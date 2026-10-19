/**
 * Owner / system notice feed.
 *
 * The workspace owner (or the platform operator) publishes signed kind-1 notes
 * tagged `#t=bnos` from an allow-listed npub. We query the readable relays for
 * those notes, map them into the notification center (bell + `/notifications`),
 * and persist the seen event ids so reloads never re-announce a notice.
 *
 * Trust model:
 * - The allow-list is the only trust boundary: `PUBLIC_OWNER_NPUBS` (env default)
 *   plus keys the user trusts locally in Settings → Notifications.
 * - Content is rendered as plain text. The only navigable link we accept is a
 *   same-origin internal path (`/...`); external URLs are shown as text and never
 *   followed automatically (SPA `goto()` cannot traverse off-origin anyway).
 *
 * Publishing convention (any Nostr client works) — kind 1, allow-listed author.
 * A notice is recognised by a category tag below (legacy `bnos.space-*` names
 * and short aliases both work) or the plain `bnos` marker:
 *
 *   ["t","bnos.space-announcement" | "announcement"]  → general notice
 *   ["t","bnos.space-update"       | "update"]        → app update
 *   ["t","bnos.space-feature"      | "feature"]       → new feature
 *   ["t","bnos.space-maintenance"  | "maintenance"]   → maintenance
 *   ["t","bnos.space-security"     | "security"]      → security alert
 *   ["t","bnos.space-bugfix"       | "bugfix"]        → bug fix
 *   ["t","alert"]                                     → important alert
 *   ["t","critical"|"error"|"warning"|"success"|"info"] → severity override
 *   ["subject","Title"]                               → optional title
 *   ["expiration","<unix>"]                           → NIP-40 auto-expiry
 *   ["r","/orders"]                                   → internal deep link
 *
 * A first content line starting with `#` is used as the title (legacy behaviour).
 * @see docs/owner-notices.md
 */
import { browser } from '$app/environment';
import { env } from '$env/dynamic/public';
import { nip19 } from 'nostr-tools';
import { SvelteSet } from 'svelte/reactivity';
import { fetchEvents } from './client';
import { relays } from './relay.svelte';
import { session } from './session.svelte';
import { notifications, type NotificationTone } from '$lib/stores/notifications.svelte';
import { t as translate } from '$lib/i18n/i18n.svelte';
import type { NostrEvent } from '@bitos/bnos-core';

const LOCAL_NPUBS_KEY = 'bnos-os:owner-npubs';
const SEEN_KEY = 'bnos-os:owner-seen';
const PREFS_KEY = 'bnos-os:settings-notifications';
const MAX_SEEN = 500;
const MAX_PER_SYNC = 10;
const POLL_INTERVAL_MS = 5 * 60 * 1000;

const HEX_RE = /^[0-9a-f]{64}$/i;

/** Decode an `npub1…` or 64-char hex pubkey into lowercase hex, or `null`. */
export function toHexPubkey(token: string): string | null {
	const value = token.trim();
	if (!value) return null;
	if (HEX_RE.test(value)) return value.toLowerCase();
	if (!value.startsWith('npub1')) return null;
	try {
		const decoded = nip19.decode(value);
		if (decoded.type === 'npub') return decoded.data;
	} catch {
		/* malformed npub */
	}
	return null;
}

/** Parse a comma/whitespace separated list of npub or hex keys into hex. */
export function parseOwnerNpubs(value: string | undefined | null): string[] {
	if (!value) return [];
	const out = new SvelteSet<string>();
	for (const token of value.split(/[\s,]+/)) {
		const hex = toHexPubkey(token);
		if (hex) out.add(hex);
	}
	return [...out];
}

/** Keys trusted on this device (Settings → Notifications). */
export function getLocalOwnerNpubs(): string[] {
	if (!browser) return [];
	try {
		const raw: unknown = JSON.parse(localStorage.getItem(LOCAL_NPUBS_KEY) ?? '[]');
		if (!Array.isArray(raw)) return [];
		return raw.filter((v): v is string => typeof v === 'string' && HEX_RE.test(v));
	} catch {
		return [];
	}
}

export function setLocalOwnerNpubs(values: string[]): void {
	if (!browser) return;
	const hex = [...new SvelteSet(values.map((v) => toHexPubkey(v)).filter((v): v is string => !!v))];
	try {
		localStorage.setItem(LOCAL_NPUBS_KEY, JSON.stringify(hex));
	} catch {
		/* quota / private mode */
	}
}

/** Env default allow-list merged with the device-local trusted keys. */
export function ownerAllowList(): string[] {
	return [...new SvelteSet([...parseOwnerNpubs(env.PUBLIC_OWNER_NPUBS), ...getLocalOwnerNpubs()])];
}

/** Canonical notice categories (aligned with the legacy `bnos.space-*` feed). */
export type NoticeCategory =
	'announcement' | 'update' | 'feature' | 'maintenance' | 'security' | 'bugfix' | 'alert';

export interface NoticeCategoryMeta {
	tone: NotificationTone;
	icon: string;
	/** i18n key + fallback for the chip label. */
	labelKey: string;
	labelFallback: string;
	/** i18n key + fallback for the default title. */
	titleKey: string;
	titleFallback: string;
}

export const NOTICE_CATEGORIES: Record<NoticeCategory, NoticeCategoryMeta> = {
	security: {
		tone: 'error',
		icon: 'lucide:shield-alert',
		labelKey: 'notifications.categorySecurity',
		labelFallback: 'Security',
		titleKey: 'notifications.ownerSecurityTitle',
		titleFallback: 'Security notice'
	},
	maintenance: {
		tone: 'warning',
		icon: 'lucide:wrench',
		labelKey: 'notifications.categoryMaintenance',
		labelFallback: 'Maintenance',
		titleKey: 'notifications.ownerMaintenanceTitle',
		titleFallback: 'Scheduled maintenance'
	},
	alert: {
		tone: 'warning',
		icon: 'lucide:triangle-alert',
		labelKey: 'notifications.categoryAlert',
		labelFallback: 'Alert',
		titleKey: 'notifications.ownerAlertTitle',
		titleFallback: 'Important alert'
	},
	update: {
		tone: 'info',
		icon: 'lucide:download',
		labelKey: 'notifications.categoryUpdate',
		labelFallback: 'Update',
		titleKey: 'notifications.ownerUpdateTitle',
		titleFallback: 'Update available'
	},
	feature: {
		tone: 'info',
		icon: 'lucide:sparkles',
		labelKey: 'notifications.categoryFeature',
		labelFallback: 'Feature',
		titleKey: 'notifications.ownerFeatureTitle',
		titleFallback: 'New feature'
	},
	bugfix: {
		tone: 'success',
		icon: 'lucide:bug',
		labelKey: 'notifications.categoryBugfix',
		labelFallback: 'Bug fix',
		titleKey: 'notifications.ownerBugfixTitle',
		titleFallback: 'Important bug fix'
	},
	announcement: {
		tone: 'info',
		icon: 'lucide:megaphone',
		labelKey: 'notifications.categoryAnnouncement',
		labelFallback: 'Announcement',
		titleKey: 'notifications.ownerNoticeTitle',
		titleFallback: 'Notice from your owner'
	}
};

/** tag value (lowercased) → category. Legacy and short names both accepted. */
const TAG_ALIASES: Record<string, NoticeCategory> = {
	'bnos.space-announcement': 'announcement',
	announcement: 'announcement',
	notice: 'announcement',
	'bnos.space-update': 'update',
	update: 'update',
	'bnos.space-feature': 'feature',
	feature: 'feature',
	'bnos.space-maintenance': 'maintenance',
	maintenance: 'maintenance',
	'bnos.space-security': 'security',
	security: 'security',
	'bnos.space-bugfix': 'bugfix',
	bugfix: 'bugfix',
	alert: 'alert'
};

/** Most specific category wins when an event carries several tags. */
const CATEGORY_PRIORITY: NoticeCategory[] = [
	'security',
	'maintenance',
	'alert',
	'update',
	'feature',
	'bugfix',
	'announcement'
];

/** `#t` values the relay query asks for (OR match); author allow-list is the gate. */
export const NOTICE_QUERY_TAGS: string[] = ['bnos', ...Object.keys(TAG_ALIASES)];

/** Category metadata for a stored notification (defaults to `announcement`). */
export function categoryMeta(category: string | undefined): NoticeCategoryMeta {
	return (
		NOTICE_CATEGORIES[(category as NoticeCategory) ?? 'announcement'] ??
		NOTICE_CATEGORIES.announcement
	);
}

function tagsOf(event: NostrEvent, name: string): string[] {
	const out: string[] = [];
	for (const tag of event.tags) {
		if (tag[0] === name && typeof tag[1] === 'string') out.push(tag[1]);
	}
	return out;
}

function classify(event: NostrEvent): {
	category: NoticeCategory;
	tone: NotificationTone;
	tags: string[];
} {
	const tags = tagsOf(event, 't');
	const values = new SvelteSet(tags.map((v) => v.toLowerCase()));
	let category: NoticeCategory = 'announcement';
	for (const candidate of CATEGORY_PRIORITY) {
		if ([...values].some((v) => TAG_ALIASES[v] === candidate)) {
			category = candidate;
			break;
		}
	}

	let tone = NOTICE_CATEGORIES[category].tone;
	// Severity tags override the category default (most severe wins).
	if (values.has('info')) tone = 'info';
	if (values.has('success')) tone = 'success';
	if (values.has('warning')) tone = 'warning';
	if (values.has('critical') || values.has('error')) tone = 'error';

	return { category, tone, tags };
}

function isExpired(event: NostrEvent, nowMs: number): boolean {
	for (const value of tagsOf(event, 'expiration')) {
		const seconds = Number(value);
		if (Number.isFinite(seconds) && seconds * 1000 <= nowMs) return true;
	}
	return false;
}

function splitContent(content: string): { title: string; description?: string } {
	const text = content.trim();
	if (!text) return { title: '' };
	const lines = text.split('\n');
	// Legacy behaviour: a leading markdown heading becomes the title.
	const heading = lines[0].trim().match(/^#{1,6}\s+(.*)$/);
	if (heading) {
		const body = lines.slice(1).join('\n').trim();
		return { title: heading[1].trim(), description: body || undefined };
	}
	if (text.length <= 80 && lines.length === 1) return { title: text };
	const body = lines.slice(1).join('\n').trim();
	return { title: lines[0].trim() || text.slice(0, 80), description: body || undefined };
}

/** Map an allow-listed event into the fields the notification store expects. */
function toNotification(event: NostrEvent): {
	title: string;
	description?: string;
	icon: string;
	tone: NotificationTone;
	href?: string;
	category: NoticeCategory;
	tags: string[];
} {
	const { category, tone, tags } = classify(event);
	const meta = NOTICE_CATEGORIES[category];
	const { title, description } = splitContent(event.content);
	const subject = tagsOf(event, 'subject')[0]?.trim();

	// Internal deep link only; external URLs surface as text, never auto-followed.
	let href: string | undefined;
	const externalLinks: string[] = [];
	for (const r of tagsOf(event, 'r')) {
		if (r.startsWith('/')) {
			href ??= r;
		} else if (/^https?:\/\//i.test(r)) {
			externalLinks.push(r);
		}
	}

	const parts = [description, ...externalLinks].filter(Boolean);
	const titleText = subject || title || i18nText(meta.titleKey, meta.titleFallback);

	return {
		title: titleText,
		description: parts.length ? parts.join('\n') : undefined,
		icon: meta.icon,
		tone,
		href,
		category,
		tags
	};
}

function readSeen(): SvelteSet<string> {
	if (!browser) return new SvelteSet();
	try {
		const raw: unknown = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]');
		return new SvelteSet(
			Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : []
		);
	} catch {
		return new SvelteSet();
	}
}

function writeSeen(seen: SvelteSet<string>): void {
	if (!browser) return;
	const trimmed = [...seen].slice(-MAX_SEEN);
	try {
		localStorage.setItem(SEEN_KEY, JSON.stringify(trimmed));
	} catch {
		/* quota / private mode */
	}
}

/** Whether the user's alert preferences allow owner/system notices. */
function ownerNoticesEnabled(): boolean {
	if (!browser) return false;
	try {
		const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
		const prefs = raw?.prefs;
		if (prefs && typeof prefs === 'object' && 'owner_updates' in prefs) {
			return prefs.owner_updates !== false;
		}
	} catch {
		/* fall back to enabled */
	}
	return true;
}

let syncing = false;

/** Query relays for new allowed owner notices and feed them to the bell. */
export async function syncOwnerNotices(): Promise<void> {
	if (!browser || syncing || !session.pubkey) return;
	const authors = ownerAllowList();
	if (!authors.length || !ownerNoticesEnabled()) return;
	if (!relays.online || !relays.readableNormalized.length) return;

	syncing = true;
	try {
		const events = await fetchEvents({
			kinds: [1],
			authors,
			'#t': NOTICE_QUERY_TAGS,
			limit: 30
		});
		if (!events.length) return;

		const seen = readSeen();
		const now = Date.now();
		let pushed = 0;
		const ordered = [...events].sort((a, b) => a.created_at - b.created_at);

		for (const event of ordered) {
			if (seen.has(event.id)) continue;
			if (pushed >= MAX_PER_SYNC) break;
			seen.add(event.id);
			if (isExpired(event, now)) continue;
			notifications.push({
				...toNotification(event),
				sourceId: event.id,
				at: event.created_at * 1000
			});
			pushed += 1;
		}
		writeSeen(seen);
	} catch {
		/* best effort — offline / relay errors are non-fatal */
	} finally {
		syncing = false;
	}
}

let started = false;

/**
 * Start the owner notice feed. Idempotent — first call wins per app session.
 * Runs once on start (if relays are up), whenever relays come back online, and
 * on a slow poll. Safe to call alongside `startSystemNotifications()`.
 */
export function startOwnerFeed(): () => void {
	if (!browser || started) return () => {};
	started = true;
	notifications.load();

	const stopEffect = $effect.root(() => {
		$effect(() => {
			// Re-run when the session or relay connectivity changes.
			if (!relays.online || !session.pubkey) return;
			void syncOwnerNotices();
		});
	});

	const timer = setInterval(() => {
		if (document.visibilityState === 'visible') void syncOwnerNotices();
	}, POLL_INTERVAL_MS);
	void syncOwnerNotices();

	return () => {
		stopEffect();
		started = false;
		clearInterval(timer);
	};
}

/** Translate with an offline-safe fallback (returns the key when missing). */
function i18nText(key: string, fallback: string): string {
	const out = translate(key);
	return out === key ? fallback : out;
}
