/**
 * Open Business Protocol (OBP) v0.1 — core message and document types.
 *
 * This module is the transport-neutral contract described in
 * `docs/OBP_SYSTEM_PLAN.md`: it must have **no dependency on Svelte,
 * Nostr or BNOS-specific GLO types**. Transports (Nostr, HTTP, loopback)
 * carry the canonical signed envelope defined here.
 *
 * Design rules (from the system plan):
 * - State changes are append-only messages referencing a document; a
 *   `status` field is never overwritten.
 * - Amounts are integer minor units (e.g. attosats, sats, cents); currency
 *   precision is explicit per currency.
 * - Every message carries protocol, version, globally unique ids, issuer,
 *   recipient, times, lines, totals, references, hash and signature.
 */

/** Protocol discriminator for every OBP envelope. */
export const OBP_PROTOCOL = 'obp' as const;

/** Current contract version. */
export const OBP_VERSION = '0.1' as const;

/** Document types in the v0.1 purchasing slice. */
export const OBP_DOCUMENT_TYPES = [
	'rfq',
	'quote',
	'purchase_order',
	'invoice',
	'payment_evidence',
	'receipt'
] as const;
export type ObpDocumentType = (typeof OBP_DOCUMENT_TYPES)[number];

/** Actions a message can perform against a document. */
export const OBP_ACTIONS = ['issue', 'accept', 'reject', 'cancel'] as const;
export type ObpAction = (typeof OBP_ACTIONS)[number];

/** Lifecycle states projected from the append-only message log. */
export const OBP_DOCUMENT_STATES = [
	'issued',
	'accepted',
	'rejected',
	'cancelled',
	'paid',
	'settled'
] as const;
export type ObpDocumentState = (typeof OBP_DOCUMENT_STATES)[number];

/**
 * Minor-unit precision per currency (digits after the decimal point).
 * LAK is quoted without minor units in practice; BTC is counted in sats
 * (2) or attsats (8) — v0.1 uses sats. Unknown currencies must be
 * registered explicitly before use; amounts never silently convert.
 */
export const CURRENCY_MINOR_UNITS: Record<string, number> = {
	LAK: 0,
	THB: 2,
	USD: 2,
	BTC: 2,
	SATS: 0
};

/** A single priced line inside a business document. */
export interface ObpLineItem {
	description: string;
	/** Integer quantity in the smallest sellable unit (safe integer). */
	quantity: number;
	/** Unit of measure, e.g. `kg`, `box`, `piece`. */
	unit: string;
	/** Integer unit price in minor units of {@link ObpEnvelope.currency}. */
	unitPriceMinor: number;
}

/** Reference to a prior document, optionally pinning its payload hash. */
export interface ObpReference {
	documentId: string;
	documentType: ObpDocumentType;
	/** Hex SHA-256 of the referenced document's canonical payload, when known. */
	hash?: string;
}

/** External settlement details attached to payment evidence. */
export interface ObpSettlement {
	/** Provider/wallet identifier, e.g. `lightning`, `manual`, `bank`. */
	method: string;
	/** External settlement identifier as reported by the provider. */
	externalId: string;
	/** Free-form verifiable detail (preimage, txid, receipt number…). */
	detail?: string;
}

/** Delivery terms attached to quotes (explicit, never dropped silently). */
export interface ObpDeliveryTerms {
	/** e.g. `pickup`, `delivery`, `exw`. */
	method: string;
	/** Location or address description. */
	place: string;
	/** Promised lead time in days after order acceptance. */
	leadTimeDays: number;
}

/**
 * The signed OBP envelope. `signature` is excluded from the signed
 * canonical bytes; `payloadHash` is the SHA-256 of those bytes.
 */
export interface ObpEnvelope {
	protocol: typeof OBP_PROTOCOL;
	version: typeof OBP_VERSION;
	/** Globally unique message id (UUID or similar); the idempotency key. */
	messageId: string;
	/** Document this message belongs to (append-only log per document). */
	documentId: string;
	documentType: ObpDocumentType;
	action: ObpAction;
	/** Issuing organization id. */
	issuer: string;
	/** Signing key/credential id (resolved through org key grants). */
	signerKeyId: string;
	/** Hex pubkey of the signing key; signatures verify against this. */
	signerPubkey: string;
	/** Intended recipient organization id. */
	recipient: string;
	/** ISO-8601 creation timestamp. */
	createdAt: string;
	/** ISO-8601 expiry/validity timestamp. */
	expiresAt: string;
	currency: string;
	lines: ObpLineItem[];
	/** Integer total in minor units; must equal Σ quantity × unitPriceMinor. */
	totalsMinor: number;
	/** Explicit tax, shipping and FX terms in minor units when applicable. */
	taxMinor?: number;
	shippingMinor?: number;
	references: ObpReference[];
	/** Settlement proof for `payment_evidence` documents. */
	settlement?: ObpSettlement;
	/** Delivery terms for `quote` documents. */
	deliveryTerms?: ObpDeliveryTerms;
	/** Optional note (human-readable, not a term of the contract). */
	note?: string;
	/** SHA-256 hex of the canonical envelope bytes without `signature`. */
	payloadHash: string;
	/** BIP-340 schnorr signature hex over the canonical bytes. */
	signature: string;
}

/** Envelope before signing (no `payloadHash` / `signature` yet). */
export type ObpUnsignedEnvelope = Omit<ObpEnvelope, 'payloadHash' | 'signature'>;

/** A response message carries the id of the message it answers. */
export interface ObpResponse extends ObpEnvelope {
	/** Message id this acceptance/rejection answers. */
	correlationId?: string;
}

/** Decision a node reached for an inbound message. */
export type ObpDecision = 'accepted' | 'rejected';

/** Verifiable settlement status, kept separate from business acceptance. */
export type ObpSettlementStatus = 'unpaid' | 'pending' | 'verified' | 'failed';

/** Error codes owned by the OBP contract (stable, wire-visible). */
export const OBP_ERROR_CODES = {
	SCHEMA_INVALID: 'OBP-E01',
	BAD_SIGNATURE: 'OBP-E02',
	UNKNOWN_ISSUER: 'OBP-E03',
	UNKNOWN_SIGNER: 'OBP-E04',
	REVOKED_SIGNER: 'OBP-E05',
	SCOPE_VIOLATION: 'OBP-E06',
	WRONG_RECIPIENT: 'OBP-E07',
	EXPIRED: 'OBP-E08',
	UNKNOWN_REFERENCE: 'OBP-E09',
	HASH_MISMATCH: 'OBP-E10',
	INVALID_TRANSITION: 'OBP-E11',
	POLICY_DENIED: 'OBP-E12',
	APPROVAL_REQUIRED: 'OBP-E13',
	ENCRYPTION_REQUIRED: 'OBP-E14',
	EXPIRED_QUOTE: 'OBP-E15'
} as const;
export type ObpErrorCode = (typeof OBP_ERROR_CODES)[keyof typeof OBP_ERROR_CODES];

/** Structured rejection reason carried in decisions and audit records. */
export interface ObpError {
	code: ObpErrorCode;
	message: string;
}
