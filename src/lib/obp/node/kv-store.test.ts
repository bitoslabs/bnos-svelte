/**
 * Durable KV store tests: atomic inbox decisions, append-only logs,
 * outbox retry bookkeeping, settlement flips, and restart survival —
 * the crash/restart determinism the node core promises.
 */
import { describe, expect, it } from 'vitest';
import { MemoryObpKv } from './kv-store';
import { KvObpStores } from './idb-store';
import { signEnvelope, generateSigningKey } from '../signature';
import type { ObpEnvelope, ObpUnsignedEnvelope } from '../types';

function envelope(patch: Partial<ObpUnsignedEnvelope> = {}): ObpEnvelope {
	const { secretKey, pubkey } = generateSigningKey();
	return signEnvelope(
		{
			protocol: 'obp',
			version: '0.1',
			messageId: `msg-${crypto.randomUUID()}`,
			documentId: `doc-${crypto.randomUUID()}`,
			documentType: 'rfq',
			action: 'issue',
			issuer: 'org:buyer',
			signerKeyId: 'buyer:owner',
			signerPubkey: pubkey,
			recipient: 'org:seller',
			createdAt: new Date().toISOString(),
			expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
			currency: 'LAK',
			lines: [{ description: 'beans', quantity: 1, unit: 'kg', unitPriceMinor: 85_000 }],
			totalsMinor: 85_000,
			references: [],
			...patch
		},
		secretKey
	);
}

describe('KvObpStores durability', () => {
	it('persists inbox decisions atomically and idempotently', async () => {
		const kv = new MemoryObpKv();
		const stores = new KvObpStores(kv);
		const env = envelope();

		const first = await stores.recordInbox(env.messageId, {
			envelope: env,
			receivedAt: '2026-10-07T00:00:00Z',
			decision: 'accepted'
		});
		expect(first.duplicate).toBe(false);

		const second = await stores.recordInbox(env.messageId, {
			envelope: env,
			receivedAt: '2026-10-07T01:00:00Z',
			decision: 'rejected'
		});
		expect(second.duplicate).toBe(true);
		expect(second.stored.decision).toBe('accepted');
		expect(second.stored.receivedAt).toBe('2026-10-07T00:00:00Z');
	});

	it('concurrent duplicate deliveries keep exactly one decision', async () => {
		const stores = new KvObpStores(new MemoryObpKv());
		const env = envelope();
		const results = await Promise.all([
			stores.recordInbox(env.messageId, {
				envelope: env,
				receivedAt: 't1',
				decision: 'accepted'
			}),
			stores.recordInbox(env.messageId, {
				envelope: env,
				receivedAt: 't2',
				decision: 'accepted'
			})
		]);
		expect(results.filter((r) => r.duplicate)).toHaveLength(1);
	});

	it('appends the message log and projects transitions', async () => {
		const stores = new KvObpStores(new MemoryObpKv());
		const issue = envelope();
		const doc = await stores.appendDocument(issue, 'accepted');
		expect(doc.state).toBe('issued');
		expect(doc.issueHash).toBe(issue.payloadHash);

		const accept = envelope({
			documentId: issue.documentId,
			action: 'accept',
			messageId: `msg-${crypto.randomUUID()}`
		});
		await stores.appendDocument(accept, 'accepted');
		expect((await stores.getDocument(issue.documentId))?.state).toBe('accepted');
		expect(await stores.getDocumentLog(issue.documentId)).toHaveLength(2);
	});

	it('flips settlement to verified and state to paid together', async () => {
		const stores = new KvObpStores(new MemoryObpKv());
		const invoice = envelope({ documentType: 'invoice' });
		await stores.appendDocument(invoice, 'accepted');
		const accept = envelope({
			documentId: invoice.documentId,
			action: 'accept',
			messageId: `msg-${crypto.randomUUID()}`
		});
		await stores.appendDocument(accept, 'accepted');

		await stores.setSettlement(invoice.documentId, 'pending');
		await stores.setSettlement(invoice.documentId, 'verified');
		const doc = await stores.getDocument(invoice.documentId);
		expect(doc).toMatchObject({ settlement: 'verified', state: 'paid' });
	});

	it('tracks outbox delivery and retries only undelivered entries', async () => {
		const stores = new KvObpStores(new MemoryObpKv());
		const a = envelope();
		const b = envelope();
		await stores.enqueueOutbox({ envelope: a, queuedAt: 't', attempts: 0 });
		await stores.enqueueOutbox({ envelope: b, queuedAt: 't', attempts: 0 });
		await stores.updateOutbox(a.messageId, { attempts: 1, lastError: 'simulated-outage' });
		await stores.updateOutbox(b.messageId, { attempts: 1, deliveredAt: 't2' });

		const pending = await stores.pendingOutbox();
		expect(pending).toHaveLength(1);
		expect(pending[0].envelope.messageId).toBe(a.messageId);
		expect(pending[0].lastError).toBe('simulated-outage');
	});

	it('survives restart: a new store over the same KV resumes state', async () => {
		const kv = new MemoryObpKv();
		const first = new KvObpStores(kv);
		const env = envelope();
		await first.recordInbox(env.messageId, {
			envelope: env,
			receivedAt: 't',
			decision: 'accepted'
		});
		await first.appendDocument(env, 'accepted');
		await first.enqueueOutbox({ envelope: env, queuedAt: 't', attempts: 1 });
		await first.appendAudit({
			at: 't',
			kind: 'receive',
			messageId: env.messageId,
			detail: 'accepted rfq.issue'
		});

		// "Restart": fresh store instance, same KV.
		const second = new KvObpStores(kv);
		const replay = await second.recordInbox(env.messageId, {
			envelope: env,
			receivedAt: 't3',
			decision: 'rejected'
		});
		expect(replay.duplicate).toBe(true);
		expect((await second.getDocument(env.documentId))?.state).toBe('issued');
		expect(await second.pendingOutbox()).toHaveLength(1);
		expect(await second.listAudit()).toHaveLength(1);
	});

	it('lists documents newest-first with updated timestamps', async () => {
		const stores = new KvObpStores(new MemoryObpKv());
		const a = envelope();
		const b = envelope();
		await stores.appendDocument(a, 'accepted');
		await new Promise((r) => setTimeout(r, 5));
		await stores.appendDocument(b, 'accepted');

		const list = await stores.listDocuments();
		expect(list).toHaveLength(2);
		expect(list[0].documentId).toBe(b.documentId);
		expect(list[0].createdAt).toBeTruthy();
		expect(list[0].updatedAt >= list[0].createdAt).toBe(true);

		// An accept on the older doc bumps it back to the top.
		const accept = envelope({ documentId: a.documentId, action: 'accept' });
		await stores.appendDocument(accept, 'accepted');
		expect((await stores.listDocuments())[0].documentId).toBe(a.documentId);
	});

	it('stores and resolves pending approvals', async () => {
		const stores = new KvObpStores(new MemoryObpKv());
		// A signed envelope is structurally a valid unsigned draft for the
		// pending-approval record (the stored hash/signature are ignored).
		const unsigned: ObpUnsignedEnvelope = envelope();
		await stores.savePendingApproval({
			pendingId: 'pend-1',
			envelopeDraft: unsigned,
			policyRecord: {
				decision: 'requires_approval',
				reason: 'human-approval',
				signerGrantId: 'buyer:staff',
				documentId: unsigned.documentId,
				evaluatedAt: 't'
			},
			requestedAt: 't'
		});
		expect((await stores.getPendingApprovalForDocument(unsigned.documentId))?.pendingId).toBe(
			'pend-1'
		);
		await stores.resolvePendingApproval('pend-1', 'buyer:owner');
		expect(await stores.getPendingApprovalForDocument(unsigned.documentId)).toBeUndefined();
		expect((await stores.getPendingApproval('pend-1'))?.approvedByGrantId).toBe('buyer:owner');
	});
});
