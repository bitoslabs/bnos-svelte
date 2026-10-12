/**
 * OBP v0.1 document lifecycle — the append-only state machine.
 *
 * A document's state is a *projection* over its message log; it is never
 * overwritten. This module owns:
 *
 * - the per-documentType state table,
 * - which actions each party may take in each state,
 * - the reference requirements for each issuing action
 *   (RFQ → quote → purchase order → invoice → payment evidence → receipt),
 * - party rules: only the document's recipient may accept/reject; only
 *   its issuer may cancel, and only before recipient acceptance
 *   (the v0.1 party/clock rule).
 */
import type { ObpAction, ObpDocumentType, ObpDocumentState, ObpError } from './types';

/** Which party an action belongs to, relative to the referenced document. */
export type ObpParty = 'issuer' | 'recipient';

/** Projected view of one document's message log. */
export interface ObpDocumentProjection {
	documentId: string;
	documentType: ObpDocumentType;
	/** First issuer org. */
	issuer: string;
	/** Intended recipient org from the issuing message. */
	recipient: string;
	/** Current projected state. */
	state: ObpDocumentState;
	/** SHA-256 of the issuing message's canonical payload. */
	issueHash: string;
	/** Issuing message's expiry. */
	expiresAt: string;
	/** First issue timestamp (from the issuing message). */
	createdAt: string;
	/** Last message/settlement update timestamp. */
	updatedAt: string;
	currency: string;
	totalsMinor: number;
	/** Verified settlement status (only meaningful for `invoice`). */
	settlement: 'unpaid' | 'pending' | 'verified' | 'failed';
}

/** Parties allowed to perform each action on a live document. */
const ACTION_PARTY: Partial<Record<ObpAction, ObpParty>> = {
	accept: 'recipient',
	reject: 'recipient',
	cancel: 'issuer'
};

/** State produced by each terminal action. */
const ACTION_RESULT: Record<'accept' | 'reject' | 'cancel', ObpDocumentState> = {
	accept: 'accepted',
	reject: 'rejected',
	cancel: 'cancelled'
};

/** States from which each action may move a document. */
const ACTION_FROM: Record<'accept' | 'reject' | 'cancel', ObpDocumentState[]> = {
	accept: ['issued'],
	reject: ['issued'],
	cancel: ['issued']
};

/** Required reference chains for issuing actions. */
const ISSUE_REFERENCES: Record<
	ObpDocumentType,
	{
		type: ObpDocumentType;
		state: ObpDocumentState | ObpDocumentState[];
		settlement?: 'verified';
		/** Which party of the referenced document must issue the new one. */
		party?: ObpParty;
	}[]
> = {
	rfq: [],
	quote: [{ type: 'rfq', state: 'accepted', party: 'recipient' }],
	purchase_order: [{ type: 'quote', state: 'accepted', party: 'recipient' }],
	invoice: [{ type: 'purchase_order', state: 'accepted', party: 'recipient' }],
	payment_evidence: [{ type: 'invoice', state: 'accepted', party: 'recipient' }],
	// Receipt requires a verified-settled invoice (state may be `accepted`
	// or already `paid`, which verified settlement flips it to) AND
	// delivered payment evidence. The seller — issuer of the invoice and
	// recipient of the payment — signs the receipt.
	receipt: [
		{ type: 'invoice', state: ['accepted', 'paid'], settlement: 'verified', party: 'issuer' },
		{ type: 'payment_evidence', state: ['issued', 'accepted'], party: 'recipient' }
	]
};

/**
 * Which party of a live document may perform a state-changing action:
 * only its recipient may accept/reject, only its issuer may cancel.
 * (Issuing-party rules are per-reference in `ISSUE_REFERENCES`.)
 */
export function requiredParty(
	documentType: ObpDocumentType,
	action: ObpAction
): ObpParty | 'any-relation' {
	if (action === 'issue') return 'any-relation';
	return ACTION_PARTY[action] ?? 'any-relation';
}

/**
 * Validate an issuing action against the projected prior documents it
 * references. Enforces chain shape, prior acceptance, settlement status
 * and the quote expiry clock (`OBP-E15`).
 */
export function checkIssueReferences(
	envelope: {
		documentType: ObpDocumentType;
		issuer: string;
		recipient: string;
		createdAt: string;
		expiresAt: string;
		references: { documentId: string; documentType: ObpDocumentType; hash?: string }[];
	},
	lookup: (documentId: string) => ObpDocumentProjection | undefined
): ObpError | null {
	const required = ISSUE_REFERENCES[envelope.documentType];
	if (envelope.references.length !== required.length) {
		return {
			code: 'OBP-E09',
			message: `${envelope.documentType}.issue requires exactly ${required.length} reference(s): ${required
				.map((r) => r.type)
				.join(', ')}`
		};
	}
	for (let i = 0; i < required.length; i++) {
		const want = required[i];
		const got = envelope.references[i];
		if (got.documentType !== want.type) {
			return {
				code: 'OBP-E09',
				message: `references[${i}] must be a ${want.type}, got ${got.documentType}`
			};
		}
		const doc = lookup(got.documentId);
		if (!doc) {
			return { code: 'OBP-E09', message: `referenced ${want.type} ${got.documentId} not found` };
		}
		if (doc.documentType !== want.type) {
			return {
				code: 'OBP-E09',
				message: `referenced document ${got.documentId} is a ${doc.documentType}`
			};
		}
		const states = Array.isArray(want.state) ? want.state : [want.state];
		if (!states.includes(doc.state)) {
			return {
				code: 'OBP-E11',
				message: `referenced ${want.type} ${got.documentId} is ${doc.state}, needs ${states.join('|')}`
			};
		}
		if (want.settlement && doc.settlement !== want.settlement) {
			return {
				code: 'OBP-E11',
				message: `referenced ${want.type} ${got.documentId} settlement is ${doc.settlement}, needs ${want.settlement}`
			};
		}
		// Party rule: e.g. the seller (RFQ recipient) quotes, the buyer
		// (quote recipient) orders, and the seller (invoice issuer, payment
		// recipient) issues the receipt.
		const party = want.party ?? 'recipient';
		const partyOrg = party === 'issuer' ? doc.issuer : doc.recipient;
		const counterpartyOrg = party === 'issuer' ? doc.recipient : doc.issuer;
		if (partyOrg !== envelope.issuer) {
			return {
				code: 'OBP-E11',
				message: `${envelope.documentType}.issue must come from the ${party} of ${want.type} ${got.documentId}`
			};
		}
		if (counterpartyOrg !== envelope.recipient) {
			return {
				code: 'OBP-E11',
				message: `${envelope.documentType}.issue must target the ${party === 'issuer' ? 'recipient' : 'issuer'} of ${want.type} ${got.documentId}`
			};
		}
		// Pinned hashes must match the referenced document's issue hash.
		if (got.hash !== undefined && got.hash !== doc.issueHash) {
			return {
				code: 'OBP-E10',
				message: `reference hash mismatch for ${want.type} ${got.documentId}`
			};
		}
		// Quote validity clock: a purchase order must arrive before the
		// quoted expiry.
		if (want.type === 'quote' && Date.parse(doc.expiresAt) <= Date.parse(envelope.createdAt)) {
			return {
				code: 'OBP-E15',
				message: `quote ${got.documentId} expired at ${doc.expiresAt}`
			};
		}
	}
	return null;
}

/**
 * Validate a state-changing action (`accept`/`reject`/`cancel`) against
 * the target document's current projection and party rules.
 */
export function checkTransition(
	envelope: { documentId: string; action: ObpAction; issuer: string; createdAt: string },
	doc: ObpDocumentProjection | undefined
): ObpError | null {
	if (envelope.action === 'issue') return null;
	if (!doc) {
		return { code: 'OBP-E09', message: `document ${envelope.documentId} not found` };
	}
	const a = envelope.action as 'accept' | 'reject' | 'cancel';
	const party = requiredParty(doc.documentType, envelope.action);
	const expected = party === 'issuer' ? doc.issuer : doc.recipient;
	if (envelope.issuer !== expected) {
		return {
			code: 'OBP-E11',
			message: `action ${a} on ${doc.documentId} reserved for ${party} ${expected}, got ${envelope.issuer}`
		};
	}
	if (!ACTION_FROM[a].includes(doc.state)) {
		return {
			code: 'OBP-E11',
			message: `document ${doc.documentId} is ${doc.state}; ${a} not allowed from here`
		};
	}
	if (a === 'cancel') {
		// Clock rule: issuer may cancel while `issued`; expiry alone does not
		// cancel — the recipient must still reject, or the issuer cancels.
		if (Date.parse(envelope.createdAt) >= Date.parse(doc.expiresAt)) {
			return {
				code: 'OBP-E08',
				message: `document ${doc.documentId} expired at ${doc.expiresAt}; issue a new document instead`
			};
		}
	}
	return null;
}

/** Fold a validated message into the document projection. */
export function applyToProjection(
	doc: ObpDocumentProjection,
	envelope: {
		documentId: string;
		action: ObpAction;
		totalsMinor: number;
		currency: string;
		expiresAt: string;
	}
): void {
	if (envelope.action === 'accept') {
		doc.state = ACTION_RESULT.accept;
		// An accepted invoice enters the payment pipeline as pending payment
		// only after settlement verification flips it (`paid`).
	} else if (envelope.action === 'reject') {
		doc.state = ACTION_RESULT.reject;
	} else if (envelope.action === 'cancel') {
		doc.state = ACTION_RESULT.cancel;
	}
}
