/**
 * Relay configuration + connectivity store. Defaults mirror the relays bdgo-os
 * ships with. The active relay list is persisted and used by the GLO sync
 * store to query/publish Nostr events via @bitos/bnos-core's relay helpers.
 */
import { browser } from '$app/environment';
import { normalizeRelayUrls } from '@bitos/bnos-core';

const STORAGE_KEY = 'bnos-os:relays';

export interface RelayPermissions {
	read: boolean;
	write: boolean;
}

export const DEFAULT_RELAYS = [
	'wss://relay.damus.io',
	'wss://nos.lol',
	'wss://relay.nostr.band'
];

class RelayStore {
	/** Canonical list of relay URLs (no trailing slash, wss://). */
	relays = $state<string[]>([...DEFAULT_RELAYS]);
	/** Per-relay read/write access. Missing entries default to full access. */
	permissions = $state<Record<string, RelayPermissions>>({});
	/** Whether the device currently has a network connection. */
	online = $state(true);
	hydrated = $state(false);

	private defaultPermissions = (): Record<string, RelayPermissions> =>
		Object.fromEntries(DEFAULT_RELAYS.map((url) => [url, { read: true, write: true }]));

	private normalizePermissions = (urls: string[], raw: unknown): Record<string, RelayPermissions> => {
		const out: Record<string, RelayPermissions> = {};
		const source = raw && typeof raw === 'object' ? raw : {};
		for (const url of urls) {
			const entry = Reflect.get(source, url);
			out[url] = {
				read: typeof entry === 'object' && entry !== null && 'read' in entry ? Boolean((entry as RelayPermissions).read) : true,
				write: typeof entry === 'object' && entry !== null && 'write' in entry ? Boolean((entry as RelayPermissions).write) : true
			};
		}
		return out;
	};

	private save = () => {
		if (!browser) return;
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({ relays: this.relays, permissions: this.permissions })
		);
	};

	load = () => {
		if (!browser) return;
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (raw) {
				const parsed = JSON.parse(raw);
				if (Array.isArray(parsed)) {
					this.relays = normalizeRelayUrls(parsed);
					this.permissions = this.normalizePermissions(this.relays, {});
				} else if (parsed && typeof parsed === 'object') {
					const relays = Array.isArray(parsed.relays) ? parsed.relays : [];
					this.relays = normalizeRelayUrls(relays);
					if (Array.isArray(parsed.disabled)) {
						const disabled = new Set(
							normalizeRelayUrls(parsed.disabled).filter((url) => this.relays.includes(url))
						);
						this.permissions = Object.fromEntries(
							this.relays.map((url) => [
								url,
								{ read: !disabled.has(url), write: !disabled.has(url) }
							])
						);
					} else {
						this.permissions = this.normalizePermissions(this.relays, parsed.permissions);
					}
				}
			}
		} catch {
			/* ignore */
		}
		if (!this.relays.length) {
			this.relays = [...DEFAULT_RELAYS];
			this.permissions = this.defaultPermissions();
		}
		this.online = navigator.onLine;
		this.hydrated = true;

		window.addEventListener('online', () => (this.online = true));
		window.addEventListener('offline', () => (this.online = false));
	};

	set = (urls: string[]) => {
		this.relays = normalizeRelayUrls(urls.length ? urls : DEFAULT_RELAYS);
		this.permissions = this.normalizePermissions(this.relays, this.permissions);
		this.save();
	};

	add = (url: string) => {
		const norm = normalizeRelayUrls([url])[0];
		if (norm && !this.relays.includes(norm)) {
			this.relays = [...this.relays, norm];
			this.permissions = { ...this.permissions, [norm]: { read: true, write: true } };
			this.save();
		}
	};

	remove = (url: string) => {
		this.relays = this.relays.filter((r) => r !== url);
		const { [url]: _removed, ...rest } = this.permissions;
		this.permissions = rest;
		this.save();
	};

	setActive = (url: string, active: boolean) => {
		if (!this.relays.includes(url)) return;
		this.permissions = {
			...this.permissions,
			[url]: { read: active, write: active }
		};
		this.save();
	};

	setPermission = (url: string, kind: keyof RelayPermissions, enabled: boolean) => {
		if (!this.relays.includes(url)) return;
		const current = this.permissions[url] ?? { read: true, write: true };
		this.permissions = {
			...this.permissions,
			[url]: { ...current, [kind]: enabled }
		};
		this.save();
	};

	reset = () => {
		this.relays = normalizeRelayUrls(DEFAULT_RELAYS);
		this.permissions = this.defaultPermissions();
		this.save();
	};

	get normalized() {
		return normalizeRelayUrls(this.relays);
	}

	get activeRelays() {
		return this.relays.filter((url) => this.isActive(url));
	}

	get activeNormalized() {
		return normalizeRelayUrls(this.activeRelays);
	}

	get readableRelays() {
		return this.relays.filter((url) => this.permissions[url]?.read ?? true);
	}

	get writableRelays() {
		return this.relays.filter((url) => this.permissions[url]?.write ?? true);
	}

	get readableNormalized() {
		return normalizeRelayUrls(this.readableRelays);
	}

	get writableNormalized() {
		return normalizeRelayUrls(this.writableRelays);
	}

	canRead = (url: string) => this.permissions[url]?.read ?? true;
	canWrite = (url: string) => this.permissions[url]?.write ?? true;
	isActive = (url: string) => this.canRead(url) || this.canWrite(url);
}

export const relays = new RelayStore();
