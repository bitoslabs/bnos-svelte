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
 * AES-256-GCM encryption envelope. Serialized as JSON (string or embedded as
 * an object inside a GLO `data` field). `aad` binds the ciphertext to its
 * domain/scope so a record can't be replayed against a different context.
 */
export interface EncryptionEnvelope {
	v: 1;
	encrypted: true;
	scheme: 'org.bitos.bnos.organization-key.v1';
	alg: 'AES-256-GCM';
	/** Key id (`<scopeId>:v1`) — names the local key used to decrypt. */
	kid: string;
	domain: SensitiveDataDomain;
	scopeId: string;
	nonce: string;
	aad: {
		domain: SensitiveDataDomain;
		scopeId: string;
		organizationId?: string;
		branchId?: string;
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
