/**
 * Nostr auth session — runes-based singleton wrapping @bitos/bnos-core's
 * auth snapshot helpers. Supports nsec (private key) and NIP-07 browser
 * extension login. Persisted to localStorage via the canonical BNOS keys so it
 * is interoperable with other BNOS clients (bdgo-os, bnos-space).
 */
import { browser } from '$app/environment';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import {
	BNOS_AUTH_STORAGE_KEYS,
	createAuthSnapshotFromPrivateKey,
	normalizePublicKey,
	publicKeyToNpub,
	readCanonicalAuthSnapshot,
	readLegacyBnosSpaceAuthSnapshot,
	type BnosAuthSnapshot,
	type BnosLoginMethod,
	type NostrEvent,
	type NostrExtensionSigner
} from '@bitos/bnos-core';
import { clear as idbClear } from 'idb-keyval';
import { truncateNpub } from '$lib/utils/format';

/** Minimal NIP-07 signer shape we rely on (aligned with bnos-core). */
type Nip07 = {
	getPublicKey: () => Promise<string>;
	signEvent: (event: Record<string, unknown>) => Promise<NostrEvent>;
};

function getNip07(): Nip07 | null {
	if (!browser) return null;
	const w = window as unknown as { nostr?: Nip07 };
	return (w.nostr as Nip07 | undefined) ?? null;
}

export function hasNip07Extension(): boolean {
	return !!getNip07();
}

/**
 * localStorage key prefixes that belong to the BNOS app. On logout we wipe
 * everything matching these prefixes so the next login starts clean.
 */
const APP_STORAGE_PREFIXES = [
	'bnos-os:',
	'bnos:',
	'nostr_npub',
	'nostr_pubkey',
	'nostr_privkey',
	'nostr_login',
	'nostr_auto_sync',
	'nostr_profile',
	'nostr_profile_kind0',
	'pos-global',
	'active-workspace',
	'active-company',
	'active-branch',
	'active-staff',
	'active-role',
	'setup-'
];

class SessionStore {
	/** Current auth snapshot, or null when signed out. */
	snapshot = $state<BnosAuthSnapshot | null>(null);
	/** True once we've read persisted auth from storage on mount. */
	hydrated = $state(false);
	loading = $state(false);
	error = $state<string | null>(null);

	get isAuthenticated() {
		return !!this.snapshot?.pubkey;
	}
	get pubkey() {
		return this.snapshot?.pubkey ?? null;
	}
	get npub() {
		return this.snapshot?.npub ?? null;
	}
	get shortNpub() {
		return this.npub ? truncateNpub(this.npub) : null;
	}
	get loginMethod() {
		return this.snapshot?.loginMethod ?? null;
	}

	/** NIP-07 signer (browser extension) if available. */
	get extensionSigner(): NostrExtensionSigner | null {
		const ext = getNip07();
		if (!ext) return null;
		return { signEvent: ext.signEvent };
	}

	/** Restore session from localStorage. */
	load = () => {
		if (!browser) return;
		this.loading = true;
		try {
			const canonical = readCanonicalAuthSnapshot(localStorage);
			const legacy = canonical ? null : readLegacyBnosSpaceAuthSnapshot(localStorage);
			this.snapshot = canonical ?? legacy ?? null;
		} catch (e) {
			this.error = e instanceof Error ? e.message : String(e);
		} finally {
			this.loading = false;
			this.hydrated = true;
		}
	};

	/** Sign in with an nsec / hex private key. */
	loginWithNsec = (inputKey: string): BnosAuthSnapshot => {
		const snap = createAuthSnapshotFromPrivateKey(inputKey);
		this.snapshot = snap;
		this.persist(snap);
		return snap;
	};

	/**
	 * Generate a brand-new Nostr keypair (the bdgo-os "Create account" flow).
	 * Returns the nsec/npub so the UI can present a backup step before signing
	 * the user in. Does NOT log in until `loginWithNsec(nsec)` is called.
	 */
	generateAccount = (): { pubkey: string; npub: string; nsec: string } => {
		const sk = generateSecretKey();
		const pubkey = getPublicKey(sk);
		const npub = nip19.npubEncode(pubkey);
		const nsec = nip19.nsecEncode(sk);
		return { pubkey, npub, nsec };
	};

	/**
	 * Convenience: generate a keypair AND sign in immediately. Use the explicit
	 * generate → backup → `loginWithNsec` sequence in the UI so the nsec is shown
	 * before it is committed.
	 */
	createAccount = (): BnosAuthSnapshot => this.loginWithNsec(this.generateAccount().nsec);

	/** Sign in with a NIP-07 browser extension. */
	loginWithExtension = async (): Promise<BnosAuthSnapshot> => {
		const ext = getNip07();
		if (!ext) throw new Error('No NIP-07 extension detected');
		const pubkey = await ext.getPublicKey();
		const normalized = normalizePublicKey(pubkey);
		const snap: BnosAuthSnapshot = {
			pubkey: normalized,
			npub: publicKeyToNpub(normalized),
			loginMethod: 'extension'
		};
		this.snapshot = snap;
		this.persist(snap);
		return snap;
	};

	/**
	 * Full logout — clears all app data from every storage layer:
	 *
	 *  1. In-memory auth snapshot
	 *  2. localStorage — all BNOS/auth keys (prefix-wiped)
	 *  3. sessionStorage — cleared entirely
	 *  4. IndexedDB (idb-keyval) — all GLO collections, publish queue, etc.
	 *  5. Cache API (window.caches) — any cached responses
	 *
	 * This mirrors the bdgo-os-nuxt `clearPersistedClientData` flow and ensures
	 * a fresh login starts with zero stale state. The caller is still
	 * responsible for resetting any in-memory stores they hold references to
	 * (e.g. `tenant.reset()`, `relays.reset()`, `glo` collections) before or
	 * after calling this — though the IndexedDB wipe means the GLO store will
	 * re-hydrate empty on next load.
	 */
	logout = async () => {
		this.snapshot = null;
		this.hydrated = false;

		if (!browser) return;

		// 1. localStorage — wipe all known app keys by prefix
		try {
			const keysToRemove: string[] = [];
			for (let i = localStorage.length - 1; i >= 0; i--) {
				const key = localStorage.key(i);
				if (!key) continue;
				if (APP_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
					keysToRemove.push(key);
				}
			}
			for (const key of keysToRemove) {
				localStorage.removeItem(key);
			}
		} catch (e) {
			console.error('[session] Failed to clear localStorage on logout', e);
		}

		// 2. sessionStorage — clear entirely
		try {
			sessionStorage.clear();
		} catch (e) {
			console.error('[session] Failed to clear sessionStorage on logout', e);
		}

		// 3. IndexedDB (idb-keyval) — wipe all GLO collections + publish queue
		try {
			await idbClear();
		} catch (e) {
			console.error('[session] Failed to clear IndexedDB on logout', e);
		}

		// 4. Cache API — delete any cached responses
		if ('caches' in window) {
			try {
				const cacheNames = await window.caches.keys();
				await Promise.all(cacheNames.map((name) => window.caches.delete(name)));
			} catch (e) {
				console.error('[session] Failed to clear caches on logout', e);
			}
		}
	};

	private persist(snap: BnosAuthSnapshot) {
		if (!browser) return;
		localStorage.setItem(BNOS_AUTH_STORAGE_KEYS.PUBKEY, snap.pubkey);
		localStorage.setItem('nostr_npub', snap.npub);
		localStorage.setItem(BNOS_AUTH_STORAGE_KEYS.LOGIN_METHOD, snap.loginMethod);
		if (snap.loginMethod === 'nsec' && snap.nsec) {
			// NOTE: storing the nsec locally mirrors bdgo-os's local-first model.
			// Production deployments should move this to a secure enclave.
			localStorage.setItem(BNOS_AUTH_STORAGE_KEYS.PRIVKEY, snap.nsec);
		}
	}

	/** Re-export login method type for convenience. */
	static method = (m: BnosLoginMethod) => m;
}

export const session = new SessionStore();
