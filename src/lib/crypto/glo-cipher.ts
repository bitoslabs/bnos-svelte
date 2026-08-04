/**
 * GLO ciphertext adapter — the layer `@bitos/bnos-core` deliberately leaves to
 * the app (see `docs/SECURITY.md`): "encrypt the payload with a dedicated
 * ciphertext adapter before publishing".
 *
 * What this module does
 * ---------------------
 * Maps each GLO object type to a sensitive-data domain and, when encryption is
 * enabled AND the active company key is present, replaces the Nostr event
 * `content` with a real AES-256-GCM ciphertext of the complete GLO envelope.
 * It reuses bnos-core's own tag emission by setting `object.encryption`, so the
 * published event carries the honest `encrypted` / `encryption` /
 * `encryption-key` tags. Readers decrypt `content` back to the plaintext GLO
 * envelope and then run the standard `parseGloEvent` validation — exactly the
 * "decrypt before parseGloEvent" contract the security doc requires.
 *
 * Why AES-GCM (not raw NIP-44) for the payload
 * --------------------------------------------
 * NIP-44 is pairwise, so it can't encrypt one org-wide record for N staff
 * efficiently. The proven model (bdgo-os) is a single symmetric company key
 * (AES-256-GCM) — distributed to staff via NIP-44 key grants (kind 30512) —
 * which is where NIP-44 belongs. The `encryption` tag honestly reports
 * `aes-256-gcm` rather than claiming `nip44-v2`. The ciphertext is additionally
 * bound (AAD) to the record id + scope to prevent payload substitution.
 */
import {
	createGloTags,
	decodeGloContent,
	encodeGloContent,
	parseGloEvent,
	type GloObject,
	type GloTag
} from '@bitos/bnos-core/glo';
import { getGloKindForType } from '@bitos/bnos-core/glo';
import {
	isEncryptionEnvelope,
	protectSensitiveJson,
	unprotectSensitiveJson
} from './sensitive-data';
import { organizationKey, isEncryptionEnabled } from './organization-key.svelte';
import type { SensitiveDataDomain } from './privacy';

/** GLO object type → sensitive-data domain. Only types listed here are
 *  candidates for encryption (and only when their visibility is non-public).
 *  Public-discovery types (marketplace listings, store profile, reviews) are
 *  intentionally ABSENT — they must stay plaintext for relay discovery. */
export const ENCRYPTED_DOMAIN_BY_TYPE: Record<string, SensitiveDataDomain> = {
	'commerce.order': 'order',
	'commerce.payment': 'payment',
	'commerce.refund': 'refund',
	'crm.customer': 'customer',
	'identity.staff': 'staff',
	shift: 'shift',
	'cash-event': 'cash_event',
	// Marketplace channel connections carry API keys/credentials in `config` →
	// org-internal, must be encrypted. (Listings/reviews stay plaintext.)
	'marketplace.connection': 'settings'
};

/** The sensitive domain for a GLO type, or undefined if it is not encrypted. */
export const sensitiveDomainForType = (type: string): SensitiveDataDomain | undefined =>
	ENCRYPTED_DOMAIN_BY_TYPE[type];

/** Should records of this GLO type be encrypted when the feature is on? */
export const shouldEncryptType = (type: string): boolean => type in ENCRYPTED_DOMAIN_BY_TYPE;

/**
 * Is encryption active for the active company right now? Requires:
 *  - the device-level feature flag to be on, AND
 *  - a company scope + a locally-available AES key.
 */
export const cipherActive = (): boolean =>
	isEncryptionEnabled() && !!organizationKey.activeScopeId && organizationKey.hasActiveKey;

export interface EncryptedPayload {
	/** AES-GCM envelope JSON string — goes into the event `content`. */
	content: string;
	/** The three honest bnos-core encryption tags to merge onto the event. */
	encryptionTags: GloTag[];
	/** Key id used (non-secret version reference). */
	keyId: string;
}

/**
 * Encrypt a GLO object's envelope into a ciphertext `content` blob. Returns
 * null (→ caller publishes plaintext) when ANY of these hold:
 *  - encryption is off, no org key, or the type isn't sensitive;
 *  - **visibility is `public`** (marketplace listings, store profile, reviews
 *    are meant for relay discovery — encrypting them would hide them).
 *
 * The plaintext bound into the AAD is the full GLO envelope JSON, keyed by the
 * record id so the same ciphertext can't be replayed against another object.
 */
export async function encryptGloObject(
	object: GloObject<unknown>
): Promise<EncryptedPayload | null> {
	if (object.visibility === 'public') return null; // discovery data stays public
	const domain = sensitiveDomainForType(object.type);
	const scopeId = organizationKey.activeScopeId;
	const keyId = organizationKey.activeKeyId;
	if (!domain || !scopeId || !keyId || !cipherActive()) return null;

	const plainEnvelope = encodeGloContent(object);
	const content = await protectSensitiveJson(plainEnvelope, {
		domain,
		scopeId,
		organizationId: object.scope.organizationId,
		branchId: object.scope.locationId ?? null,
		recordId: object.id
	});

	// Reuse bnos-core's tag emission by stamping encryption metadata, so the
	// tags exactly match the spec SECURITY.md documents.
	const tags = createGloTags(
		{ ...object, encryption: { encrypted: true, scheme: 'aes-256-gcm', keyId } },
		{}
	);
	const encryptionTags = tags.filter(
		(t) => t[0] === 'encrypted' || t[0] === 'encryption' || t[0] === 'encryption-key'
	);
	return { content, encryptionTags, keyId };
}

/**
 * Decrypt an event whose `content` is an AES-GCM envelope back into a validated
 * GLO object. Mirrors the contract: decrypt, then `parseGloEvent` validates the
 * resulting envelope against the event's tags. Returns null if the content is
 * not encrypted (so callers can fall through to the plaintext parse).
 */
export async function decryptGloEvent<T>(event: {
	kind: number;
	content: string;
	tags: readonly (readonly string[])[];
	pubkey?: string;
}): Promise<T | null> {
	if (!isEncryptionEnvelope(parseJson(event.content))) return null;
	const plaintext = await unprotectSensitiveJson<string>(event.content);
	// Validate the decrypted envelope against the (still-present) tags.
	const parsed = parseGloEvent({ ...event, content: plaintext } as never);
	return parsed.object as unknown as T;
}

/** Encrypt the content of an already-built plaintext event template (advanced). */
export async function encryptTemplateContent(
	object: GloObject<unknown>,
	plaintextContent: string
): Promise<{ content: string; encryptionTags: GloTag[] } | null> {
	if (object.visibility === 'public') return null; // discovery data stays public
	const domain = sensitiveDomainForType(object.type);
	const scopeId = organizationKey.activeScopeId;
	const keyId = organizationKey.activeKeyId;
	if (!domain || !scopeId || !keyId || !cipherActive()) return null;
	const content = await protectSensitiveJson(plaintextContent, {
		domain,
		scopeId,
		organizationId: object.scope.organizationId,
		branchId: object.scope.locationId ?? null,
		recordId: object.id
	});
	const tags = createGloTags(
		{ ...object, encryption: { encrypted: true, scheme: 'aes-256-gcm', keyId } },
		{}
	);
	return {
		content,
		encryptionTags: tags.filter(
			(t) => t[0] === 'encrypted' || t[0] === 'encryption' || t[0] === 'encryption-key'
		)
	};
}

/** Kind for a GLO type, accounting for app-side BNOS overrides is the store's
 *  job; here we just expose the standard resolver for completeness. */
export const gloKindForType = getGloKindForType;

// Tiny safe JSON.parse for envelope detection (never throws).
function parseJson(value: string): unknown {
	try {
		return JSON.parse(value);
	} catch {
		return undefined;
	}
}

export { decodeGloContent, encodeGloContent };
