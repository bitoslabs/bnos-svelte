/**
 * NIP-47 (Nostr Wallet Connect) client — persistent, multi-relay.
 *
 * A single shared connection backs the whole app: the POS checkout, the
 * Bitcoin settings page, and payment auto-detection all reuse it, instead of
 * opening a throwaway socket per request.
 *
 * Payment auto-detection (NIP-47):
 *   • Push  — wallets emit kind 7375 `payment_received` notifications the
 *     moment sats land; `watchPaymentReceived()` subscribes and fires
 *     instantly (no polling). Authenticated: NIP-04 encrypted by the wallet key.
 *   • Pull  — `lookupInvoice()` is the authoritative settle check, used as a
 *     backstop for wallets that don't push notifications.
 *
 * Protocol: requests are kind 23194 events; responses are kind 23195 events
 * tagged with the request id and the client pubkey (the URI `secret` derives
 * both the signing key and the NIP-04 conversation key).
 */
import { browser } from '$app/environment';
import { nip04 } from 'nostr-tools';
import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent, getPublicKey, type Event } from 'nostr-tools/pure';

export const NWC_REQUEST_KIND = 23194;
export const NWC_RESPONSE_KIND = 23195;
export const NWC_NOTIFICATION_KIND = 7375;

/** Parsed `nostr+walletconnect://` connection string. */
export interface NwcConnection {
	/** Wallet service pubkey (from the URI path). */
	walletPubkey: string;
	/** All relay URLs the URI advertises (deduped, wss/http). */
	relays: string[];
	/** 64-hex client secret — signs requests and encrypts the payload. */
	secret: string;
}

/** Parse a NWC connection URI. Accepts multiple `relay` params. */
export function parseNwcConnectionString(uri: string): NwcConnection | null {
	const v = uri.trim();
	if (!/^nostr\+walletconnect:\/\//i.test(v)) return null;
	try {
		const parsed = new URL(v);
		const pubkey = (parsed.pathname || parsed.host).replace(/^\//, '').toLowerCase();
		const relays = [...new Set(parsed.searchParams.getAll('relay'))].filter((r) =>
			/^wss?:\/\//.test(r)
		);
		const secret = (parsed.searchParams.get('secret') ?? '').toLowerCase();
		if (!/^[0-9a-f]{64}$/.test(pubkey)) return null;
		if (!/^[0-9a-f]{64}$/.test(secret)) return null;
		if (!relays.length) return null;
		return { walletPubkey: pubkey, relays, secret };
	} catch {
		return null;
	}
}

/** A NIP-47 `payment_received` notification, normalized. */
export interface NwcPaymentReceived {
	/** The settled BOLT11, when the wallet includes it. */
	invoice?: string;
	/** Settled amount in sats (NIP-47 reports msat). */
	amountSats?: number;
	/** Payment preimage, when provided. */
	preimage?: string;
}

interface NwcResponse {
	result_type?: string;
	result?: Record<string, unknown>;
	error?: { code?: string; message?: string };
}

/* ── shared connection state ─────────────────────────────────────────────── */

let connection: NwcConnection | null = null;
let pool: SimplePool | null = null;

function getPool(): SimplePool {
	if (!browser) throw new Error('NWC is only available in the browser.');
	return (pool ??= new SimplePool());
}

/** Activate the shared connection (idempotent — reconnects if the URI changed). */
export function nwcConnect(uri: string): NwcConnection {
	const c = parseNwcConnectionString(uri);
	if (!c) throw new Error('This NWC connection string is invalid.');
	if (connection && connection.secret !== c.secret) {
		// Different wallet: drop the old pool so stale sockets/subscriptions die.
		try {
			pool?.close(connection.relays);
		} catch {
			/* ignore */
		}
		pool = null;
	}
	connection = c;
	return c;
}

/** Deactivate the shared connection (closes pooled sockets). */
export function nwcDisconnect() {
	if (connection && pool) {
		try {
			pool.close(connection.relays);
		} catch {
			/* ignore */
		}
	}
	connection = null;
	pool = null;
}

export function nwcConnection(): NwcConnection | null {
	return connection;
}

/* ── request/response ────────────────────────────────────────────────────── */

/** Send a NIP-47 request and await the wallet's encrypted kind 23195 response. */
export async function nwcRequest(
	method: string,
	params: Record<string, unknown> = {},
	timeoutMs = 20_000
): Promise<Record<string, unknown>> {
	if (!connection) throw new Error('No NWC wallet is connected.');
	const active = connection;
	// In NIP-47 the URI's `secret` is the client key: it signs the request and
	// encrypts the payload. A replacement key would be rejected by the wallet.
	const sk = hexToBytes(active.secret);
	const clientPubkey = getPublicKey(sk);
	const content = await nip04.encrypt(active.secret, active.walletPubkey, JSON.stringify({ method, params }));
	const event = finalizeEvent(
		{
			kind: NWC_REQUEST_KIND,
			created_at: Math.floor(Date.now() / 1000),
			tags: [['p', active.walletPubkey]],
			content
		},
		sk
	);
	const p = getPool();

	return new Promise<Record<string, unknown>>((resolve, reject) => {
		let settled = false;
		const finish = (fn: () => void) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			sub.close();
			fn();
		};
		const sub = p.subscribeMany(
			active.relays,
			{
				kinds: [NWC_RESPONSE_KIND],
				authors: [active.walletPubkey],
				'#p': [clientPubkey],
				'#e': [event.id]
			},
			{
				onevent: async (response: Event) => {
					try {
						const plaintext = await nip04.decrypt(active.secret, active.walletPubkey, response.content);
						const decoded = JSON.parse(plaintext) as NwcResponse;
						if (decoded.error)
							throw new Error(decoded.error.message || decoded.error.code || 'Wallet request failed.');
						finish(() => resolve(decoded.result ?? {}));
					} catch (error) {
						finish(() => reject(error instanceof Error ? error : new Error('Invalid wallet response.')));
					}
				}
			}
		);
		const timer = setTimeout(
			() => finish(() => reject(new Error('Wallet did not respond — relay unreachable or wallet offline.'))),
			timeoutMs
		);
		void Promise.allSettled(p.publish(active.relays, event)).then((published) => {
			if (!published.some((r) => r.status === 'fulfilled')) {
				finish(() => reject(new Error('Could not reach the wallet relay.')));
			}
		});
	});
}

/* ── typed helpers ───────────────────────────────────────────────────────── */

export interface NwcInfo {
	alias?: string;
	/** Methods the wallet grants this connection. */
	methods?: string[];
	notifications?: string[];
	balance?: number;
}

export async function nwcGetInfo(): Promise<NwcInfo> {
	return (await nwcRequest('get_info')) as NwcInfo;
}

export async function nwcGetBalanceSats(): Promise<number | null> {
	const result = await nwcRequest('get_balance');
	const msats = Number(result.balance ?? 0);
	return Number.isFinite(msats) ? Math.round(msats / 1000) : null;
}

export async function nwcMakeInvoice(amountMsat: number, description = ''): Promise<string> {
	const result = await nwcRequest('make_invoice', {
		amount: Math.round(amountMsat),
		description
	});
	const pr = (result.invoice ?? result.payment_request) as string | undefined;
	if (!pr) throw new Error('Wallet returned no invoice.');
	return pr;
}

export interface NwcInvoiceStatus {
	settled: boolean;
	preimage?: string;
}

/** NIP-47 `lookup_invoice`: authoritative settlement state of a BOLT11. */
export async function nwcLookupInvoice(invoice: string): Promise<NwcInvoiceStatus | null> {
	const result = await nwcRequest('lookup_invoice', { invoice });
	return {
		settled: result.settled === true,
		preimage: typeof result.preimage === 'string' ? result.preimage : undefined
	};
}

export async function nwcPayInvoice(invoice: string): Promise<string> {
	const result = await nwcRequest('pay_invoice', { invoice });
	return typeof result.preimage === 'string' ? result.preimage : '';
}

/* ── payment push notifications (kind 7375) ──────────────────────────────── */

/**
 * Subscribe to `payment_received` notifications — the wallet pushes kind 7375
 * the moment sats land, so the POS can auto-confirm without polling. Returns
 * an unwatch function.
 */
export function watchPaymentReceived(onReceived: (n: NwcPaymentReceived) => void): () => void {
	if (!connection || !browser) return () => {};
	const active = connection;
	const sk = hexToBytes(active.secret);
	const clientPubkey = getPublicKey(sk);
	const p = getPool();
	const sub = p.subscribeMany(
		active.relays,
		{ kinds: [NWC_NOTIFICATION_KIND], authors: [active.walletPubkey], '#p': [clientPubkey] },
		{
			onevent: async (event: Event) => {
				try {
					const plaintext = await nip04.decrypt(active.secret, active.walletPubkey, event.content);
					const decoded = JSON.parse(plaintext) as {
						type?: string;
						notification?: Record<string, unknown>;
					};
					if (decoded.type !== 'payment_received') return;
					const n = decoded.notification ?? {};
					onReceived({
						invoice: typeof n.invoice === 'string' ? n.invoice : undefined,
						amountSats:
							typeof n.amount === 'number' && n.amount > 0 ? Math.round(n.amount / 1000) : undefined,
						preimage: typeof n.preimage === 'string' ? n.preimage : undefined
					});
				} catch {
					/* ignore notifications we cannot decrypt */
				}
			}
		}
	);
	return () => {
		try {
			sub.close();
		} catch {
			/* ignore */
		}
	};
}

/** Does a pushed notification settle the invoice we're waiting on? */
export function nwcNotificationMatchesInvoice(n: NwcPaymentReceived, pr: string): boolean {
	if (!n.invoice) return false;
	return n.invoice.trim() === pr.trim();
}

/* ── misc ────────────────────────────────────────────────────────────────── */

function hexToBytes(hex: string): Uint8Array {
	const out = new Uint8Array(hex.length / 2);
	for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
	return out;
}
