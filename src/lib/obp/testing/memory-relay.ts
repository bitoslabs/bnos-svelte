/**
 * In-memory Nostr relay hub — deterministic `ObpNostrClient` for tests
 * and local pilots. Models the relay semantics the binding relies on:
 * published events fan out to active subscribers whose filter matches
 * (kind + all `#p` values present as `p` tags); nothing is stored, so
 * subscribers joining later miss past events — exactly like an ephemeral
 * relay. Published ciphertexts are retained for assertions.
 */
import type { Event } from 'nostr-tools';
import type { ObpNostrClient } from '../node/nostr-transport';

interface Subscription {
	filter: { kinds: number[]; '#p': string[] };
	handler: (event: Event) => void;
}

export class MemoryRelayHub implements ObpNostrClient {
	private subs: Subscription[] = [];
	private queue: Event[] = [];
	private draining = false;
	/** Every event published, in order (ciphertext + transport metadata). */
	readonly published: Event[] = [];

	publish(event: Event): Promise<void> {
		this.published.push(event);
		this.queue.push(event);
		void this.drain();
		return Promise.resolve();
	}

	subscribe(
		filter: { kinds: number[]; '#p': string[] },
		onEvent: (event: Event) => void
	): () => void {
		const sub: Subscription = { filter, handler: onEvent };
		this.subs.push(sub);
		return () => {
			this.subs = this.subs.filter((s) => s !== sub);
		};
	}

	private matches(sub: Subscription, event: Event): boolean {
		if (!sub.filter.kinds.includes(event.kind)) return false;
		const pTags = event.tags.filter((t) => t[0] === 'p').map((t) => t[1]);
		return sub.filter['#p'].every((p) => pTags.includes(p));
	}

	private async drain(): Promise<void> {
		if (this.draining) return;
		this.draining = true;
		try {
			while (this.queue.length > 0) {
				const event = this.queue.shift()!;
				for (const sub of [...this.subs]) {
					if (this.matches(sub, event)) sub.handler(event);
				}
			}
		} finally {
			this.draining = false;
		}
	}
}
