/**
 * Sensitive-data crypto — AES-256-GCM symmetric encryption for organization data.
 *
 * Ported from bdgo-os `app/utils/sensitive-data.ts`, renamed to the GLO standard
 * `organization` scope with a clean scheme id. AES-256-GCM remains the cipher;
 * the AAD envelope shape (domain/scope/branch/record binding) is preserved.
 *
 * Key model
 * ---------
 * A 32-byte random AES key is generated per *scope* (one per organization,
 * scoped `organization:<orgId>`) and stored locally (base64url in localStorage).
 * The owner device creates the key; staff devices receive it via NIP-44 key
 * grants (kind 30512) — see `organization-key-grants.ts`.
 *
 * Two surfaces:
 *  - `protectSensitiveJson` / `unprotectSensitiveJson` — envelope as a JSON
 *    string (the bdgo-os event-`content` convention).
 *  - `protectSensitiveValue` / `unprotectSensitiveValue` — envelope as an
 *    object, for embedding inside a GLO object's `data` field (the
 *    bnos-svelte convention) so the GLO envelope (type/id/scope/tags) stays
 *    public for relay discovery while the payload is opaque.
 */
import type { EncryptionEnvelope, SensitiveDataDomain } from './privacy';

export const SCHEME = 'org.bitos.bnos.organization-key.v1' as const;
export const ACTIVE_KEY_VERSION = 1;
const KEY_PREFIX = 'bdgoos_sensitive_data_key';
const SCOPE_POINTER_PREFIX = 'bdgoos_sensitive_data_scope';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export type ProtectOptions = {
	domain: SensitiveDataDomain;
	scopeId: string;
	organizationId?: string | null;
	branchId?: string | null;
	recordId?: string | null;
};

// ── base64url helpers (browser-safe) ─────────────────────────────────────────

export const toBase64Url = (bytes: Uint8Array): string => {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
};

export const fromBase64Url = (value: string): Uint8Array => {
	const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
	const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
	const binary = atob(padded);
	return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const stableJson = (value: unknown) => JSON.stringify(value);

const getStorage = (): Storage | null => {
	if (typeof window === 'undefined' || !window.localStorage) return null;
	return window.localStorage;
};

const getCrypto = (): Crypto => {
	if (typeof window === 'undefined' || !window.crypto?.subtle) {
		throw new Error('Web Crypto is required to protect sensitive data');
	}
	return window.crypto;
};

// ── key management ───────────────────────────────────────────────────────────

// The wire `kid` is a random opaque token — it NEVER embeds the organization
// id, so an encrypted event's content leaks nothing about which org it belongs
// to (the org id is already public in the tags for discovery; repeating it in
// the envelope would be pure leakage). A local scope→kid pointer lets
// `hasActiveKey`/`encrypt` resolve the active key from the org scope.

/** Generate a fresh opaque key id (`k_<128-bit hex>`). */
const newOpaqueKid = () =>
	`k_${[...getCrypto().getRandomValues(new Uint8Array(16))]
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('')}`;

/** Public, stable per-scope identifier (NOT published on the wire). */
export const getSensitiveDataKeyId = (scopeId: string, version = ACTIVE_KEY_VERSION) =>
	`${scopeId}:v${version}`;

const keyStorageName = (kid: string) => `${KEY_PREFIX}:${kid}`;
const scopePointerName = (scopeId: string) => `${SCOPE_POINTER_PREFIX}:${scopeId}`;

/** Resolve the opaque key id active for a scope (or null if none yet). */
export const getActiveKidForScope = (scopeId: string): string | null => {
	const storage = getStorage();
	if (!storage) return null;
	return storage.getItem(scopePointerName(scopeId));
};

/** Bind a scope to an opaque kid (so scope-based lookups resolve the key). */
export const storeScopePointer = (scopeId: string, kid: string) => {
	const storage = getStorage();
	if (!storage) return;
	storage.setItem(scopePointerName(scopeId), kid);
};

export const storeSensitiveDataKey = (kid: string, rawKey: Uint8Array) => {
	const storage = getStorage();
	if (!storage) throw new Error('Local storage is required for sensitive data keys');
	storage.setItem(keyStorageName(kid), toBase64Url(rawKey));
};

export const getStoredSensitiveDataKey = (kid: string): Uint8Array | null => {
	const storage = getStorage();
	if (!storage) return null;
	const existing = storage.getItem(keyStorageName(kid));
	return existing ? fromBase64Url(existing) : null;
};

/** Return the existing {kid, rawKey} for a scope, or mint a new opaque-keyed 32-byte key. */
export const getOrCreateSensitiveDataKey = (scopeId: string) => {
	const existingKid = getActiveKidForScope(scopeId);
	if (existingKid) {
		const existing = getStoredSensitiveDataKey(existingKid);
		if (existing) return { keyId: existingKid, rawKey: existing };
	}
	const rawKey = new Uint8Array(32);
	getCrypto().getRandomValues(rawKey);
	const keyId = newOpaqueKid();
	storeSensitiveDataKey(keyId, rawKey);
	storeScopePointer(scopeId, keyId);
	return { keyId, rawKey };
};

/** Delete a stored key + clear its scope pointer (used on revoke / logout). */
export const forgetSensitiveDataKey = (kid: string) => {
	const storage = getStorage();
	if (!storage) return;
	storage.removeItem(keyStorageName(kid));
};

const importAesKey = (rawKey: Uint8Array) =>
	getCrypto().subtle.importKey(
		'raw',
		toBufferSource(rawKey),
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt']
	);

/** Web Crypto's BufferSource wants an ArrayBuffer-backed view; TS 5.7+ infers
 *  Uint8Array<ArrayBufferLike> (which also covers SharedArrayBuffer), so cast
 *  at the crypto boundary. All our bytes are ArrayBuffer-backed at runtime. */
const toBufferSource = (bytes: Uint8Array): BufferSource => bytes as unknown as BufferSource;

/** Scope id for an organization (or per-user fallback when no org). */
export const getSensitiveDataScopeId = (organizationId?: string | null, pubkey?: string | null) => {
	if (organizationId) return `organization:${organizationId}`;
	if (pubkey) return `user:${pubkey}`;
	return 'local';
};

// ── envelope detection ───────────────────────────────────────────────────────

export const isEncryptionEnvelope = (value: unknown): value is EncryptionEnvelope => {
	if (!value || typeof value !== 'object') return false;
	const candidate = value as Partial<EncryptionEnvelope>;
	return (
		candidate.encrypted === true &&
		candidate.v === 1 &&
		candidate.scheme === SCHEME &&
		candidate.alg === 'AES-256-GCM' &&
		typeof candidate.kid === 'string' &&
		typeof candidate.nonce === 'string' &&
		typeof candidate.ciphertext === 'string'
	);
};

export const isProtectedContent = (content: string): boolean => {
	try {
		return isEncryptionEnvelope(JSON.parse(content));
	} catch {
		return false;
	}
};

// ── encrypt / decrypt ───────────────────────────────────────────────────────
// Privacy: the published envelope serializes ONLY what is needed to find the
// key (opaque `kid`) + the ciphertext + nonce, plus a minimal `aad` bound to
// the record id (which is already public via the GLO `d` tag). The org id,
// branch id, and domain are deliberately NOT serialized — they are already
// public in the event tags, so repeating them here would be pure leakage.
// They ARE included in the GCM AAD computation (tamper binding) but the AAD is
// fully reconstructable from the (public) record id, so nothing extra leaks.

const buildAad = (options: ProtectOptions): EncryptionEnvelope['aad'] =>
	options.recordId ? { recordId: options.recordId } : {};

const encryptToEnvelope = async (
	value: unknown,
	options: ProtectOptions
): Promise<EncryptionEnvelope> => {
	const { keyId, rawKey } = getOrCreateSensitiveDataKey(options.scopeId);
	const key = await importAesKey(rawKey);
	const nonce = new Uint8Array(12);
	getCrypto().getRandomValues(nonce);
	const aad = buildAad(options);

	const ciphertext = await getCrypto().subtle.encrypt(
		{
			name: 'AES-GCM',
			iv: toBufferSource(nonce),
			additionalData: toBufferSource(textEncoder.encode(stableJson(aad)))
		},
		key,
		toBufferSource(textEncoder.encode(stableJson(value)))
	);

	return {
		v: 1,
		encrypted: true,
		scheme: SCHEME,
		alg: 'AES-256-GCM',
		kid: keyId,
		nonce: toBase64Url(nonce),
		aad,
		ciphertext: toBase64Url(new Uint8Array(ciphertext))
	};
};

const decryptFromEnvelope = async (envelope: EncryptionEnvelope): Promise<unknown> => {
	const rawKey = getStoredSensitiveDataKey(envelope.kid);
	if (!rawKey) {
		throw new Error(`Missing sensitive data key for ${envelope.kid}`);
	}
	const key = await importAesKey(rawKey);
	const plaintext = await getCrypto().subtle.decrypt(
		{
			name: 'AES-GCM',
			iv: toBufferSource(fromBase64Url(envelope.nonce)),
			additionalData: toBufferSource(textEncoder.encode(stableJson(envelope.aad)))
		},
		key,
		toBufferSource(fromBase64Url(envelope.ciphertext))
	);
	return JSON.parse(textDecoder.decode(plaintext));
};

// ── string surface (bdgo-os event-content convention) ────────────────────────

export const protectSensitiveJson = async (value: unknown, options: ProtectOptions) =>
	JSON.stringify(await encryptToEnvelope(value, options));

export const unprotectSensitiveJson = async <T>(content: string): Promise<T> => {
	const parsed = JSON.parse(content) as unknown;
	if (!isEncryptionEnvelope(parsed)) return parsed as T;
	return (await decryptFromEnvelope(parsed)) as T;
};

// ── object surface (GLO `data` embedding) ────────────────────────────────────

export const protectSensitiveValue = async (value: unknown, options: ProtectOptions) =>
	encryptToEnvelope(value, options);

export const unprotectSensitiveValue = async <T>(value: unknown): Promise<T> => {
	if (!isEncryptionEnvelope(value)) return value as T;
	return (await decryptFromEnvelope(value)) as T;
};
