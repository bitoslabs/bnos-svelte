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
import { fetchEvents, fetchEventsPrimaryFirst, sendEvent } from './client';
import { verifyEvent } from 'nostr-tools/pure';
import { encryptGloObject, decryptGloEvent, shouldEncryptType } from '$lib/crypto/glo-cipher';
import { mergeHydratedCollection } from './collection-merge';
import { mapLimit } from '$lib/utils/async';
import {
	clearAllDeletions,
	clearDeletion,
	invalidateTombstones,
	isTombstoned,
	recordDeletion,
	tombstonesFor
} from './deletions';

const STORAGE_PREFIX = 'bnos-os:glo:';
const PUBLISH_QUEUE_KEY = 'bnos-os:glo:publish-queue';
const KIND_UPGRADE_PREFIX = 'bnos-os:glo:kind-upgraded:';
const APP_KIND_BY_TYPE: Record<string, number> = {
	shift: NOSTR_KINDS.SHIFT,
	'cash-event': NOSTR_KINDS.CASH_EVENT,
	// Dedicated BNOS marketplace kinds (registered app-side until bnos-core
	// adds them to GLO_KIND_BY_TYPE). Keeps wire format standards-compliant.
	'marketplace.connection': NOSTR_KINDS.STORE_CONNECTION,
	'marketplace.product': NOSTR_KINDS.MARKETPLACE_PRODUCT,
	'marketplace.review': NOSTR_KINDS.MARKETPLACE_REVIEW
};

function uid(): string {
	if (browser && crypto.randomUUID) return crypto.randomUUID();
	return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

type AnyGloObject = GloObject<unknown> & {
	__eventCreatedAt?: number;
	/** Persisted (cheap) — enables the fast `ids:[]` relay lookup in fetchEvent. */
	__eventId?: string;
	/** Ephemeral full event — stripped from IDB (see writeLocal) to avoid bloat. */
	__event?: NostrEvent;
};
type QueuedPublish = {
	type: string;
	object: AnyGloObject;
	queuedAt: number;
};

/** Remove the in-memory Nostr event before serializing a GLO object. */
function withoutEphemeralEvent(object: AnyGloObject): AnyGloObject {
	const plain = { ...object };
	delete plain.__event;
	delete plain.__eventId;
	delete plain.__eventCreatedAt;
	return plain;
}

function toTimestamp(value: unknown): number {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value !== 'string') return 0;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

function objectTimestamp(object: AnyGloObject): number {
	const data =
		object.data && typeof object.data === 'object' ? (object.data as Record<string, unknown>) : {};
	return Math.max(
		toTimestamp(data.updatedAt),
		toTimestamp(data.createdAt),
		(object.__eventCreatedAt ?? 0) * 1000
	);
}

function stampData<TData>(data: TData, existing?: AnyGloObject): TData {
	if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
	const now = new Date().toISOString();
	const current =
		existing?.data && typeof existing.data === 'object'
			? (existing.data as Record<string, unknown>)
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
/** Cryptographically validate a Nostr event (id + Schnorr sig). Never throws. */
function safeVerify(ev: NostrEvent): boolean {
	try {
		return verifyEvent(ev);
	} catch {
		return false;
	}
}

function kindUpgradeKey(type: string) {
	return `${KIND_UPGRADE_PREFIX}${tenant.state.organizationId || 'no-workspace'}:${type}:${appKindForType(type)}`;
}

function createAppGloEventTemplate(
	object: GloObject<unknown>,
	options: { client?: string; summary?: string } = {}
) {
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

async function parseAppGloEvent(event: NostrEvent): Promise<AnyGloObject> {
	// Encrypted event (SECURITY.md): decrypt content → full GLO envelope, then
	// let the standard parseGloEvent validate envelope-vs-tags. decryptGloEvent
	// returns null for plaintext content, so we fall through unchanged.
	const decrypted = await decryptGloEvent<AnyGloObject>(event).catch(() => null);
	if (decrypted) return decrypted;
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

/** The `createGloFilter` params `glo.sync` builds for a given type + context.
 *
 *  Author strategy (the key to owner ↔ staff device data sharing):
 *  - workspace types (`organization`/`location`) → author = the device's own
 *    pubkey, so each device finds the workspace records it authored. Staff
 *    devices additionally resolve owner-authored workspace records through
 *    `memberships.fetchOrgAndLocations`.
 *  - operational types (catalog, orders, payments, shifts, …) with a known
 *    org → discover via the org scope topic (`glo:organization:<orgId>`) with
 *    NO author restriction. This is what lets a staff device read
 *    owner-authored products AND lets an owner device read staff-authored
 *    orders — the org id acts as an unguessable capability token.
 *  - no org context yet → fall back to own key to avoid a global relay query.
 *
 *  `locationId` adds the `glo:scope:org:loc` topic for branch-scoped sync. */
export interface SyncScopeInput {
	type: string;
	isWorkspaceType: boolean;
	orgId?: string;
	locationId?: string | null;
	sessionPubkey?: string | null;
	authors?: string[];
}
export interface SyncScopeParams {
	types: [string];
	authors?: string[];
	organizationId?: string;
	locationId?: string;
}
export function resolveSyncScope(input: SyncScopeInput): SyncScopeParams {
	const { type, isWorkspaceType, orgId, sessionPubkey, authors } = input;
	const locationId = input.locationId ?? undefined;
	if (authors) {
		return {
			types: [type],
			authors,
			...(isWorkspaceType ? {} : { organizationId: orgId, locationId })
		};
	}
	if (isWorkspaceType) {
		return { types: [type], authors: sessionPubkey ? [sessionPubkey] : undefined };
	}
	if (orgId) {
		return { types: [type], organizationId: orgId, locationId };
	}
	return { types: [type], authors: sessionPubkey ? [sessionPubkey] : undefined };
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
		const plain = JSON.parse(JSON.stringify(items, (k, v) => (k === '__event' ? undefined : v)));
		await idbSet(STORAGE_PREFIX + type, plain);
	} catch {
		/* best effort */
	}
}

// Coalesce persistence for mutations that happen in the same tick (batch
// imports, parallel checkout updates). Serializing a large collection on every
// single upsert is the most expensive part of a local write.
const pendingWrites: Record<string, AnyGloObject[]> = {};
let writeScheduled = false;

async function flushLocalWrites() {
	writeScheduled = false;
	const batch = Object.entries(pendingWrites);
	for (const type of Object.keys(pendingWrites)) delete pendingWrites[type];
	await Promise.all(batch.map(([type, items]) => writeLocal(type, items)));
}

function scheduleLocalWrite(type: string, items: AnyGloObject[]) {
	if (!browser) return;
	pendingWrites[type] = items;
	if (writeScheduled) return;
	writeScheduled = true;
	void Promise.resolve().then(flushLocalWrites);
}

async function readPublishQueue(): Promise<QueuedPublish[]> {
	if (!browser) return [];
	try {
		const queued = await idbGet<QueuedPublish[]>(PUBLISH_QUEUE_KEY);
		return Array.isArray(queued)
			? queued.filter((item) => item?.type && isGloObject(item.object))
			: [];
	} catch {
		return [];
	}
}

async function writePublishQueue(items: QueuedPublish[]) {
	if (!browser) return;
	try {
		// A failed publish may already have an in-memory event attached. Never
		// persist it: retrying such an item would nest the previous event inside
		// its next GLO content and grow exponentially on repeated failures.
		await idbSet(
			PUBLISH_QUEUE_KEY,
			JSON.parse(JSON.stringify(items, (key, value) => (key === '__event' ? undefined : value)))
		);
	} catch {
		/* best effort */
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
	/** IDs removed locally while the IndexedDB read was still in flight. */
	private _removedWhileHydrating: Record<string, Record<string, true>> = {};
	/** Bumped on clearAll so in-flight reads cannot repopulate a cleared store. */
	private _generation = 0;

	private finishHydration(type: string, loaded: AnyGloObject[], generation: number) {
		this._hydrating.delete(type);
		if (generation !== this._generation) return;
		// A local mutation may have marked the type hydrated already (e.g. a
		// cross-tab reload). Never overwrite newer in-memory state.
		if (this._hydrated.has(type)) return;

		const local = this._map[type];
		let items = loaded;
		if (local) {
			// A write happened before the read completed: merge it over the
			// stored snapshot instead of dropping either side.
			items = mergeHydratedCollection(local, loaded, this._removedWhileHydrating[type]);
			scheduleLocalWrite(type, items);
		}

		delete this._removedWhileHydrating[type];
		this._hydrated.add(type);
		this._map[type] = items;
		// Bump version to signal hydration completed (for components that need
		// to know when initial data has arrived).
		if (gloInstance) gloInstance.bump();
	}

	/** Ensure a type is loaded from IndexedDB into the reactive proxy.
	 *  Safe to call inside $derived — if not yet hydrated, schedules async
	 *  hydration and returns empty array (will re-run derived after hydration
	 *  completes and $state is updated). */
	hydrate(type: string) {
		if (this._hydrated.has(type) || this._hydrating.has(type)) return;
		this._hydrating.add(type);
		const generation = this._generation;

		// Fire async hydration — when it completes, update $state which
		// triggers any $derived/$effect that read this collection.
		void readLocal(type)
			.then((items) => this.finishHydration(type, items, generation))
			.catch(() => this.finishHydration(type, [], generation));
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
		const next = [...items];
		// If the stored snapshot has not loaded yet, keep the new items in
		// memory and let finishHydration merge them with the stored data.
		this._map[type] = next;
		if (this._hydrated.has(type)) scheduleLocalWrite(type, next);
		else this.hydrate(type);
	}

	/** Insert or update a single object within a type collection.
	 *  Works on in-memory state synchronously, persists to IDB asynchronously. */
	upsert(type: string, obj: AnyGloObject) {
		const current = this._map[type] ?? [];
		const filtered = current.filter((o) => o.id !== obj.id);
		const next = [obj, ...filtered];
		this._map[type] = next;
		if (this._hydrated.has(type)) scheduleLocalWrite(type, next);
		else this.hydrate(type);
	}

	/** Remove a single object by id.
	 *  Works on in-memory state synchronously, persists to IDB asynchronously. */
	remove(type: string, id: string) {
		const next = (this._map[type] ?? []).filter((o) => o.id !== id);
		this._map[type] = next;
		if (this._hydrated.has(type)) {
			scheduleLocalWrite(type, next);
			return;
		}
		const removed = this._removedWhileHydrating[type] ?? {};
		removed[id] = true;
		this._removedWhileHydrating[type] = removed;
		this.hydrate(type);
	}

	/** Find a single object by id (pure read — safe inside $derived). */
	/** Per-array id index. Array identity changes on every mutation, so this
	 *  cache is invalidated automatically without extra bookkeeping. */
	private _indexes = new WeakMap<AnyGloObject[], Map<string, AnyGloObject>>();

	find(type: string, id: string): AnyGloObject | undefined {
		if (!this._hydrated.has(type) && !this._hydrating.has(type)) {
			this.hydrate(type);
		}
		const items = this._map[type];
		if (!items) return undefined;
		let index = this._indexes.get(items);
		if (!index) {
			index = new Map(items.map((obj) => [obj.id, obj] as const));
			this._indexes.set(items, index);
		}
		return index.get(id);
	}

	/** Get all keys that have been hydrated. */
	types(): string[] {
		return [...this._hydrated];
	}

	/** One-time migration from localStorage to IndexedDB. */
	async migrate() {
		if (!browser) return;
		try {
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
						// Never clobber an existing IndexedDB snapshot with stale
						// localStorage data (e.g. after a downgrade or previous run).
						const existing = await idbGet(key);
						if (existing === undefined) await idbSet(key, parsed);
						// Either way, the legacy copy is no longer needed.
						localStorage.removeItem(key);
					}
				} catch {
					// Skip malformed entries.
				}
			}
		} catch {
			/* best effort */
		}
	}

	/** Reload a type from IndexedDB (used by cross-tab sync). */
	async reload(type: string) {
		if (this._hydrating.has(type)) return;
		const generation = this._generation;
		const items = await readLocal(type);
		if (generation !== this._generation) return;
		this._hydrated.add(type);
		this._map[type] = items;
	}

	/** Clear all collections and reset hydration state (for logout). */
	clearAll() {
		this._generation++;
		this._map = {};
		this._hydrated.clear();
		this._hydrating.clear();
		this._removedWhileHydrating = {};
		for (const type of Object.keys(pendingWrites)) delete pendingWrites[type];
		clearAllDeletions();
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

	private pendingBroadcasts: Record<string, string> = {};
	private broadcastScheduled = false;

	/** Notify other tabs only after the coalesced IndexedDB write has flushed,
	 *  so they read the new state instead of a stale snapshot. One message per
	 *  collection per tick keeps bulk writes from causing reload storms. */
	private broadcast = (message: { type: string; collectionType: string }) => {
		if (!getBroadcastChannel()) return;
		this.pendingBroadcasts[message.collectionType] = message.type;
		if (this.broadcastScheduled) return;
		this.broadcastScheduled = true;
		void flushLocalWrites().then(() => {
			this.broadcastScheduled = false;
			const channel = getBroadcastChannel();
			if (!channel) return;
			const batch = Object.entries(this.pendingBroadcasts);
			this.pendingBroadcasts = {};
			for (const [collectionType, type] of batch) {
				channel.postMessage({ type, collectionType });
			}
		});
	};

	/** Serializes read-modify-write access to the persisted publish queue. */
	private publishQueueLock: Promise<unknown> = Promise.resolve();

	private withPublishQueueLock<T>(task: () => Promise<T>): Promise<T> {
		const next = this.publishQueueLock.then(task, task);
		this.publishQueueLock = next.then(
			() => undefined,
			() => undefined
		);
		return next;
	}

	private queuePublish = (type: string, object: GloObject<unknown>) =>
		this.withPublishQueueLock(async () => {
			const queued = await readPublishQueue();
			const key = `${type}:${object.id}`;
			const next = [
				{ type, object: withoutEphemeralEvent(object as AnyGloObject), queuedAt: Date.now() },
				...queued.filter((item) => `${item.type}:${item.object.id}` !== key)
			];
			await writePublishQueue(next);
			this.publishQueueSize = next.length;
		});

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

	private buildObject = <TData>(
		type: string,
		data: TData,
		opts: {
			id?: string;
			visibility?: GloVisibility;
			extensions?: Record<string, unknown>;
			scope?: Partial<GloScope>;
		}
	) => {
		const id = opts.id ?? uid();
		const existing = this.collections.find(type, id);
		const object = createGloObject<TData, string>({
			type,
			id,
			scope: {
				...tenant.scope,
				...(opts.scope ?? {}),
				ownerPubkey: opts.scope?.ownerPubkey ?? session.pubkey ?? undefined
			},
			visibility: opts.visibility ?? existing?.visibility ?? 'organization',
			data: stampData(data, existing),
			extensions: opts.extensions as never
		});
		return object;
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
		const object = this.buildObject(type, data, opts);
		// An explicit local save overrides an earlier deletion of this id.
		clearDeletion(type, object.id);

		// Insert/update through the reactive collections proxy.
		this.collections.upsert(type, object as AnyGloObject);
		this.bump();

		this.broadcast({ type: 'upsert', collectionType: type });

		// Best-effort Nostr publish.
		await this.publish(type, object);
		return object;
	};

	/** Create/update a GLO object and expose whether its Nostr publish succeeded. */
	upsertWithStatus = async <TData>(
		type: string,
		data: TData,
		opts: {
			id?: string;
			visibility?: GloVisibility;
			extensions?: Record<string, unknown>;
			scope?: Partial<GloScope>;
		} = {}
	): Promise<{ object: GloObject<TData, string>; published: boolean }> => {
		const object = this.buildObject(type, data, opts);
		clearDeletion(type, object.id);

		this.collections.upsert(type, object as AnyGloObject);
		this.bump();
		this.broadcast({ type: 'upsert', collectionType: type });

		const published = await this.publish(type, object);
		return { object, published };
	};

	/** Remove a GLO object locally. */
	remove = (type: string, id: string) => {
		recordDeletion(type, id);
		this.collections.remove(type, id);
		this.bump();
		this.broadcast({ type: 'remove', collectionType: type });
	};

	/** Batch upsert (for relay sync merges). */
	batchUpsert = (type: string, objects: AnyGloObject[]) => {
		if (!objects.length) return;
		// Skip relay copies of objects deleted locally unless the relay copy is
		// newer (an edit from another device wins and clears the tombstone).
		const tombstones = tombstonesFor(type);
		const accepted = objects.filter((obj) => {
			if (isTombstoned(tombstones, obj.id, objectTimestamp(obj))) return false;
			if (tombstones[obj.id] !== undefined) clearDeletion(type, obj.id);
			return true;
		});
		if (!accepted.length) return;

		// `set()` preserves a not-yet-loaded IndexedDB snapshot and merges it in
		// when hydration completes, so this is safe during startup as well.
		const byId: Record<string, AnyGloObject> = Object.fromEntries(
			this.collections.get(type).map((obj) => [obj.id, obj])
		);
		for (const obj of accepted) {
			const existing = byId[obj.id];
			if (!existing || objectTimestamp(obj) >= objectTimestamp(existing)) {
				byId[obj.id] = obj;
			}
		}
		this.collections.set(type, Object.values(byId));
		this.bump();
		this.broadcast({ type: 'batch', collectionType: type });
	};

	/** Sign + publish a GLO object as a Nostr event. */
	private publish = async (
		type: string,
		object: GloObject<unknown>,
		options: { queueOnFailure?: boolean } = {}
	) => {
		const { queueOnFailure = true } = options;
		if (!session.snapshot || !relays.online || !relays.writableNormalized.length) {
			if (queueOnFailure) await this.queuePublish(type, object);
			return false;
		}
		try {
			// Queued objects and objects received from relay sync can carry an
			// ephemeral full event for the Raw Data viewer. It must never become
			// part of the next event's GLO content.
			const publishObject = withoutEphemeralEvent(object as AnyGloObject);
			const template = createAppGloEventTemplate(publishObject, {
				client: 'bnos',
				summary: `${type} ${publishObject.id}`
			});

			// Encryption (opt-in, per SECURITY.md): for sensitive types, swap the
			// plaintext GLO content for an AES-256-GCM ciphertext envelope and add
			// bnos-core's honest encrypted/encryption/encryption-key tags. Local
			// cache keeps the plaintext object; only the wire event is encrypted.
			if (shouldEncryptType(type)) {
				try {
					const enc = await encryptGloObject(publishObject);
					if (enc) {
						template.content = enc.content;
						template.tags = [...template.tags, ...enc.encryptionTags];
					}
				} catch {
					// No company key yet (e.g. staff awaiting a grant) → publish plaintext.
				}
			}

			const event = await signNostrEvent({
				template,
				fallbackPubkey: session.snapshot.pubkey,
				loginMethod: session.snapshot.loginMethod,
				nsec: session.snapshot.nsec,
				extensionSigner: session.extensionSigner ?? undefined
			});
			// Retain the signed event in-memory so the Raw Data viewer can show the
			// live Nostr event (id / sig / tags). Not persisted (writeLocal strips it).
			(object as AnyGloObject).__event = event as NostrEvent;
			(object as AnyGloObject).__eventId = (event as NostrEvent).id;
			(object as AnyGloObject).__eventCreatedAt = (event as NostrEvent).created_at;
			const published = await sendEvent(event as NostrEvent);
			if (!published && queueOnFailure) await this.queuePublish(type, object);
			return published;
		} catch {
			if (queueOnFailure) await this.queuePublish(type, object);
			return false;
		}
	};

	private publishQueueFlush: Promise<number> | null = null;

	/** Retry locally saved writes that failed to publish earlier. Concurrent
	 *  callers (parallel type syncs) share one flush so the queue is never
	 *  read-modify-written twice. */
	flushPublishQueue = (): Promise<number> => {
		if (!this.publishQueueFlush) {
			this.publishQueueFlush = this.withPublishQueueLock(() =>
				this.flushPublishQueueOnce()
			).finally(() => {
				this.publishQueueFlush = null;
			});
		}
		return this.publishQueueFlush;
	};

	private flushPublishQueueOnce = async () => {
		if (!session.snapshot || !relays.online || !relays.writableNormalized.length) return 0;
		const queued = await readPublishQueue();
		if (!queued.length) {
			this.publishQueueSize = 0;
			return 0;
		}

		// Retry with bounded concurrency; preserve queue order for leftovers.
		const results = await mapLimit(queued, 4, (item) =>
			this.publish(item.type, item.object, { queueOnFailure: false })
		);
		const remaining = queued.filter((_, index) => !results[index]);
		await writePublishQueue(remaining);
		this.publishQueueSize = remaining.length;
		return results.filter(Boolean).length;
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

		const results = await mapLimit(localObjects, 4, (object) =>
			this.publish(type, object, { queueOnFailure: true })
		);
		if (results.every(Boolean)) localStorage.setItem(stampKey, String(Date.now()));
	};

	/** Sync options.
	 *  - `locationId`: restrict to one branch (adds the `glo:scope:org:loc`
	 *    topic to the relay filter). Omit for org-wide sync.
	 *  - `authors`: override the author set. By default operational types are
	 *    discovered via the org scope topic regardless of author, so an owner
	 *    device sees staff-authored orders and a staff device sees
	 *    owner-authored catalog. Workspace types (organization/location) stay
	 *    author-restricted to the device's own key.
	 *  - `limit`: relay result cap. */
	sync = async (
		type: string,
		options: {
			locationId?: string | null;
			authors?: string[];
			limit?: number;
			relayStrategy?: 'all' | 'primary-first';
		} = {}
	) => {
		const { locationId, authors, limit = 200, relayStrategy = 'all' } = options;
		if (!session.pubkey || !relays.online || !relays.readableNormalized.length) return;
		if (this.syncing.has(type)) return;
		this.syncing.add(type);
		try {
			await this.flushPublishQueue();
			await this.publishLocalKindUpgrade(type);
			const isWorkspaceType = type === 'organization' || type === 'location';
			const orgId = tenant.state.organizationId || undefined;
			const scopeParams = resolveSyncScope({
				type,
				isWorkspaceType,
				orgId,
				locationId,
				sessionPubkey: session.pubkey,
				authors
			});
			const filter = createGloFilter({
				...scopeParams,
				limit
			});
			filter.kinds = [...new Set([...filter.kinds, appKindForType(type)])];
			const events =
				relayStrategy === 'primary-first'
					? await fetchEventsPrimaryFirst(filter as Parameters<typeof fetchEvents>[0])
					: await fetchEvents(filter as Parameters<typeof fetchEvents>[0]);

			// Relays return recent events on every sync. Skip event ids already
			// parsed and stored — this avoids repeated decryption of the same
			// payloads on each cooldown tick.
			const knownEventIds: Record<string, true> = {};
			for (const obj of this.collections.get(type)) {
				const eventId = (obj as AnyGloObject).__eventId;
				if (typeof eventId === 'string') knownEventIds[eventId] = true;
			}
			// Multiple relays commonly return the same event; de-dupe before
			// decrypting as well as dropping already-stored ids.
			const seenEventIds: Record<string, true> = { ...knownEventIds };
			const freshEvents: NostrEvent[] = [];
			for (const ev of events) {
				if (seenEventIds[ev.id]) continue;
				seenEventIds[ev.id] = true;
				freshEvents.push(ev);
			}
			if (!freshEvents.length) return;

			// Parsing/decrypting is async per event; run the batch together
			// instead of paying one await per record.
			const parsedEvents = await mapLimit(
				freshEvents,
				8,
				async (ev): Promise<AnyGloObject | null> => {
					try {
						const parsed = await parseAppGloEvent(ev as NostrEvent);
						return {
							...parsed,
							__eventCreatedAt: ev.created_at,
							__eventId: ev.id,
							__event: ev as NostrEvent
						};
					} catch {
						// Skip non-GLO / malformed / undecryptable events.
						return null;
					}
				}
			);
			const incoming = parsedEvents.filter((obj): obj is AnyGloObject => obj !== null);
			if (incoming.length) this.batchUpsert(type, incoming);
		} finally {
			this.syncing.delete(type);
		}
	};

	/** Sync everything the app cares about. */
	/** Lazily fetch the live Nostr event for one record (Raw Data viewer shows
	 *  the real id/sig). Cached on the object in-memory; returns null offline /
	 *  when not found. Single-record relay query (kind + author + #d). */
	fetchEvent = async (
		type: string,
		id: string,
		opts: { force?: boolean } = {}
	): Promise<NostrEvent | null> => {
		if (!browser) return null;
		const existing = this.collections.find(type, id) as AnyGloObject | undefined;
		if (!opts.force && existing?.__event) return existing.__event; // in-memory cache
		if (!session.pubkey || !relays.online || !relays.readableNormalized.length) return null;
		// Prefer a cryptographically-verified event so a single corrupt/truncated
		// relay copy doesn't poison the viewer.
		const pickVerified = (list: NostrEvent[]): NostrEvent | null => {
			const seen: Record<string, true> = {};
			const dedup: NostrEvent[] = [];
			for (const e of list) {
				if (e && !seen[e.id]) {
					seen[e.id] = true;
					dedup.push(e);
				}
			}
			return dedup.find((e) => safeVerify(e)) ?? dedup[0] ?? null;
		};
		try {
			let ev: NostrEvent | null = null;
			let suspect: NostrEvent | null = null;
			// 1) ids:[] — fast, universal. Accept immediately if it verifies.
			if (existing?.__eventId) {
				const c =
					(
						await fetchEvents({
							ids: [existing.__eventId],
							limit: 1
						} as Parameters<typeof fetchEvents>[0])
					)[0] ?? null;
				if (c) {
					if (safeVerify(c)) ev = c;
					else suspect = c;
				}
			}
			// 2) #d lookup — also finds a clean copy when the id one failed verify.
			if (!ev) {
				const author = existing?.scope?.ownerPubkey ?? session.pubkey;
				const list = await fetchEvents({
					kinds: [appKindForType(type)],
					authors: [author],
					'#d': [createGloIdentifier(type, id)],
					limit: 5
				} as Parameters<typeof fetchEvents>[0]);
				ev = pickVerified(list);
			}
			// Last resort: surface a bad copy so the UI can warn about tampering.
			if (!ev) ev = suspect;
			if (ev && existing) {
				existing.__event = ev;
				existing.__eventId = ev.id;
				existing.__eventCreatedAt = ev.created_at;
			}
			return ev;
		} catch {
			return null;
		}
	};

	syncAll = async (types: string[]) => {
		if (!session.pubkey) return;
		await Promise.all(types.map((t) => this.sync(t)));
	};

	/**
	 * Clear ALL in-memory GLO collections and reset hydration tracking.
	 * Call this on logout so the next login starts with zero stale data.
	 * The IndexedDB wipe is handled by session.logout().
	 */
	private resetLocal = () => {
		this.collections.clearAll();
		this.publishQueueSize = 0;
		this.bump();
	};

	clearAll = () => {
		this.resetLocal();
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
				// Never rebroadcast: that would ping-pong forever between tabs.
				this.resetLocal();
				return;
			}
			if (!msg?.collectionType) return;
			if (msg.type === 'remove') invalidateTombstones(msg.collectionType);
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
	// A coalesced write may still be queued when the tab closes.
	window.addEventListener('pagehide', () => void flushLocalWrites());
}

export type { GloObject, GloObjectType, KnownGloObjectType, GloVisibility };
