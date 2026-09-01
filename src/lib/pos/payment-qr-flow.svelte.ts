/**
 * Payment QR checkout flow — the state machine behind the POS payment dialog.
 *
 * Owns everything QR/Lightning-mechanical so the POS page doesn't have to:
 * dialog open/close, invoice fetch + regenerate, the 15-minute countdown,
 * expiry, payment detection (push watch + poll backstop), and the cashier's
 * on-demand "Check payment". UI feedback and sale completion stay with the
 * caller via `PaymentFlowDeps` callbacks (SRP: no toasts / no cart here).
 *
 * Honest phase model (drives the dialog's 3-step timeline):
 *   preparing → awaiting → paid
 *                 └→ expired
 */
import type { PaymentQrResult } from './payment-qr';
import { getActiveLightningProvider, type LightningProvider } from './lightning-providers';
import { getMerchantLightning } from './lightning';

export type PaymentCheckResult = 'paid' | 'pending' | 'unknown';

/** How the flow detects payment for the active invoice. */
export type PaymentDetectMode = 'instant' | 'poll' | 'manual';

export interface PaymentFlowDeps {
	/** Local-currency amount → sats (uses the live BTC rate). 0 when unavailable. */
	satsFromAmount(amountLocal: number): number;
	/** Default invoice memo (e.g. cart contents). */
	defaultMemo(): string;
	/** Whether the customer-facing display should mirror the QR. */
	showOnCustomerDisplay(): boolean;
	/** Push the QR to the customer display. */
	broadcastQr(payload: string, total: number, method: string, kind: string, badge: string): void;
	/** Clear the customer display QR. */
	broadcastQrClear(): void;
	/** A payment was detected (push / poll / manual check) — complete the sale. */
	onAutoPaid(): void;
	/** UI notifications (the caller maps these to toasts). */
	notify(
		kind: 'no-provider' | 'fallback' | 'invoice-error' | 'no-rate',
		detail?: string
	): void;
}

const QR_WINDOW_SEC = 15 * 60;

export class PaymentQrFlowStore {
	// ── dialog state ────────────────────────────────────────────────────
	open = $state(false);
	result = $state<PaymentQrResult | null>(null);
	amount = $state(0);
	method = $state('');
	note = $state('');
	/** True while fetching a live Lightning invoice. */
	fetching = $state(false);
	/** True while the sale is being recorded (post-confirm). */
	loading = $state(false);
	/** The live BOLT11 invoice (enables regenerate + sats display). */
	invoice = $state<{ pr: string; amountSats: number } | null>(null);
	/** How the memo travels on this invoice (honest dialog feedback). */
	memoDelivery = $state<'invoice' | 'comment' | 'zap' | 'none'>('none');
	/** Real amount-locked invoice vs a static fallback QR. */
	isInvoice = $state(false);
	/** Active Lightning provider (re-assigned after fetch so `autoConfirms`
	 *  flips are picked up — LnurlAddressProvider proves capability late). */
	provider = $state<LightningProvider | null>(null);
	/** Payment detected (push / poll / manual). */
	paid = $state(false);
	/** Cashier-triggered check in flight. */
	checking = $state(false);
	/** Inline feedback from the last manual check. */
	lastCheck = $state<'none' | 'pending' | 'unknown' | 'error'>('none');
	expiresAt = $state(0);
	secondsLeft = $state(0);

	private timer: ReturnType<typeof setInterval> | null = null;
	private pollTimer: ReturnType<typeof setInterval> | null = null;
	private watchStop: (() => void) | null = null;

	constructor(private readonly deps: PaymentFlowDeps) {}

	// ── derived (plain getters — reactive through $state reads) ─────────

	/** Honest phase for the dialog timeline. */
	get phase(): 'preparing' | 'awaiting' | 'paid' | 'expired' {
		if (this.paid) return 'paid';
		if (!this.open) return 'preparing';
		if (this.secondsLeft <= 0) return 'expired';
		if (this.fetching || !this.result?.payload) return 'preparing';
		return 'awaiting';
	}

	get expired(): boolean {
		return this.open && !this.paid && this.secondsLeft <= 0;
	}

	/** Detection capability of the active invoice's provider. */
	get detectMode(): PaymentDetectMode {
		const p = this.provider;
		if (!p || !p.autoConfirms) return 'manual';
		return typeof p.watchPayment === 'function' ? 'instant' : 'poll';
	}

	/** True when automatic watchers are running (drives the watching banner). */
	get watching(): boolean {
		return this.isInvoice && !this.paid && !this.expired && this.detectMode !== 'manual';
	}

	// ── open paths ──────────────────────────────────────────────────────

	/** Lightning path: pre-open in a fetching state, then fetch a live invoice. */
	openLightning(amount: number, memo?: string) {
		const provider = getActiveLightningProvider();
		if (!provider) {
			this.deps.notify('no-provider');
			return;
		}
		this.provider = provider;
		this.result = { payload: '', kind: 'lightning', configured: true, badge: 'lightning' };
		this.amount = amount;
		this.method = 'lightning';
		this.note = memo?.trim() || this.deps.defaultMemo();
		this.invoice = null;
		this.memoDelivery = 'none';
		this.isInvoice = false;
		this.paid = false;
		this.lastCheck = 'none';
		this.fetching = true;
		this.beginWindow();
		void this.fetchInvoice(amount, provider);
	}

	/** Static QR path (PromptPay / VietQR / bank): instant, offline. */
	openStatic(result: PaymentQrResult, amount: number, method: string, note = '') {
		this.result = result;
		this.amount = amount;
		this.method = method;
		this.note = note;
		this.invoice = null;
		this.isInvoice = false;
		this.provider = null;
		this.paid = false;
		this.fetching = false;
		this.lastCheck = 'none';
		this.beginWindow();
		if (this.deps.showOnCustomerDisplay()) {
			this.deps.broadcastQr(result.payload, amount, method, result.kind, result.badge);
		}
	}

	/** Fetch (or re-fetch) a Lightning invoice; static-address fallback on error. */
	async regenerate() {
		if (!this.open || this.method !== 'lightning' || !this.provider || this.paid) return;
		this.lastCheck = 'none';
		await this.fetchInvoice(this.amount, this.provider);
	}

	// ── payment detection ───────────────────────────────────────────────

	/** Cashier-triggered one-shot check. Sets inline feedback; when it finds
	 *  the payment settled it behaves exactly like an auto-detect. */
	async checkNow(): Promise<void> {
		if (this.checking || this.paid || this.loading || this.expired) return;
		const provider = this.provider;
		const pr = this.invoice?.pr;
		if (!provider || !pr) {
			this.lastCheck = 'unknown';
			return;
		}
		this.checking = true;
		try {
			let status: PaymentCheckResult | 'expired' = 'unknown';
			if (typeof provider.checkPaymentNow === 'function') {
				status = await provider.checkPaymentNow(pr);
			} else if (provider.getPaymentStatus) {
				status = await provider.getPaymentStatus(pr);
			}
			if (status === 'paid') {
				this.markPaid();
			} else if (status === 'pending') {
				this.lastCheck = 'pending';
			} else {
				this.lastCheck = 'unknown';
			}
		} catch {
			this.lastCheck = 'error';
		} finally {
			this.checking = false;
		}
	}

	/** Payment confirmed (any path): freeze state and hand off to the page. */
	markPaid() {
		if (this.paid) return;
		this.paid = true;
		this.stopDetection();
		this.deps.onAutoPaid();
	}

	// ── lifecycle ───────────────────────────────────────────────────────

	/** Close the dialog and tear down timers/watchers + customer display. */
	close() {
		this.open = false;
		this.result = null;
		this.invoice = null;
		this.provider = null;
		this.paid = false;
		this.fetching = false;
		this.loading = false;
		this.lastCheck = 'none';
		this.stopDetection();
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
		this.deps.broadcastQrClear();
	}

	/** Full teardown (component unmount). */
	destroy() {
		this.close();
	}

	// ── internals ───────────────────────────────────────────────────────

	private beginWindow() {
		this.expiresAt = Date.now() + QR_WINDOW_SEC * 1000;
		this.secondsLeft = QR_WINDOW_SEC;
		this.open = true;
		if (this.timer) clearInterval(this.timer);
		this.timer = setInterval(() => {
			this.secondsLeft = Math.max(0, Math.floor((this.expiresAt - Date.now()) / 1000));
			if (this.secondsLeft <= 0 && this.timer) {
				clearInterval(this.timer);
				this.timer = null;
				// Detection past expiry is pointless — stop watching/polling.
				this.stopDetection();
			}
		}, 1000);
	}

	private async fetchInvoice(amount: number, provider: LightningProvider) {
		this.fetching = true;
		try {
			const sats = this.deps.satsFromAmount(amount);
			if (sats <= 0) throw new Error('No BTC rate available');
			const invoice = await provider.makeInvoice(sats * 1000, this.note || this.deps.defaultMemo());
			this.invoice = { pr: invoice.pr, amountSats: invoice.amountSats };
			this.memoDelivery = invoice.memoDelivery ?? (provider.id === 'lnaddress' ? 'none' : 'invoice');
			// Re-assign so the dialog re-reads `autoConfirms` — makeInvoice flips
			// it on when the provider proves auto-confirmable (zap/verify).
			this.provider = provider;
			this.isInvoice = true;
			this.result = { payload: invoice.pr, kind: 'lightning', configured: true, badge: 'lightning' };
			if (this.deps.showOnCustomerDisplay()) {
				this.deps.broadcastQr(invoice.pr, amount, 'lightning', 'lightning', 'lightning');
			}
			this.startDetection(provider, invoice.pr);
		} catch (e) {
			// Graceful fallback: static address QR (Lightning Address path only).
			const wallet = getMerchantLightning();
			if (wallet) {
				const fallback = `lightning:${wallet.address}`;
				this.isInvoice = false;
				this.result = { payload: fallback, kind: 'lightning', configured: true, badge: 'lightning' };
				this.deps.notify('fallback', e instanceof Error ? e.message : '');
				if (this.deps.showOnCustomerDisplay()) {
					this.deps.broadcastQr(fallback, amount, 'lightning', 'lightning', 'lightning');
				}
			} else {
				this.isInvoice = false;
				this.result = { payload: '', kind: 'lightning', configured: true, badge: 'lightning' };
				this.deps.notify('invoice-error', e instanceof Error ? e.message : undefined);
			}
		} finally {
			this.fetching = false;
		}
	}

	/** Two-layer detection, matching NIP-47 / LNURL capabilities:
	 *  1) push watch (NWC kind 7375 / zap receipts) — instant;
	 *  2) poll backstop (`lookup_invoice` / verify URL) — 4s (10s when push is active). */
	private startDetection(provider: LightningProvider, pr: string) {
		this.stopDetection();
		if (!provider.autoConfirms) return;
		const hasPush = typeof provider.watchPayment === 'function';
		if (hasPush) {
			this.watchStop = provider.watchPayment!(pr, () => this.markPaid());
		}
		if (!provider.getPaymentStatus) return;
		const intervalMs = hasPush ? 10_000 : 4_000;
		this.pollTimer = setInterval(async () => {
			if (!this.open || this.paid || this.expired) {
				this.stopDetection();
				return;
			}
			const status = await provider.getPaymentStatus!(pr).catch(() => 'unknown' as const);
			if (status === 'paid') this.markPaid();
		}, intervalMs);
	}

	private stopDetection() {
		if (this.pollTimer) {
			clearInterval(this.pollTimer);
			this.pollTimer = null;
		}
		if (this.watchStop) {
			this.watchStop();
			this.watchStop = null;
		}
	}
}

/** m:ss countdown formatting (shared by the dialog). */
export function fmtCountdown(s: number): string {
	const m = Math.floor(s / 60);
	const sec = s % 60;
	return `${m}:${sec.toString().padStart(2, '0')}`;
}
