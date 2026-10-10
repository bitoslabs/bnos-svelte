/**
 * Minimal key-value abstraction for OBP node persistence.
 *
 * `KvObpStores` (see `idb-store.ts`) implements the full `ObpStores`
 * contract over this interface with a single-writer mutex, so any KV —
 * in-memory (tests), IndexedDB via idb-keyval (browser), or a future
 * SQLite adapter (server) — gets the same atomicity and durability
 * semantics.
 */
export interface ObpKv {
	get<T>(key: string): Promise<T | undefined>;
	set<T>(key: string, value: T): Promise<void>;
	/** All keys, optionally limited to a prefix. */
	keys(prefix?: string): Promise<string[]>;
}

/** In-memory KV — tests, SSR fallback, and durable-store logic tests. */
export class MemoryObpKv implements ObpKv {
	private map = new Map<string, unknown>();

	async get<T>(key: string): Promise<T | undefined> {
		return this.map.get(key) as T | undefined;
	}
	async set<T>(key: string, value: T): Promise<void> {
		this.map.set(key, value);
	}
	async keys(prefix?: string): Promise<string[]> {
		return [...this.map.keys()].filter((k) => k.startsWith(prefix ?? ''));
	}
}
