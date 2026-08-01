/**
 * Relay configuration + connectivity store. Defaults mirror the relays bdgo-os
 * ships with. The active relay list is persisted and used by the GLO sync
 * store to query/publish Nostr events via @bitos/bnos-core's relay helpers.
 */
import { browser } from '$app/environment';
import { normalizeRelayUrls } from '@bitos/bnos-core';

const STORAGE_KEY = 'bnos-os:relays';

export const DEFAULT_RELAYS = [
	'wss://relay.damus.io',
	'wss://nos.lol',
	'wss://relay.nostr.band'
];

class RelayStore {
	/** Canonical list of relay URLs (no trailing slash, wss://). */
	relays = $state<string[]>([...DEFAULT_RELAYS]);
	/** Relays that are present but switched off. */
	disabled = $state<string[]>([]);
	/** Whether the device currently has a network connection. */
	online = $state(true);
	hydrated = $state(false);

	private save = () => {
		if (!browser) return;
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({ relays: this.relays, disabled: this.disabled })
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
					this.disabled = [];
				} else if (parsed && typeof parsed === 'object') {
					const relays = Array.isArray(parsed.relays) ? parsed.relays : [];
					const disabled = Array.isArray(parsed.disabled) ? parsed.disabled : [];
					this.relays = normalizeRelayUrls(relays);
					this.disabled = normalizeRelayUrls(disabled).filter((url) => this.relays.includes(url));
				}
			}
		} catch {
			/* ignore */
		}
		this.online = navigator.onLine;
		this.hydrated = true;

		window.addEventListener('online', () => (this.online = true));
		window.addEventListener('offline', () => (this.online = false));
	};

	set = (urls: string[]) => {
		this.relays = normalizeRelayUrls(urls.length ? urls : DEFAULT_RELAYS);
		this.disabled = this.disabled.filter((url) => this.relays.includes(url));
		this.save();
	};

	add = (url: string) => {
		const norm = normalizeRelayUrls([url])[0];
		if (norm && !this.relays.includes(norm)) {
			this.relays = [...this.relays, norm];
			this.save();
		}
	};

	remove = (url: string) => {
		this.relays = this.relays.filter((r) => r !== url);
		this.disabled = this.disabled.filter((r) => r !== url);
		this.save();
	};

	setActive = (url: string, active: boolean) => {
		if (!this.relays.includes(url)) return;
		this.disabled = active
			? this.disabled.filter((r) => r !== url)
			: this.disabled.includes(url)
				? this.disabled
				: [...this.disabled, url];
		this.save();
	};

	reset = () => {
		this.relays = normalizeRelayUrls(DEFAULT_RELAYS);
		this.disabled = [];
		this.save();
	};

	get normalized() {
		return normalizeRelayUrls(this.relays);
	}

	get activeRelays() {
		return this.relays.filter((url) => !this.disabled.includes(url));
	}

	get activeNormalized() {
		return normalizeRelayUrls(this.activeRelays);
	}

	isActive = (url: string) => !this.disabled.includes(url);
}

export const relays = new RelayStore();
