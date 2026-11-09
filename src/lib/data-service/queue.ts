/**
 * Durable, service-only upload queue.
 *
 * This queue is intentionally independent from the relay publish queue: success
 * or failure on one destination must never hide the state of the other. Events
 * are acknowledged and removed only after the service confirms durable
 * acceptance or confirms an existing duplicate. Rejected events remain local.
 */
import { fromBase64Url, isEncryptionEnvelope, toBase64Url } from '../crypto/sensitive-data';
import type { DataServiceIngestResult, ServiceEvent } from './protocol';

export const SERVICE_QUEUE_VERSION = 1;
export const MAX_QUEUE_ITEMS = 2_000;

export interface QueuedServiceEvent {
	id: string;
	event: ServiceEvent;
	queuedAt: number;
	attempts: number;
	lastAttemptAt: number | null;
	lastError: string | null;
}

export interface ServiceQueue {
	version: number;
	items: QueuedServiceEvent[];
}

export function emptyQueue(): ServiceQueue {
	return { version: SERVICE_QUEUE_VERSION, items: [] };
}

function isQueuedEvent(value: unknown): value is QueuedServiceEvent {
	if (!value || typeof value !== 'object') return false;
	const record = value as Record<string, unknown>;
	const event = record.event;
	return (
		typeof record.id === 'string' &&
		record.id.length > 0 &&
		!!event &&
		typeof event === 'object' &&
		(event as Record<string, unknown>).id === record.id
	);
}

export function parseQueue(raw: string | null | undefined): ServiceQueue {
	if (raw == null) return emptyQueue();
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error('Service queue is unreadable');
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
		throw new Error('Service queue is unreadable');
	const record = parsed as Record<string, unknown>;
	if (
		record.version !== SERVICE_QUEUE_VERSION ||
		!Array.isArray(record.items) ||
		!record.items.every(isQueuedEvent)
	) {
		throw new Error('Service queue is unreadable');
	}
	const seen = new Set<string>();
	const items = record.items.map((item: QueuedServiceEvent) => {
		if (seen.has(item.id)) throw new Error('Service queue is unreadable');
		seen.add(item.id);
		return {
			id: item.id,
			event: item.event,
			queuedAt: typeof item.queuedAt === 'number' ? item.queuedAt : Date.now(),
			attempts: typeof item.attempts === 'number' ? item.attempts : 0,
			lastAttemptAt: typeof item.lastAttemptAt === 'number' ? item.lastAttemptAt : null,
			lastError: typeof item.lastError === 'string' ? item.lastError : null
		};
	});
	return { version: SERVICE_QUEUE_VERSION, items };
}

export function serializeQueue(queue: ServiceQueue): string {
	return JSON.stringify(queue);
}

/** Insert or replace an event by id. The newest copy wins. */
export function enqueueEvent(
	queue: ServiceQueue,
	event: ServiceEvent,
	now = Date.now()
): { queue: ServiceQueue; added: boolean; overflow: boolean } {
	if (!event.id) return { queue, added: false, overflow: false };
	if (queue.items.some((item) => item.id === event.id)) {
		return { queue, added: false, overflow: false };
	}
	if (queue.items.length >= MAX_QUEUE_ITEMS) {
		return { queue, added: false, overflow: true };
	}
	return {
		queue: {
			version: SERVICE_QUEUE_VERSION,
			items: [
				...queue.items,
				{
					id: event.id,
					event,
					queuedAt: now,
					attempts: 0,
					lastAttemptAt: null,
					lastError: null
				}
			]
		},
		added: true,
		overflow: false
	};
}

/** Remove events the service accepted or already had. */
export function acknowledgeEvents(queue: ServiceQueue, ids: Iterable<string>): ServiceQueue {
	const remove = new Set(ids);
	if (!remove.size) return queue;
	return {
		version: SERVICE_QUEUE_VERSION,
		items: queue.items.filter((item) => !remove.has(item.id))
	};
}

/** Record a failed attempt without dropping the event. */
export function markAttempts(
	queue: ServiceQueue,
	ids: Iterable<string>,
	error: string,
	now = Date.now()
): ServiceQueue {
	const target = new Set(ids);
	if (!target.size) return queue;
	return {
		version: SERVICE_QUEUE_VERSION,
		items: queue.items.map((item) =>
			target.has(item.id)
				? {
						...item,
						attempts: item.attempts + 1,
						lastAttemptAt: now,
						lastError: error
					}
				: item
		)
	};
}

export function queueIds(queue: ServiceQueue): string[] {
	return queue.items.map((item) => item.id);
}

/** Apply only acknowledgements for this batch; rejected or conflicting IDs stay queued. */
export function applyIngestResult(
	queue: ServiceQueue,
	batchIds: Iterable<string>,
	result: DataServiceIngestResult,
	now = Date.now()
): { queue: ServiceQueue; acknowledged: number } {
	const batch = new Set(batchIds);
	const rejected = new Set(result.rejected.map((item) => item.id).filter((id) => batch.has(id)));
	const acknowledged = new Set(
		[...result.accepted, ...result.duplicates].filter((id) => batch.has(id) && !rejected.has(id))
	);
	let next = acknowledgeEvents(queue, acknowledged);
	for (const item of result.rejected) {
		if (rejected.delete(item.id)) {
			next = markAttempts(next, [item.id], `Service rejected: ${item.reason.slice(0, 256)}`, now);
		}
	}
	return { queue: next, acknowledged: acknowledged.size };
}

/** A shape check only; it cannot establish ciphertext authenticity or hide event tags. */
function candidateEncryptedContent(content: unknown): boolean {
	if (typeof content !== 'string' || content.length > 512 * 1024) return false;
	try {
		const envelope: unknown = JSON.parse(content);
		// The local producer uses JSON.stringify. Reject duplicate keys or other
		// alternate encodings that could hide plaintext in the original content.
		if (JSON.stringify(envelope) !== content || !isEncryptionEnvelope(envelope)) return false;
		const fields = envelope as unknown as Record<string, unknown>;
		if (
			Object.keys(fields).some(
				(key) =>
					!['v', 'encrypted', 'scheme', 'alg', 'kid', 'nonce', 'ciphertext', 'aad'].includes(key)
			)
		)
			return false;
		if (!envelope.kid || envelope.kid.length > 256 || /[\u0000-\u001f\u007f]/.test(envelope.kid))
			return false;
		const canonical = (value: string, min: number, max: number) => {
			if (!/^[A-Za-z0-9_-]+$/.test(value)) return false;
			const bytes = fromBase64Url(value);
			return bytes.length >= min && bytes.length <= max && toBase64Url(bytes) === value;
		};
		if (!canonical(envelope.nonce, 12, 12) || !canonical(envelope.ciphertext, 16, 512 * 1024))
			return false;
		if (fields.aad !== undefined) {
			if (!fields.aad || typeof fields.aad !== 'object' || Array.isArray(fields.aad)) return false;
			const aad = fields.aad as Record<string, unknown>;
			if (
				Object.entries(aad).some(
					([key, value]) =>
						key !== 'recordId' ||
						typeof value !== 'string' ||
						!value ||
						value.length > 256 ||
						/[\u0000-\u001f\u007f]/.test(value)
				)
			)
				return false;
		}
		return true;
	} catch {
		return false;
	}
}

/** Keep events without a recognized ciphertext envelope local. */
export function encryptedUploadBatch(queue: ServiceQueue, limit: number): QueuedServiceEvent[] {
	return queue.items
		.filter((item) => candidateEncryptedContent(item.event.content))
		.slice(0, limit);
}
