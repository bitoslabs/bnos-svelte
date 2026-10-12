/**
 * OBP contract unit tests: canonical encoding, hashing, signatures and
 * schema validation. These are the "versioned OBP schemas and signed
 * fixtures" deliverable from `docs/OBP_SYSTEM_PLAN.md`.
 */
import { describe, expect, it } from 'vitest';
import { canonicalJson, envelopePayloadHash, verifyPayloadHash } from './canonical';
import { generateSigningKey, signEnvelope, verifyEnvelopeSignature } from './signature';
import { validateEnvelope } from './validate';
import type { ObpUnsignedEnvelope } from './types';

describe('canonical JSON', () => {
	it('sorts keys deterministically at every level', () => {
		const a = canonicalJson({ b: 1, a: { d: [3, { z: 1, c: 2 }], c: 'x' } });
		const b = canonicalJson({ a: { c: 'x', d: [3, { c: 2, z: 1 }] }, b: 1 });
		expect(a).toBe(b);
		expect(a).toBe('{"a":{"c":"x","d":[3,{"c":2,"z":1}]},"b":1}');
	});

	it('emits no whitespace', () => {
		expect(canonicalJson({ x: [1, 2], y: 's' })).toBe('{"x":[1,2],"y":"s"}');
	});

	it('escapes control characters and quotes minimally', () => {
		expect(canonicalJson({ s: 'a"b\\c\nd' })).toBe('{"s":"a\\"b\\\\c\\nd"}');
		expect(canonicalJson({ s: '\u0000' })).toBe('{"s":"\\u0000"}');
	});

	it('rejects non-safe integers', () => {
		expect(() => canonicalJson({ n: 1.5 })).toThrow();
		expect(() => canonicalJson({ n: Number.MAX_SAFE_INTEGER + 1 })).toThrow();
		expect(() => canonicalJson({ n: null })).toThrow();
	});

	it('drops undefined-valued keys', () => {
		expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
	});
});

describe('envelope hashing and signatures', () => {
	const draft = baseDraft();

	it('hash is stable across key order and omitted undefined fields', () => {
		const reordered = { ...draft, note: undefined };
		expect(envelopePayloadHash(draft)).toBe(envelopePayloadHash(reordered));
	});

	it('sign + verify roundtrip succeeds and tampering fails', () => {
		const { secretKey, pubkey } = generateSigningKey();
		const signed = signEnvelope(draft, secretKey);
		expect(verifyPayloadHash(signed)).toBe(true);
		expect(verifyEnvelopeSignature(signed, pubkey)).toBe(true);

		const tampered = { ...signed, totalsMinor: signed.totalsMinor + 1 };
		expect(verifyPayloadHash(tampered)).toBe(false);
		// A "fixed-up" hash over tampered bytes still fails signature check.
		const rehashed = { ...tampered, payloadHash: envelopePayloadHash(tampered) };
		expect(verifyEnvelopeSignature(rehashed, pubkey)).toBe(false);
	});

	it('verification fails with the wrong key', () => {
		const { secretKey } = generateSigningKey();
		const other = generateSigningKey();
		const signed = signEnvelope(draft, secretKey);
		expect(verifyEnvelopeSignature(signed, other.pubkey)).toBe(false);
	});

	it('different drafts produce different hashes', () => {
		expect(envelopePayloadHash(draft)).not.toBe(
			envelopePayloadHash({ ...draft, documentId: 'doc-2' })
		);
	});
});

describe('envelope schema validation', () => {
	it('accepts a valid draft once signed fields are stubbed', () => {
		const { secretKey, pubkey } = generateSigningKey();
		const signed = { ...signEnvelope(baseDraft(), secretKey), signerPubkey: pubkey };
		expect(validateEnvelope(signed)).toBeNull();
	});

	it('rejects wrong protocol/version', () => {
		expect(codeFor({ protocol: 'nostr' })).toBe('OBP-E01');
		expect(codeFor({ version: '0.2' })).toBe('OBP-E01');
	});

	it('rejects unknown document types and actions', () => {
		expect(codeFor({ documentType: 'shipment' })).toBe('OBP-E01');
		expect(codeFor({ action: 'amend' })).toBe('OBP-E01');
	});

	it('rejects totals that do not match line math', () => {
		expect(codeFor({ totalsMinor: 999 })).toBe('OBP-E01');
	});

	it('rejects unregistered currencies', () => {
		expect(codeFor({ currency: 'XXX' })).toBe('OBP-E01');
	});

	it('rejects issue actions without lines but allows empty lines on responses', () => {
		const noLines = { ...baseDraft(), lines: [], totalsMinor: 0 };
		expect(codeFor(noLines)).toBe('OBP-E01');
		const response = { ...noLines, action: 'accept' as const };
		expect(codeFor(response)).toBeNull();
	});

	it('rejects expiry before creation', () => {
		expect(codeFor({ createdAt: '2026-10-07T10:00:00Z', expiresAt: '2026-10-07T09:00:00Z' })).toBe(
			'OBP-E01'
		);
	});
});

function codeFor(patch: Record<string, unknown>): string | null {
	const { secretKey, pubkey } = generateSigningKey();
	const draft = { ...baseDraft(), ...patch } as ObpUnsignedEnvelope;
	const signed = { ...signEnvelope(draft, secretKey), signerPubkey: pubkey };
	return validateEnvelope(signed)?.code ?? null;
}

function baseDraft(): ObpUnsignedEnvelope {
	return {
		protocol: 'obp',
		version: '0.1',
		messageId: 'msg-1',
		documentId: 'doc-1',
		documentType: 'rfq',
		action: 'issue',
		issuer: 'org:buyer',
		signerKeyId: 'buyer:staff',
		signerPubkey: '',
		recipient: 'org:seller',
		createdAt: '2026-10-07T10:00:00Z',
		expiresAt: '2026-10-14T10:00:00Z',
		currency: 'LAK',
		lines: [{ description: 'Arabica beans 1kg', quantity: 10, unit: 'kg', unitPriceMinor: 85_000 }],
		totalsMinor: 850_000,
		references: []
	};
}
