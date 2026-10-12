/**
 * OBP transport binding interface + loopback network.
 *
 * Transports carry the canonical signed envelope as an opaque payload;
 * transport metadata stays outside the signed business payload. A
 * transport acknowledgement means *transport accepted the message* —
 * never business acceptance (that is a signed OBP decision).
 *
 * Confidential documents must **fail closed**: if the transport cannot
 * encrypt for the intended recipient, `deliver` refuses with
 * `encryption-unavailable` and the message stays in the outbox.
 *
 * The Nostr/HTTP bindings are specified in `docs/OBP_V01_SPEC.md`;
 * the loopback network here is the deterministic harness transport.
 */

export interface ObpTransportResult {
	/** Did the transport accept custody of the message? */
	ok: boolean;
	/** Transport-side receipt id when ok. */
	transportId?: string;
	/** Failure detail; `encryption-unavailable` triggers fail-closed. */
	error?: string;
	/** Whether retrying later can succeed (transient vs permanent). */
	retryable?: boolean;
}

export interface ObpTransport {
	readonly kind: string;
	/** Whether this transport can carry confidential (encrypted) documents. */
	readonly canEncrypt: boolean;
	deliver(
		envelope: unknown,
		opts: { confidential: boolean; recipient: string }
	): Promise<ObpTransportResult>;
}

type Handler = (envelope: unknown) => void;

/**
 * In-memory network connecting Business Nodes in one process. Each node
 * serves inbound messages at its address and sends through the shared
 * transport, routed by the envelope's recipient. Deliveries are queued
 * micro-async to make retry/outbox behavior observable.
 */
export class LoopbackNetwork {
	private handlers = new Map<string, Handler>();
	private queue: { to: string; envelope: unknown }[] = [];
	private draining = false;

	/** Fail the next N deliveries (simulates relay outage). */
	failNext = 0;
	/** Drop the next N deliveries silently (simulates message loss). */
	dropNext = 0;
	/** Disable encryption capability (for fail-closed tests). */
	encryptionDisabled = false;

	constructor(private readonly log: string[] = []) {}

	/** Register the inbound handler for a node's address. */
	serve(address: string, handler: Handler): void {
		this.handlers.set(address, handler);
	}

	/** A transport that routes by envelope recipient. */
	transportFor(): ObpTransport {
		const encryptionAvailable = (): boolean => !this.encryptionDisabled;
		return {
			kind: 'loopback',
			get canEncrypt() {
				return encryptionAvailable();
			},
			deliver: async (
				envelope: unknown,
				opts: { confidential: boolean; recipient: string }
			): Promise<ObpTransportResult> => {
				if (opts.confidential && !encryptionAvailable()) {
					return {
						ok: false,
						error: 'encryption-unavailable',
						retryable: false
					};
				}
				const messageId = (envelope as { messageId: string }).messageId;
				if (this.failNext > 0) {
					this.failNext--;
					this.log.push(`fail:${messageId}`);
					return { ok: false, error: 'simulated-outage', retryable: true };
				}
				if (this.dropNext > 0) {
					this.dropNext--;
					this.log.push(`drop:${messageId}`);
					return { ok: true, transportId: `lb-${crypto.randomUUID()}` };
				}
				this.queue.push({ to: opts.recipient, envelope });
				this.log.push(`sent:${messageId}`);
				void this.drain();
				return { ok: true, transportId: `lb-${crypto.randomUUID()}` };
			}
		};
	}

	private async drain(): Promise<void> {
		if (this.draining) return;
		this.draining = true;
		try {
			while (this.queue.length > 0) {
				const item = this.queue.shift()!;
				const handler = this.handlers.get(item.to);
				if (handler) {
					await handler(item.envelope);
				} else {
					this.log.push(`no-handler:${item.to}`);
				}
			}
		} finally {
			this.draining = false;
		}
	}
}
