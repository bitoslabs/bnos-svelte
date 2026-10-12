/**
 * Durable `ObpStores` implementation over a key-value store.
 *
 * All mutating operations run through a single-writer mutex, so
 * `recordInbox` (message + decision in one step) and the log/projection
 * updates are atomic even on KV backends without transactions. State
 * survives restarts: constructing `KvObpStores` over the same KV resumes
 * with the same inbox decisions, outbox entries and audit trail.
 *
 * `createIdbKv()` returns the browser persistence (idb-keyval custom
 * store); tests use `MemoryObpKv` to verify the durability semantics.
 */
import { createStore, get, set, keys } from 'idb-keyval';
import type {
	ObpAuditEntry,
	ObpOutboxEntry,
	ObpPendingApproval,
	ObpStoredMessage,
	ObpStores
} from './store';
import type { ObpDocumentProjection } from '../lifecycle';
import type { ObpPolicyRecord } from '../policy';
import type { ObpKv } from './kv-store';

const K = {
	inbox: (id: string) => `obp:inbox:${id}`,
	doc: (id: string) => `obp:doc:${id}`,
	log: (id: string) => `obp:log:${id}`,
	outbox: (id: string) => `obp:outbox:${id}`,
	pending: (id: string) => `obp:pending:${id}`,
	policy: 'obp:policy-records',
	audit: 'obp:audit'
};

export class KvObpStores implements ObpStores {
	private chain: Promise<unknown> = Promise.resolve();

	constructor(private readonly kv: ObpKv) {}

	/** Serialize writes: every mutation is atomic w.r.t. other mutations. */
	private locked<T>(fn: () => Promise<T>): Promise<T> {
		const run = this.chain.then(fn, fn);
		this.chain = run.then(
			() => undefined,
			() => undefined
		);
		return run;
	}

	async recordInbox(
		messageId: string,
		entry: ObpStoredMessage
	): Promise<{ stored: ObpStoredMessage; duplicate: boolean }> {
		return this.locked(async () => {
			const key = K.inbox(messageId);
			const existing = await this.kv.get<ObpStoredMessage>(key);
			if (existing) return { stored: existing, duplicate: true };
			await this.kv.set(key, entry);
			return { stored: entry, duplicate: false };
		});
	}

	getInbox(messageId: string): Promise<ObpStoredMessage | undefined> {
		return this.kv.get<ObpStoredMessage>(K.inbox(messageId));
	}

	async appendDocument(
		envelope: ObpStoredMessage['envelope'],
		decision: ObpStoredMessage['decision']
	): Promise<ObpDocumentProjection> {
		return this.locked(async () => {
			const logKey = K.log(envelope.documentId);
			const log = (await this.kv.get<ObpStoredMessage[]>(logKey)) ?? [];
			const stored: ObpStoredMessage = {
				envelope,
				receivedAt: new Date().toISOString(),
				decision
			};
			log.push(stored);
			await this.kv.set(logKey, log);

			const docKey = K.doc(envelope.documentId);
			const doc: ObpDocumentProjection = (await this.kv.get<ObpDocumentProjection>(docKey)) ?? {
				documentId: envelope.documentId,
				documentType: envelope.documentType,
				issuer: envelope.issuer,
				recipient: envelope.recipient,
				state: 'issued',
				issueHash: envelope.payloadHash,
				expiresAt: envelope.expiresAt,
				createdAt: envelope.createdAt,
				updatedAt: new Date().toISOString(),
				currency: envelope.currency,
				totalsMinor: envelope.totalsMinor,
				settlement: 'unpaid'
			};
			if (decision === 'accepted') {
				if (envelope.action === 'accept') doc.state = 'accepted';
				else if (envelope.action === 'reject') doc.state = 'rejected';
				else if (envelope.action === 'cancel') doc.state = 'cancelled';
			}
			doc.updatedAt = new Date().toISOString();
			await this.kv.set(docKey, doc);
			return doc;
		});
	}

	getDocument(documentId: string): Promise<ObpDocumentProjection | undefined> {
		return this.kv.get<ObpDocumentProjection>(K.doc(documentId));
	}

	async listDocuments(): Promise<ObpDocumentProjection[]> {
		const ids = await this.kv.keys(K.doc(''));
		const docs = await Promise.all(ids.map((k) => this.kv.get<ObpDocumentProjection>(k)));
		return docs
			.filter((d): d is ObpDocumentProjection => !!d)
			.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	}

	async getDocumentLog(documentId: string): Promise<ObpStoredMessage[]> {
		return (await this.kv.get<ObpStoredMessage[]>(K.log(documentId))) ?? [];
	}

	async setSettlement(
		documentId: string,
		status: 'unpaid' | 'pending' | 'verified' | 'failed'
	): Promise<void> {
		await this.locked(async () => {
			const key = K.doc(documentId);
			const doc = await this.kv.get<ObpDocumentProjection>(key);
			if (!doc) return;
			doc.settlement = status;
			doc.updatedAt = new Date().toISOString();
			if (status === 'verified' && doc.state === 'accepted') doc.state = 'paid';
			await this.kv.set(key, doc);
		});
	}

	async enqueueOutbox(entry: ObpOutboxEntry): Promise<void> {
		await this.kv.set(K.outbox(entry.envelope.messageId), entry);
	}

	async updateOutbox(messageId: string, patch: Partial<ObpOutboxEntry>): Promise<void> {
		await this.locked(async () => {
			const key = K.outbox(messageId);
			const cur = await this.kv.get<ObpOutboxEntry>(key);
			if (cur) await this.kv.set(key, { ...cur, ...patch });
		});
	}

	getOutbox(messageId: string): Promise<ObpOutboxEntry | undefined> {
		return this.kv.get<ObpOutboxEntry>(K.outbox(messageId));
	}

	async pendingOutbox(): Promise<ObpOutboxEntry[]> {
		const ids = await this.kv.keys(K.outbox(''));
		const entries = await Promise.all(ids.map((k) => this.kv.get<ObpOutboxEntry>(k)));
		return entries.filter((e): e is ObpOutboxEntry => !!e && !e.deliveredAt);
	}

	async savePolicyRecord(record: ObpPolicyRecord): Promise<void> {
		await this.locked(async () => {
			const list = (await this.kv.get<ObpPolicyRecord[]>(K.policy)) ?? [];
			list.push(record);
			await this.kv.set(K.policy, list);
		});
	}

	async savePendingApproval(pending: ObpPendingApproval): Promise<void> {
		await this.kv.set(K.pending(pending.pendingId), pending);
	}

	getPendingApproval(pendingId: string): Promise<ObpPendingApproval | undefined> {
		return this.kv.get<ObpPendingApproval>(K.pending(pendingId));
	}

	async getPendingApprovalForDocument(documentId: string): Promise<ObpPendingApproval | undefined> {
		const ids = await this.kv.keys(K.pending(''));
		for (const k of ids) {
			const p = await this.kv.get<ObpPendingApproval>(k);
			if (p && p.envelopeDraft.documentId === documentId && !p.resolvedAt) return p;
		}
		return undefined;
	}

	async resolvePendingApproval(pendingId: string, approverGrantId: string): Promise<void> {
		await this.locked(async () => {
			const key = K.pending(pendingId);
			const p = await this.kv.get<ObpPendingApproval>(key);
			if (!p) return;
			p.resolvedAt = new Date().toISOString();
			p.approvedByGrantId = approverGrantId;
			await this.kv.set(key, p);
		});
	}

	async appendAudit(entry: ObpAuditEntry): Promise<void> {
		await this.locked(async () => {
			const list = (await this.kv.get<ObpAuditEntry[]>(K.audit)) ?? [];
			list.push(entry);
			await this.kv.set(K.audit, list);
		});
	}

	async listAudit(limit?: number): Promise<ObpAuditEntry[]> {
		const list = (await this.kv.get<ObpAuditEntry[]>(K.audit)) ?? [];
		return limit === undefined ? [...list] : list.slice(-limit);
	}
}

const IDB_STORE_NAME = 'bnos-os:obp-node';

/**
 * Browser KV persistence (IndexedDB via idb-keyval). Returns a lazy
 * proxy-safe store; only construct in a browser context.
 */
export function createIdbKv(): ObpKv {
	const store = createStore(IDB_STORE_NAME, 'kv');
	return {
		async get(key) {
			return get(key, store);
		},
		async set(key, value) {
			await set(key, value, store);
		},
		async keys(prefix) {
			const all = await keys(store);
			return all
				.filter((k): k is string => typeof k === 'string')
				.filter((k) => k.startsWith(prefix ?? ''));
		}
	};
}
