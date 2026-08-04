/**
 * Nostr user-profile metadata (kind 0 / NIP-01) cache.
 *
 * This is the single source of truth the app chrome (AppTopbar, AppSidebar)
 * reads from to render the logged-in user's display name + avatar. It:
 *
 *   1. hydrates from localStorage on boot (instant, offline-friendly),
 *   2. pulls the latest kind-0 event from relays for the active pubkey and
 *      merges it in when the relay copy is newer (so a profile edited on
 *      another client — or this one — propagates everywhere),
 *   3. lets the settings page `save()` local edits and `publish()` them as a
 *      signed replaceable kind-0 event.
 *
 * Merge watermark: `seenCreatedAt` tracks the `created_at` of the freshest
 * kind-0 event we've accepted (from relay fetch OR our own publish OR a local
 * edit). A relay event only overrides the cache when its `created_at` is
 * strictly newer, so offline local edits are never clobbered by stale relay
 * data.
 */
import { browser } from '$app/environment';
import { NOSTR_KINDS, signNostrEvent, type NostrEvent } from '@bitos/bnos-core';
import { session } from './session.svelte';
import { relays } from './relay.svelte';
import { fetchEvents, sendEvent } from './client';

/** localStorage key (kept stable with the legacy profile page). */
export const PROFILE_STORAGE_KEY = 'nostr_profile_kind0';

/** NIP-01 kind-0 profile metadata content. */
export interface NostrProfileMeta {
	display_name?: string;
	name?: string;
	about?: string;
	picture?: string;
	website?: string;
	lud16?: string;
	nip05?: string;
	banner?: string;
}

/** Internal persisted shape — carries the watermark alongside the metadata. */
interface PersistedProfile extends NostrProfileMeta {
	/** created_at (seconds) of the freshest kind-0 event accepted. */
	__seenCreatedAt?: number;
}

function normalizeMeta(input: Record<string, unknown>): NostrProfileMeta {
	const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
	return {
		display_name: str(input.display_name),
		name: str(input.name),
		about: str(input.about),
		picture: str(input.picture),
		website: str(input.website),
		lud16: str(input.lud16),
		nip05: str(input.nip05),
		banner: str(input.banner)
	};
}

class ProfileStore {
	/** Reactive kind-0 metadata content. */
	meta = $state<NostrProfileMeta>({});
	hydrated = $state(false);
	/** created_at (seconds) watermark — see module doc. */
	private seenCreatedAt = $state(0);
	loading = $state(false);
	publishing = $state(false);

	// ── reactive getters ───────────────────────────────────────────────
	get displayName() {
		return this.meta.display_name?.trim() || this.meta.name?.trim() || '';
	}
	get name() {
		return this.meta.name?.trim() || '';
	}
	get about() {
		return this.meta.about ?? '';
	}
	get picture() {
		return this.meta.picture?.trim() || '';
	}
	get website() {
		return this.meta.website ?? '';
	}
	get lud16() {
		return this.meta.lud16 ?? '';
	}
	get nip05() {
		return this.meta.nip05 ?? '';
	}
	get banner() {
		return this.meta.banner ?? '';
	}

	/** Human-friendly label for app chrome: display name → username → short npub. */
	get displayLabel() {
		return this.displayName || session.shortNpub || 'Account';
	}
	/** Secondary subtitle: npub (always available when signed in). */
	get subtitle() {
		return session.npub ?? 'Nostr identity';
	}
	/** Single-character avatar fallback. */
	get avatarLetter() {
		const base = this.displayName || session.shortNpub || 'B';
		return base.charAt(0).toUpperCase();
	}
	/** True when we have a usable avatar URL. */
	get hasAvatar() {
		return !!this.picture;
	}

	// ── lifecycle ──────────────────────────────────────────────────────
	/** Load cached metadata from localStorage. Safe to call repeatedly. */
	load = () => {
		if (!browser) return;
		try {
			const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
			if (raw) {
				const parsed = JSON.parse(raw) as PersistedProfile;
				this.seenCreatedAt = Number(parsed.__seenCreatedAt) || 0;
				this.meta = normalizeMeta(parsed as Record<string, unknown>);
			}
		} catch {
			/* corrupt cache — start empty */
		} finally {
			this.hydrated = true;
		}
	};

	private persist() {
		if (!browser) return;
		const payload: PersistedProfile = {
			...this.meta,
			...(this.seenCreatedAt ? { __seenCreatedAt: this.seenCreatedAt } : {})
		};
		localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(payload));
	}

	/** Overwrite the local cache from the settings form. Does NOT touch relays.
	 *  Bumps the watermark to "now" so a later relay fetch won't clobber an
	 *  offline edit with stale data. */
	save = (data: NostrProfileMeta) => {
		this.meta = normalizeMeta(data as Record<string, unknown>);
		this.seenCreatedAt = Math.floor(Date.now() / 1000);
		this.persist();
	};

	/** Publish the current cache to Nostr as a signed kind-0 event. Returns
	 *  true when at least one relay accepted it. Best-effort: failures are
	 *  swallowed (the local cache is already saved). */
	publish = async (): Promise<boolean> => {
		const snap = session.snapshot;
		if (!snap) return false;
		if (!relays.online || !relays.writableNormalized.length) return false;
		this.publishing = true;
		try {
			const clean: Record<string, string> = {};
			for (const [k, v] of Object.entries(this.meta)) {
				if (typeof v === 'string' && v.trim()) clean[k] = v.trim();
			}
			const template = {
				kind: NOSTR_KINDS.PROFILE,
				created_at: Math.floor(Date.now() / 1000),
				tags: [] as string[][],
				content: JSON.stringify(clean)
			};
			const event = (await signNostrEvent({
				template,
				fallbackPubkey: snap.pubkey,
				loginMethod: snap.loginMethod,
				nsec: snap.nsec,
				extensionSigner: session.extensionSigner ?? undefined
			})) as NostrEvent;
			const ok = await sendEvent(event);
			if (ok) {
				this.seenCreatedAt = event.created_at;
				this.persist();
			}
			return ok;
		} catch (e) {
			console.warn('[profile] publish failed', e);
			return false;
		} finally {
			this.publishing = false;
		}
	};

	/** Fetch the latest kind-0 metadata for the active pubkey from relays and
	 *  merge into the cache when the relay copy is newer than what we have.
	 *  Pass `force` to accept the relay copy regardless of the watermark. */
	fetchFromRelays = async (force = false): Promise<boolean> => {
		const me = session.pubkey;
		if (!me || !relays.online || !relays.readableNormalized.length) return false;
		this.loading = true;
		try {
			const events = await fetchEvents({ kinds: [NOSTR_KINDS.PROFILE], authors: [me] });
			if (!events.length) return false;
			let best: NostrEvent | null = null;
			for (const ev of events) {
				if (!best || ev.created_at > best.created_at) best = ev;
			}
			if (!best) return false;
			if (!force && best.created_at <= this.seenCreatedAt) return false;
			let parsed: NostrProfileMeta = {};
			try {
				parsed = JSON.parse(best.content || '{}');
			} catch {
				return false;
			}
			this.meta = normalizeMeta(parsed as Record<string, unknown>);
			this.seenCreatedAt = best.created_at;
			this.persist();
			return true;
		} catch (e) {
			console.warn('[profile] fetch failed', e);
			return false;
		} finally {
			this.loading = false;
		}
	};

	/** Clear cached state (on logout / identity switch). */
	reset = () => {
		this.meta = {};
		this.seenCreatedAt = 0;
		this.hydrated = false;
		this.loading = false;
		this.publishing = false;
		if (browser) localStorage.removeItem(PROFILE_STORAGE_KEY);
	};
}

export const profile = new ProfileStore();
