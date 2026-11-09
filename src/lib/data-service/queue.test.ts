import { describe, expect, it } from 'vitest';
import {
	MAX_QUEUE_ITEMS,
	acknowledgeEvents,
	applyIngestResult,
	emptyQueue,
	encryptedUploadBatch,
	enqueueEvent,
	eventTagValue,
	markAttempts,
	parseQueue,
	serializeQueue
} from './queue';

const event = (id: string) => ({ id, kind: 1, content: id });

describe('service upload queue', () => {
	it('queues each event id once', () => {
		const first = enqueueEvent(emptyQueue(), event('a'), 1);
		expect(first.added).toBe(true);
		expect(first.queue.items).toHaveLength(1);

		const second = enqueueEvent(first.queue, event('a'), 2);
		expect(second.added).toBe(false);
		expect(second.queue.items).toHaveLength(1);
	});

	it('preserves serialized queues and refuses malformed or unsupported data', () => {
		const queued = enqueueEvent(emptyQueue(), event('a'), 1).queue;
		expect(parseQueue(serializeQueue(queued)).items[0].id).toBe('a');
		expect(parseQueue(null).items).toHaveLength(0);
		for (const raw of [
			'not json',
			'',
			JSON.stringify({ version: 2, items: [] }),
			JSON.stringify({ version: 1, items: [{ id: 'bad', event: {} }] }),
			JSON.stringify({ version: 1, items: [queued.items[0], queued.items[0]] })
		]) {
			expect(() => parseQueue(raw)).toThrow('Service queue is unreadable');
		}
	});

	it('keeps events after a failed attempt and records the error', () => {
		const queued = enqueueEvent(emptyQueue(), event('a'), 1).queue;
		const failed = markAttempts(queued, ['a'], 'offline', 3);
		expect(failed.items[0].attempts).toBe(1);
		expect(failed.items[0].lastError).toBe('offline');
		expect(failed.items[0].id).toBe('a');
	});

	it('removes only explicitly acknowledged ids', () => {
		let queued = emptyQueue();
		for (const id of ['a', 'b', 'c', 'd']) queued = enqueueEvent(queued, event(id)).queue;
		const next = acknowledgeEvents(queued, ['a', 'b', 'c']);
		expect(next.items.map((item) => item.id)).toEqual(['d']);
	});

	it('preserves rejected, unmentioned, conflicting and unsubmitted events', () => {
		let queued = emptyQueue();
		for (const id of ['a', 'b', 'c', 'd', 'e']) queued = enqueueEvent(queued, event(id)).queue;
		const applied = applyIngestResult(
			queued,
			['a', 'b', 'c', 'd'],
			{
				accepted: ['a', 'c', 'e'],
				duplicates: ['b'],
				rejected: [{ id: 'c', reason: 'unauthorized' }]
			},
			10
		);
		expect(applied.acknowledged).toBe(2);
		expect(applied.queue.items.map((item) => item.id)).toEqual(['c', 'd', 'e']);
		expect(parseQueue(serializeQueue(applied.queue)).items[0]).toMatchObject({
			id: 'c',
			attempts: 1,
			lastError: 'Service rejected: unauthorized'
		});
	});

	it('keeps plaintext queued and selects only protected content for upload', () => {
		const encrypted = JSON.stringify({
			v: 1,
			encrypted: true,
			scheme: 'org.bitos.bnos.organization-key.v1',
			alg: 'AES-256-GCM',
			kid: 'key',
			nonce: 'AAAAAAAAAAAAAAAA',
			ciphertext: 'AAAAAAAAAAAAAAAAAAAAAA'
		});
		let queued = emptyQueue();
		queued = enqueueEvent(queued, event('plain')).queue;
		queued = enqueueEvent(queued, { ...event('encrypted'), content: encrypted }).queue;
		queued = enqueueEvent(queued, { ...event('malformed'), content: '{' }).queue;
		queued = enqueueEvent(queued, {
			...event('duplicate-key'),
			content: encrypted.replace('{', '{\"ciphertext\":\"private\",')
		}).queue;
		queued = enqueueEvent(queued, {
			...event('extra'),
			content: JSON.stringify({ ...JSON.parse(encrypted), plaintext: 'private' })
		}).queue;
		queued = enqueueEvent(queued, {
			...event('invalid'),
			content: JSON.stringify({ ...JSON.parse(encrypted), nonce: 'bad' })
		}).queue;
		expect(encryptedUploadBatch(queued, 100).map((item) => item.id)).toEqual(['encrypted']);
		expect(queued.items.map((item) => item.id)).toEqual([
			'plain',
			'encrypted',
			'malformed',
			'duplicate-key',
			'extra',
			'invalid'
		]);
	});

	it('reads a queued event tag without trusting its shape', () => {
		expect(eventTagValue({ id: 'a', tags: [['snapshot-id', 'snap-1']] }, 'snapshot-id')).toBe(
			'snap-1'
		);
		expect(eventTagValue({ id: 'a', tags: [['x', 1]] }, 'snapshot-id')).toBeNull();
		expect(eventTagValue({ id: 'a' }, 'snapshot-id')).toBeNull();
	});

	it('refuses to drop events past the queue cap', () => {
		const full = {
			version: 1,
			items: Array.from({ length: MAX_QUEUE_ITEMS }, (_, index) => ({
				id: `e${index}`,
				event: event(`e${index}`),
				queuedAt: 0,
				attempts: 0,
				lastAttemptAt: null,
				lastError: null
			}))
		};
		const result = enqueueEvent(full, event('overflow'));
		expect(result.overflow).toBe(true);
		expect(result.queue.items).toHaveLength(MAX_QUEUE_ITEMS);
	});
});
