/**
 * Device-level notification center — the functional backbone behind the
 * topbar bell popover and the `/notifications` page.
 *
 * Design notes:
 * - Single source of truth (`items`), persisted to localStorage under the same
 *   key the legacy `/notifications` page used (`bnos-os:notifications`), so
 *   existing seeded/history data is migrated, not lost.
 * - `unread` is derived; read-state survives reloads.
 * - Cross-tab aware: a `storage` listener keeps other open tabs in sync.
 * - `startSystemNotifications()` wires real system events (relay connectivity,
 *   sync failures) into the feed, gated by the user's notification prefs
 *   (`bnos-os:settings-notifications`). Idempotent — safe to call per-mount.
 */
import { browser } from '$app/environment';
import { t as translate } from '$lib/i18n/i18n.svelte';
import { relays } from '$nostr/relay.svelte';
import { dataSync } from '$nostr/sync.svelte';

export type NotificationTone = 'info' | 'success' | 'warning' | 'error';

export interface AppNotification {
	id: number;
	title: string;
	description?: string;
	icon: string;
	tone: NotificationTone;
	/** Epoch ms. */
	at: number;
	read: boolean;
	/** Optional deep link — clicking the row navigates there. */
	href?: string;
}

const STORAGE_KEY = 'bnos-os:notifications';
const PREFS_KEY = 'bnos-os:settings-notifications';
const MAX_ITEMS = 50;
/** Window in which an identical notification is treated as a duplicate. */
const DEDUPE_WINDOW_MS = 10_000;

function parseAt(value: unknown): number {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string') {
		const ms = Date.parse(value);
		if (Number.isFinite(ms)) return ms;
	}
	return Date.now();
}

/** Migrate the legacy page shape (`color`, ISO `at`) into the store shape. */
function fromStored(raw: unknown): AppNotification[] {
	if (!Array.isArray(raw)) return [];
	const out: AppNotification[] = [];
	for (const entry of raw) {
		if (!entry || typeof entry !== 'object') continue;
		const e = entry as Record<string, unknown>;
		if (typeof e.title !== 'string') continue;
		const tone = e.tone ?? e.color;
		out.push({
			id: typeof e.id === 'number' ? e.id : Math.floor(parseAt(e.at) + Math.random() * 1000),
			title: e.title,
			description: typeof e.description === 'string' ? e.description : undefined,
			icon: typeof e.icon === 'string' ? e.icon : 'lucide:bell',
			tone:
				tone === 'success' || tone === 'warning' || tone === 'error' || tone === 'info'
					? tone
					: 'info',
			at: parseAt(e.at),
			read: e.read === true,
			href: typeof e.href === 'string' ? e.href : undefined
		});
	}
	return out
		.filter((n) => Number.isFinite(n.at))
		.sort((a, b) => b.at - a.at)
		.slice(0, MAX_ITEMS);
}

let idCounter = 0;
function nextId(): number {
	const now = Date.now();
	// Monotonic per session; seeded from now so ids survive reloads uniquely.
	idCounter = Math.max(idCounter + 1, now);
	return idCounter;
}

class NotificationStore {
	items = $state<AppNotification[]>([]);
	hydrated = $state(false);

	unread = $derived(this.items.filter((n) => !n.read).length);

	private save = () => {
		if (!browser) return;
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(this.items));
		} catch {
			/* storage full / private mode — keep in-memory only */
		}
	};

	/** Hydrate from localStorage + subscribe to cross-tab updates. */
	load = () => {
		if (!browser || this.hydrated) return;
		try {
			this.items = fromStored(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'));
		} catch {
			this.items = [];
		}
		this.hydrated = true;

		window.addEventListener('storage', (e) => {
			if (e.key !== STORAGE_KEY) return;
			try {
				this.items = fromStored(JSON.parse(e.newValue ?? '[]'));
			} catch {
				/* ignore malformed cross-tab writes */
			}
		});
	};

	/** Push a notification. Duplicates inside the window refresh the
	 *  timestamp instead of stacking noise (mirrors the toast store). */
	push = (n: Omit<AppNotification, 'id' | 'at' | 'read'> & Partial<Pick<AppNotification, 'at'>>) => {
		const at = n.at ?? Date.now();
		const existing = this.items.find(
			(item) => item.title === n.title && item.description === n.description && !item.read
		);
		if (existing && at - existing.at < DEDUPE_WINDOW_MS) {
			existing.at = at;
			return existing.id;
		}
		const id = nextId();
		this.items = [{ ...n, id, at, read: false }, ...this.items].slice(0, MAX_ITEMS);
		this.save();
		return id;
	};

	markRead = (id: number) => {
		const item = this.items.find((n) => n.id === id);
		if (!item || item.read) return;
		item.read = true;
		this.save();
	};

	markAllRead = () => {
		if (!this.items.some((n) => !n.read)) return;
		this.items = this.items.map((n) => ({ ...n, read: true }));
		this.save();
	};

	remove = (id: number) => {
		this.items = this.items.filter((n) => n.id !== id);
		this.save();
	};

	clear = () => {
		if (!this.items.length) return;
		this.items = [];
		this.save();
	};
}

export const notifications = new NotificationStore();

// ── System event wiring ─────────────────────────────────────────────────────

/**
 * Feed real system events into the notification center. Reads the user's
 * alert preferences (Settings → Notifications) so `system_sync` / `system_error`
 * toggles are honoured. Idempotent — the first call wins per app session.
 */
export function startSystemNotifications() {
	if (!browser) return;
	notifications.load();

	const prefAllows = (key: 'system_sync' | 'system_error'): boolean => {
		try {
			const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
			const prefs = raw?.prefs;
			if (prefs && typeof prefs === 'object' && key in prefs) return prefs[key] !== false;
		} catch {
			/* fall back to enabled */
		}
		return true;
	};

	// Relay connectivity transitions (online ⇄ offline).
	let wasOnline = relays.online;
	$effect.root(() => {
		$effect(() => {
			const online = relays.online;
			if (online === wasOnline) return;
			wasOnline = online;
			if (online) {
				notifications.push({
					title: i18nText('notifications.relayOnlineTitle', 'Back online'),
					description: i18nText('notifications.relayOnlineDesc', 'Connected and syncing with your relays.'),
					icon: 'lucide:wifi',
					tone: 'success',
					href: '/settings/relays'
				});
			} else if (prefAllows('system_error')) {
				notifications.push({
					title: i18nText('notifications.relayOfflineTitle', 'Relay connection lost'),
					description: i18nText(
						'notifications.relayOfflineDesc',
						'Your changes stay on this device and sync automatically later.'
					),
					icon: 'lucide:wifi-off',
					tone: 'warning',
					href: '/settings/relays'
				});
			}
		});

		// Sync failures (+ recovery after a failure).
		let prevStatus = dataSync.status;
		$effect(() => {
			const status = dataSync.status;
			const from = prevStatus;
			prevStatus = status;
			if (status === from) return;
			if (status === 'failed' && prefAllows('system_error')) {
				notifications.push({
					title: i18nText('notifications.syncFailedTitle', 'Sync failed'),
					description: i18nText(
						'notifications.syncFailedDesc',
						'Could not reach your relays. It will retry automatically.'
					),
					icon: 'lucide:cloud-alert',
					tone: 'error',
					href: '/settings/data'
				});
			} else if (status === 'done' && from === 'failed' && prefAllows('system_sync')) {
				notifications.push({
					title: i18nText('notifications.syncDoneTitle', 'All data synced'),
					description: i18nText(
						'notifications.syncDoneDesc',
						'Everything is up to date across your relays.'
					),
					icon: 'lucide:cloud-check',
					tone: 'success',
					href: '/settings/data'
				});
			}
		});
	});
}

/** Translate with an offline-safe fallback (returns the key when missing). */
function i18nText(key: string, fallback: string): string {
	const out = translate(key);
	return out === key ? fallback : out;
}
