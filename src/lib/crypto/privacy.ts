/**
 * Encryption privacy model — ported from bdgo-os (`app/types/privacy.ts`) and
 * adapted to the bnos-svelte domain. Keeps the wire envelope identical so
 * records encrypted by bdgo-os remain readable here and vice-versa.
 */

/** Sensitive-data domains. Maps 1:1 to the GLO object types we encrypt. */
export type SensitiveDataDomain =
	| 'order'
	| 'payment'
	| 'refund'
	| 'product'
	| 'customer'
	| 'staff'
	| 'shift'
	| 'cash_event'
	| 'settings'
	| 'membership'
	| 'membership_subscription'
	| 'membership_checkin';

export type DataVisibility = 'public' | 'private';

/**
 * AES-256-GCM encryption envelope — the published (plaintext) wrapper around a
 * ciphertext payload. Privacy: it carries ONLY the opaque key id, nonce,
 * ciphertext, and a minimal `aad` bound to the record id (which is already
 * public via the GLO `d` tag). It deliberately does NOT serialize the org id,
 * branch id, or domain — those are already public in the event tags, so
 * repeating them here would be pure metadata leakage.
 */
export interface EncryptionEnvelope {
	v: 1;
	encrypted: true;
	scheme: 'org.bitos.bnos.organization-key.v1';
	alg: 'AES-256-GCM';
	/** Opaque key id (`k_<random>`) — names the local AES key. Never embeds the
	 *  organization id, so the envelope leaks nothing about which org it belongs to. */
	kid: string;
	nonce: string;
	aad: {
		/** Record/object id (already public via the GLO `d` tag). Binds ciphertext
		 *  to its record so it can't be replayed against another object. */
		recordId?: string;
	};
	ciphertext: string;
}

export interface DataPrivacy {
	visibility: DataVisibility;
	encrypted: boolean;
	domain?: SensitiveDataDomain;
	keyId?: string;
	scheme?: EncryptionEnvelope['scheme'];
}
/** A wrapped organization key delivered to a staff member via NIP-44 (kind 30512). */
export interface OrganizationKeyGrant {
	organizationId: string;
	keyId: string;
	keyVersion: number;
	/** NIP-44 ciphertext of the base64url-encoded raw AES key. */
	wrappedKey: string;
	recipientPubkey: string;
	scopes: SensitiveDataDomain[];
	createdAt: number;
	revokedAt?: number;
}
