/**
 * OBP-over-Nostr binding tests — the same contract over the second
 * transport: NIP-44-encrypted envelopes through an in-memory relay hub,
 * durable KV stores, and the full purchasing flow between two
 * independent nodes that share no database.
 */
import { describe, expect, it } from 'vitest';
import { createNostrPilot } from './testing/harness';
import { nip44 } from 'nostr-tools';
import { OBP_NOSTR_KIND } from './node/nostr-transport';

const BEANS = [{ description: 'Arabica beans 1kg', quantity: 10, unit: 'kg', unitPriceMinor: 85_000 }];

describe('Nostr transport binding', () => {
	it('completes RFQ → quote → order over relays with KV-durable stores', async () => {
		const pilot = createNostrPilot();
		try {
			const rfq = await pilot.buyer.node.issue({
				documentType: 'rfq',
				signerKeyId: pilot.buyer.keys.staff.grantId,
				recipient: 'org:seller',
				currency: 'LAK',
				lines: BEANS
			});
			await settle();
			let doc = await pilot.seller.node.getDocument(rfq.envelope.documentId);
			expect(doc?.state).toBe('issued');

			await pilot.seller.node.respond({
				documentId: rfq.envelope.documentId,
				action: 'accept',
				signerKeyId: pilot.seller.keys.owner.grantId
			});
			await settle();
			doc = await pilot.buyer.node.getDocument(rfq.envelope.documentId);
			expect(doc?.state).toBe('accepted');

			const quote = await pilot.seller.node.issue({
				documentType: 'quote',
				signerKeyId: pilot.seller.keys.owner.grantId,
				recipient: 'org:buyer',
				currency: 'LAK',
				lines: BEANS,
				references: [{ documentId: rfq.envelope.documentId, documentType: 'rfq' }]
			});
			await settle();
			doc = await pilot.buyer.node.getDocument(quote.envelope.documentId);
			expect(doc?.state).toBe('issued');

			await pilot.buyer.node.respond({
				documentId: quote.envelope.documentId,
				action: 'accept',
				signerKeyId: pilot.buyer.keys.owner.grantId
			});
			await settle();
			const po = await pilot.buyer.node.issue({
				documentType: 'purchase_order',
				signerKeyId: pilot.buyer.keys.owner.grantId,
				recipient: 'org:seller',
				currency: 'LAK',
				lines: BEANS,
				references: [{ documentId: quote.envelope.documentId, documentType: 'quote' }]
			});
			await settle();
			doc = await pilot.seller.node.getDocument(po.envelope.documentId);
			expect(doc?.state).toBe('issued');
		} finally {
			pilot.close();
		}
	});

	it('the relay never sees plaintext business documents', async () => {
		const pilot = createNostrPilot();
		try {
			const rfq = await pilot.buyer.node.issue({
				documentType: 'rfq',
				signerKeyId: pilot.buyer.keys.staff.grantId,
				recipient: 'org:seller',
				currency: 'LAK',
				lines: BEANS
			});
			await settle();
			expect(pilot.hub.published.length).toBeGreaterThan(0);
			for (const event of pilot.hub.published) {
				expect(event.kind).toBe(OBP_NOSTR_KIND);
				expect(event.content).not.toContain(rfq.envelope.documentId);
				expect(event.content).not.toContain('Arabica');
				expect(event.content).not.toContain('"protocol"');
				// NIP-44 ciphertext is base64 payload data.
				expect(() => JSON.parse(event.content)).toThrow();
			}
		} finally {
			pilot.close();
		}
	});

	it('the counterparty can decrypt with the conversation key (sanity)', async () => {
		const pilot = createNostrPilot();
		try {
			const rfq = await pilot.buyer.node.issue({
				documentType: 'rfq',
				signerKeyId: pilot.buyer.keys.staff.grantId,
				recipient: 'org:seller',
				currency: 'LAK',
				lines: BEANS
			});
			await settle();
			const event = pilot.hub.published[0];
			expect(event.pubkey).toBe(pilot.transportKeys.buyer.pubkey);

			// Seller-side decryption, exactly as bindNostrInbox does it.
			const conversationKey = nip44.getConversationKey(
				pilot.transportKeys.seller.secretKey,
				event.pubkey
			);
			const envelope = JSON.parse(nip44.v2.decrypt(event.content, conversationKey));
			expect(envelope.protocol).toBe('obp');
			expect(envelope.documentType).toBe('rfq');
			expect(envelope.messageId).toBe(rfq.envelope.messageId);
		} finally {
			pilot.close();
		}
	});

	it('refuses delivery to unlisted recipients (fail closed routing)', async () => {
		const pilot = createNostrPilot();
		try {
			const result = await pilot.buyer.node.issue({
				documentType: 'rfq',
				signerKeyId: pilot.buyer.keys.staff.grantId,
				recipient: 'org:unknown',
				currency: 'LAK',
				lines: BEANS
			});
			expect(result.delivered).toBe(false);
			expect(result.transportError).toBe('unknown-recipient');
			// The envelope stays queued in the outbox, undelivered.
			const pending = await pilot.buyer.node.pendingOutbox();
			expect(pending).toHaveLength(1);
			expect(pending[0].lastError).toBe('unknown-recipient');
		} finally {
			pilot.close();
		}
	});

	it('rejection checks still apply over the relay path (tampered payload)', async () => {
		const pilot = createNostrPilot();
		try {
			const rfq = await pilot.buyer.node.issue({
				documentType: 'rfq',
				signerKeyId: pilot.buyer.keys.staff.grantId,
				recipient: 'org:seller',
				currency: 'LAK',
				lines: BEANS
			});
			await settle();
			const forged = { ...rfq.envelope, note: 'nostr-tamper' };
			const result = await pilot.seller.node.receive(forged);
			expect(result.decision).toBe('rejected');
			expect(result.error?.code).toBe('OBP-E02');
		} finally {
			pilot.close();
		}
	});
});

/** Wait for hub fanout (microtask) to settle. */
async function settle(): Promise<void> {
	await new Promise((r) => setTimeout(r, 0));
	await new Promise((r) => setTimeout(r, 0));
}
