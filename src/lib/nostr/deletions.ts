import { browser } from '$app/environment';

/**
 * Local tombstones for deleted GLO objects.
 *
 * Deletion removes an object locally, but relays still hold its (replaceable)
 * event. Without a tombstone the next sync would resurrect it. We therefore
 * remember when an id was deleted and ignore relay copies that are not newer
 * than the deletion. A later edit from another device (newer timestamp) wins
 * and clears the tombstone.
 */
export type Tombstones = Record<string, number>;

export const TOMBSTONE_LIMIT = 500;
const PREFIX = 'bnos:deleted:';
const cache = new Map<string, Tombstones>();

/** True when the relay object is not newer than the local deletion. */
export function isTombstoned(tombstones: Tombstones, id: string, objectAtMs: number): boolean {
	const deletedAt = tombstones[id];
	return deletedAt !== undefined && deletedAt >= objectAtMs;
}

/** Add a tombstone, keeping only the most recent ids for a type. */
export function addTombstone(tombstones: Tombstones, id: string, atMs: number): Tombstones {
	const next = { ...tombstones, [id]: atMs };
	const entries = Object.entries(next);
	if (entries.length <= TOMBSTONE_LIMIT) return next;
	entries.sort((a, b) => b[1] - a[1]);
	return Object.fromEntries(entries.slice(0, TOMBSTONE_LIMIT));
}

export function tombstonesFor(type: string): Tombstones {
	let tombstones = cache.get(type);
	if (!tombstones) {
		tombstones = read(type);
		cache.set(type, tombstones);
	}
	return tombstones;
}

export function recordDeletion(type: string, id: string, atMs = Date.now()): void {
	const next = addTombstone(tombstonesFor(type), id, atMs);
	cache.set(type, next);
	persist(type, next);
}

export function clearDeletion(type: string, id: string): void {
	const current = tombstonesFor(type);
	if (!(id in current)) return;
	const next = { ...current };
	delete next[id];
	cache.set(type, next);
	persist(type, next);
}

export function invalidateTombstones(type: string): void {
	cache.delete(type);
}

export function clearAllDeletions(): void {
	cache.clear();
	if (!browser) return;
	try {
		for (let i = localStorage.length - 1; i >= 0; i--) {
			const key = localStorage.key(i);
			if (key?.startsWith(PREFIX)) localStorage.removeItem(key);
		}
	} catch {
		/* best effort */
	}
}

function read(type: string): Tombstones {
	if (!browser) return {};
	try {
		const raw = localStorage.getItem(PREFIX + type);
		const parsed = raw ? JSON.parse(raw) : null;
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
		const out: Tombstones = {};
		for (const [id, at] of Object.entries(parsed)) {
			if (typeof at === 'number' && Number.isFinite(at)) out[id] = at;
		}
		return out;
	} catch {
		return {};
	}
}

function persist(type: string, tombstones: Tombstones): void {
	if (!browser) return;
	try {
		if (Object.keys(tombstones).length === 0) localStorage.removeItem(PREFIX + type);
		else localStorage.setItem(PREFIX + type, JSON.stringify(tombstones));
	} catch {
		/* best effort */
	}
}
