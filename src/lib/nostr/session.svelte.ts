/**
 * Nostr auth session — runes-based singleton wrapping @bitos/bnos-core's
 * auth snapshot helpers. Supports nsec (private key), NIP-07 browser extension,
 * and NIP-46 remote signer (bunker URL or `nostrconnect://` QR) login.
 * Persisted to localStorage via the canonical BNOS keys so it is interoperable
 * with other BNOS clients (bdgo-os, bnos-space).
 */
import { browser } from '$app/environment';
import { finalizeEvent, generateSecretKey, getPublicKey, nip19, nip44 } from 'nostr-tools';
import type { EventTemplate } from 'nostr-tools/pure';
import { SimplePool } from 'nostr-tools/pool';
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
import {
	clearKnownDevice,
	markKnownDevice,
	requestPersistentStorage,
	wasKnownDevice
} from '$lib/storage/persistence';
import { relays } from './relay.svelte';
import {
	connectWithBunker,
	connectWithNostrConnect,
	restoreNip46Signer,
	type Nip46Connection,
	type Nip46Signer
} from './nip46';

/** Minimal NIP-07 signer shape we rely on (aligned with bnos-core). */
type Nip07 = {
	getPublicKey: () => Promise<string>;
	signEvent: (event: Record<string, unknown>) => Promise<NostrEvent>;
	nip44?: {
		encrypt: (pubkey: string, plaintext: string) => Promise<string>;
		decrypt: (pubkey: string, ciphertext: string) => Promise<string>;
	};
};

function getNip07(): Nip07 | null {
	if (!browser) return null;
	const w = window as unknown as { nostr?: Nip07 };
	return (w.nostr as Nip07 | undefined) ?? null;
}

/** Shared relay pool for NIP-46 JSON-RPC (browser only). */
let nip46Pool: SimplePool | null = null;
function getNip46Pool(): SimplePool | undefined {
	if (!browser) return undefined;
	if (!nip46Pool) nip46Pool = new SimplePool();
	return nip46Pool;
}

/** True when the browser's Data Saver mode is on (skip background probes). */
function isDataSaverOn(): boolean {
	if (!browser) return false;
	const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
	return !!conn?.saveData;
}

/** Decode an `nsec` into its 32-byte secret key. */
function nsecToBytes(nsec: string): Uint8Array {
	const decoded = nip19.decode(nsec);
	if (decoded.type !== 'nsec') throw new Error('Invalid nsec');
	return decoded.data;
}

/** A signer that can sign events and (optionally) NIP-44 encrypt/decrypt. */
export interface ActiveSigner {
	signEvent(template: EventTemplate): Promise<NostrEvent>;
	nip44Encrypt?: (peerHex: string, plaintext: string) => Promise<string>;
	nip44Decrypt?: (peerHex: string, ciphertext: string) => Promise<string>;
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
	// Canonical auth keys (mirror BNOS_AUTH_STORAGE_KEYS) + their legacy twin.
	// `nostrUser` (BNOS_AUTH_STORAGE_KEYS.LEGACY_BNOS_SPACE_USER) MUST be wiped:
	// leaving it behind lets `session.load()` resurrect a signed-out session on
	// /login, which then bounces the user straight back into the app.
	BNOS_AUTH_STORAGE_KEYS.PUBKEY,
	BNOS_AUTH_STORAGE_KEYS.PRIVKEY,
	BNOS_AUTH_STORAGE_KEYS.LOGIN_METHOD,
	BNOS_AUTH_STORAGE_KEYS.LEGACY_BNOS_SPACE_USER,
	'nostr_login',
	'nostr_auto_sync',
	'nostr_profile',
	'pos-global',
	'active-workspace',
	'active-company',
	'active-branch',
	'active-staff',
	'active-role',
	'setup-'
];
const PRESERVE_ON_LOGOUT = new Set(['bnos-os:relays']);

/** Persisted NIP-46 connection (bunker pointer + disposable client key). */
const NIP46_STORAGE_KEY = 'bnos-os:nip46';

/**
 * Await `p` but never longer than `ms`. Storage cleanup (IndexedDB / Cache API)
 * can hang — e.g. when another tab holds the DB — and that must never block the
 * caller's redirect back to /login.
 */
function bounded<T>(p: Promise<T>, ms: number): Promise<T | void> {
	return Promise.race([p, new Promise<void>((r) => setTimeout(r, ms))]);
}

class SessionStore {
	/** Current auth snapshot, or null when signed out. */
	snapshot = $state<BnosAuthSnapshot | null>(null);
	/** True once we've read persisted auth from storage on mount. */
	hydrated = $state(false);
	loading = $state(false);
	error = $state<string | null>(null);
	/**
	 * True when this device signed in before but the auth snapshot is gone —
	 * usually because the browser evicted storage. The login screen uses this
	 * to explain the unexpected sign-out instead of showing a blank first run.
	 */
	sessionLost = $state(false);
	/**
	 * True when a NIP-46 session is still in memory but the remote signer no
	 * longer accepts requests — usually because the owner removed this app's
	 * connection in the signer app.
	 */
	remoteSignerLost = $state(false);

	/** Live NIP-46 signer (not reactive — it owns a relay subscription). */
	private nip46Signer: Nip46Signer | null = null;
	/** Persisted connection, kept in memory so a lost signer can be rebuilt. */
	private nip46Connection: Nip46Connection | null = null;
	/** Throttle for remote-signer health checks (epoch ms). */
	private lastRemoteCheck = 0;
	/** Shared in-flight check so resume + online never ping twice. */
	private remoteCheckInFlight: Promise<boolean> | null = null;

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
			// Migrate a legacy bnos-space session to the canonical keys so tenant
			// ownership checks (`nostr_pubkey`) keep working across reloads.
			if (!canonical && legacy) this.persist(legacy);
			this.restoreNip46();

			if (this.snapshot) {
				// A live session is a known device; also ask the browser to keep the
				// storage so mobile eviction does not sign the user out later.
				markKnownDevice();
				void requestPersistentStorage();
				this.sessionLost = false;
			} else {
				// No auth snapshot: distinguish a first visit from a cleared session.
				this.sessionLost = wasKnownDevice();
			}
		} catch (e) {
			this.error = e instanceof Error ? e.message : String(e);
		} finally {
			this.loading = false;
			this.hydrated = true;
		}
	};

	/** Tear down any active NIP-46 signer + its persisted connection. */
	private clearNip46() {
		void this.nip46Signer?.close().catch(() => {});
		this.nip46Signer = null;
		this.nip46Connection = null;
		this.remoteSignerLost = false;
		this.lastRemoteCheck = 0;
		if (browser) localStorage.removeItem(NIP46_STORAGE_KEY);
	}

	/** Rebuild the signer from the persisted connection (used by Retry). */
	private reconnectNip46(): boolean {
		if (!this.nip46Connection) return false;
		try {
			this.nip46Signer = restoreNip46Signer(this.nip46Connection, {
				pool: getNip46Pool()
			});
			return true;
		} catch {
			this.nip46Signer = null;
			return false;
		}
	}

	/** Sign in with an nsec / hex private key. */
	loginWithNsec = (inputKey: string): BnosAuthSnapshot => {
		const snap = createAuthSnapshotFromPrivateKey(inputKey);
		this.clearNip46();
		this.snapshot = snap;
		this.hydrated = true;
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
		this.clearNip46();
		const snap: BnosAuthSnapshot = {
			pubkey: normalized,
			npub: publicKeyToNpub(normalized),
			loginMethod: 'extension'
		};
		this.snapshot = snap;
		this.hydrated = true;
		this.persist(snap);
		return snap;
	};

	/**
	 * Sign in with a NIP-46 remote signer (bunker URL or NIP-05 identifier).
	 * The user's key never reaches this device; only the disposable client key
	 * and bunker pointer are persisted.
	 */
	loginWithBunker = async (
		input: string,
		onAuth?: (url: string) => void
	): Promise<BnosAuthSnapshot> => {
		this.loading = true;
		this.error = null;
		try {
			const signer = await connectWithBunker(input, {
				pool: getNip46Pool(),
				onAuth
			});
			return this.adoptNip46(signer);
		} catch (e) {
			this.error = e instanceof Error ? e.message : 'Could not connect the remote signer.';
			throw e;
		} finally {
			this.loading = false;
		}
	};

	/**
	 * Sign in with a NIP-46 client-initiated connection. Generates a
	 * `nostrconnect://` URI for the UI to show as a QR code, then resolves once
	 * a signer app approves it.
	 */
	loginWithNostrConnect = async (input: {
		onUri: (uri: string) => void;
		signal?: AbortSignal;
		onAuth?: (url: string) => void;
	}): Promise<BnosAuthSnapshot> => {
		this.loading = true;
		this.error = null;
		try {
			const signer = await connectWithNostrConnect({
				relays: relays.writableNormalized.length ? relays.writableNormalized : relays.normalized,
				onUri: input.onUri,
				signal: input.signal,
				options: { pool: getNip46Pool(), onAuth: input.onAuth }
			});
			return this.adoptNip46(signer);
		} catch (e) {
			if (!input.signal?.aborted) {
				this.error = e instanceof Error ? e.message : 'Could not connect the signer app.';
			}
			throw e;
		} finally {
			this.loading = false;
		}
	};

	/** Commit a connected NIP-46 signer as the active session. */
	private adoptNip46(signer: Nip46Signer): BnosAuthSnapshot {
		const { connection } = signer;
		const pubkey = normalizePublicKey(connection.userPubkey);
		const snap: BnosAuthSnapshot = {
			pubkey,
			npub: publicKeyToNpub(pubkey),
			loginMethod: 'nip46'
		};
		void this.nip46Signer?.close().catch(() => {});
		this.nip46Signer = signer;
		this.nip46Connection = connection;
		this.remoteSignerLost = false;
		this.lastRemoteCheck = 0;
		this.snapshot = snap;
		this.hydrated = true;
		this.persist(snap);
		if (browser) localStorage.setItem(NIP46_STORAGE_KEY, JSON.stringify(connection));
		return snap;
	}

	/** Rebuild the remote signer for a persisted NIP-46 session. */
	private restoreNip46() {
		if (!browser) return;
		if (this.snapshot?.loginMethod !== 'nip46') {
			if (this.nip46Signer) {
				void this.nip46Signer.close().catch(() => {});
				this.nip46Signer = null;
			}
			return;
		}
		// `load()` runs from several routes; keep the live signer if we already
		// restored it for this identity.
		if (this.nip46Signer) return;
		try {
			const raw = localStorage.getItem(NIP46_STORAGE_KEY);
			if (!raw) throw new Error('Missing NIP-46 connection');
			const connection = JSON.parse(raw) as Nip46Connection;
			this.nip46Connection = connection;
			this.nip46Signer = restoreNip46Signer(connection, { pool: getNip46Pool() });
		} catch {
			// A broken connection must not leave a half-signed-in session behind.
			this.nip46Signer = null;
			this.nip46Connection = null;
			this.snapshot = null;
			localStorage.removeItem(NIP46_STORAGE_KEY);
		}
	}

	/** Sign an event template with the active login method. */
	signEvent = async (template: EventTemplate): Promise<NostrEvent> => {
		const signer = this.activeSigner;
		if (!signer) throw new Error('No Nostr signer available');
		try {
			return await signer.signEvent(template);
		} catch (e) {
			// A failed remote-signing request is a free revocation signal — confirm
			// it with one ping instead of polling on a timer.
			if (this.snapshot?.loginMethod === 'nip46') void this.verifyRemoteSigner(true);
			throw e;
		}
	};

	/** NIP-44 encrypt to a peer with the active login method. */
	nip44Encrypt = async (peerHex: string, plaintext: string): Promise<string> => {
		const signer = this.activeSigner;
		if (!signer?.nip44Encrypt) {
			throw new Error(
				'NIP-44 encryption requires a NIP-07 extension, NIP-46 signer, or nsec login'
			);
		}
		try {
			return await signer.nip44Encrypt(peerHex, plaintext);
		} catch (e) {
			if (this.snapshot?.loginMethod === 'nip46') void this.verifyRemoteSigner(true);
			throw e;
		}
	};

	/** NIP-44 decrypt from a peer with the active login method. */
	nip44Decrypt = async (peerHex: string, ciphertext: string): Promise<string> => {
		const signer = this.activeSigner;
		if (!signer?.nip44Decrypt) {
			throw new Error(
				'NIP-44 decryption requires a NIP-07 extension, NIP-46 signer, or nsec login'
			);
		}
		try {
			return await signer.nip44Decrypt(peerHex, ciphertext);
		} catch (e) {
			if (this.snapshot?.loginMethod === 'nip46') void this.verifyRemoteSigner(true);
			throw e;
		}
	};

	/**
	 * The active signer for the current login method, exposing signing and
	 * (when available) NIP-44. Used by NIP-17 / key-grant helpers that need more
	 * than a bare `signEvent`.
	 */
	get activeSigner(): ActiveSigner | null {
		const snap = this.snapshot;
		if (!snap) return null;

		if (snap.loginMethod === 'nip46') return this.nip46Signer;

		if (snap.loginMethod === 'extension') {
			const ext = getNip07();
			if (!ext) return null;
			return {
				signEvent: (template) => ext.signEvent({ ...template, pubkey: snap.pubkey }),
				nip44Encrypt: ext.nip44 ? (peer, text) => ext.nip44!.encrypt(peer, text) : undefined,
				nip44Decrypt: ext.nip44 ? (peer, text) => ext.nip44!.decrypt(peer, text) : undefined
			};
		}

		if (snap.loginMethod === 'nsec' && snap.nsec) {
			const secret = nsecToBytes(snap.nsec);
			return {
				signEvent: (template) => Promise.resolve(finalizeEvent(template, secret) as NostrEvent),
				nip44Encrypt: (peer, text) =>
					Promise.resolve(nip44.v2.encrypt(text, nip44.getConversationKey(secret, peer))),
				nip44Decrypt: (peer, text) =>
					Promise.resolve(nip44.v2.decrypt(text, nip44.getConversationKey(secret, peer)))
			};
		}

		return null;
	}

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
		this.clearNip46();
		// An explicit sign-out is not a lost session — forget the marker so the
		// login screen does not claim the session was cleared by the browser.
		clearKnownDevice();
		this.sessionLost = false;
		this.snapshot = null;
		this.hydrated = false;

		if (!browser) return;

		// 1. localStorage — wipe all known app keys by prefix
		try {
			const keysToRemove: string[] = [];
			for (let i = localStorage.length - 1; i >= 0; i--) {
				const key = localStorage.key(i);
				if (!key) continue;
				if (PRESERVE_ON_LOGOUT.has(key)) continue;
				if (APP_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
					keysToRemove.push(key);
				}
			}
			for (const key of keysToRemove) {
				localStorage.removeItem(key);
			}
		} catch {
			/* best effort */
		}

		// 2. sessionStorage — clear entirely
		try {
			sessionStorage.clear();
		} catch {
			/* best effort */
		}

		// 3. IndexedDB (idb-keyval) — wipe all GLO collections + publish queue
		try {
			await bounded(idbClear(), 1500);
		} catch {
			/* best effort */
		}

		// 4. Cache API — delete any cached responses
		if ('caches' in window) {
			try {
				const cacheNames = await bounded(window.caches.keys(), 1500);
				if (cacheNames) {
					await bounded(Promise.all(cacheNames.map((name) => window.caches.delete(name))), 1500);
				}
			} catch {
				/* best effort */
			}
		}
	};

	private persist(snap: BnosAuthSnapshot) {
		if (!browser) return;
		// Remember this device and request durable storage from the login gesture.
		markKnownDevice();
		void requestPersistentStorage();
		this.sessionLost = false;
		localStorage.setItem(BNOS_AUTH_STORAGE_KEYS.PUBKEY, snap.pubkey);
		localStorage.setItem('nostr_npub', snap.npub);
		localStorage.setItem(BNOS_AUTH_STORAGE_KEYS.LOGIN_METHOD, snap.loginMethod);
		if (snap.loginMethod === 'nsec' && snap.nsec) {
			// NOTE: storing the nsec locally mirrors bdgo-os's local-first model.
			// Production deployments should move this to a secure enclave.
			localStorage.setItem(BNOS_AUTH_STORAGE_KEYS.PRIVKEY, snap.nsec);
		} else {
			// Switching to NIP-07/NIP-46 must not leave a stale nsec behind:
			// `readCanonicalAuthSnapshot` prefers the private key over the method.
			localStorage.removeItem(BNOS_AUTH_STORAGE_KEYS.PRIVKEY);
		}
	}

	/**
	 * Ping the NIP-46 signer to confirm the owner has not removed this app's
	 * connection. No-op for other login methods and while offline. Retries once
	 * to avoid signing out on a transient relay hiccup.
	 */
	verifyRemoteSigner = (force = false): Promise<boolean> => {
		if (this.remoteCheckInFlight) return this.remoteCheckInFlight;
		const pending = this.runRemoteCheck(force).finally(() => {
			if (this.remoteCheckInFlight === pending) this.remoteCheckInFlight = null;
		});
		this.remoteCheckInFlight = pending;
		return pending;
	};

	private runRemoteCheck = async (force: boolean): Promise<boolean> => {
		if (!browser || this.snapshot?.loginMethod !== 'nip46') return true;
		if (!navigator.onLine) return true;
		// Respect Data Saver: never spend metered traffic on a background probe.
		if (!force && isDataSaverOn()) return true;

		// A forced check is the banner's Retry: rebuild a signer we closed after
		// the previous failure, then ping again.
		if (this.remoteSignerLost) {
			if (!force) return false;
			if (!this.nip46Signer && !this.reconnectNip46()) return false;
		} else if (!this.nip46Signer) {
			return true;
		}

		const now = Date.now();
		if (!force && now - this.lastRemoteCheck < 120_000) return true;
		this.lastRemoteCheck = now;

		const signer = this.nip46Signer;
		if (!signer) return false;

		const first = await signer.checkConnection();
		if (first === 'ok') {
			this.remoteSignerLost = false;
			return true;
		}
		// An explicit rejection is a definite revocation — no need to retry.
		if (first === 'rejected') {
			this.markRemoteSignerLost(signer);
			return false;
		}

		// Timeout: one short retry to rule out a relay hiccup.
		await new Promise((resolve) => setTimeout(resolve, 1000));
		if (!navigator.onLine) return true;
		const second = await signer.checkConnection(3000);
		if (second === 'ok') {
			this.remoteSignerLost = false;
			return true;
		}

		this.markRemoteSignerLost(signer);
		return false;
	};

	/** Mark the remote signer lost and release its pending request/subscription. */
	private markRemoteSignerLost(signer: Nip46Signer) {
		this.remoteSignerLost = true;
		void signer.close().catch(() => {});
		this.nip46Signer = null;
	}

	/**
	 * Re-write the auth snapshot if the browser cleared it while the app was
	 * open (mobile browsers can evict storage in the background). Called when
	 * the app becomes visible again so a reload does not lose the session.
	 */
	reassertPersistence = () => {
		if (!browser || !this.snapshot) return;
		try {
			if (!localStorage.getItem(BNOS_AUTH_STORAGE_KEYS.PUBKEY)) {
				this.persist(this.snapshot);
			}
		} catch {
			/* storage may be unavailable */
		}
	};

	/** Dismiss the "session was cleared" notice on the login screen. */
	dismissSessionLost = () => {
		this.sessionLost = false;
	};

	/** Re-export login method type for convenience. */
	static method = (m: BnosLoginMethod) => m;
}

export const session = new SessionStore();
