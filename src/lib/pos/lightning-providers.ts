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
import { finalizeEvent, nip04 } from 'nostr-tools';
import {
	type LightningInvoice,
	decodeBolt11AmountMsat,
	isLightningAddress,
	isLnurlString,
	resolveLnurlPay,
	requestInvoice
} from './lightning';

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

export class LnurlAddressProvider implements LightningProvider {
	readonly id = 'lnaddress';
	readonly label: string;
	readonly autoConfirms = false;
	constructor(private readonly address: string) {
		this.label = `Lightning · ${address}`;
	}
	async makeInvoice(amountMsat: number, memo?: string): Promise<LightningInvoice> {
		const meta = await resolveLnurlPay(this.address);
		const inv = await requestInvoice(meta, amountMsat, memo);
		return makeInvoiceResult(inv.pr, amountMsat, 'lnurl');
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

interface NwcConnection {
	walletPubkey: string;
	relay: string;
	secret: string; // hex
}

export function parseNwcUri(uri: string): NwcConnection | null {
	const m = uri
		.trim()
		.match(/^nostr\+walletconnect:\/\/([0-9a-fA-F]{64})\?(.*)$/);
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

export class NwcProvider implements LightningProvider {
	readonly id = 'nwc';
	readonly label = 'NWC wallet';
	readonly autoConfirms = true;
	private readonly conn: NwcConnection;

	constructor(uri: string) {
		const c = parseNwcUri(uri);
		if (!c) throw new Error('Invalid NWC URI');
		this.conn = c;
	}

	/** Send a NWC request and await the wallet's encrypted response. */
	private async request(payload: unknown, timeoutMs = 20000): Promise<any> {
		const sk = hexToBytes(this.conn.secret);
		const content = await nip04.encrypt(sk, this.conn.walletPubkey, JSON.stringify(payload));
		const event = finalizeEvent(
			{
				kind: 23194,
				created_at: Math.floor(Date.now() / 1000),
				tags: [['p', this.conn.walletPubkey]],
				content
			},
			sk
		);
		return new Promise((resolve, reject) => {
			let ws: WebSocket | null = null;
			let settled = false;
			const timer = setTimeout(() => done(new Error('NWC timeout — relay unreachable or wallet offline')), timeoutMs);
			const done = (err: Error | null, val?: unknown) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				try {
					ws?.close();
				} catch {
					/* */
				}
				if (err) reject(err);
				else resolve(val);
			};
			try {
				ws = new WebSocket(this.conn.relay);
			} catch (e) {
				done(e instanceof Error ? e : new Error('NWC connection failed'));
				return;
			}
			ws.onopen = () => ws!.send(JSON.stringify(['EVENT', event]));
			ws.onmessage = async (msg) => {
				try {
					const [type, data] = JSON.parse(msg.data as string);
					if (
						type === 'EVENT' &&
						data?.kind === 23194 &&
						Array.isArray(data.tags) &&
						data.tags.some((t: string[]) => t[0] === 'e' && t[1] === event.id)
					) {
						const decrypted = await nip04.decrypt(sk, this.conn.walletPubkey, data.content);
						const result = JSON.parse(decrypted) as { result?: unknown; error?: { message?: string } };
						if (result.error) done(new Error(result.error.message ?? 'NWC error'));
						else done(null, result.result);
					}
				} catch {
					/* ignore malformed frame */
				}
			};
			ws.onerror = () => done(new Error('NWC relay connection failed'));
		});
	}

	async makeInvoice(amountMsat: number, memo?: string): Promise<LightningInvoice> {
		const r = (await this.request({
			method: 'make_invoice',
			params: { amount: Math.round(amountMsat), description: memo ?? 'BNOS sale' }
		})) as { invoice?: string; payment_request?: string; amount?: number };
		const pr = r.invoice ?? r.payment_request;
		if (!pr) throw new Error('Wallet returned no invoice');
		return makeInvoiceResult(pr, amountMsat, 'lnurl');
	}

	async getPaymentStatus(pr: string): Promise<'pending' | 'paid' | 'expired' | 'unknown'> {
		try {
			const r = (await this.request({
				method: 'lookup_invoice',
				params: { invoice: pr }
			})) as { settled?: boolean; preimage?: string };
			return r.settled ? 'paid' : 'pending';
		} catch {
			return 'unknown';
		}
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
export function selectProviderForConfig(cfg: ProviderConfig): LightningProvider | null {
	switch (cfg.lightningProvider) {
		case 'lnaddress':
			if (cfg.lightningAddress) {
				const v = cfg.lightningAddress.trim();
				if (isLightningAddress(v) || isLnurlString(v)) return new LnurlAddressProvider(v);
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

/** Resolve the merchant's configured Lightning provider, or null if none.
 *  Respects the `lightningProvider` selection from Settings → Bitcoin. */
export function getActiveLightningProvider(): LightningProvider | null {
	return selectProviderForConfig(loadProviderConfig());
}

/** Human label for the active provider (for the POS dialog header). */
export function activeProviderLabel(): string {
	const p = getActiveLightningProvider();
	return p?.label ?? '';
}
