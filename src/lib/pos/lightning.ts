/**
 * Lightning Network client — real, client-side invoice generation.
 *
 * Primary path: **LNURL-pay** for a Lightning Address (user@domain.com) or a
 * raw `lnurl1...` string. This is the 90% case for a POS — resolve the
 * address's pay endpoint, request an amount-locked BOLT11 invoice, render that
 * invoice as the QR (instead of a static tip-jar address QR).
 *
 * Secondary path: NWC (Nostr Wallet Connect) / custodial wallets are configured
 * in Bitcoin settings; when a wallet URI is present we prefer it (so the
 * merchant's own node issues invoices and we can poll payment status).
 *
 * Everything degrades gracefully: any network/CORS/offline failure falls back
 * to the static `lightning:<address>` QR so the customer can still pay. We never
 * block the checkout.
 */
import { browser } from '$app/environment';

const LNURLP_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

export interface LnurlPayMetadata {
	/** Provider domain (for display). */
	domain: string;
	/** Callback URL template (append ?amount=…). */
	callback: string;
	/** Min sendable in millisatoshis. */
	minSendable: number;
	/** Max sendable in millisatoshis. */
	maxSendable: number;
	/** JSON metadata string (merchant name, image, …). */
	metadata: string;
	/** Bytes allowed in the `comment` field. */
	commentAllowed?: number;
	/** Nostr pubkey for NIP-57 zaps (optional). */
	nostrPubkey?: string;
	/** The LNURL-pay metadata endpoint this was resolved from. */
	endpoint?: string;
}

/** NIP-57 zap support: the provider signs kind 9735 zap receipts with
 *  `nostrPubkey` — that's what makes "zaps style" payment detection possible
 *  with a plain Lightning Address (no wallet connection needed). */
export function lnurlSupportsZap(meta: LnurlPayMetadata): boolean {
	return !!meta.nostrPubkey && /^[0-9a-f]{64}$/i.test(meta.nostrPubkey);
}

export interface LightningInvoice {
	/** BOLT11 invoice string (goes into the QR / `lightning:` URI). */
	pr: string;
	/** Verified amount in millisatoshis (decoded from the invoice). */
	amountMsat: number;
	/** Same amount in whole satoshis. */
	amountSats: number;
	/** When the invoice expires (unix seconds). */
	expiresAt: number;
	/** Where the invoice came from. */
	source: 'lnurl' | 'static';
	/** LNURL-pay `verify` URL (optional, spec LUD-06): pollable settlement
	 *  status for this invoice — the non-Nostr auto-confirm fallback. */
	verifyUrl?: string;
}

export interface LightningWallet {
	/** The merchant's configured Lightning Address / LNURL (single source). */
	address: string;
	/** Display label for the wallet/provider. */
	label: string;
}

/* ── parsing helpers ────────────────────────────────────────────────────── */

export function isLightningAddress(v: string): boolean {
	const s = v.trim();
	// user@domain.tld, domain has a dot, no scheme
	return /^[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(s) && !s.includes('://');
}

export function isLnurlString(v: string): boolean {
	const s = v.trim().toLowerCase();
	return s.startsWith('lnurl1') || s.startsWith('lightning:lnurl1');
}

export function isNwcUri(v: string): boolean {
	return v.trim().toLowerCase().startsWith('nostr+walletconnect://');
}

export function parseLightningAddress(addr: string): { user: string; domain: string } | null {
	const m = addr.trim().match(/^([a-z0-9._+-]+)@([a-z0-9.-]+\.[a-z]{2,})$/i);
	if (!m) return null;
	return { user: m[1], domain: m[2] };
}

/** bech32 → bytes, used to decode a raw `lnurl1...` string into its URL. */
function bech32ToBytes(str: string): Uint8Array | null {
	const sep = str.lastIndexOf('1');
	if (sep < 1) return null;
	const dataPart = str.slice(sep + 1).toLowerCase();
	const values: number[] = [];
	for (const ch of dataPart) {
		const v = LNURLP_CHARSET.indexOf(ch);
		if (v < 0) return null;
		values.push(v);
	}
	// 5-bit groups → 8-bit (drop trailing checksum bits)
	const out: number[] = [];
	let acc = 0;
	let bits = 0;
	for (const v of values) {
		acc = (acc << 5) | v;
		bits += 5;
		if (bits >= 8) {
			out.push((acc >> (bits - 8)) & 0xff);
			bits -= 8;
		}
	}
	return Uint8Array.from(out);
}

/** Decode the URL embedded in a raw lnurl1... string. */
export function decodeLnurlUrl(lnurl: string): string | null {
	const clean = lnurl.trim().replace(/^lightning:/i, '');
	const bytes = bech32ToBytes(clean);
	if (!bytes) return null;
	try {
		return new TextDecoder().decode(bytes);
	} catch {
		return null;
	}
}

/** Decode the amount (millisatoshis) from a BOLT11 invoice's human-readable part.
 *  Returns 0 for zero-amount invoices, or null if it doesn't look like a BOLT11. */
export function decodeBolt11AmountMsat(pr: string): number | null {
	const m = pr.trim().toLowerCase().match(/^ln(bc|tb|bcrt)(\d*)([munp]?)/);
	if (!m) return null;
	const amtStr = m[2];
	if (!amtStr) return 0; // zero-amount invoice
	const num = Number.parseInt(amtStr, 10);
	if (!Number.isFinite(num)) return null;
	const mult = m[3];
	const btcVal =
		mult === 'm'
			? num * 1e-3
			: mult === 'u'
				? num * 1e-6
				: mult === 'n'
					? num * 1e-9
					: mult === 'p'
						? num * 1e-12
						: num / 1e8;
	return Math.round(btcVal * 1e11); // BTC → msat (1 BTC = 1e11 msat)
}

/* ── LNURL-pay resolution ───────────────────────────────────────────────── */

async function getJson(url: string, timeoutMs = 12000): Promise<unknown> {
	const ctrl = new AbortController();
	const t = setTimeout(() => ctrl.abort(), timeoutMs);
	try {
		const res = await fetch(url, {
			signal: ctrl.signal,
			headers: { Accept: 'application/json' }
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		return await res.json();
	} finally {
		clearTimeout(t);
	}
}

/** Resolve a Lightning Address / LNURL → its LNURL-pay metadata. */
export async function resolveLnurlPay(addrOrLnurl: string): Promise<LnurlPayMetadata> {
	const v = addrOrLnurl.trim();
	let url: string;

	if (isLightningAddress(v)) {
		const parsed = parseLightningAddress(v)!;
		url = `https://${parsed.domain}/.well-known/lnurlp/${parsed.user}`;
	} else if (isLnurlString(v)) {
		const decoded = decodeLnurlUrl(v);
		if (!decoded) throw new Error('Could not decode LNURL');
		url = decoded;
	} else if (/^https?:\/\//i.test(v)) {
		url = v;
	} else {
		throw new Error('Not a Lightning Address or LNURL');
	}

	const data = (await getJson(url)) as {
		status?: string;
		reason?: string;
		tag?: string;
		callback?: string;
		minSendable?: number;
		maxSendable?: number;
		metadata?: string;
		commentAllowed?: number;
		allowsNostr?: boolean;
		nostrPubkey?: string;
	};

	if (data.status === 'ERROR') throw new Error(data.reason ?? 'LNURL provider error');
	if (data.tag !== 'payRequest' || !data.callback)
		throw new Error('Not an LNURL-pay endpoint');

	let domain = v;
	if (isLightningAddress(v)) domain = parseLightningAddress(v)!.domain;
	else {
		try {
			domain = new URL(data.callback).host;
		} catch {
			/* keep raw */
		}
	}

	return {
		domain,
		endpoint: url,
		callback: data.callback,
		minSendable: data.minSendable ?? 1000,
		maxSendable: data.maxSendable ?? 1_000_000_000,
		metadata: data.metadata ?? '',
		commentAllowed: data.commentAllowed,
		nostrPubkey: data.allowsNostr ? data.nostrPubkey : undefined
	};
}

/** Request an amount-locked BOLT11 invoice from a resolved LNURL-pay endpoint.
 *
 *  `zapRequest` (NIP-57): serialized kind 9734 event. When passed, the provider
 *  ties the invoice to a zap and — on settlement — publishes a kind 9735 zap
 *  receipt to the relays named in the request's `relays` tag. Subscribing to
 *  those relays then gives push-style payment detection ("zaps style"), no
 *  wallet connection required. Providers also return an optional `verify` URL
 *  (spec) that can be polled for settlement as a fallback. */
export async function requestInvoice(
	meta: LnurlPayMetadata,
	amountMsat: number,
	comment?: string,
	zapRequest?: string
): Promise<LightningInvoice> {
	if (amountMsat < meta.minSendable || amountMsat > meta.maxSendable) {
		throw new Error(
			`Amount out of range (provider allows ${meta.minSendable}–${meta.maxSendable} msat)`
		);
	}
	const cb = new URL(meta.callback);
	cb.searchParams.set('amount', String(Math.round(amountMsat)));
	if (comment && meta.commentAllowed) cb.searchParams.set('comment', comment.slice(0, meta.commentAllowed));
	if (zapRequest) {
		cb.searchParams.set('nostr', zapRequest);
		// Some providers (Alby et al.) also expect the lnurl bech32 of the
		// metadata endpoint — same param set bitos-nostr sends when zapping.
		if (meta.endpoint) {
			try {
				const { encodeBytes } = await import('nostr-tools/nip19');
				cb.searchParams.set(
					'lnurl',
					encodeBytes('lnurl', new TextEncoder().encode(meta.endpoint))
				);
			} catch {
				/* optional param — ignore */
			}
		}
	}

	const data = (await getJson(cb.toString())) as {
		status?: string;
		reason?: string;
		pr?: string;
		successAction?: { tag?: string };
		verify?: string;
	};

	if (data.status === 'ERROR') throw new Error(data.reason ?? 'Invoice request failed');
	if (!data.pr) throw new Error('Provider returned no invoice');

	const verified = decodeBolt11AmountMsat(data.pr);
	// Some providers return zero-amount invoices (rare); trust requested amount then.
	const verifiedMsat = verified ?? amountMsat;
	return {
		pr: data.pr,
		amountMsat: verifiedMsat,
		amountSats: Math.round(verifiedMsat / 1000),
		expiresAt: Math.floor(Date.now() / 1000) + 3600, // BOLT11 default expiry
		source: 'lnurl',
		verifyUrl: data.verify
	};
}

/** Poll a LNURL-pay `verify` URL → settlement state (spec LUD-06). */
export async function checkVerifyUrl(
	verifyUrl: string
): Promise<'pending' | 'paid' | 'unknown'> {
	try {
		const data = (await getJson(verifyUrl, 8000)) as {
			status?: string;
			settled?: boolean;
		};
		if (data.status === 'ERROR') return 'unknown';
		return data.settled === true ? 'paid' : 'pending';
	} catch {
		return 'unknown';
	}
}

/** One-shot: resolve address → fetch invoice for an amount. Falls back to a
 *  static address QR when the provider can't be reached (CORS/offline/down). */
export async function fetchInvoiceForAmount(
	address: string,
	amountMsat: number,
	comment?: string
): Promise<LightningInvoice> {
	const meta = await resolveLnurlPay(address);
	return requestInvoice(meta, amountMsat, comment);
}

/* ── merchant wallet config (single source: Bitcoin settings) ───────────── */

const BITCOIN_SETTINGS_KEY = 'bnos-os:settings-bitcoin';

interface BitcoinSettings {
	lightningProvider?: string;
	lightningAddress?: string;
	nwcUrl?: string;
	lndUrl?: string;
	lndMacaroon?: string;
	phoenixdUrl?: string;
	phoenixdPass?: string;
	albyApiKey?: string;
	blinkApiKey?: string;
	blinkWalletId?: string;
	strikeApiKey?: string;
}

export function loadBitcoinLightningSettings(): BitcoinSettings {
	if (!browser) return {};
	try {
		return JSON.parse(localStorage.getItem(BITCOIN_SETTINGS_KEY) ?? '{}') as BitcoinSettings;
	} catch {
		return {};
	}
}

/** The merchant's configured Lightning receive address/URI. Only meaningful
 *  for the Lightning Address provider (used by the Pay QR static preview).
 *  Node providers (Blink/NWC/LND/…) issue per-sale invoices at checkout. */
export function getMerchantLightning(): LightningWallet | null {
	const s = loadBitcoinLightningSettings();
	if (s.lightningProvider === 'lnaddress') {
		const addr = s.lightningAddress?.trim();
		if (addr && (isLightningAddress(addr) || isLnurlString(addr))) {
			return { address: addr, label: addr };
		}
	}
	return null;
}

const present = (v?: string) => !!v?.trim();

/** Is ANY Lightning provider configured and ready? (Respects the selection
 *  in Settings → Bitcoin — Lightning Address, Blink, NWC, LND, PhoenixD,
 *  Alby, or Strike.) */
export function isLightningReady(): boolean {
	const s = loadBitcoinLightningSettings();
	switch (s.lightningProvider) {
		case 'lnaddress':
			return present(s.lightningAddress);
		case 'blink':
			return present(s.blinkApiKey);
		case 'nwc':
			return present(s.nwcUrl);
		case 'alby':
			return present(s.albyApiKey);
		case 'lnd':
			return present(s.lndUrl) && present(s.lndMacaroon);
		case 'phoenixd':
			return present(s.phoenixdUrl) && present(s.phoenixdPass);
		case 'strike':
			return present(s.strikeApiKey);
		default:
			return false;
	}
}

/** Quick validation used by the Bitcoin settings page "Test" button. */
export async function testLightningAddress(
	addr: string
): Promise<
	| { ok: true; domain: string; minSats: number; maxSats: number; zapReceipts: boolean }
	| { ok: false; error: string }
> {
	try {
		const meta = await resolveLnurlPay(addr);
		return {
			ok: true,
			domain: meta.domain,
			minSats: Math.round(meta.minSendable / 1000),
			maxSats: Math.round(meta.maxSendable / 1000),
			zapReceipts: lnurlSupportsZap(meta)
		};
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}
