/**
 * Stable `obpDocumentId ↔ localRecordId` mapping store.
 *
 * The adapter must keep BNOS records' original ids and kinds intact; this
 * link table is the only place the two worlds are joined. In-memory for
 * tests and SSR; `IdbObpLinkStore` persists in the browser via
 * idb-keyval under a single JSON map.
 */
import { browser } from '$app/environment';
import { get, set } from 'idb-keyval';

export interface ObpLocalLink {
	obpDocumentId: string;
	localRecordId: string;
	/** GLO object type of the local record (e.g. `purchase-order`). */
	localType: string;
	linkedAt: string;
}

export interface ObpLinkStore {
	link(entry: ObpLocalLink): Promise<void>;
	byObpDocument(obpDocumentId: string): Promise<ObpLocalLink | undefined>;
	byLocalRecord(localType: string, localRecordId: string): Promise<ObpLocalLink | undefined>;
	list(): Promise<ObpLocalLink[]>;
}

export class MemoryObpLinkStore implements ObpLinkStore {
	private byObp = new Map<string, ObpLocalLink>();

	async link(entry: ObpLocalLink): Promise<void> {
		this.byObp.set(entry.obpDocumentId, entry);
	}
	async byObpDocument(id: string): Promise<ObpLocalLink | undefined> {
		return this.byObp.get(id);
	}
	async byLocalRecord(localType: string, localRecordId: string): Promise<ObpLocalLink | undefined> {
		for (const link of this.byObp.values()) {
			if (link.localType === localType && link.localRecordId === localRecordId) return link;
		}
		return undefined;
	}
	async list(): Promise<ObpLocalLink[]> {
		return [...this.byObp.values()];
	}
}

const IDB_KEY = 'bnos-os:obp-links';

/** Browser-persisted link store; falls back to memory outside browsers. */
export class IdbObpLinkStore implements ObpLinkStore {
	private fallback = new MemoryObpLinkStore();

	private async readMap(): Promise<Map<string, ObpLocalLink> | null> {
		if (!browser) return null;
		try {
			const stored = await get<ObpLocalLink[]>(IDB_KEY);
			return stored ? new Map(stored.map((l) => [l.obpDocumentId, l])) : new Map();
		} catch {
			return null;
		}
	}

	private async writeMap(map: Map<string, ObpLocalLink>): Promise<void> {
		if (!browser) return;
		await set(IDB_KEY, [...map.values()]);
	}

	async link(entry: ObpLocalLink): Promise<void> {
		const map = await this.readMap();
		if (!map) return this.fallback.link(entry);
		map.set(entry.obpDocumentId, entry);
		await this.writeMap(map);
	}

	async byObpDocument(id: string): Promise<ObpLocalLink | undefined> {
		const map = await this.readMap();
		return map ? map.get(id) : this.fallback.byObpDocument(id);
	}

	async byLocalRecord(localType: string, localRecordId: string): Promise<ObpLocalLink | undefined> {
		const map = await this.readMap();
		if (!map) return this.fallback.byLocalRecord(localType, localRecordId);
		for (const link of map.values()) {
			if (link.localType === localType && link.localRecordId === localRecordId) return link;
		}
		return undefined;
	}

	async list(): Promise<ObpLocalLink[]> {
		const map = await this.readMap();
		return map ? [...map.values()] : this.fallback.list();
	}
}
