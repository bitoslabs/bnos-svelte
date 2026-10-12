/**
 * OBP Nostr transport binding (spec §8).
 *
 * Carries the same canonical signed envelope over Nostr relays:
 *
 * - one event per OBP message, default kind 21099 (ephemeral range:
 *   relays are not expected to store confidential bilateral documents;
 *   the sender's durable outbox + retries cover offline gaps — pick a
 *   stored parameterized kind if store-and-forward is required),
 * - `content` = NIP-44 v2 ciphertext of the envelope JSON, keyed to the
 *   recipient's *transport* key (fail closed: never plaintext),
 * - `p`-tag = recipient transport pubkey (routing only),
 * - the Nostr event signature covers transport metadata; the OBP
 *   signature inside the ciphertext covers the business payload.
 *
 * `ObpNostrClient` abstracts publish/subscribe so tests run on an
 * in-memory relay hub (`testing/memory-relay.ts`) while production uses
 * `SimplePoolNostrClient` (nostr-tools `SimplePool`).
 */
import { finalizeEvent, nip44, type Event } from 'nostr-tools';
import { schnorr } from '@noble/curves/secp256k1.js';
import { toHex } from '../canonical';
import type { ObpTransport, ObpTransportResult } from './transport';
import type { BusinessNode } from './business-node';

/** Default OBP-over-Nostr event kind (ephemeral range 20000–29999). */
export const OBP_NOSTR_KIND = 21099;

/** Minimal relay client surface the binding needs. */
export interface ObpNostrClient {
	publish(event: Event): Promise<void>;
	subscribe(
		filter: { kinds: number[]; '#p': string[] },
		onEvent: (event: Event) => void
	): () => void;
}

export interface NostrTransportOptions {
	client: ObpNostrClient;
	/** This node's transport secret key (not a business signing key). */
	secretKey: Uint8Array;
	/** orgId → counterparty transport pubkey (preconfigured directory). */
	resolveRecipientPubkey: (orgId: string) => string | undefined;
	kind?: number;
}

export class NostrTransport implements ObpTransport {
	readonly kind = 'nostr';
	private readonly client: ObpNostrClient;
	private readonly secretKey: Uint8Array;
	private readonly resolve: (orgId: string) => string | undefined;
	private readonly eventKind: number;

	constructor(opts: NostrTransportOptions) {
		this.client = opts.client;
		this.secretKey = opts.secretKey;
		this.resolve = opts.resolveRecipientPubkey;
		this.eventKind = opts.kind ?? OBP_NOSTR_KIND;
	}

	/** NIP-44 encryption to the intended recipient is always available. */
	get canEncrypt(): boolean {
		return true;
	}

	async deliver(
		envelope: unknown,
		opts: { confidential: boolean; recipient: string }
	): Promise<ObpTransportResult> {
		const recipientPubkey = this.resolve(opts.recipient);
		if (!recipientPubkey) {
			return { ok: false, error: 'unknown-recipient', retryable: false };
		}
		try {
			const conversationKey = nip44.getConversationKey(this.secretKey, recipientPubkey);
			const content = nip44.v2.encrypt(JSON.stringify(envelope), conversationKey);
			const event = finalizeEvent(
				{
					kind: this.eventKind,
					created_at: Math.floor(Date.now() / 1000),
					tags: [['p', recipientPubkey]],
					content
				},
				this.secretKey
			);
			await this.client.publish(event);
			return { ok: true, transportId: event.id };
		} catch (err) {
			return {
				ok: false,
				error: err instanceof Error ? err.message : 'nostr-publish-failed',
				retryable: true
			};
		}
	}
}

export interface NostrInboxBinding {
	/** Stop listening and disconnect. */
	close(): void;
	/** Messages handed to the node so far (any decision). */
	processed: number;
}

/**
 * Production relay client over nostr-tools `SimplePool`. Publishes with
 * any-relay success; subscriptions stay open until `close()`.
 */
export class SimplePoolNostrClient implements ObpNostrClient {
	private pool: { publish: (relays: string[], ev: Event) => Promise<unknown>[] } | undefined;
	private closed = false;

	constructor(private readonly relays: string[]) {}

	async publish(event: Event): Promise<void> {
		const { SimplePool } = await import('nostr-tools/pool');
		if (!this.pool) this.pool = new SimplePool() as never;
		await Promise.any(this.pool.publish(this.relays, event));
	}

	subscribe(
		filter: { kinds: number[]; '#p': string[] },
		onEvent: (event: Event) => void
	): () => void {
		let sub: { close: () => void } | undefined;
		void (async () => {
			const { SimplePool } = await import('nostr-tools/pool');
			if (this.closed) return;
			const pool = (this.pool ??= new SimplePool() as never);
			sub = (
				pool as unknown as {
					subscribeMany: (
						relays: string[],
						filters: unknown[],
						params: { onevent: (e: Event) => void }
					) => { close: () => void };
				}
			).subscribeMany(this.relays, [filter], { onevent: onEvent });
		})();
		return () => {
			this.closed = true;
			sub?.close();
		};
	}
}

/**
 * Subscribe this node's transport key for OBP events, decrypt each
 * NIP-44 ciphertext and feed the envelope into the verification
 * pipeline. Undecryptable or malformed events are dropped and counted —
 * they can never become documents.
 */
export function bindNostrInbox(
	node: BusinessNode,
	opts: { client: ObpNostrClient; secretKey: Uint8Array; kind?: number }
): NostrInboxBinding {
	let processed = 0;
	let closed = false;
	const ownPubkey = toHex(schnorr.getPublicKey(opts.secretKey));
	const close = opts.client.subscribe(
		{ kinds: [opts.kind ?? OBP_NOSTR_KIND], '#p': [ownPubkey] },
		(event) => {
			void (async () => {
				try {
					const conversationKey = nip44.getConversationKey(opts.secretKey, event.pubkey);
					const plaintext = nip44.v2.decrypt(event.content, conversationKey);
					await node.receive(JSON.parse(plaintext));
					processed++;
				} catch {
					// Ciphertext not addressed to us or corrupted: ignore.
				}
			})();
		}
	);
	return {
		close: () => {
			if (!closed) {
				closed = true;
				close();
			}
		},
		get processed() {
			return processed;
		}
	};
}
