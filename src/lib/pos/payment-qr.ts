/**
 * Payment-QR builder — maps a (payment method, amount, currency) to a scannable
 * QR payload string + display metadata, using the merchant's pay-config.
 *
 * Used by the POS checkout QR dialog AND the customer-facing display so both
 * screens render the exact same QR the customer must scan.
 */
import { browser } from '$app/environment';
import { buildPromptPay, buildVietQr, buildBankQr } from './emvco';
import { loadPayConfig, hasQrConfigured, hasLightningConfigured, type PayConfig } from './pay-config';
import { getMerchantLightning } from './lightning';

export interface PaymentQrRequest {
	method: string;
	amount: number;
	currency: string;
	note?: string;
	/** Optional override config (defaults to the stored merchant config). */
	config?: PayConfig;
}

export interface PaymentQrResult {
	/** QR payload string to encode. */
	payload: string;
	/** Human label for the QR scheme shown under the code. */
	kind: 'promptpay' | 'vietqr' | 'bank' | 'lightning' | 'unknown';
	/** Whether a real scannable QR could be built (config present). */
	configured: boolean;
	/** Short guidance when not configured. */
	hint?: string;
	/** Optional accent badge for the QR. */
	badge: 'lightning' | 'bitcoin' | 'bank' | 'qr' | 'store' | 'none';
}

/** Build the QR payload for a `qr`-type payment (PromptPay / VietQR / bank). */
export function buildQrPayment(req: PaymentQrRequest): PaymentQrResult {
	const cfg = req.config ?? loadPayConfig();
	const amount = Math.max(0, Number(req.amount) || 0);

	switch (cfg.qrScheme) {
		case 'promptpay':
			if (!cfg.promptpayId.trim()) {
				return {
					payload: '',
					kind: 'promptpay',
					configured: false,
					hint: 'Set a PromptPay ID (phone / national ID) in Settings → Pay QR.',
					badge: 'qr'
				};
			}
			return {
				payload: buildPromptPay({
					id: cfg.promptpayId,
					amount: amount > 0 ? amount : undefined,
					currency: req.currency
				}),
				kind: 'promptpay',
				configured: true,
				badge: 'qr'
			};
		case 'vietqr':
			if (!cfg.vietqrAccount.trim() || !cfg.vietqrBin.trim()) {
				return {
					payload: '',
					kind: 'vietqr',
					configured: false,
					hint: 'Set a bank BIN + account number in Settings → Pay QR.',
					badge: 'qr'
				};
			}
			return {
				payload: buildVietQr({
					bin: cfg.vietqrBin,
					account: cfg.vietqrAccount,
					amount: amount > 0 ? amount : undefined,
					currency: req.currency,
					message: req.note
				}),
				kind: 'vietqr',
				configured: true,
				badge: 'qr'
			};
		case 'bank':
		default:
			if (!cfg.bankAccountNumber.trim()) {
				return {
					payload: '',
					kind: 'bank',
					configured: false,
					hint: 'Set a bank account in Settings → Pay QR.',
					badge: 'bank'
				};
			}
			return {
				payload: buildBankQr({
					accountName: cfg.bankAccountName,
					accountNumber: cfg.bankAccountNumber,
					bankName: cfg.bankName,
					amount: amount > 0 ? amount : undefined,
					currency: req.currency,
					note: req.note
				}),
				kind: 'bank',
				configured: true,
				badge: 'bank'
			};
	}
}

/** Build a Lightning QR payload from the merchant's configured Lightning
 *  address/URI. The Lightning address is owned by Settings → Bitcoin (single
 *  source of truth) — resolved via the lightning client. */
export function buildLightningPayment(req: PaymentQrRequest): PaymentQrResult {
	void req;
	// Resolve from the single source (Bitcoin settings). For a live
	// amount-locked invoice the POS calls lightning.fetchInvoiceForAmount
	// directly — this builder only produces the static fallback QR.
	const wallet = getMerchantLightning();
	if (!wallet) {
		return {
			payload: '',
			kind: 'lightning',
			configured: false,
			hint: 'Set a Lightning address in Settings → Bitcoin.',
			badge: 'lightning'
		};
	}
	return {
		payload: `lightning:${wallet.address}`,
		kind: 'lightning',
		configured: true,
		badge: 'lightning'
	};
}

/** Dispatcher: pick the right builder from the POS payment method id. */
export function buildPaymentQr(req: PaymentQrRequest): PaymentQrResult {
	const m = req.method.toLowerCase();
	if (m === 'lightning') return buildLightningPayment(req);
	if (m === 'qr' || m === 'bank_transfer' || m === 'bank' || m === 'mobile_payment')
		return buildQrPayment(req);
	return { payload: '', kind: 'unknown', configured: false, hint: 'No QR for this method', badge: 'none' };
}

/** Convenience: is this payment method QR-capable (qr / lightning / bank)? */
export function isQrMethod(method: string): boolean {
	const m = method.toLowerCase();
	return m === 'qr' || m === 'lightning' || m === 'bank_transfer' || m === 'bank' || m === 'mobile_payment';
}

/** Whether the merchant has *any* QR method ready (config present). */
export function qrCheckoutReady(): boolean {
	if (!browser) return false;
	const cfg = loadPayConfig();
	return hasQrConfigured(cfg) || hasLightningConfigured(cfg);
}
