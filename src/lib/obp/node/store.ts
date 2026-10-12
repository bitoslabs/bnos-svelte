/**
 * Business Node durable storage contracts.
 *
 * Every method is async so a browser implementation (idb-keyval) or a
 * server implementation (SQLite) can satisfy the same interface. The
 * critical atomicity rule: `recordInbox` persists the inbound message and
 * its decision in ONE operation — a crash can never leave a decision
 * without its message or vice versa. Idempotency is enforced by
 * `recordInbox` itself: a duplicate messageId returns the stored decision
 * untouched.
 */
import type { ObpDecision, ObpEnvelope, ObpError } from '../types';
import type { ObpDocumentProjection } from '../lifecycle';
import type { ObpPolicyRecord } from '../policy';

/** One entry in a document's append-only message log. */
export interface ObpStoredMessage {
	envelope: ObpEnvelope;
	receivedAt: string;
	decision: ObpDecision;
	error?: ObpError;
}

/** Outbox entry: accepted locally, delivery tracked separately. */
export interface ObpOutboxEntry {
	envelope: ObpEnvelope;
	queuedAt: string;
	attempts: number;
	lastAttemptAt?: string;
	lastError?: string;
	deliveredAt?: string;
	/** Transport acknowledgement id when delivered. */
	transportId?: string;
}

/** Append-only audit trail entry. */
export interface ObpAuditEntry {
	at: string;
	/** `send` | `receive` | `decision` | `settlement` | `approval` | `retry` */
	kind: string;
	messageId?: string;
	documentId?: string;
	detail: string;
}

/** Pending human-approval request for an outgoing action. */
export interface ObpPendingApproval {
	pendingId: string;
	envelopeDraft: Omit<ObpEnvelope, 'payloadHash' | 'signature'>;
	policyRecord: ObpPolicyRecord;
	requestedAt: string;
	resolvedAt?: string;
	approvedByGrantId?: string;
}

export interface ObpStores {
	/** Inbound message + decision, written atomically, idempotent by messageId. */
	recordInbox(
		messageId: string,
		entry: ObpStoredMessage
	): Promise<{ stored: ObpStoredMessage; duplicate: boolean }>;
	getInbox(messageId: string): Promise<ObpStoredMessage | undefined>;

	/** Append a message to a document log and return the fresh projection. */
	appendDocument(envelope: ObpEnvelope, decision: ObpDecision): Promise<ObpDocumentProjection>;
	getDocument(documentId: string): Promise<ObpDocumentProjection | undefined>;
	/** All document projections, newest update first. */
	listDocuments(): Promise<ObpDocumentProjection[]>;
	getDocumentLog(documentId: string): Promise<ObpStoredMessage[]>;

	/**
	 * Update an invoice's settlement status after (in)dependent verification.
	 * `verified` also flips the projection state to `paid`.
	 */
	setSettlement(
		documentId: string,
		status: 'unpaid' | 'pending' | 'verified' | 'failed'
	): Promise<void>;

	/** Outbox queue with per-entry retry bookkeeping. */
	enqueueOutbox(entry: ObpOutboxEntry): Promise<void>;
	updateOutbox(messageId: string, patch: Partial<ObpOutboxEntry>): Promise<void>;
	getOutbox(messageId: string): Promise<ObpOutboxEntry | undefined>;
	pendingOutbox(): Promise<ObpOutboxEntry[]>;

	/** Policy decisions and pending approvals. */
	savePolicyRecord(record: ObpPolicyRecord): Promise<void>;
	savePendingApproval(pending: ObpPendingApproval): Promise<void>;
	getPendingApproval(pendingId: string): Promise<ObpPendingApproval | undefined>;
	getPendingApprovalForDocument(documentId: string): Promise<ObpPendingApproval | undefined>;
	resolvePendingApproval(pendingId: string, approverGrantId: string): Promise<void>;

	/** Audit log. */
	appendAudit(entry: ObpAuditEntry): Promise<void>;
	listAudit(limit?: number): Promise<ObpAuditEntry[]>;
}

/** In-memory implementation — pilots, tests, and the two-node harness. */
export class MemoryObpStores implements ObpStores {
	private inbox = new Map<string, ObpStoredMessage>();
	private docs = new Map<string, ObpDocumentProjection>();
	private logs = new Map<string, ObpStoredMessage[]>();
	private outbox = new Map<string, ObpOutboxEntry>();
	private policyRecords: ObpPolicyRecord[] = [];
	private pending = new Map<string, ObpPendingApproval>();
	private audit: ObpAuditEntry[] = [];

	async recordInbox(
		messageId: string,
		entry: ObpStoredMessage
	): Promise<{ stored: ObpStoredMessage; duplicate: boolean }> {
		const existing = this.inbox.get(messageId);
		if (existing) return { stored: existing, duplicate: true };
		this.inbox.set(messageId, entry);
		return { stored: entry, duplicate: false };
	}

	async getInbox(messageId: string): Promise<ObpStoredMessage | undefined> {
		return this.inbox.get(messageId);
	}

	async appendDocument(
		envelope: ObpEnvelope,
		decision: ObpDecision
	): Promise<ObpDocumentProjection> {
		const log = this.logs.get(envelope.documentId) ?? [];
		log.push({ envelope, receivedAt: new Date().toISOString(), decision });
		this.logs.set(envelope.documentId, log);

		let doc = this.docs.get(envelope.documentId);
		if (!doc) {
			doc = {
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
		}
		if (decision === 'accepted') {
			if (envelope.action === 'issue') {
				// (Re)issue replaces nothing — append-only; projection already
				// reflects the initial state for a fresh document.
			} else if (envelope.action === 'accept') {
				doc.state = 'accepted';
			} else if (envelope.action === 'reject') {
				doc.state = 'rejected';
			} else if (envelope.action === 'cancel') {
				doc.state = 'cancelled';
			}
		}
		doc.updatedAt = new Date().toISOString();
		this.docs.set(envelope.documentId, doc);
		return doc;
	}

	async getDocument(documentId: string): Promise<ObpDocumentProjection | undefined> {
		return this.docs.get(documentId);
	}

	async listDocuments(): Promise<ObpDocumentProjection[]> {
		return [...this.docs.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	}

	async setSettlement(
		documentId: string,
		status: 'unpaid' | 'pending' | 'verified' | 'failed'
	): Promise<void> {
		const doc = this.docs.get(documentId);
		if (!doc) return;
		doc.settlement = status;
		doc.updatedAt = new Date().toISOString();
		if (status === 'verified' && doc.state === 'accepted') doc.state = 'paid';
	}

	async getDocumentLog(documentId: string): Promise<ObpStoredMessage[]> {
		return this.logs.get(documentId) ?? [];
	}

	async enqueueOutbox(entry: ObpOutboxEntry): Promise<void> {
		this.outbox.set(entry.envelope.messageId, entry);
	}

	async updateOutbox(messageId: string, patch: Partial<ObpOutboxEntry>): Promise<void> {
		const cur = this.outbox.get(messageId);
		if (cur) this.outbox.set(messageId, { ...cur, ...patch });
	}

	async getOutbox(messageId: string): Promise<ObpOutboxEntry | undefined> {
		return this.outbox.get(messageId);
	}

	async pendingOutbox(): Promise<ObpOutboxEntry[]> {
		return Array.from(this.outbox.values()).filter((e) => !e.deliveredAt);
	}

	async savePolicyRecord(record: ObpPolicyRecord): Promise<void> {
		this.policyRecords.push(record);
	}

	async savePendingApproval(pending: ObpPendingApproval): Promise<void> {
		this.pending.set(pending.pendingId, pending);
	}

	async getPendingApproval(pendingId: string): Promise<ObpPendingApproval | undefined> {
		return this.pending.get(pendingId);
	}

	async getPendingApprovalForDocument(
		documentId: string
	): Promise<ObpPendingApproval | undefined> {
		for (const p of this.pending.values()) {
			if (p.envelopeDraft.documentId === documentId && !p.resolvedAt) return p;
		}
		return undefined;
	}

	async resolvePendingApproval(pendingId: string, approverGrantId: string): Promise<void> {
		const p = this.pending.get(pendingId);
		if (p) {
			p.resolvedAt = new Date().toISOString();
			p.approvedByGrantId = approverGrantId;
		}
	}

	async appendAudit(entry: ObpAuditEntry): Promise<void> {
		this.audit.push(entry);
	}

	async listAudit(limit?: number): Promise<ObpAuditEntry[]> {
		return limit === undefined ? [...this.audit] : this.audit.slice(-limit);
	}
}
