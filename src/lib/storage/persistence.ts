/**
 * Mobile/PWA storage durability helpers.
 *
 * Mobile browsers (especially iOS Safari) can evict site storage when a site
 * has not been used for a while or when the device is low on space. That wipes
 * the persisted Nostr session and silently signs the user out.
 *
 * Two things live here:
 *
 *  1. **Prevention** — `requestPersistentStorage()` asks the browser to mark
 *     this origin's storage as persistent so it is not evicted under pressure.
 *     Call it from a user gesture (login) or from the settings button.
 *
 *  2. **Detection** — `markKnownDevice()` writes a small marker to both
 *     localStorage and a long-lived first-party cookie when the device signs
 *     in. If the auth snapshot later disappears but the marker survives,
 *     `wasKnownDevice()` lets the login screen explain that the session was
 *     cleared instead of pretending this is a brand-new device.
 */
import { browser } from '$app/environment';

const KNOWN_DEVICE_KEY = 'bnos-os:known-device';
const KNOWN_DEVICE_COOKIE = 'bnos_known_device';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

export interface StorageStatus {
	/** Whether the browser exposes the Storage API. */
	supported: boolean;
	/** Whether storage is exempt from automatic eviction. */
	persisted: boolean;
	/** Bytes currently used by this origin, when available. */
	usage: number | null;
	/** Bytes available to this origin, when available. */
	quota: number | null;
}

/** True when the browser has granted persistent storage to this origin. */
export async function isStoragePersisted(): Promise<boolean> {
	if (!browser || !navigator.storage?.persisted) return false;
	try {
		return await navigator.storage.persisted();
	} catch {
		return false;
	}
}

/**
 * Ask the browser to keep this origin's storage. Resolves to the resulting
 * persisted state. Safe to call repeatedly; browsers may ignore the request
 * when it is not tied to a user gesture.
 */
export async function requestPersistentStorage(): Promise<boolean> {
	if (!browser || !navigator.storage?.persist) return false;
	try {
		if (await navigator.storage.persisted()) return true;
		return await navigator.storage.persist();
	} catch {
		return false;
	}
}

/** Snapshot of persistence + usage/quota for the settings screen. */
export async function storageStatus(): Promise<StorageStatus> {
	if (!browser) return { supported: false, persisted: false, usage: null, quota: null };

	const supported = !!navigator.storage?.persist;
	const persisted = await isStoragePersisted();
	let usage: number | null = null;
	let quota: number | null = null;
	try {
		const estimate = await navigator.storage?.estimate?.();
		usage = typeof estimate?.usage === 'number' ? estimate.usage : null;
		quota = typeof estimate?.quota === 'number' ? estimate.quota : null;
	} catch {
		/* estimate is best-effort */
	}
	return { supported, persisted, usage, quota };
}

/** Remember that this browser has signed in before. */
export function markKnownDevice() {
	if (!browser) return;
	try {
		localStorage.setItem(KNOWN_DEVICE_KEY, '1');
	} catch {
		/* storage may be unavailable */
	}
	try {
		document.cookie = `${KNOWN_DEVICE_COOKIE}=1; max-age=${COOKIE_MAX_AGE}; path=/; SameSite=Lax`;
	} catch {
		/* cookies may be blocked */
	}
}

/** Forget the marker (explicit sign-out or data wipe). */
export function clearKnownDevice() {
	if (!browser) return;
	try {
		localStorage.removeItem(KNOWN_DEVICE_KEY);
	} catch {
		/* ignore */
	}
	try {
		document.cookie = `${KNOWN_DEVICE_COOKIE}=; max-age=0; path=/; SameSite=Lax`;
	} catch {
		/* ignore */
	}
}

/**
 * True when this browser signed in before. Used together with a missing auth
 * snapshot to detect a cleared/evicted session.
 */
export function wasKnownDevice(): boolean {
	if (!browser) return false;
	try {
		if (localStorage.getItem(KNOWN_DEVICE_KEY) === '1') return true;
	} catch {
		/* ignore */
	}
	try {
		return document.cookie
			.split(';')
			.some((entry) => entry.trim().startsWith(`${KNOWN_DEVICE_COOKIE}=`));
	} catch {
		return false;
	}
}
