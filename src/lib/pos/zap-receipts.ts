/**
 * NIP-57 zap receipts as a payment-detection channel ("zaps style").
 *
 * With a plain Lightning Address there is no wallet connection, so the POS
 * cannot call `lookup_invoice`. But when the LNURL-pay provider supports
 * NIP-57 (`allowsNostr` + `nostrPubkey`), checkout can:
 *
 *   1. Build a kind 9734 zap request (signed with a fresh key — anonymous
 *      zap, no merchant key needed) whose `p` tag is the merchant pubkey and
 *      whose `relays` tag names relays we read.
 *   2. Send it with the invoice request (`nostr=` param). The provider ties
 *      the invoice to the zap.
 *   3. Subscribe to kind 9735 receipts on those relays. The moment the
 *      customer pays, the provider's zapper publishes the receipt — matched
 *      by the embedded 9734 id (or the bolt11 tag) — and checkout
 *      auto-confirms. Same pattern bitos-nostr's zap dialog uses.
 */
import { browser } from '$app/environment';
import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent, generateSecretKey, type Event } from 'nostr-tools/pure';

export const ZAP_REQUEST_KIND = 9734;
export const ZAP_RECEIPT_KIND = 9735;

export interface ZapRequestParams {
	/** Recipient (merchant) Nostr pubkey — becomes the 9734 `p` tag and the
	 *  subscription filter `#p`. */
	recipientPubkey: string;
	/** Amount in millisatoshis. */
	amountMsat: number;
	/** Relays the zapper should publish the receipt to (we subscribe there). */
	relays: string[];
	/** Optional memo → 9734 content. */
	memo?: string;
}

/** Build + sign a kind 9734 zap request with a fresh key (anonymous zap).
 *  Returns the signed event; its `id` is the receipt-matching token. */
export function buildZapRequest(params: ZapRequestParams): Event {
	const sk = generateSecretKey();
	return finalizeEvent(
		{
			kind: ZAP_REQUEST_KIND,
			created_at: Math.floor(Date.now() / 1000),
			tags: [
				['relays', ...params.relays],
				['amount', String(Math.round(params.amountMsat))],
				['p', params.recipientPubkey]
			],
			content: params.memo?.slice(0, 180) ?? ''
		},
		sk
	);
}

/** Does a kind 9735 receipt settle the invoice we are waiting on?
 *  Primary match: the `description` tag embeds our 9734 (by event id).
 *  Secondary: the `bolt11` tag equals our invoice (some zappers mangle
 *  descriptions; the invoice string is unique enough). */
export function zapReceiptMatches(
	receipt: Event,
	expect: { requestId: string; pr: string }
): boolean {
	if (receipt.kind !== ZAP_RECEIPT_KIND) return false;
	const description = receipt.tags.find((t) => t[0] === 'description')?.[1];
	if (description) {
		try {
			const embedded = JSON.parse(description) as { id?: string };
			if (embedded.id === expect.requestId) return true;
		} catch {
			/* malformed description — try bolt11 */
		}
	}
	const bolt11 = receipt.tags.find((t) => t[0] === 'bolt11')?.[1];
	return !!bolt11 && bolt11.trim().toLowerCase() === expect.pr.trim().toLowerCase();
}

/** Extract the preimage tag from a 9735 receipt, when present. */
export function zapReceiptPreimage(receipt: Event): string | undefined {
	return receipt.tags.find((t) => t[0] === 'preimage')?.[1];
}

let pool: SimplePool | null = null;

/**
 * Subscribe for the zap receipt that settles this checkout. Fires `onPaid`
 * exactly once when a matching kind 9735 arrives; returns an unwatch function.
 * No-op (never fires) outside the browser — callers stay in charge of any
 * polling fallback.
 */
export function watchZapReceipts(opts: {
	relays: string[];
	recipientPubkey: string;
	requestId: string;
	pr: string;
	onPaid: (preimage?: string) => void;
}): () => void {
	if (!browser || !opts.relays.length) return () => {};
	pool ??= new SimplePool();
	const sub = pool.subscribeMany(
		opts.relays,
		{
			kinds: [ZAP_RECEIPT_KIND],
			'#p': [opts.recipientPubkey],
			since: Math.floor(Date.now() / 1000) - 120
		},
		{
			onevent: (receipt: Event) => {
				if (zapReceiptMatches(receipt, { requestId: opts.requestId, pr: opts.pr })) {
					opts.onPaid(zapReceiptPreimage(receipt));
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

/**
 * One-shot historical query for the receipt settling this checkout — used by
 * the cashier's manual "Check payment" tap. Catches receipts the live watch
 * missed (relay hiccup, subscription opened after publication) without
 * waiting for the next poll. Returns the preimage when found, else undefined.
 */
export async function queryZapReceiptOnce(opts: {
	relays: string[];
	recipientPubkey: string;
	requestId: string;
	pr: string;
	/** Only look at receipts from this unix second onwards. */
	sinceSec?: number;
	maxWaitMs?: number;
}): Promise<string | undefined> {
	if (!browser || !opts.relays.length) return undefined;
	pool ??= new SimplePool();
	try {
		const events = await pool.querySync(
			opts.relays,
			{
				kinds: [ZAP_RECEIPT_KIND],
				'#p': [opts.recipientPubkey],
				since: opts.sinceSec ?? Math.floor(Date.now() / 1000) - 3600
			},
			{ maxWait: opts.maxWaitMs ?? 3000 }
		);
		for (const receipt of events) {
			if (zapReceiptMatches(receipt, { requestId: opts.requestId, pr: opts.pr })) {
				return zapReceiptPreimage(receipt);
			}
		}
	} catch {
		/* offline / unreachable relays — nothing found */
	}
	return undefined;
}
