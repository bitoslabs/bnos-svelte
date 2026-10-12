/**
 * Two-node conformance fixtures — the v0.1 vertical slice.
 *
 * Implements the go/no-go checks from `docs/OBP_SYSTEM_PLAN.md`:
 *
 * 1. Two independently configured nodes complete RFQ → quote → purchase
 *    order → invoice → payment evidence → receipt without a shared
 *    database or internal API calls.
 * 2. Both reject bad signatures, unknown/revoked signers, wrong
 *    recipient, expired quotes, replayed ids, invalid transitions and
 *    mismatched document hashes.
 * 3. Restarts/offline intervals lose nothing and duplicate nothing.
 * 4. Confidential documents fail closed when the transport cannot encrypt.
 * 5. Payment stays pending until settlement is verified; receipts on
 *    unverified payments are rejected.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
	createTwoNodePilot,
	settleDelivery,
	TestClock,
	type PilotNode,
	type TwoNodePilot
} from './testing/harness';
import { ObpApprovalRequiredError, type SendResult } from './node/business-node';
import { generateSigningKey, signEnvelope } from './index';
import type { ObpEnvelope, ObpUnsignedEnvelope } from './types';

const BEANS = [
	{ description: 'Arabica beans 1kg', quantity: 10, unit: 'kg', unitPriceMinor: 85_000 }
];
const TOTAL = 850_000;

let pilot: TwoNodePilot;

beforeEach(() => {
	pilot = createTwoNodePilot();
});

// ── Flow helpers ─────────────────────────────────────────────────

async function state(p: PilotNode, id: string): Promise<string | undefined> {
	return (await p.node.getDocument(id))?.state;
}

async function accept(p: PilotNode, id: string): Promise<void> {
	await p.node.respond({ documentId: id, action: 'accept', signerKeyId: p.keys.owner.grantId });
	await settleDelivery();
}

/** RFQ issued and accepted by the seller. */
async function flowRfq(): Promise<ObpEnvelope> {
	const rfq = await pilot.buyer.node.issue({
		documentType: 'rfq',
		signerKeyId: pilot.buyer.keys.staff.grantId,
		recipient: 'org:seller',
		currency: 'LAK',
		lines: BEANS
	});
	await settleDelivery();
	await accept(pilot.seller, rfq.envelope.documentId);
	return rfq.envelope;
}

/** Accepted RFQ → quoted and quote-accepted. */
async function flowQuote(rfq: ObpEnvelope): Promise<ObpEnvelope> {
	const quote = await pilot.seller.node.issue({
		documentType: 'quote',
		signerKeyId: pilot.seller.keys.owner.grantId,
		recipient: 'org:buyer',
		currency: 'LAK',
		lines: BEANS,
		references: [{ documentId: rfq.documentId, documentType: 'rfq', hash: rfq.payloadHash }],
		deliveryTerms: { method: 'delivery', place: 'Vientiane', leadTimeDays: 3 }
	});
	await settleDelivery();
	await accept(pilot.buyer, quote.envelope.documentId);
	return quote.envelope;
}

/** Accepted quote → purchase order issued and accepted. */
async function flowOrder(quote: ObpEnvelope): Promise<ObpEnvelope> {
	const po = await pilot.buyer.node.issue({
		documentType: 'purchase_order',
		signerKeyId: pilot.buyer.keys.owner.grantId,
		recipient: 'org:seller',
		currency: 'LAK',
		lines: BEANS,
		references: [{ documentId: quote.documentId, documentType: 'quote', hash: quote.payloadHash }]
	});
	await settleDelivery();
	await accept(pilot.seller, po.envelope.documentId);
	return po.envelope;
}

/** Accepted order → invoice issued and accepted. */
async function flowInvoice(po: ObpEnvelope): Promise<ObpEnvelope> {
	const invoice = await pilot.seller.node.issue({
		documentType: 'invoice',
		signerKeyId: pilot.seller.keys.owner.grantId,
		recipient: 'org:buyer',
		currency: 'LAK',
		lines: BEANS,
		references: [
			{ documentId: po.documentId, documentType: 'purchase_order', hash: po.payloadHash }
		],
		taxMinor: 0
	});
	await settleDelivery();
	await accept(pilot.buyer, invoice.envelope.documentId);
	return invoice.envelope;
}

/** Accepted invoice → owner-signed payment evidence. */
async function flowPayment(invoice: ObpEnvelope, externalId: string): Promise<ObpEnvelope> {
	const payment = await pilot.buyer.node.issue({
		documentType: 'payment_evidence',
		signerKeyId: pilot.buyer.keys.owner.grantId,
		recipient: 'org:seller',
		currency: 'LAK',
		lines: [],
		totalsMinor: TOTAL,
		references: [
			{ documentId: invoice.documentId, documentType: 'invoice', hash: invoice.payloadHash }
		],
		settlement: { method: 'lightning', externalId }
	});
	await settleDelivery();
	return payment.envelope;
}

/** Full happy path; asserts each leg landed on both nodes. */
async function runFullFlow() {
	const rfq = await flowRfq();
	const quote = await flowQuote(rfq);
	const po = await flowOrder(quote);
	const invoice = await flowInvoice(po);
	const payment = await flowPayment(invoice, 'ln-hash-1');
	const receipt = await pilot.seller.node.issue({
		documentType: 'receipt',
		signerKeyId: pilot.seller.keys.owner.grantId,
		recipient: 'org:buyer',
		currency: 'LAK',
		lines: [],
		totalsMinor: TOTAL,
		references: [
			{ documentId: invoice.documentId, documentType: 'invoice', hash: invoice.payloadHash },
			{
				documentId: payment.documentId,
				documentType: 'payment_evidence',
				hash: payment.payloadHash
			}
		]
	});
	await settleDelivery();
	return { rfq, quote, po, invoice, payment, receipt: receipt.envelope };
}

/** A schema-valid RFQ draft, ready to sign for crafted fixture messages. */
function rfqDraft(patch: Partial<ObpUnsignedEnvelope> = {}): ObpUnsignedEnvelope {
	return {
		protocol: 'obp',
		version: '0.1',
		messageId: `msg-${crypto.randomUUID()}`,
		documentId: `doc-${crypto.randomUUID()}`,
		documentType: 'rfq',
		action: 'issue',
		issuer: 'org:buyer',
		signerKeyId: 'buyer:staff',
		signerPubkey: '',
		recipient: 'org:seller',
		createdAt: new Date().toISOString(),
		expiresAt: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
		currency: 'LAK',
		lines: BEANS,
		totalsMinor: TOTAL,
		references: [],
		...patch
	};
}

// ── Vertical slice ───────────────────────────────────────────────

describe('two-node vertical slice', () => {
	it('completes RFQ → quote → order → invoice → payment → receipt', async () => {
		const ids = await runFullFlow();

		// Buyer and seller projections agree on every terminal state, with
		// independent stores and independent settlement verification.
		for (const side of [pilot.buyer, pilot.seller]) {
			expect(await state(side, ids.rfq.documentId)).toBe('accepted');
			expect(await state(side, ids.quote.documentId)).toBe('accepted');
			expect(await state(side, ids.po.documentId)).toBe('accepted');
			expect(await state(side, ids.invoice.documentId)).toBe('paid');
			expect((await side.node.getDocument(ids.invoice.documentId))?.settlement).toBe('verified');
			expect(await state(side, ids.receipt.documentId)).toBe('issued');
		}

		// Append-only logs on both sides.
		expect(
			(await pilot.buyer.node.getDocumentLog(ids.rfq.documentId)).map(
				(m) => `${m.envelope.action}:${m.decision}`
			)
		).toEqual(['issue:accepted', 'accept:accepted']);
		expect(await pilot.seller.node.getDocumentLog(ids.invoice.documentId)).toHaveLength(2);

		// No outbox entries are left undelivered.
		expect(await pilot.buyer.node.pendingOutbox()).toHaveLength(0);
		expect(await pilot.seller.node.pendingOutbox()).toHaveLength(0);
	});

	it('runs on independent stores, keys and registries', () => {
		expect(pilot.buyer.node).not.toBe(pilot.seller.node);
		expect(pilot.buyer.registry).not.toBe(pilot.seller.registry);
		expect(pilot.buyer.keys.owner.secretKey).not.toBe(pilot.seller.keys.owner.secretKey);
	});
});

// ── Go/no-go rejection fixtures ──────────────────────────────────

describe('rejection fixtures', () => {
	it('rejects a tampered payload (OBP-E02)', async () => {
		const rfq = await pilot.buyer.node.issue({
			documentType: 'rfq',
			signerKeyId: pilot.buyer.keys.staff.grantId,
			recipient: 'org:seller',
			currency: 'LAK',
			lines: BEANS
		});
		// Schema-valid tampering: the note changes, the signature no longer
		// covers the bytes on the wire.
		const forged: ObpEnvelope = { ...rfq.envelope, note: 'actually, double it' };
		const result = await pilot.seller.node.receive(forged);
		expect(result.decision).toBe('rejected');
		expect(result.error?.code).toBe('OBP-E02');
	});

	it('rejects an unknown signer (OBP-E04)', async () => {
		// Properly signed by a key that has no grant anywhere.
		const stranger = generateSigningKey();
		const signed = signEnvelope(
			rfqDraft({ signerKeyId: 'buyer:ghost', signerPubkey: stranger.pubkey }),
			stranger.secretKey
		);
		const result = await pilot.seller.node.receive(signed);
		expect(result.decision).toBe('rejected');
		expect(result.error?.code).toBe('OBP-E04');
	});

	it('rejects a revoked signer (OBP-E05)', async () => {
		const rfq = await pilot.buyer.node.issue({
			documentType: 'rfq',
			signerKeyId: pilot.buyer.keys.staff.grantId,
			recipient: 'org:seller',
			currency: 'LAK',
			lines: BEANS
		});
		await settleDelivery();
		pilot.seller.registry.revokeGrant('buyer:staff');
		const replay = await pilot.seller.node.receive(rfq.envelope);
		expect(replay.decision).toBe('rejected');
		expect(replay.error?.code).toBe('OBP-E05');
	});

	it('rejects messages addressed to another node (OBP-E07)', async () => {
		// Properly signed by a trusted grant — but for someone else.
		const misaddressed = signEnvelope(
			rfqDraft({
				recipient: 'org:someone-else',
				signerPubkey: pilot.buyer.keys.staff.pubkey
			}),
			pilot.buyer.keys.staff.secretKey
		);
		const result = await pilot.seller.node.receive(misaddressed);
		expect(result.decision).toBe('rejected');
		expect(result.error?.code).toBe('OBP-E07');
	});

	it('rejects purchase orders against expired quotes (OBP-E15)', async () => {
		const clock = new TestClock();
		pilot = createTwoNodePilot({ now: clock.now });
		const { buyer, seller } = pilot;

		const rfq = await buyer.node.issue({
			documentType: 'rfq',
			signerKeyId: buyer.keys.staff.grantId,
			recipient: 'org:seller',
			currency: 'LAK',
			lines: BEANS
		});
		await settleDelivery();
		await accept(seller, rfq.envelope.documentId);
		// One-hour quote validity (clock starts at 08:00Z).
		const quote = await seller.node.issue({
			documentType: 'quote',
			signerKeyId: seller.keys.owner.grantId,
			recipient: 'org:buyer',
			currency: 'LAK',
			lines: BEANS,
			references: [{ documentId: rfq.envelope.documentId, documentType: 'rfq' }],
			expiresAt: new Date(Date.parse('2026-10-07T09:00:00Z')).toISOString()
		});
		await settleDelivery();
		await accept(buyer, quote.envelope.documentId);

		// Two hours later the quote is expired: the buyer's own node refuses
		// to issue an order against it.
		clock.advance(2 * 3600_000);
		await expect(
			buyer.node.issue({
				documentType: 'purchase_order',
				signerKeyId: buyer.keys.owner.grantId,
				recipient: 'org:seller',
				currency: 'LAK',
				lines: BEANS,
				references: [{ documentId: quote.envelope.documentId, documentType: 'quote' }]
			})
		).rejects.toMatchObject({ error: { code: 'OBP-E15' } });

		// The seller independently rejects a properly signed order that
		// references the expired quote (delivered out-of-band).
		const poDraft = rfqDraft({
			documentType: 'purchase_order',
			signerKeyId: 'buyer:owner',
			signerPubkey: buyer.keys.owner.pubkey,
			references: [{ documentId: quote.envelope.documentId, documentType: 'quote' }]
		});
		poDraft.createdAt = new Date(Date.parse('2026-10-07T10:00:00Z')).toISOString();
		poDraft.expiresAt = new Date(Date.parse('2026-10-07T11:00:00Z')).toISOString();
		const forgedPo = signEnvelope(poDraft, buyer.keys.owner.secretKey);
		const result = await seller.node.receive(forgedPo);
		expect(result.decision).toBe('rejected');
		expect(result.error?.code).toBe('OBP-E15');
	});

	it('replayed messages return the same decision without side effects', async () => {
		// Transport acks but loses the first copy: only manual redelivery
		// reaches the seller, twice.
		pilot.network.dropNext = 1;
		const rfq = await pilot.buyer.node.issue({
			documentType: 'rfq',
			signerKeyId: pilot.buyer.keys.staff.grantId,
			recipient: 'org:seller',
			currency: 'LAK',
			lines: BEANS
		});
		await settleDelivery();
		expect(await pilot.seller.node.getDocument(rfq.envelope.documentId)).toBeUndefined();

		const first = await pilot.seller.node.receive(rfq.envelope);
		expect(first).toMatchObject({ decision: 'accepted', duplicate: false });

		const replay = await pilot.seller.node.receive(rfq.envelope);
		expect(replay).toMatchObject({ decision: 'accepted', duplicate: true });
		expect(await pilot.seller.node.getDocumentLog(rfq.envelope.documentId)).toHaveLength(1);
	});

	it('rejects invalid transitions: double accept and wrong party (OBP-E11)', async () => {
		const rfq = await pilot.buyer.node.issue({
			documentType: 'rfq',
			signerKeyId: pilot.buyer.keys.staff.grantId,
			recipient: 'org:seller',
			currency: 'LAK',
			lines: BEANS
		});
		await settleDelivery();
		await accept(pilot.seller, rfq.envelope.documentId);
		expect(await state(pilot.seller, rfq.envelope.documentId)).toBe('accepted');

		// Second accept from the same party: invalid transition.
		await expect(
			pilot.seller.node.respond({
				documentId: rfq.envelope.documentId,
				action: 'accept',
				signerKeyId: pilot.seller.keys.owner.grantId
			})
		).rejects.toMatchObject({ error: { code: 'OBP-E11' } });

		// The issuer cannot accept a document addressed to the recipient.
		await expect(
			pilot.buyer.node.respond({
				documentId: rfq.envelope.documentId,
				action: 'accept',
				signerKeyId: pilot.buyer.keys.owner.grantId
			})
		).rejects.toMatchObject({ error: { code: 'OBP-E11' } });
	});

	it('rejects reference hash mismatches (OBP-E10)', async () => {
		const rfq = await flowRfq();
		await expect(
			pilot.seller.node.issue({
				documentType: 'quote',
				signerKeyId: pilot.seller.keys.owner.grantId,
				recipient: 'org:buyer',
				currency: 'LAK',
				lines: BEANS,
				references: [{ documentId: rfq.documentId, documentType: 'rfq', hash: 'f'.repeat(64) }]
			})
		).rejects.toMatchObject({ error: { code: 'OBP-E10' } });
	});

	it('rejects invoices referencing unknown orders (OBP-E09)', async () => {
		await expect(
			pilot.seller.node.issue({
				documentType: 'invoice',
				signerKeyId: pilot.seller.keys.owner.grantId,
				recipient: 'org:buyer',
				currency: 'LAK',
				lines: BEANS,
				references: [{ documentId: 'doc:missing', documentType: 'purchase_order' }]
			})
		).rejects.toMatchObject({ error: { code: 'OBP-E09' } });
	});

	it('the issuer may cancel an unaccepted document before expiry (party/clock rule)', async () => {
		const rfq = await pilot.buyer.node.issue({
			documentType: 'rfq',
			signerKeyId: pilot.buyer.keys.staff.grantId,
			recipient: 'org:seller',
			currency: 'LAK',
			lines: BEANS
		});
		await settleDelivery();
		// The seller cannot cancel the buyer's RFQ.
		await expect(
			pilot.seller.node.respond({
				documentId: rfq.envelope.documentId,
				action: 'cancel',
				signerKeyId: pilot.seller.keys.owner.grantId
			})
		).rejects.toMatchObject({ error: { code: 'OBP-E11' } });

		await pilot.buyer.node.respond({
			documentId: rfq.envelope.documentId,
			action: 'cancel',
			signerKeyId: pilot.buyer.keys.owner.grantId
		});
		await settleDelivery();
		expect(await state(pilot.seller, rfq.envelope.documentId)).toBe('cancelled');
	});
});

// ── Durability and delivery ──────────────────────────────────────

describe('durability and delivery', () => {
	it('holds outgoing messages in the outbox during outages and retries after restart', async () => {
		pilot.network.failNext = 1;
		const rfq = await pilot.buyer.node.issue({
			documentType: 'rfq',
			signerKeyId: pilot.buyer.keys.staff.grantId,
			recipient: 'org:seller',
			currency: 'LAK',
			lines: BEANS
		});
		expect(rfq.delivered).toBe(false);
		const pending = await pilot.buyer.node.pendingOutbox();
		expect(pending).toHaveLength(1);
		expect(pending[0].attempts).toBe(1);
		expect(pending[0].envelope.messageId).toBe(rfq.envelope.messageId);

		// "Restart": retry undelivered entries; nothing lost, nothing duplicated.
		const retry = await pilot.buyer.node.retryOutbox();
		expect(retry).toMatchObject({ retried: 1, delivered: 1 });
		await settleDelivery();
		expect(await state(pilot.seller, rfq.envelope.documentId)).toBe('issued');
		expect(await pilot.buyer.node.pendingOutbox()).toHaveLength(0);
	});

	it('redelivery after a dropped message has exactly-once effects', async () => {
		pilot.network.dropNext = 1;
		const rfq = await pilot.buyer.node.issue({
			documentType: 'rfq',
			signerKeyId: pilot.buyer.keys.staff.grantId,
			recipient: 'org:seller',
			currency: 'LAK',
			lines: BEANS
		});
		await settleDelivery();
		expect(await pilot.seller.node.getDocument(rfq.envelope.documentId)).toBeUndefined();

		await pilot.seller.node.receive(rfq.envelope);
		await pilot.seller.node.receive(rfq.envelope);
		expect(await pilot.seller.node.getDocumentLog(rfq.envelope.documentId)).toHaveLength(1);
		expect(await state(pilot.seller, rfq.envelope.documentId)).toBe('issued');
	});

	it('fails closed when the transport cannot encrypt confidential documents', async () => {
		pilot.network.encryptionDisabled = true;
		const rfq = await pilot.buyer.node.issue({
			documentType: 'rfq',
			signerKeyId: pilot.buyer.keys.staff.grantId,
			recipient: 'org:seller',
			currency: 'LAK',
			lines: BEANS
		});
		expect(rfq.delivered).toBe(false);
		expect(rfq.transportError).toBe('encryption-unavailable');
		const pending = await pilot.buyer.node.pendingOutbox();
		expect(pending[0].lastError).toBe('encryption-unavailable');

		// The audit trail records the fail-closed decision, and retry skips
		// non-retryable encryption failures.
		const audit = await pilot.buyer.node.listAudit();
		expect(audit.some((a) => a.detail.includes('transport cannot encrypt'))).toBe(true);
		expect(await pilot.buyer.node.retryOutbox()).toMatchObject({ retried: 1, delivered: 0 });
	});
});

// ── Payment and settlement ───────────────────────────────────────

describe('payment and settlement', () => {
	it('keeps payment pending until settlement is verified, then flips to paid', async () => {
		pilot = createTwoNodePilot({ settlementDecide: () => 'pending' });
		const rfq = await flowRfq();
		const quote = await flowQuote(rfq);
		const po = await flowOrder(quote);
		const invoice = await flowInvoice(po);
		await flowPayment(invoice, 'ln-pending-1');

		for (const side of [pilot.buyer, pilot.seller]) {
			const doc = await side.node.getDocument(invoice.documentId);
			expect(doc?.settlement).toBe('pending');
			expect(doc?.state).toBe('accepted');
		}

		// A receipt against an unverified invoice is refused.
		await expect(
			pilot.seller.node.issue({
				documentType: 'receipt',
				signerKeyId: pilot.seller.keys.owner.grantId,
				recipient: 'org:buyer',
				currency: 'LAK',
				lines: [],
				totalsMinor: TOTAL,
				references: [
					{ documentId: invoice.documentId, documentType: 'invoice' },
					{ documentId: invoice.documentId, documentType: 'payment_evidence' }
				]
			})
		).rejects.toMatchObject({ error: { code: 'OBP-E11' } });
	});

	it('marks settlement failed when verification fails', async () => {
		pilot = createTwoNodePilot({ settlementDecide: () => 'failed' });
		const rfq = await flowRfq();
		const quote = await flowQuote(rfq);
		const po = await flowOrder(quote);
		const invoice = await flowInvoice(po);
		await flowPayment(invoice, 'ln-failed-1');

		const sellerInvoice = await pilot.seller.node.getDocument(invoice.documentId);
		expect(sellerInvoice?.settlement).toBe('failed');
		expect(sellerInvoice?.state).toBe('accepted');
	});
});

// ── Human approval gates ─────────────────────────────────────────

describe('human approval gates', () => {
	it('holds staff purchase orders until an owner approves, then delivers', async () => {
		const rfq = await flowRfq();
		const quote = await flowQuote(rfq);

		// Staff tries to order: policy holds the draft.
		let held: ObpApprovalRequiredError | undefined;
		try {
			await pilot.buyer.node.issue({
				documentType: 'purchase_order',
				signerKeyId: pilot.buyer.keys.staff.grantId,
				recipient: 'org:seller',
				currency: 'LAK',
				lines: BEANS,
				references: [{ documentId: quote.documentId, documentType: 'quote' }]
			});
		} catch (e) {
			if (e instanceof ObpApprovalRequiredError) held = e;
		}
		expect(held).toBeInstanceOf(ObpApprovalRequiredError);
		expect(await pilot.buyer.node.pendingOutbox()).toHaveLength(0);

		// Non-owner cannot approve.
		await expect(
			pilot.buyer.node.approve(held!.pendingId, pilot.buyer.keys.staff.grantId)
		).rejects.toMatchObject({ error: { code: 'OBP-E12' } });

		// Owner approves; the held document is signed and delivered.
		const approved: SendResult = await pilot.buyer.node.approve(
			held!.pendingId,
			pilot.buyer.keys.owner.grantId
		);
		expect(approved.delivered).toBe(true);
		await settleDelivery();
		expect(await state(pilot.seller, approved.envelope.documentId)).toBe('issued');
	});

	it('never lets an agent sign purchase orders or payments', async () => {
		await expect(
			pilot.buyer.node.issue({
				documentType: 'purchase_order',
				signerKeyId: pilot.buyer.keys.agent.grantId,
				recipient: 'org:seller',
				currency: 'LAK',
				lines: BEANS,
				references: []
			})
		).rejects.toMatchObject({ error: { code: 'OBP-E06' } });
	});

	it('agent-drafted RFQs are allowed (drafting only)', async () => {
		const rfq = await pilot.buyer.node.issue({
			documentType: 'rfq',
			signerKeyId: pilot.buyer.keys.agent.grantId,
			recipient: 'org:seller',
			currency: 'LAK',
			lines: BEANS
		});
		await settleDelivery();
		expect(await state(pilot.seller, rfq.envelope.documentId)).toBe('issued');
	});
});
