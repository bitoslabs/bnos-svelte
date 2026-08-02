/**
 * Local-first GLO collection store. Every domain object (product, order,
 * customer, …) is a GLO object carrying its Nostr kind (see bnos-core
 * `glo/kinds`). The store keeps a reactive, IndexedDB-backed cache per type
 * and syncs to Nostr relays via @bitos/bnos-core when online + authenticated.
 *
 * Persistence:
 *   - GLO collections → IndexedDB via idb-keyval (handles large data, non-blocking)
 *   - One-time migration from localStorage keys with `bnos-os:glo:` prefix
 *
 * Reactivity (Svelte 5 runes):
 *   - `collections` is `$state` — a deep reactive proxy.
 *   - `all()` ALWAYS reads from `collections[type]` so any `$derived` that
 *     calls `all()` will re-run when the collection changes.
 *   - Mutations go through `setCollection()` which creates a NEW array
 *     (never mutate in place) so Svelte detects the change.
 *   - `version` counter bumps on every mutation as a second reactivity signal
 *     for computed values that derive across types.
 *
 * Async hydration:
 *   - `get()` returns the current cached value synchronously (empty [] if not
 *     yet loaded) and kicks off async IndexedDB hydration in the background.
 *   - When hydration completes, `$state` is updated, which re-runs any
 *     active `$derived` / `$effect` automatically.
 */
import { browser } from '$app/environment';
import {
	createGloObject,
	createGloEventTemplate,
	createGloFilter,
	parseGloEvent,
	isGloObject,
	type GloObject,
	type GloObjectType,
	type GloVisibility,
	type KnownGloObjectType
} from '@bitos/bnos-core/glo';
import { signNostrEvent, type NostrEvent } from '@bitos/bnos-core';
import { get as idbGet, set as idbSet, del as idbDel, keys as idbKeys } from 'idb-keyval';
import { session } from './session.svelte';
import { relays } from './relay.svelte';
import { tenant } from './tenant.svelte';
import { fetchEvents, sendEvent } from './client';
import { toast } from '$lib/stores/toast.svelte';

const STORAGE_PREFIX = 'bnos-os:glo:';

function uid(): string {
	if (browser && crypto.randomUUID) return crypto.randomUUID();
	return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

type AnyGloObject = GloObject<unknown>;

// ─── IndexedDB read/write helpers ────────────────────────────────────────────

async function readLocal(type: string): Promise<AnyGloObject[]> {
	if (!browser) return [];
	try {
		const arr = await idbGet<AnyGloObject[]>(STORAGE_PREFIX + type);
		return Array.isArray(arr) ? arr.filter(isGloObject) : [];
	} catch {
		return [];
	}
}

async function writeLocal(type: string, items: AnyGloObject[]) {
	if (!browser) return;
	try {
		// Strip Svelte $state proxies — IndexedDB structured clone can't handle them.
		const plain = JSON.parse(JSON.stringify(items));
		await idbSet(STORAGE_PREFIX + type, plain);
	} catch (e) {
		console.warn('[glo] IndexedDB write failed', type, e);
	}
}

// ─── Cross-tab sync via BroadcastChannel ─────────────────────────────────────

let _broadcastChannel: BroadcastChannel | null = null;

function getBroadcastChannel(): BroadcastChannel | null {
	if (!browser) return null;
	if (!_broadcastChannel) {
		_broadcastChannel = new BroadcastChannel('bnos-os:glo');
	}
	return _broadcastChannel;
}

// ─── Reactive Collections ────────────────────────────────────────────────────

// Forward reference — set after GloStore is instantiated.
let gloInstance: GloStore | null = null;

/** A reactive Map of type → array of GLO objects, backed by IndexedDB. */
class ReactiveCollections {
	private _map = $state<Record<string, AnyGloObject[]>>({});
	private _hydrated = new Set<string>();
	private _hydrating = new Set<string>();

	/** Ensure a type is loaded from IndexedDB into the reactive proxy.
	 *  Safe to call inside $derived — if not yet hydrated, schedules async
	 *  hydration and returns empty array (will re-run derived after hydration
	 *  completes and $state is updated). */
	hydrate(type: string) {
		if (this._hydrated.has(type) || this._hydrating.has(type)) return;
		this._hydrating.add(type);

		// Fire async hydration — when it completes, update $state which
		// triggers any $derived/$effect that read this collection.
		void readLocal(type).then((items) => {
			this._hydrating.delete(type);
			// Don't overwrite if data was written while we were reading.
			if (this._hydrated.has(type)) return;
			this._hydrated.add(type);
			this._map[type] = items;
			console.debug(`[glo] hydrated "${type}" → ${items.length} items`);
			// Bump version to signal hydration completed (for components
			// that need to know when initial data has arrived).
			if (gloInstance) gloInstance.bump();
		}).catch((e) => {
			this._hydrating.delete(type);
			console.warn(`[glo] hydration failed for "${type}"`, e);
			this._hydrated.add(type);
			if (gloInstance) gloInstance.bump();
		});
	}

	isHydrated(type: string) {
		return this._hydrated.has(type);
	}

	/** Read the reactive array for a type (pure read — safe inside $derived).
	 *  Returns cached data synchronously; triggers async hydration if not yet
	 *  loaded, which will cause $derived to re-run when data arrives. */
	get(type: string): AnyGloObject[] {
		if (!this._hydrated.has(type) && !this._hydrating.has(type)) {
			this.hydrate(type);
		}
		return this._map[type] ?? [];
	}

	/** Replace the entire array for a type (triggers $state reactivity).
	 *  Persists to IndexedDB asynchronously (fire-and-forget). */
	set(type: string, items: AnyGloObject[]) {
		this._hydrated.add(type);
		this._hydrating.delete(type);
		// Create a fresh array so the $state proxy sees a new reference.
		this._map[type] = [...items];
		void writeLocal(type, this._map[type]);
	}

	/** Insert or update a single object within a type collection.
	 *  Works on in-memory state synchronously, persists to IDB asynchronously. */
	upsert(type: string, obj: AnyGloObject) {
		// Mark as hydrated so async hydration won't overwrite our write.
		this._hydrated.add(type);
		this._hydrating.delete(type);
		const current = this._map[type] ?? [];
		const filtered = current.filter((o) => o.id !== obj.id);
		// Prepend the new/updated object.
		this._map[type] = [obj, ...filtered];
		void writeLocal(type, this._map[type]);
	}

	/** Remove a single object by id.
	 *  Works on in-memory state synchronously, persists to IDB asynchronously. */
	remove(type: string, id: string) {
		// Mark as hydrated so async hydration won't overwrite our removal.
		this._hydrated.add(type);
		this._hydrating.delete(type);
		const current = this._map[type] ?? [];
		this._map[type] = current.filter((o) => o.id !== id);
		void writeLocal(type, this._map[type]);
	}

	/** Find a single object by id (pure read — safe inside $derived). */
	find(type: string, id: string): AnyGloObject | undefined {
		if (!this._hydrated.has(type) && !this._hydrating.has(type)) {
			this.hydrate(type);
		}
		return (this._map[type] ?? []).find((o) => o.id === id);
	}

	/** Get all keys that have been hydrated. */
	types(): string[] {
		return [...this._hydrated];
	}

	/** One-time migration from localStorage to IndexedDB. */
	async migrate() {
		if (!browser) return;
		try {
			let migrated = 0;
			for (let i = localStorage.length - 1; i >= 0; i--) {
				const key = localStorage.key(i);
				if (!key?.startsWith(STORAGE_PREFIX)) continue;
				const type = key.slice(STORAGE_PREFIX.length);
				if (!type) continue;
				const raw = localStorage.getItem(key);
				if (!raw) continue;
				try {
					const parsed = JSON.parse(raw);
					if (Array.isArray(parsed)) {
						await idbSet(key, parsed);
						migrated++;
						// Remove from localStorage to free space.
						localStorage.removeItem(key);
					}
				} catch {
					// Skip malformed entries.
				}
			}
			if (migrated > 0) {
				console.info(`[glo] Migrated ${migrated} collection(s) from localStorage to IndexedDB`);
			}
		} catch (e) {
			console.warn('[glo] Migration failed', e);
		}
	}

	/** Reload a type from IndexedDB (used by cross-tab sync). */
	async reload(type: string) {
		if (this._hydrating.has(type)) return;
		const items = await readLocal(type);
		this._hydrated.add(type);
		this._map[type] = items;
	}
}

// ─── Glo Store ───────────────────────────────────────────────────────────────

class GloStore {
	/** Reactive collections — the single source of truth for UI. */
	private collections = new ReactiveCollections();

	hydrating = $state(false);
	syncing = $state<Set<string>>(new Set());

	/** Global version counter — bumps on every mutation + hydration. */
	version = $state(0);

	bump() {
		this.version++;
	}

	/** Run one-time migration from localStorage to IndexedDB. */
	migrate = async () => {
		await this.collections.migrate();
	};

	/** Hydrate a type's local cache into the reactive store (idempotent). */
	hydrate = (type: string) => {
		this.collections.hydrate(type);
	};

	/** Check if a type has been hydrated from IndexedDB. */
	isHydrated = (type: string): boolean => {
		// Read version so Svelte tracks reactivity — version bumps when hydration completes.
		void this.version;
		return this.collections.isHydrated(type);
	};

	/**
	 * Reactive accessor for a typed collection.
	 *
	 * ALWAYS reads from the `$state` proxy so any `$derived` or `$effect`
	 * that calls this will re-run when the collection changes.
	 */
	all = <TData, TType extends string = string>(type: TType): GloObject<TData, TType>[] => {
		// Always read from the reactive proxy — this is the key fix.
		// The proxy tracks reads and notifies any active $derived/$effect.
		return this.collections.get(type) as GloObject<TData, TType>[];
	};

	/** Find one by id (reactive). */
	get = (type: string, id: string): AnyGloObject | undefined => {
		return this.collections.find(type, id);
	};

	/** Create or update a GLO object. Returns the saved object. */
	upsert = async <TData>(
		type: string,
		data: TData,
		opts: { id?: string; visibility?: GloVisibility; extensions?: Record<string, unknown> } = {}
	): Promise<GloObject<TData, string>> => {
		const id = opts.id ?? uid();
		const existing = this.collections.find(type, id);
		const object = createGloObject<TData, string>({
			type,
			id,
			scope: { ...tenant.scope, ownerPubkey: session.pubkey ?? undefined },
			visibility: opts.visibility ?? existing?.visibility ?? 'organization',
			data,
			extensions: opts.extensions as never
		});

		// Insert/update through the reactive collections proxy.
		this.collections.upsert(type, object as AnyGloObject);
		this.bump();

		// Broadcast to other tabs.
		getBroadcastChannel()?.postMessage({ type: 'upsert', collectionType: type });

		// Best-effort Nostr publish.
		await this.publish(type, object);
		return object;
	};

	/** Remove a GLO object locally. */
	remove = (type: string, id: string) => {
		this.collections.remove(type, id);
		this.bump();
		// Broadcast to other tabs.
		getBroadcastChannel()?.postMessage({ type: 'remove', collectionType: type });
	};

	/** Batch upsert (for relay sync merges). */
	batchUpsert = (type: string, objects: AnyGloObject[]) => {
		if (!objects.length) return;
		// Ensure data is loaded — if not hydrated, the set() below replaces [].
		const current = this.collections.get(type);
		const byId = new Map(current.map((o) => [o.id, o]));
		for (const obj of objects) {
			byId.set(obj.id, obj);
		}
		this.collections.set(type, [...byId.values()]);
		this.bump();
		// Broadcast to other tabs.
		getBroadcastChannel()?.postMessage({ type: 'batch', collectionType: type });
	};

	/** Sign + publish a GLO object as a Nostr event. */
	private publish = async (type: string, object: GloObject<unknown>) => {
		if (!session.snapshot || !relays.online) return;
		try {
			const template = createGloEventTemplate(object, {
				client: 'bdgo-os',
				summary: `${type} ${object.id}`
			});
			const event = await signNostrEvent({
				template,
				fallbackPubkey: session.snapshot.pubkey,
				loginMethod: session.snapshot.loginMethod,
				nsec: session.snapshot.nsec,
				extensionSigner: session.extensionSigner ?? undefined
			});
			await sendEvent(event as NostrEvent);
		} catch (e) {
			console.warn('[glo] publish failed', e);
		}
	};

	/** Pull the latest events for a type from relays and merge locally. */
	sync = async (type: string, limit = 200) => {
		if (!session.pubkey || !relays.online || !relays.readableNormalized.length) return;
		if (this.syncing.has(type)) return;
		this.syncing = new Set(this.syncing).add(type);
		try {
			const filter = createGloFilter({
				types: [type],
				authors: [session.pubkey],
				organizationId: tenant.state.organizationId || undefined,
				limit
			});
			const events = await fetchEvents(filter as Parameters<typeof fetchEvents>[0]);
			const incoming: AnyGloObject[] = [];
			for (const ev of events) {
				try {
					incoming.push(parseGloEvent(ev as never).object);
				} catch {
					/* skip non-GLO / malformed */
				}
			}
			if (incoming.length) this.batchUpsert(type, incoming);
		} finally {
			const next = new Set(this.syncing);
			next.delete(type);
			this.syncing = next;
		}
	};

	/** Sync everything the app cares about. */
	syncAll = async (types: string[]) => {
		if (!session.pubkey) return;
		await Promise.all(types.map((t) => this.sync(t)));
	};

	/** Cross-tab sync: listen for BroadcastChannel messages from other tabs. */
	initCrossTab = () => {
		if (!browser) return;
		const channel = getBroadcastChannel();
		if (!channel) return;
		channel.addEventListener('message', (e) => {
			const msg = e.data;
			if (!msg?.collectionType) return;
			// Reload this type from IndexedDB into the reactive proxy.
			void this.collections.reload(msg.collectionType).then(() => this.bump());
		});
	};
}

export const glo = new GloStore();
gloInstance = glo;

// Initialize cross-tab sync + run migration in the browser.
if (browser) {
	glo.initCrossTab();
	void glo.migrate();
}

export type { GloObject, GloObjectType, KnownGloObjectType, GloVisibility };
