/**
 * Identity delegation, lifecycle rules and policy engine tests.
 */
import { describe, expect, it } from 'vitest';
import {
	MemoryObpRegistry,
	checkGrant,
	verifyDelegation,
	type ObpKeyGrant
} from './identity';
import { DefaultObpPolicy } from './policy';
import type { ObpUnsignedEnvelope } from './types';

const grant = (patch: Partial<ObpKeyGrant>): ObpKeyGrant => ({
	grantId: 'g1',
	orgId: 'org:a',
	pubkey: 'a'.repeat(64),
	role: 'staff',
	scope: { documentTypes: ['*'], actions: ['*'] },
	...patch
});

describe('key grants', () => {
	it('allows in-scope, valid grants', () => {
		expect(
			checkGrant(grant({}), 'invoice', 'issue', new Date('2026-10-07T00:00:00Z'))
		).toBeNull();
	});

	it('rejects revoked, future and expired grants', () => {
		const at = new Date('2026-10-07T00:00:00Z');
		expect(checkGrant(grant({ revokedAt: '2026-10-06T00:00:00Z' }), 'invoice', 'issue', at)?.code).toBe('OBP-E05');
		expect(checkGrant(grant({ validFrom: '2026-10-08T00:00:00Z' }), 'invoice', 'issue', at)?.code).toBe('OBP-E05');
		expect(checkGrant(grant({ validUntil: '2026-10-07T00:00:00Z' }), 'invoice', 'issue', at)?.code).toBe('OBP-E05');
	});

	it('rejects out-of-scope document types and actions', () => {
		const at = new Date('2026-10-07T00:00:00Z');
		const scoped = grant({
			scope: { documentTypes: ['rfq', 'quote'], actions: ['issue'] }
		});
		expect(checkGrant(scoped, 'rfq', 'issue', at)).toBeNull();
		expect(checkGrant(scoped, 'invoice', 'issue', at)?.code).toBe('OBP-E06');
		expect(checkGrant(scoped, 'rfq', 'accept', at)?.code).toBe('OBP-E06');
	});
});

describe('delegation verification', () => {
	it('resolves a matching grant and rejects unknown issuers/signers', () => {
		const registry = new MemoryObpRegistry();
		registry.trustOrganization({ orgId: 'org:a', name: 'A', ownerPubkey: 'a'.repeat(64) }, [
			grant({ scope: { documentTypes: ['rfq'], actions: ['issue'] } })
		]);
		const ok = verifyDelegation(registry, {
			issuer: 'org:a',
			signerKeyId: 'g1',
			pubkey: 'a'.repeat(64),
			documentType: 'rfq',
			action: 'issue'
		});
		expect('grant' in ok).toBe(true);

		expect(
			'error' in verifyDelegation(registry, {
				issuer: 'org:unknown',
				signerKeyId: 'g1',
				pubkey: 'a'.repeat(64),
				documentType: 'rfq',
				action: 'issue'
			})
		).toBe(true);
		expect(
			'error' in
				verifyDelegation(registry, {
					issuer: 'org:a',
					signerKeyId: 'nope',
					pubkey: 'a'.repeat(64),
					documentType: 'rfq',
					action: 'issue'
				})
		).toBe(true);
	});
});

describe('default policy', () => {
	const policy = new DefaultObpPolicy();
	const base: ObpUnsignedEnvelope = {
		protocol: 'obp',
		version: '0.1',
		messageId: 'm',
		documentId: 'd',
		documentType: 'purchase_order',
		action: 'issue',
		issuer: 'org:a',
		signerKeyId: 'g1',
		signerPubkey: 'a'.repeat(64),
		recipient: 'org:b',
		createdAt: '2026-10-07T00:00:00Z',
		expiresAt: '2026-10-14T00:00:00Z',
		currency: 'LAK',
		lines: [{ description: 'beans', quantity: 1, unit: 'kg', unitPriceMinor: 4_000_000 }],
		totalsMinor: 4_000_000,
		references: []
	};

	it('owner may issue purchase orders directly', () => {
		const r = policy.evaluate(base, grant({ role: 'owner' }), {});
		expect(r.decision).toBe('allow');
	});

	it('staff purchase orders always require human approval in v0.1', () => {
		const r = policy.evaluate(base, grant({ role: 'staff' }), {});
		expect(r.decision).toBe('requires_approval');
	});

	it('over-limit purchase orders require approval even for owners', () => {
		const g = grant({
			role: 'owner',
			scope: { documentTypes: ['*'], actions: ['*'], maxAmountMinor: 1_000_000, currency: 'LAK' }
		});
		expect(policy.evaluate(base, g, {}).decision).toBe('requires_approval');
	});

	it('never converts between limit currencies', () => {
		const g = grant({
			role: 'owner',
			scope: { documentTypes: ['*'], actions: ['*'], maxAmountMinor: 5_000_000, currency: 'THB' }
		});
		const r = policy.evaluate({ ...base, currency: 'THB' }, g, {});
		// envelope is THB and limit is THB: under limit → allow
		expect(r.decision).toBe('allow');
		// A LAK envelope against a THB limit is denied, never converted.
		const mismatch = policy.evaluate(base, g, {});
		expect(mismatch.decision).toBe('deny');
		expect(mismatch.error?.code).toBe('OBP-E12');
	});

	it('agents may only draft rfqs', () => {
		const agent = grant({ role: 'agent', scope: { documentTypes: ['rfq'], actions: ['issue'] } });
		expect(policy.evaluate({ ...base, documentType: 'rfq' }, agent, {}).decision).toBe('allow');
		const r = policy.evaluate(base, agent, {});
		expect(r.decision).toBe('deny');
	});

	it('every non-owner payment requires human approval; owner signing is the approval', () => {
		const evidence: ObpUnsignedEnvelope = {
			...base,
			documentType: 'payment_evidence',
			settlement: { method: 'lightning', externalId: 'preimage-hash' }
		};
		expect(policy.evaluate(evidence, grant({ role: 'owner' }), {}).decision).toBe('allow');
		expect(policy.evaluate(evidence, grant({ role: 'staff' }), {}).decision).toBe(
			'requires_approval'
		);
		expect(
			policy.evaluate(evidence, grant({ role: 'staff' }), { hasHumanApproval: true }).decision
		).toBe('allow');
	});

	it('daily spend limit denies before approval is considered', () => {
		const evidence: ObpUnsignedEnvelope = {
			...base,
			documentType: 'payment_evidence',
			totalsMinor: 4_000_000,
			settlement: { method: 'lightning', externalId: 'x' }
		};
		const g = grant({
			role: 'owner',
			scope: { documentTypes: ['*'], actions: ['*'], dailyLimitMinor: 5_000_000 }
		});
		const r = policy.evaluate(evidence, g, { approvedTodayMinor: 2_000_000, hasHumanApproval: true });
		expect(r.decision).toBe('deny');
		expect(r.error?.code).toBe('OBP-E12');
	});
});
