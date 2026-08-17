/**
 * Lightning provider abstraction — every provider configured in
 * Settings → Bitcoin resolves to one of these, so the POS checkout works no
 * matter which the merchant picked (Lightning Address, Blink, NWC, LND,
 * PhoenixD, Alby, Strike).
 *
 * Each provider implements `makeInvoice()`; providers that can poll payment
 * status also implement `getPaymentStatus()` → the POS can auto-confirm the
 * sale the moment the customer pays (no "Mark paid" tap needed).
 *
 * Browser feasibility:
 *   - Lightning Address (LNURL-pay)  ✅ fully client-side
 *   - Blink (Galoy GraphQL)          ✅ fully client-side (CORS-enabled)
 *   - NWC (Nostr Wallet Connect)     ✅ fully client-side (Nostr + NIP-04)
 *   - Alby (REST)                    ⚠️ best-effort (CORS depends on plan)
 *   - LND (REST)                     ⚠️ needs CORS-enabled node or backend
 *   - PhoenixD (HTTP)                ⚠️ localhost / mixed-content caveats
 *   - Strike (REST)                  ⚠️ best-effort
 * On any failure the POS falls back to a static `lightning:` QR.
 */
import { browser } from '$app/environment';
import type { Event } from 'nostr-tools/pure';
import {
	nwcConnect,
	nwcLookupInvoice,
	nwcMakeInvoice,
	watchPaymentReceived,
	nwcNotificationMatchesInvoice,
	type NwcConnection
} from '$lib/nostr/nwc-client';
import {
	type LightningInvoice,
	checkVerifyUrl,
	decodeBolt11AmountMsat,
	isLightningAddress,
	isLnurlString,
	lnurlSupportsZap,
	resolveLnurlPay,
	requestInvoice
} from './lightning';
import { buildZapRequest, watchZapReceipts } from './zap-receipts';

const BITCOIN_SETTINGS_KEY = 'bnos-os:settings-bitcoin';

export interface ProviderConfig {
	lightningProvider: string;
	lightningAddress: string;
	nwcUrl: string;
	lndUrl: string;
	lndMacaroon: string;
	phoenixdUrl: string;
	phoenixdPass: string;
	albyApiKey: string;
	blinkApiKey: string;
	blinkWalletId: string;
	strikeApiKey: string;
}

export function loadProviderConfig(): ProviderConfig {
	if (!browser) return {} as ProviderConfig;
	try {
		return JSON.parse(localStorage.getItem(BITCOIN_SETTINGS_KEY) ?? '{}') as ProviderConfig;
	} catch {
		return {} as ProviderConfig;
	}
}

export interface LightningProvider {
	readonly id: string;
	readonly label: string;
	/** Can this provider report payment status (for auto-confirm)? */
	readonly autoConfirms: boolean;
	/** Issue an amount-locked invoice. */
	makeInvoice(amountMsat: number, memo?: string): Promise<LightningInvoice>;
	/** Poll payment status (optional). Returns 'unknown' if unsupported. */
	getPaymentStatus?(pr: string): Promise<'pending' | 'paid' | 'expired' | 'unknown'>;
	/** Push-based payment watch (optional, NWC kind 7375): fires once when the
	 *  invoice is settled. Returns an unwatch function. When absent the POS
	 *  falls back to `getPaymentStatus` polling. */
	watchPayment?(pr: string, onPaid: (preimage?: string) => void): () => void;
}

function makeInvoiceResult(
	pr: string,
	expectedMsat: number,
	source: LightningInvoice['source']
): LightningInvoice {
	const verified = decodeBolt11AmountMsat(pr);
	const amountMsat = verified ?? expectedMsat;
	return {
		pr,
		amountMsat,
		amountSats: Math.round(amountMsat / 1000),
		expiresAt: Math.floor(Date.now() / 1000) + 3600,
		source
	};
}

/* ── 1. Lightning Address (LNURL-pay) ──────────────────────────────────── */

/** Detection context that lets a plain Lightning Address auto-confirm: the
 *  merchant's Nostr pubkey (9734 `p` tag + receipt filter) and the relays to
 *  watch for NIP-57 kind 9735 zap receipts. */
export interface LnurlDetectionContext {
	recipientPubkey?: string;
	relays?: string[];
}

/** Widely-readable relays used when the merchant hasn't configured any
 *  (subset of the app's builtin relay list). */
const FALLBACK_ZAP_RELAYS = ['wss://nos.lol', 'wss://relay.damus.io', 'wss://relay.nostr.band'];

export class LnurlAddressProvider implements LightningProvider {
	readonly id = 'lnaddress';
	readonly label: string;
	/** Starts false; `makeInvoice` flips it true once the provider proves
	 *  auto-confirmable (NIP-57 zap receipts and/or a pollable verify URL). */
	autoConfirms = false;
	/** Per-invoice detection state, populated by makeInvoice. */
	private pending: {
		pr: string;
		verifyUrl?: string;
		zapRequestId?: string;
		recipientPubkey?: string;
		relays?: string[];
	} | null = null;

	constructor(
		private readonly address: string,
		private readonly ctx?: LnurlDetectionContext
	) {
		this.label = `Lightning · ${address}`;
	}

	async makeInvoice(amountMsat: number, memo?: string): Promise<LightningInvoice> {
		const meta = await resolveLnurlPay(this.address);
		// "Zaps style" push detection: NIP-57-capable providers publish a kind
		// 9735 receipt the moment the customer pays the invoice.
		const zapCapable =
			lnurlSupportsZap(meta) && !!this.ctx?.recipientPubkey && !!this.ctx.relays?.length;
		let zap: Event | undefined;
		if (zapCapable) {
			zap = buildZapRequest({
				recipientPubkey: this.ctx!.recipientPubkey!,
				amountMsat,
				relays: this.ctx!.relays!,
				memo
			});
		}
		const inv = await requestInvoice(
			meta,
			amountMsat,
			memo,
			zap ? JSON.stringify(zap) : undefined
		);
		this.pending = {
			pr: inv.pr,
			verifyUrl: inv.verifyUrl,
			zapRequestId: zap?.id,
			recipientPubkey: this.ctx?.recipientPubkey,
			relays: this.ctx?.relays
		};
		this.autoConfirms = !!zap || !!inv.verifyUrl;
		return { ...makeInvoiceResult(inv.pr, amountMsat, 'lnurl'), verifyUrl: inv.verifyUrl };
	}

	/** Push: settle the instant the provider publishes the 9735 receipt. */
	watchPayment(pr: string, onPaid: (preimage?: string) => void): () => void {
		const p = this.pending;
		if (!p || p.pr !== pr || !p.zapRequestId || !p.recipientPubkey || !p.relays?.length)
			return () => {};
		return watchZapReceipts({
			relays: p.relays,
			recipientPubkey: p.recipientPubkey,
			requestId: p.zapRequestId,
			pr,
			onPaid
		});
	}

	/** Poll backstop: the LNURL-pay `verify` URL (spec LUD-06), when the
	 *  provider returns one. */
	async getPaymentStatus(pr: string): Promise<'pending' | 'paid' | 'expired' | 'unknown'> {
		const p = this.pending;
		if (!p || p.pr !== pr || !p.verifyUrl) return 'unknown';
		return checkVerifyUrl(p.verifyUrl);
	}
}

/* ── 2. Blink (Galoy) GraphQL ──────────────────────────────────────────── */

export class BlinkProvider implements LightningProvider {
	readonly id = 'blink';
	readonly label = 'Blink (Galoy)';
	readonly autoConfirms = true;
	private readonly endpoint = 'https://api.blink.sv/graphql';
	private discoveredWalletId: string | null = null;

	constructor(
		private readonly apiKey: string,
		private readonly walletId?: string
	) {}

	private async gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
		const res = await fetch(this.endpoint, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Api-Key': this.apiKey
			},
			body: JSON.stringify({ query, variables })
		});
		if (!res.ok) throw new Error(`Blink HTTP ${res.status}`);
		const j = (await res.json()) as { errors?: { message: string }[]; data?: T };
		if (j.errors?.length) throw new Error(`Blink: ${j.errors[0].message}`);
		return j.data as T;
	}

	async makeInvoice(amountMsat: number, memo?: string): Promise<LightningInvoice> {
		const sats = Math.round(amountMsat / 1000);
		let walletId: string | undefined = this.walletId || this.discoveredWalletId || undefined;
		if (!walletId) {
			const q = await this.gql<{
				me?: { defaultAccount?: { wallets?: { id: string; walletCurrency: string }[] } };
			}>(
				`query { me { defaultAccount { wallets { id walletCurrency } } } }`,
				{}
			);
			walletId =
				q.me?.defaultAccount?.wallets?.find((w) => w.walletCurrency === 'BTC')?.id ??
				q.me?.defaultAccount?.wallets?.[0]?.id;
			if (!walletId) throw new Error('No BTC wallet found in your Blink account');
			this.discoveredWalletId = walletId;
		}
		const r = await this.gql<{
			lnInvoiceCreate?: {
				invoice?: { paymentRequest?: string; satoshis?: number };
				errors?: { message: string }[];
			};
		}>(
			// Blink/Galoy `LnInvoiceCreateInput` fields (verified via introspection):
			//   amount, walletId, memo, expiresIn (Minutes), externalId
			`mutation($i: LnInvoiceCreateInput!) { lnInvoiceCreate(input:$i) { invoice { paymentRequest satoshis } errors { message } } }`,
			{ i: { walletId, amount: sats, memo: memo ?? 'BNOS sale', expiresIn: 15 } }
		);
		const errs = r.lnInvoiceCreate?.errors;
		if (errs?.length) throw new Error(`Blink: ${errs[0].message}`);
		const pr = r.lnInvoiceCreate?.invoice?.paymentRequest;
		if (!pr) throw new Error('Blink returned no invoice');
		return makeInvoiceResult(pr, amountMsat, 'lnurl');
	}

	async getPaymentStatus(pr: string): Promise<'pending' | 'paid' | 'expired' | 'unknown'> {
		try {
			const r = await this.gql<{
				lnInvoicePaymentStatusByPaymentRequest?: { status?: string };
			}>(
				// Root Query field is `lnInvoicePaymentStatusByPaymentRequest`
				// (verified via introspection — there is no `lnInvoicePaymentStatus` root field).
				// status enum: PAID | PENDING | EXPIRED
				`query($r: LnInvoicePaymentStatusByPaymentRequestInput!) { lnInvoicePaymentStatusByPaymentRequest(input:$r) { status } }`,
				{ r: { paymentRequest: pr } }
			);
			const s = (r.lnInvoicePaymentStatusByPaymentRequest?.status ?? '').toUpperCase();
			if (s === 'PAID') return 'paid';
			if (s === 'EXPIRED') return 'expired';
			return 'pending';
		} catch {
			return 'unknown';
		}
	}
}

/* ── 3. NWC (Nostr Wallet Connect) ─────────────────────────────────────── */

export interface NwcConnectionLegacy {
	walletPubkey: string;
	relay: string;
	secret: string; // hex
}

/** Parse a NWC URI (single-relay legacy shape; kept for compatibility). */
export function parseNwcUri(uri: string): NwcConnectionLegacy | null {
	const m = uri.trim().match(/^nostr\+walletconnect:\/\/([0-9a-fA-F]{64})\?(.*)$/);
	if (!m) return null;
	const params = new URLSearchParams(m[2]);
	const relay = params.get('relay');
	const secret = params.get('secret');
	if (!relay || !secret) return null;
	return { walletPubkey: m[1].toLowerCase(), relay, secret: secret.toLowerCase() };
}

function hexToBytes(hex: string): Uint8Array {
	const out = new Uint8Array(hex.length / 2);
	for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
	return out;
}

/**
 * NWC provider — delegates to the shared persistent client in
 * `$lib/nostr/nwc-client` (multi-relay SimplePool, correct kind 23195 response
 * handling). Auto-detection is two-layered, matching NIP-47:
 *   1. `watchPayment` — push: the wallet emits kind 7375 `payment_received`
 *      the moment sats land (instant, authenticated by the wallet key).
 *   2. `getPaymentStatus` — pull backstop: `lookup_invoice` polling for
 *      wallets that don't push notifications.
 */
export class NwcProvider implements LightningProvider {
	readonly id = 'nwc';
	readonly label = 'NWC wallet';
	readonly autoConfirms = true;
	private readonly conn: NwcConnection;

	constructor(uri: string) {
		// Validates the URI (throws on garbage) and activates the shared connection.
		try {
			this.conn = nwcConnect(uri);
		} catch (e) {
			throw e instanceof Error ? e : new Error('Invalid NWC URI');
		}
	}

	async makeInvoice(amountMsat: number, memo?: string): Promise<LightningInvoice> {
		const pr = await nwcMakeInvoice(amountMsat, memo ?? 'BNOS sale');
		return makeInvoiceResult(pr, amountMsat, 'lnurl');
	}

	async getPaymentStatus(pr: string): Promise<'pending' | 'paid' | 'expired' | 'unknown'> {
		try {
			const r = await nwcLookupInvoice(pr);
			return r?.settled ? 'paid' : 'pending';
		} catch {
			return 'unknown';
		}
	}

	/** Push-based: settle the moment the wallet emits `payment_received`.
	 *  When the notification carries the BOLT11 we match it exactly; some
	 *  wallets omit it, so we then confirm via an authoritative lookup. */
	watchPayment(pr: string, onPaid: (preimage?: string) => void): () => void {
		let done = false;
		const settle = (preimage?: string) => {
			if (done) return;
			done = true;
			unwatch();
			onPaid(preimage);
		};
		const unwatch = watchPaymentReceived((n) => {
			if (nwcNotificationMatchesInvoice(n, pr)) {
				settle(n.preimage);
			} else if (!n.invoice) {
				// No BOLT11 in the notification — can't match by string; ask the
				// wallet whether *our* invoice settled.
				void nwcLookupInvoice(pr)
					.then((s) => {
						if (s?.settled) settle(s.preimage);
					})
					.catch(() => {
						/* keep waiting */
					});
			}
		});
		return () => {
			done = true;
			unwatch();
		};
	}
}

/* ── 4. Alby (REST) ────────────────────────────────────────────────────── */

export class AlbyProvider implements LightningProvider {
	readonly id = 'alby';
	readonly label = 'Alby';
	readonly autoConfirms = true;
	private readonly endpoint = 'https://api.getalby.com';
	constructor(private readonly apiKey: string) {}

	async makeInvoice(amountMsat: number, memo?: string): Promise<LightningInvoice> {
		const sats = Math.round(amountMsat / 1000);
		const res = await fetch(`${this.endpoint}/invoices`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${this.apiKey}`
			},
			body: JSON.stringify({ amount: sats, description: memo ?? 'BNOS sale' })
		});
		if (!res.ok) throw new Error(`Alby HTTP ${res.status} (browser CORS may block this)`);
		const j = (await res.json()) as { payment_request?: string };
		if (!j.payment_request) throw new Error('Alby returned no invoice');
		return makeInvoiceResult(j.payment_request, amountMsat, 'lnurl');
	}

	async getPaymentStatus(pr: string): Promise<'pending' | 'paid' | 'expired' | 'unknown'> {
		try {
			const res = await fetch(`${this.endpoint}/invoices/${encodeURIComponent(pr)}`, {
				headers: { Authorization: `Bearer ${this.apiKey}` }
			});
			if (!res.ok) return 'unknown';
			const j = (await res.json()) as { settled?: boolean };
			return j.settled ? 'paid' : 'pending';
		} catch {
			return 'unknown';
		}
	}
}

/* ── 5. LND (REST) ─────────────────────────────────────────────────────── */

export class LndProvider implements LightningProvider {
	readonly id = 'lnd';
	readonly label = 'LND (REST)';
	readonly autoConfirms = false;
	constructor(
		private readonly baseUrl: string,
		private readonly macaroonHex: string
	) {}

	async makeInvoice(amountMsat: number, memo?: string): Promise<LightningInvoice> {
		const url = `${this.baseUrl.replace(/\/$/, '')}/v1/invoices`;
		const res = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Grpc-Metadata-macaroon': this.macaroonHex
			},
			body: JSON.stringify({ value_msat: String(Math.round(amountMsat)), memo: memo ?? 'BNOS sale' })
		});
		if (!res.ok)
			throw new Error(
				`LND HTTP ${res.status}. Requires a CORS-enabled node (--restcors='*') and trusted TLS cert. A backend signing proxy is the secure alternative.`
			);
		const j = (await res.json()) as { payment_request?: string };
		if (!j.payment_request) throw new Error('LND returned no invoice');
		return makeInvoiceResult(j.payment_request, amountMsat, 'lnurl');
	}
}

/* ── 6. PhoenixD (HTTP) ────────────────────────────────────────────────── */

export class PhoenixDProvider implements LightningProvider {
	readonly id = 'phoenixd';
	readonly label = 'PhoenixD';
	readonly autoConfirms = false;
	constructor(
		private readonly baseUrl: string,
		private readonly password: string
	) {}

	async makeInvoice(amountMsat: number, memo?: string): Promise<LightningInvoice> {
		const sats = Math.round(amountMsat / 1000);
		const url = `${this.baseUrl.replace(/\/$/, '')}/invoices`;
		const body = new URLSearchParams({
			amountSat: String(sats),
			description: memo ?? 'BNOS sale'
		});
		const res = await fetch(url, {
			method: 'POST',
			headers: {
				Authorization: 'Basic ' + btoa('phoenixd:' + this.password),
				'Content-Type': 'application/x-www-form-urlencoded'
			},
			body
		});
		if (!res.ok) throw new Error(`PhoenixD HTTP ${res.status}`);
		const j = (await res.json()) as { invoice?: string };
		const pr = j.invoice;
		if (!pr) throw new Error('PhoenixD returned no invoice');
		return makeInvoiceResult(pr, amountMsat, 'lnurl');
	}
}

/* ── 7. Strike (REST, limited) ─────────────────────────────────────────── */

export class StrikeProvider implements LightningProvider {
	readonly id = 'strike';
	readonly label = 'Strike';
	readonly autoConfirms = false;
	private readonly endpoint = 'https://api.strike.me';
	constructor(private readonly apiKey: string) {}

	async makeInvoice(amountMsat: number, memo?: string): Promise<LightningInvoice> {
		const sats = Math.round(amountMsat / 1000);
		// Strike's BTC invoice flow: create a quote (no receiver handle) for on-chain/Lightning.
		const res = await fetch(`${this.endpoint}/v1/invoices`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${this.apiKey}`
			},
			body: JSON.stringify({
				correlationId: `bnos-${Date.now()}`,
				description: memo ?? 'BNOS sale',
				amount: { currency: 'BTC', amount: sats / 1e8 }
			})
		});
		if (!res.ok) throw new Error(`Strike HTTP ${res.status} (browser CORS may block this)`);
		const j = (await res.json()) as { invoiceId?: string };
		if (!j.invoiceId) throw new Error('Strike returned no invoice id');
		// Then fetch the Lightning payment request for that invoice.
		const prRes = await fetch(`${this.endpoint}/v1/invoices/${j.invoiceId}/quote`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${this.apiKey}`
			},
			body: JSON.stringify({ sourceCurrency: 'BTC', sourceAmount: sats / 1e8 })
		});
		if (!prRes.ok) throw new Error('Strike quote request failed');
		const prJ = (await prRes.json()) as { lightning?: string };
		if (!prJ.lightning) throw new Error('Strike returned no Lightning invoice');
		return makeInvoiceResult(prJ.lightning, amountMsat, 'lnurl');
	}
}

/* ── Factory ───────────────────────────────────────────────────────────── */

/** Pure selection: given a provider config, return the matching provider or null.
 *  (No localStorage / browser dependency — easy to unit test.) */
export function selectProviderForConfig(
	cfg: ProviderConfig,
	ctx?: LnurlDetectionContext
): LightningProvider | null {
	switch (cfg.lightningProvider) {
		case 'lnaddress':
			if (cfg.lightningAddress) {
				const v = cfg.lightningAddress.trim();
				if (isLightningAddress(v) || isLnurlString(v))
					return new LnurlAddressProvider(v, ctx);
			}
			return null;
		case 'blink':
			return cfg.blinkApiKey?.trim()
				? new BlinkProvider(cfg.blinkApiKey.trim(), cfg.blinkWalletId?.trim() || undefined)
				: null;
		case 'nwc':
			return cfg.nwcUrl?.trim() ? new NwcProvider(cfg.nwcUrl.trim()) : null;
		case 'alby':
			return cfg.albyApiKey?.trim() ? new AlbyProvider(cfg.albyApiKey.trim()) : null;
		case 'lnd':
			return cfg.lndUrl?.trim() && cfg.lndMacaroon?.trim()
				? new LndProvider(cfg.lndUrl.trim(), cfg.lndMacaroon.trim())
				: null;
		case 'phoenixd':
			return cfg.phoenixdUrl?.trim() && cfg.phoenixdPass?.trim()
				? new PhoenixDProvider(cfg.phoenixdUrl.trim(), cfg.phoenixdPass.trim())
				: null;
		case 'strike':
			return cfg.strikeApiKey?.trim() ? new StrikeProvider(cfg.strikeApiKey.trim()) : null;
		default:
			return null;
	}
}

/** Best-effort browser context for Lightning Address auto-confirm: the
 *  merchant's Nostr pubkey (persisted by the session store) and the app's
 *  configured relays (or a readable fallback subset). */
export function loadDetectionContext(): LnurlDetectionContext {
	if (!browser) return {};
	let recipientPubkey: string | undefined;
	let relays: string[] | undefined;
	try {
		const pk = localStorage.getItem('nostr_pubkey');
		if (pk && /^[0-9a-f]{64}$/i.test(pk)) recipientPubkey = pk.toLowerCase();
	} catch {
		/* ignore */
	}
	try {
		const raw = localStorage.getItem('bnos-os:relays');
		if (raw) {
			const parsed = JSON.parse(raw) as unknown;
			const urls: unknown[] = Array.isArray(parsed)
				? parsed
				: parsed && typeof parsed === 'object' && Array.isArray((parsed as { relays?: unknown[] }).relays)
					? (parsed as { relays: unknown[] }).relays
					: [];
			relays = [
				...new Set(
					urls
						.map((u) => String(u).trim())
						.filter((u) => /^wss:\/\//.test(u))
				)
			].slice(0, 6);
		}
	} catch {
		/* ignore */
	}
	if (!relays?.length) relays = FALLBACK_ZAP_RELAYS;
	return { recipientPubkey, relays };
}

/** Resolve the merchant's configured Lightning provider, or null if none.
 *  Respects the `lightningProvider` selection from Settings → Bitcoin. */
export function getActiveLightningProvider(): LightningProvider | null {
	return selectProviderForConfig(loadProviderConfig(), loadDetectionContext());
}

/** Human label for the active provider (for the POS dialog header). */
export function activeProviderLabel(): string {
	const p = getActiveLightningProvider();
	return p?.label ?? '';
}
