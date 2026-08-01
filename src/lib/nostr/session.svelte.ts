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
	 * Generate a brand-new Nostr keypair (the bdgo-os “Create account” flow).
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

	logout = () => {
		this.snapshot = null;
		if (browser) {
			localStorage.removeItem(BNOS_AUTH_STORAGE_KEYS.PUBKEY);
			localStorage.removeItem(BNOS_AUTH_STORAGE_KEYS.PRIVKEY);
			localStorage.removeItem(BNOS_AUTH_STORAGE_KEYS.LOGIN_METHOD);
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
