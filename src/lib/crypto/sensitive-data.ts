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

export const getSensitiveDataKeyId = (scopeId: string, version = ACTIVE_KEY_VERSION) =>
	`${scopeId}:v${version}`;

const keyStorageName = (keyId: string) => `${KEY_PREFIX}:${keyId}`;

export const storeSensitiveDataKey = (keyId: string, rawKey: Uint8Array) => {
	const storage = getStorage();
	if (!storage) throw new Error('Local storage is required for sensitive data keys');
	storage.setItem(keyStorageName(keyId), toBase64Url(rawKey));
};

export const getStoredSensitiveDataKey = (keyId: string): Uint8Array | null => {
	const storage = getStorage();
	if (!storage) return null;
	const existing = storage.getItem(keyStorageName(keyId));
	return existing ? fromBase64Url(existing) : null;
};

/** Return the existing key for a scope, or generate + persist a new 32-byte key. */
export const getOrCreateSensitiveDataKey = (scopeId: string) => {
	const keyId = getSensitiveDataKeyId(scopeId);
	const existing = getStoredSensitiveDataKey(keyId);
	if (existing) return { keyId, rawKey: existing };
	const rawKey = new Uint8Array(32);
	getCrypto().getRandomValues(rawKey);
	storeSensitiveDataKey(keyId, rawKey);
	return { keyId, rawKey };
};

/** Delete a stored key (used on revoke / logout). */
export const forgetSensitiveDataKey = (keyId: string) => {
	const storage = getStorage();
	if (!storage) return;
	storage.removeItem(keyStorageName(keyId));
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
		typeof candidate.scopeId === 'string' &&
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

// ── encrypt / decrypt ────────────────────────────────────────────────────────

const buildAad = (options: ProtectOptions): EncryptionEnvelope['aad'] => ({
	domain: options.domain,
	scopeId: options.scopeId,
	...(options.organizationId ? { organizationId: options.organizationId } : {}),
	...(options.branchId ? { branchId: options.branchId } : {}),
	...(options.recordId ? { recordId: options.recordId } : {})
});

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
		domain: options.domain,
		scopeId: options.scopeId,
		nonce: toBase64Url(nonce),
		aad,
		ciphertext: toBase64Url(new Uint8Array(ciphertext))
	};
};

const decryptFromEnvelope = async (envelope: EncryptionEnvelope): Promise<unknown> => {
	const rawKey =
		getStoredSensitiveDataKey(envelope.kid) ||
		getStoredSensitiveDataKey(getSensitiveDataKeyId(envelope.scopeId));
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
