import { describe, it, expect } from 'vitest';
import { finalizeEvent, generateSecretKey, type Event } from 'nostr-tools/pure';
import {
	buildZapRequest,
	zapReceiptMatches,
	zapReceiptPreimage,
	ZAP_REQUEST_KIND,
	ZAP_RECEIPT_KIND
} from './zap-receipts';

const PK64 = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const PR = 'lnbc1000n1pxyzqq';

/** Fabricate a kind 9735 zap receipt the way zappers publish them. */
function receipt(opts: { requestId?: string; bolt11?: string; preimage?: string }): Event {
	const tags: string[][] = [['p', PK64]];
	if (opts.requestId !== undefined)
		tags.push(['description', JSON.stringify({ id: opts.requestId, kind: ZAP_REQUEST_KIND })]);
	if (opts.bolt11 !== undefined) tags.push(['bolt11', opts.bolt11]);
	if (opts.preimage !== undefined) tags.push(['preimage', opts.preimage]);
	return finalizeEvent(
		{ kind: ZAP_RECEIPT_KIND, created_at: Math.floor(Date.now() / 1000), tags, content: '' },
		generateSecretKey()
	);
}

describe('buildZapRequest', () => {
	it('signs a valid anonymous kind 9734', () => {
		const zap = buildZapRequest({
			recipientPubkey: PK64,
			amountMsat: 25_000,
			relays: ['wss://nos.lol', 'wss://relay.damus.io'],
			memo: 'BNOS sale'
		});
		expect(zap.kind).toBe(ZAP_REQUEST_KIND);
		expect(zap.id).toMatch(/^[0-9a-f]{64}$/);
		expect(zap.pubkey).toMatch(/^[0-9a-f]{64}$/); // fresh anonymous key
		expect(zap.sig).toMatch(/^[0-9a-f]{128}$/);
		expect(zap.tags).toContainEqual(['p', PK64]);
		expect(zap.tags).toContainEqual(['amount', '25000']);
		expect(zap.tags).toContainEqual(['relays', 'wss://nos.lol', 'wss://relay.damus.io']);
		expect(zap.content).toBe('BNOS sale');
	});

	it('uses a fresh key per request (anonymous, unlinkable)', () => {
		const a = buildZapRequest({ recipientPubkey: PK64, amountMsat: 1000, relays: ['wss://x'] });
		const b = buildZapRequest({ recipientPubkey: PK64, amountMsat: 1000, relays: ['wss://x'] });
		expect(a.pubkey).not.toBe(b.pubkey);
	});
});

describe('zapReceiptMatches', () => {
	it('matches by embedded 9734 id (primary path)', () => {
		const zap = buildZapRequest({ recipientPubkey: PK64, amountMsat: 1000, relays: ['wss://x'] });
		const r = receipt({ requestId: zap.id });
		expect(zapReceiptMatches(r, { requestId: zap.id, pr: PR })).toBe(true);
	});

	it('rejects a receipt for a different request', () => {
		const r = receipt({ requestId: 'f'.repeat(64) });
		expect(zapReceiptMatches(r, { requestId: 'e'.repeat(64), pr: PR })).toBe(false);
	});

	it('falls back to bolt11 equality when the description is malformed', () => {
		const r = receipt({ bolt11: PR.toUpperCase() });
		expect(zapReceiptMatches(r, { requestId: 'e'.repeat(64), pr: PR })).toBe(true); // case-insensitive
		const other = receipt({ bolt11: 'lnbc9999n1other' });
		expect(zapReceiptMatches(other, { requestId: 'e'.repeat(64), pr: PR })).toBe(false);
	});

	it('ignores non-9735 events', () => {
		const note = finalizeEvent(
			{ kind: 1, created_at: 1, tags: [['p', PK64]], content: PR },
			generateSecretKey()
		);
		expect(zapReceiptMatches(note, { requestId: 'e'.repeat(64), pr: PR })).toBe(false);
	});
});

describe('zapReceiptPreimage', () => {
	it('extracts the preimage tag when present', () => {
		expect(zapReceiptPreimage(receipt({ bolt11: PR, preimage: 'ab'.repeat(32) }))).toBe('ab'.repeat(32));
		expect(zapReceiptPreimage(receipt({ bolt11: PR }))).toBeUndefined();
	});
});
