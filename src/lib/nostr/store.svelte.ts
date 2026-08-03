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
import { SvelteSet } from 'svelte/reactivity';
import {
	createGloObject,
	createGloEventTemplate,
	createGloFilter,
	createGloIdentifier,
	createGloTags,
	decodeGloContent,
	encodeGloContent,
	getTagValue,
	getGloKindForType,
	parseGloEvent,
	isGloObject,
	type GloObject,
	type GloObjectType,
	type GloScope,
	type GloVisibility,
	type KnownGloObjectType
} from '@bitos/bnos-core/glo';
import { NOSTR_KINDS, signNostrEvent, type NostrEvent } from '@bitos/bnos-core';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import { session } from './session.svelte';
import { relays } from './relay.svelte';
import { tenant } from './tenant.svelte';
import { fetchEvents, sendEvent } from './client';

const STORAGE_PREFIX = 'bnos-os:glo:';
const PUBLISH_QUEUE_KEY = 'bnos-os:glo:publish-queue';
const KIND_UPGRADE_PREFIX = 'bnos-os:glo:kind-upgraded:';
const APP_KIND_BY_TYPE: Record<string, number> = {
	shift: NOSTR_KINDS.SHIFT,
	'cash-event': NOSTR_KINDS.CASH_EVENT
};

function uid(): string {
	if (browser && crypto.randomUUID) return crypto.randomUUID();
	return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

type AnyGloObject = GloObject<unknown> & { __eventCreatedAt?: number };
type QueuedPublish = {
	type: string;
	object: AnyGloObject;
	queuedAt: number;
};

function toTimestamp(value: unknown): number {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value !== 'string') return 0;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

function objectTimestamp(object: AnyGloObject): number {
	const data = object.data && typeof object.data === 'object' ? object.data as Record<string, unknown> : {};
	return Math.max(
		toTimestamp(data.updatedAt),
		toTimestamp(data.createdAt),
		(object.__eventCreatedAt ?? 0) * 1000
	);
}

function stampData<TData>(data: TData, existing?: AnyGloObject): TData {
	if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
	const now = new Date().toISOString();
	const current = existing?.data && typeof existing.data === 'object'
		? existing.data as Record<string, unknown>
		: {};
	return {
		...(data as Record<string, unknown>),
		createdAt: (data as Record<string, unknown>).createdAt ?? current.createdAt ?? now,
		updatedAt: now
	} as TData;
}

function appKindForType(type: string) {
	return APP_KIND_BY_TYPE[type] ?? getGloKindForType(type);
}

function kindUpgradeKey(type: string) {
	return `${KIND_UPGRADE_PREFIX}${tenant.state.organizationId || 'no-workspace'}:${type}:${appKindForType(type)}`;
}

function createAppGloEventTemplate(object: GloObject<unknown>, options: { client?: string; summary?: string } = {}) {
	const overrideKind = APP_KIND_BY_TYPE[object.type];
	const template = overrideKind
		? {
				kind: overrideKind,
				created_at: Math.floor(Date.now() / 1000),
				tags: createGloTags(object, options),
				content: encodeGloContent(object)
			}
		: createGloEventTemplate(object, options);

	// Staff records: advertise the member's pubkey as a `p` tag so other devices
	// (the staff member's own login) can discover their membership via `#p`.
	// Mirrors the bdgo-os-nuxt staff event convention.
	if (object.type === 'identity.staff') {
		const staffPubkey = (object.data as { pubkey?: string } | null)?.pubkey;
		if (staffPubkey && !template.tags.some((t) => t[0] === 'p' && t[1] === staffPubkey)) {
			template.tags = [...template.tags, ['p', staffPubkey]];
		}
	}
	return template;
}

function parseAppGloEvent(event: NostrEvent): AnyGloObject {
	try {
		return parseGloEvent(event as never).object as AnyGloObject;
	} catch (e) {
		const object = decodeGloContent(event.content) as AnyGloObject;
		const overrideKind = APP_KIND_BY_TYPE[object.type];
		if (!overrideKind || event.kind !== overrideKind) throw e;
		if (getTagValue(event.tags, 'd') !== createGloIdentifier(object.type, object.id)) throw e;
		return object;
	}
}

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

async function readPublishQueue(): Promise<QueuedPublish[]> {
	if (!browser) return [];
	try {
		const queued = await idbGet<QueuedPublish[]>(PUBLISH_QUEUE_KEY);
		return Array.isArray(queued) ? queued.filter((item) => item?.type && isGloObject(item.object)) : [];
	} catch {
		return [];
	}
}

async function writePublishQueue(items: QueuedPublish[]) {
	if (!browser) return;
	try {
		await idbSet(PUBLISH_QUEUE_KEY, JSON.parse(JSON.stringify(items)));
	} catch (e) {
		console.warn('[glo] publish queue write failed', e);
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

	/** Clear all collections and reset hydration state (for logout). */
	clearAll() {
		this._map = {};
		this._hydrated.clear();
		this._hydrating.clear();
	}
}

// ─── Glo Store ───────────────────────────────────────────────────────────────

class GloStore {
	/** Reactive collections — the single source of truth for UI. */
	private collections = new ReactiveCollections();

	hydrating = $state(false);
	syncing = new SvelteSet<string>();
	publishQueueSize = $state(0);

	/** Global version counter — bumps on every mutation + hydration. */
	version = $state(0);

	bump() {
		this.version++;
	}

	private queuePublish = async (type: string, object: GloObject<unknown>) => {
		const queued = await readPublishQueue();
		const key = `${type}:${object.id}`;
		const next = [
			{ type, object: object as AnyGloObject, queuedAt: Date.now() },
			...queued.filter((item) => `${item.type}:${item.object.id}` !== key)
		];
		await writePublishQueue(next);
		this.publishQueueSize = next.length;
	};

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
		opts: {
			id?: string;
			visibility?: GloVisibility;
			extensions?: Record<string, unknown>;
			scope?: Partial<GloScope>;
		} = {}
	): Promise<GloObject<TData, string>> => {
		const id = opts.id ?? uid();
		const existing = this.collections.find(type, id);
		const dataWithTimestamps = stampData(data, existing);
		const object = createGloObject<TData, string>({
			type,
			id,
			scope: {
				...tenant.scope,
				...(opts.scope ?? {}),
				ownerPubkey: opts.scope?.ownerPubkey ?? session.pubkey ?? undefined
			},
			visibility: opts.visibility ?? existing?.visibility ?? 'organization',
			data: dataWithTimestamps,
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
		const byId: Record<string, AnyGloObject> = Object.fromEntries(current.map((o) => [o.id, o]));
		for (const obj of objects) {
			const existing = byId[obj.id];
			if (!existing || objectTimestamp(obj) >= objectTimestamp(existing)) {
				byId[obj.id] = obj;
			}
		}
		this.collections.set(type, Object.values(byId));
		this.bump();
		// Broadcast to other tabs.
		getBroadcastChannel()?.postMessage({ type: 'batch', collectionType: type });
	};

	/** Sign + publish a GLO object as a Nostr event. */
	private publish = async (type: string, object: GloObject<unknown>, options: { queueOnFailure?: boolean } = {}) => {
		const { queueOnFailure = true } = options;
		if (!session.snapshot || !relays.online || !relays.writableNormalized.length) {
			if (queueOnFailure) await this.queuePublish(type, object);
			return false;
		}
		try {
			const template = createAppGloEventTemplate(object, {
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
			const published = await sendEvent(event as NostrEvent);
			if (!published && queueOnFailure) await this.queuePublish(type, object);
			return published;
		} catch (e) {
			console.warn('[glo] publish failed', e);
			if (queueOnFailure) await this.queuePublish(type, object);
			return false;
		}
	};

	/** Retry locally saved writes that failed to publish earlier. */
	flushPublishQueue = async () => {
		if (!session.snapshot || !relays.online || !relays.writableNormalized.length) return 0;
		const queued = await readPublishQueue();
		if (!queued.length) {
			this.publishQueueSize = 0;
			return 0;
		}

		const remaining: QueuedPublish[] = [];
		let publishedCount = 0;
		for (const item of queued) {
			const published = await this.publish(item.type, item.object, { queueOnFailure: false });
			if (published) publishedCount++;
			else remaining.push(item);
		}
		await writePublishQueue(remaining);
		this.publishQueueSize = remaining.length;
		return publishedCount;
	};

	private publishLocalKindUpgrade = async (type: string) => {
		if (!browser || !APP_KIND_BY_TYPE[type]) return;
		if (!session.snapshot || !relays.online || !relays.writableNormalized.length) return;
		const stampKey = kindUpgradeKey(type);
		if (localStorage.getItem(stampKey)) return;

		const localObjects = this.collections.get(type);
		if (!localObjects.length) {
			localStorage.setItem(stampKey, String(Date.now()));
			return;
		}

		let allPublished = true;
		for (const object of localObjects) {
			const published = await this.publish(type, object, { queueOnFailure: true });
			allPublished &&= published;
		}
		if (allPublished) localStorage.setItem(stampKey, String(Date.now()));
	};

	/** Pull the latest events for a type from relays and merge locally. */
	sync = async (type: string, limit = 200) => {
		if (!session.pubkey || !relays.online || !relays.readableNormalized.length) return;
		if (this.syncing.has(type)) return;
		this.syncing.add(type);
		try {
			await this.flushPublishQueue();
			await this.publishLocalKindUpgrade(type);
			const filter = createGloFilter({
				types: [type],
				authors: [session.pubkey],
				organizationId: tenant.state.organizationId || undefined,
				limit
			});
			filter.kinds = [...new Set([...filter.kinds, appKindForType(type)])];
			const events = await fetchEvents(filter as Parameters<typeof fetchEvents>[0]);
			const incoming: AnyGloObject[] = [];
			for (const ev of events) {
				try {
					incoming.push({
						...parseAppGloEvent(ev as NostrEvent),
						__eventCreatedAt: ev.created_at
					});
				} catch {
					/* skip non-GLO / malformed */
				}
			}
			if (incoming.length) this.batchUpsert(type, incoming);
		} finally {
			this.syncing.delete(type);
		}
	};

	/** Sync everything the app cares about. */
	syncAll = async (types: string[]) => {
		if (!session.pubkey) return;
		await Promise.all(types.map((t) => this.sync(t)));
	};

	/**
	 * Clear ALL in-memory GLO collections and reset hydration tracking.
	 * Call this on logout so the next login starts with zero stale data.
	 * The IndexedDB wipe is handled by session.logout().
	 */
	clearAll = () => {
		this.collections.clearAll();
		this.publishQueueSize = 0;
		this.bump();
		// Broadcast to other tabs so they also clear.
		getBroadcastChannel()?.postMessage({ type: 'clear-all' });
	};

	/** Cross-tab sync: listen for BroadcastChannel messages from other tabs. */
	initCrossTab = () => {
		if (!browser) return;
		const channel = getBroadcastChannel();
		if (!channel) return;
		channel.addEventListener('message', (e) => {
			const msg = e.data;
			if (msg?.type === 'clear-all') {
				this.clearAll();
				return;
			}
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
