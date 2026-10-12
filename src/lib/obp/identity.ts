/**
 * OBP organization identity and key delegation.
 *
 * A Nostr pubkey is a *signing key*, not a company. Authority is expressed
 * as organization records plus **key grants**: scoped credentials for
 * owners, staff, devices and agents. Grants carry scope, optional amount
 * limits, validity windows and revocation — and are re-verified by the
 * Business Node on every inbound and outbound action.
 *
 * v0.1 pilot model: counterparties are *preconfigured* — each node's
 * registry is seeded with the orgs and grants it trusts, per
 * `docs/OBP_SYSTEM_PLAN.md` decision 1.
 */
import type { ObpAction, ObpDocumentType, ObpError } from './types';

/** Grant roles, from unrestricted authority to narrowly scoped agents. */
export type ObpRole = 'owner' | 'staff' | 'device' | 'agent';

/** Which document types and actions a grant may exercise. */
export interface ObpGrantScope {
	/** Allowed document types, or `'*'` for all. */
	documentTypes: readonly (ObpDocumentType | '*')[];
	/** Allowed actions, or `'*'` for all. */
	actions: readonly (ObpAction | '*')[];
	/**
	 * Per-document spend ceiling in minor units, enforced on
	 * `purchase_order.issue` and `payment_evidence.issue`.
	 */
	maxAmountMinor?: number;
	/** Currency the ceiling is denominated in (limits are never converted). */
	currency?: string;
	/** Rolling daily spend ceiling across approved payments, minor units. */
	dailyLimitMinor?: number;
}

/** A credential issued by an organization to a signing key. */
export interface ObpKeyGrant {
	grantId: string;
	orgId: string;
	pubkey: string;
	role: ObpRole;
	scope: ObpGrantScope;
	/** ISO-8601 validity window (inclusive start, exclusive end). */
	validFrom?: string;
	validUntil?: string;
	/** ISO-8601 revocation time; revoked grants fail every check. */
	revokedAt?: string;
}

/** A trusted counterparty organization. */
export interface ObpOrganization {
	orgId: string;
	name: string;
	/** Owner pubkey — the root of the org's signing authority. */
	ownerPubkey: string;
}

export interface ObpRegistry {
	trustOrganization(org: ObpOrganization, grants?: ObpKeyGrant[]): void;
	getOrganization(orgId: string): ObpOrganization | undefined;
	revokeGrant(grantId: string, at?: string): void;
	getGrant(grantId: string): ObpKeyGrant | undefined;
	grantsForPubkey(pubkey: string): ObpKeyGrant[];
}

/**
 * Verify that `grant` authorizes `action` on `documentType` for `amount`
 * at time `at`. Returns null when authorized, otherwise a structured error.
 *
 * Scope checks answer *authority*; spend ceilings and approval workflows
 * live in `policy.ts`, which layers on top of this result.
 */
export function checkGrant(
	grant: ObpKeyGrant,
	documentType: ObpDocumentType,
	action: ObpAction,
	at: Date = new Date()
): ObpError | null {
	if (grant.revokedAt && Date.parse(grant.revokedAt) <= at.getTime()) {
		return { code: 'OBP-E05', message: `grant ${grant.grantId} revoked` };
	}
	if (grant.validFrom && Date.parse(grant.validFrom) > at.getTime()) {
		return { code: 'OBP-E05', message: `grant ${grant.grantId} not yet valid` };
	}
	if (grant.validUntil && Date.parse(grant.validUntil) <= at.getTime()) {
		return { code: 'OBP-E05', message: `grant ${grant.grantId} expired` };
	}
	if (
		!grant.scope.documentTypes.includes('*') &&
		!grant.scope.documentTypes.includes(documentType)
	) {
		return {
			code: 'OBP-E06',
			message: `grant ${grant.grantId} not scoped for documentType ${documentType}`
		};
	}
	if (!grant.scope.actions.includes('*') && !grant.scope.actions.includes(action)) {
		return { code: 'OBP-E06', message: `grant ${grant.grantId} not scoped for action ${action}` };
	}
	return null;
}

/** In-memory registry for pilots and tests; swap for a persisted one. */
export class MemoryObpRegistry implements ObpRegistry {
	private orgs = new Map<string, ObpOrganization>();
	private grants = new Map<string, ObpKeyGrant>();
	private byPubkey = new Map<string, Set<string>>();

	trustOrganization(org: ObpOrganization, grants: ObpKeyGrant[] = []): void {
		this.orgs.set(org.orgId, org);
		for (const g of grants) this.addGrant(g);
	}

	getOrganization(orgId: string): ObpOrganization | undefined {
		return this.orgs.get(orgId);
	}

	revokeGrant(grantId: string, at = new Date().toISOString()): void {
		const g = this.grants.get(grantId);
		if (g) g.revokedAt = at;
	}

	getGrant(grantId: string): ObpKeyGrant | undefined {
		return this.grants.get(grantId);
	}

	grantsForPubkey(pubkey: string): ObpKeyGrant[] {
		const ids = this.byPubkey.get(pubkey);
		if (!ids) return [];
		return Array.from(ids, (id) => this.grants.get(id)!).filter(Boolean);
	}

	private addGrant(grant: ObpKeyGrant): void {
		this.grants.set(grant.grantId, grant);
		let ids = this.byPubkey.get(grant.pubkey);
		if (!ids) {
			ids = new Set();
			this.byPubkey.set(grant.pubkey, ids);
		}
		ids.add(grant.grantId);
	}
}

/**
 * Resolve the signing authority for an inbound envelope: the issuer org
 * must be trusted, and some *unrevoked, valid* grant of that org must
 * match the signature pubkey, signerKeyId, action and document type.
 */
export function verifyDelegation(
	registry: ObpRegistry,
	input: {
		issuer: string;
		signerKeyId: string;
		pubkey: string;
		documentType: ObpDocumentType;
		action: ObpAction;
		at?: Date;
	}
): { grant: ObpKeyGrant } | { error: ObpError } {
	const at = input.at ?? new Date();
	const org = registry.getOrganization(input.issuer);
	if (!org) return { error: { code: 'OBP-E03', message: `issuer ${input.issuer} not trusted` } };

	const candidates = registry
		.grantsForPubkey(input.pubkey)
		.filter((g) => g.orgId === input.issuer && g.grantId === input.signerKeyId);
	if (candidates.length === 0) {
		return {
			error: {
				code: 'OBP-E04',
				message: `signerKeyId ${input.signerKeyId} unknown for ${input.issuer}`
			}
		};
	}
	for (const grant of candidates) {
		const failure = checkGrant(grant, input.documentType, input.action, at);
		if (!failure) return { grant };
	}
	const first = candidates[0];
	const failure = checkGrant(first, input.documentType, input.action, at)!;
	return { error: failure };
}
