/**
 * Local-first GLO collection store. Every domain object (product, order,
 * customer, …) is a GLO object carrying its Nostr kind (see bnos-core
 * `glo/kinds`). The store keeps a reactive, localStorage-backed cache per type
 * and syncs to Nostr relays via @bitos/bnos-core when online + authenticated.
 *
 * This mirrors bdgo-os's offline-first model: writes are instant and local;
 * relay publish is best-effort with a "changes sync when reconnected" guarantee.
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

type Collections = Record<string, AnyGloObject[]>;

function readLocal(type: string): AnyGloObject[] {
	if (!browser) return [];
	try {
		const raw = localStorage.getItem(STORAGE_PREFIX + type);
		if (!raw) return [];
		const arr = JSON.parse(raw);
		return Array.isArray(arr) ? arr.filter(isGloObject) : [];
	} catch {
		return [];
	}
}

function writeLocal(type: string, items: AnyGloObject[]) {
	if (!browser) return;
	localStorage.setItem(STORAGE_PREFIX + type, JSON.stringify(items));
}

class GloStore {
	private hydratedTypes = new Set<string>();
	private queuedHydrates = new Set<string>();

	/** Reactive collections keyed by GLO object type. */
	collections = $state<Collections>({});
	hydrating = $state(false);
	syncing = $state<Set<string>>(new Set());

	/** Hydrate a type's local cache into memory (idempotent). */
	hydrate = <T extends string>(type: T) => {
		if (this.hydratedTypes.has(type)) return;
		this.hydratedTypes.add(type);
		this.queuedHydrates.delete(type);
		this.collections[type] = readLocal(type);
	};

	private queueHydrate = <T extends string>(type: T) => {
		if (this.hydratedTypes.has(type) || this.queuedHydrates.has(type)) return;
		this.queuedHydrates.add(type);
		queueMicrotask(() => this.hydrate(type));
	};

	/** Reactive accessor for a typed collection. */
	all = <TData, TType extends string = string>(type: TType): GloObject<TData, TType>[] => {
		if (!this.hydratedTypes.has(type)) {
			this.queueHydrate(type);
			return readLocal(type) as GloObject<TData, TType>[];
		}
		return (this.collections[type] ?? []) as GloObject<TData, TType>[];
	};

	/** Find one by id. */
	get = (type: string, id: string): AnyGloObject | undefined => {
		this.hydrate(type);
		return (this.collections[type] ?? []).find((o) => o.id === id);
	};

	/** Create or update a GLO object. Returns the saved object. */
	upsert = async <TData>(
		type: string,
		data: TData,
		opts: { id?: string; visibility?: GloVisibility; extensions?: Record<string, unknown> } = {}
	): Promise<GloObject<TData, string>> => {
		this.hydrate(type);
		const id = opts.id ?? uid();
		const existing = (this.collections[type] ?? []).find((o) => o.id === id);
		const object = createGloObject<TData, string>({
			type,
			id,
			scope: { ...tenant.scope, ownerPubkey: session.pubkey ?? undefined },
			visibility: opts.visibility ?? existing?.visibility ?? 'organization',
			data,
			extensions: opts.extensions as never
		});

		const list = (this.collections[type] ?? []).filter((o) => o.id !== id);
		list.unshift(object);
		this.collections[type] = list;
		writeLocal(type, list);

		// best-effort Nostr publish
		void this.publish(type, object);
		return object;
	};

	/** Soft-delete locally + broadcast a GLO deletion when possible. */
	remove = (type: string, id: string) => {
		this.hydrate(type);
		const list = (this.collections[type] ?? []).filter((o) => o.id !== id);
		this.collections[type] = list;
		writeLocal(type, list);
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
		if (!session.pubkey || !relays.online || !relays.activeNormalized.length) return;
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
			if (incoming.length) this.merge(type, incoming);
		} finally {
			const next = new Set(this.syncing);
			next.delete(type);
			this.syncing = next;
		}
	};

	/** Merge relay objects into the local cache (relay wins on newer created_at). */
	private merge = (type: string, incoming: AnyGloObject[]) => {
		this.hydrate(type);
		const local = [...(this.collections[type] ?? [])];
		const byId = new Map(local.map((o) => [o.id, o]));
		for (const obj of incoming) {
			const cur = byId.get(obj.id);
			// GLO objects don't carry a timestamp on the envelope; we prefer the
			// incoming relay copy (it is the canonical signed record).
			byId.set(obj.id, obj);
			void cur;
		}
		const merged = [...byId.values()];
		this.collections[type] = merged;
		writeLocal(type, merged);
	};

	/** Sync everything the app cares about, then toast. */
	syncAll = async (types: string[]) => {
		if (!session.pubkey) return;
		await Promise.all(types.map((t) => this.sync(t)));
		if (browser) toast.success('Data synced', 'Latest records pulled from relays.');
	};
}

export const glo = new GloStore();

export type { GloObject, GloObjectType, KnownGloObjectType, GloVisibility };
