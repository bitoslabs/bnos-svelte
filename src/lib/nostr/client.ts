/**
 * Thin relay client wrappers around @bitos/bnos-core. All calls are guarded so
 * failures (offline, relay timeout) resolve to empty/error instead of throwing
 * into the UI. The GLO collection store uses these to sync.
 */
import {
	queryRelays,
	publishToRelays,
	preconnectRelays,
	type NostrEvent
} from '@bitos/bnos-core';
import { relays } from './relay.svelte';

/** Preconnect to the configured relays (warms sockets). */
export async function warmRelays() {
	if (!relays.online) return;
	try {
		const targets = relays.readableNormalized.length
			? relays.readableNormalized
			: relays.writableNormalized;
		await preconnectRelays(targets);
	} catch {
		/* best effort */
	}
}

export type NostrFilter = Parameters<typeof queryRelays>[1];

/** Query relays for events matching a filter. Resolves to [] when offline. */
export async function fetchEvents(filter: NostrFilter): Promise<NostrEvent[]> {
	if (!relays.online || !relays.readableNormalized.length) return [];
	try {
		return await queryRelays(relays.readableNormalized, filter);
	} catch (e) {
		return [];
	}
}

/** Query the primary readable relay first, then fall back to the others. */
export async function fetchEventsPrimaryFirst(filter: NostrFilter): Promise<NostrEvent[]> {
	if (!relays.online || !relays.readableNormalized.length) return [];
	try {
		const primary = relays.primaryReadableNormalized;
		const fallback = relays.readableNormalized.filter((url) => !primary.includes(url));
		if (primary.length) {
			const primaryEvents = await queryRelays(primary, filter, { maxWaitMs: 1800 });
			if (primaryEvents.length || !fallback.length) return primaryEvents;
		}
		return fallback.length ? await queryRelays(fallback, filter) : [];
	} catch (e) {
		return [];
	}
}

/** Publish a signed event to all configured relays. No-op when offline. */
export async function sendEvent(event: NostrEvent): Promise<boolean> {
	if (!relays.online || !relays.writableNormalized.length) return false;
	try {
		const [primary] = relays.primaryWritableNormalized;
		if (!primary) return await publishToRelays(event, relays.writableNormalized);

		const primaryPublished = await publishToRelays(event, [primary], { maxWaitMs: 1800 });
		const remaining = relays.writableNormalized.filter((url) => url !== primary);
		if (primaryPublished) {
			if (remaining.length) void publishToRelays(event, remaining);
			return true;
		}
		return await publishToRelays(event, remaining.length ? remaining : relays.writableNormalized);
	} catch (e) {
		return false;
	}
}
