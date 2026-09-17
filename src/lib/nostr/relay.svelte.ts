/**
 * Relay configuration + connectivity store. Defaults mirror the relays bdgo-os
 * ships with. The active relay list is persisted and used by the GLO sync
 * store to query/publish Nostr events via @bitos/bnos-core's relay helpers.
 */
import { browser } from '$app/environment';
import { env } from '$env/dynamic/public';
import { normalizeRelayUrls } from '@bitos/bnos-core';

const STORAGE_KEY = 'bnos-os:relays';

const BUILTIN_RELAYS = [
	'wss://nostr-01.yakihonne.com',
	'wss://nos.lol',
	'wss://yabu.me',
	'wss://relay.nostr.band',
	'wss://nostr.wine',
	'wss://relay.damus.io',
	'wss://relay.bitos.space'
];

function relaysFromEnv(value: string | undefined): string[] {
	const raw = value?.trim();
	if (!raw) return [];

	try {
		const parsed: unknown = JSON.parse(raw);
		if (Array.isArray(parsed)) return normalizeRelayUrls(parsed.filter((url): url is string => typeof url === 'string'));
	} catch {
		/* Treat non-JSON values as a comma-separated list. */
	}

	return normalizeRelayUrls(raw.split(',').map((url) => url.trim()).filter(Boolean));
}

export interface RelayPermissions {
	read: boolean;
	write: boolean;
}

/** Defaults can be overridden with the browser-safe `PUBLIC_RELAYS` env var. */
const configuredRelays = relaysFromEnv(env.PUBLIC_RELAYS);
export const DEFAULT_RELAYS = configuredRelays.length ? [...configuredRelays, ...BUILTIN_RELAYS] : BUILTIN_RELAYS;

class RelayStore {
	/** Canonical list of relay URLs (no trailing slash, wss://). */
	relays = $state<string[]>([...DEFAULT_RELAYS]);
	/** Per-relay read/write access. Missing entries default to full access. */
	permissions = $state<Record<string, RelayPermissions>>({});
	/** Preferred relay for fast foreground reads/writes. */
	primaryRelay = $state<string | null>(null);
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
			JSON.stringify({ relays: this.relays, permissions: this.permissions, primaryRelay: this.primaryRelay })
		);
	};

	private defaultPrimary = (urls = this.relays) => {
		const [fallback] = normalizeRelayUrls(DEFAULT_RELAYS).filter((url) => urls.includes(url));
		return fallback ?? urls[0] ?? null;
	};

	private normalizePrimary = (value: unknown, urls = this.relays) => {
		const [primary] = typeof value === 'string' ? normalizeRelayUrls([value]) : [];
		if (primary && urls.includes(primary)) return primary;
		return this.defaultPrimary(urls);
	};

	private primaryFirst = (urls: string[]) => {
		if (!this.primaryRelay || !urls.includes(this.primaryRelay)) return urls;
		return [this.primaryRelay, ...urls.filter((url) => url !== this.primaryRelay)];
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
					this.primaryRelay = this.normalizePrimary(null, this.relays);
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
					this.primaryRelay = this.normalizePrimary(parsed.primaryRelay, this.relays);
				}
			}
		} catch {
			/* ignore */
		}
		if (!this.relays.length) {
			this.relays = [...DEFAULT_RELAYS];
			this.permissions = this.defaultPermissions();
		}
		this.primaryRelay = this.normalizePrimary(this.primaryRelay, this.relays);
		this.online = navigator.onLine;
		this.hydrated = true;

		window.addEventListener('online', () => (this.online = true));
		window.addEventListener('offline', () => (this.online = false));
	};

	set = (urls: string[]) => {
		this.relays = normalizeRelayUrls(urls.length ? urls : DEFAULT_RELAYS);
		this.permissions = this.normalizePermissions(this.relays, this.permissions);
		this.primaryRelay = this.normalizePrimary(this.primaryRelay, this.relays);
		this.save();
	};

	add = (url: string) => {
		const norm = normalizeRelayUrls([url])[0];
		if (norm && !this.relays.includes(norm)) {
			this.relays = [...this.relays, norm];
			this.permissions = { ...this.permissions, [norm]: { read: true, write: true } };
			this.primaryRelay ??= norm;
			this.save();
		}
	};

	remove = (url: string) => {
		this.relays = this.relays.filter((r) => r !== url);
		this.permissions = Object.fromEntries(
			Object.entries(this.permissions).filter(([relayUrl]) => relayUrl !== url)
		);
		this.primaryRelay = this.normalizePrimary(this.primaryRelay === url ? null : this.primaryRelay, this.relays);
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
		this.primaryRelay = this.relays[0] ?? null;
		this.save();
	};

	setPrimary = (url: string) => {
		const [norm] = normalizeRelayUrls([url]);
		if (!norm || !this.relays.includes(norm)) return;
		this.primaryRelay = norm;
		this.save();
	};

	get normalized() {
		return normalizeRelayUrls(this.relays);
	}

	get activeRelays() {
		return this.primaryFirst(this.relays.filter((url) => this.isActive(url)));
	}

	get activeNormalized() {
		return normalizeRelayUrls(this.activeRelays);
	}

	get readableRelays() {
		return this.primaryFirst(this.relays.filter((url) => this.permissions[url]?.read ?? true));
	}

	get writableRelays() {
		return this.primaryFirst(this.relays.filter((url) => this.permissions[url]?.write ?? true));
	}

	get readableNormalized() {
		return normalizeRelayUrls(this.readableRelays);
	}

	get writableNormalized() {
		return normalizeRelayUrls(this.writableRelays);
	}

	get primaryReadableNormalized() {
		return this.primaryRelay && this.canRead(this.primaryRelay)
			? normalizeRelayUrls([this.primaryRelay])
			: [];
	}

	get primaryWritableNormalized() {
		return this.primaryRelay && this.canWrite(this.primaryRelay)
			? normalizeRelayUrls([this.primaryRelay])
			: [];
	}

	canRead = (url: string) => this.permissions[url]?.read ?? true;
	canWrite = (url: string) => this.permissions[url]?.write ?? true;
	isActive = (url: string) => this.canRead(url) || this.canWrite(url);
}

export const relays = new RelayStore();
