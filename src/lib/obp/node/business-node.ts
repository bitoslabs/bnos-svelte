/**
 * Business Node — the durable OBP runtime for one organization.
 *
 * Responsibilities (from `docs/OBP_OVERVIEW.md` "What is inside one node?"):
 * - compose + sign outgoing documents under policy,
 * - verify incoming messages (schema, hash, signature, delegation,
 *   audience, expiry, references, transitions, replay),
 * - persist inbound message + decision atomically with deduplication,
 * - keep a durable outbox where transport delivery is tracked separately
 *   from business acceptance and retried after restarts,
 * - maintain append-only document logs, projections and an audit trail,
 * - keep payment state `pending` until a settlement verifier confirms.
 *
 * v0.1 trust model: counterparties are preconfigured in the registry;
 * humans approve purchase orders and every payment (`DefaultObpPolicy`).
 */
import { verifyPayloadHash } from '../canonical';
import { signEnvelope, verifyEnvelopeSignature } from '../signature';
import {
	OBP_PROTOCOL,
	OBP_VERSION,
	type ObpAction,
	type ObpDecision,
	type ObpDeliveryTerms,
	type ObpDocumentType,
	type ObpEnvelope,
	type ObpError,
	type ObpLineItem,
	type ObpReference,
	type ObpSettlement,
	type ObpUnsignedEnvelope
} from '../types';
import { checkIssueReferences, checkTransition, type ObpDocumentProjection } from '../lifecycle';
import { verifyDelegation, type ObpOrganization, type ObpRegistry } from '../identity';
import { DefaultObpPolicy, type ObpPolicyEngine, type ObpPolicyRecord } from '../policy';
import { isExpired, validateEnvelope } from '../validate';
import type { ObpOutboxEntry, ObpStoredMessage, ObpStores } from './store';
import type { ObpTransport, ObpTransportResult } from './transport';

/** Thrown when policy requires a human approval before sending. */
export class ObpApprovalRequiredError extends Error {
	constructor(
		public readonly pendingId: string,
		public readonly policyRecord: ObpPolicyRecord
	) {
		super(`approval required: ${policyRecord.reason}`);
		this.name = 'ObpApprovalRequiredError';
	}
}

/** Thrown when policy denies the action outright. */
export class ObpPolicyDeniedError extends Error {
	constructor(public readonly error: ObpError) {
		super(error.message);
		this.name = 'ObpPolicyDeniedError';
	}
}

/** Thrown for local validation/authorization failures before sending. */
export class ObpInvalidError extends Error {
	constructor(public readonly error: ObpError) {
		super(error.message);
		this.name = 'ObpInvalidError';
	}
}

/** Verifiable settlement source for payment evidence. */
export interface SettlementVerifier {
	verify(paymentEvidence: ObpEnvelope): Promise<{
		status: 'verified' | 'pending' | 'failed';
		detail?: string;
	}>;
}

/** Deterministic verifier for pilots and tests. */
export class SimulatedSettlementVerifier implements SettlementVerifier {
	constructor(
		private readonly decide: (evidence: ObpEnvelope) => 'verified' | 'pending' | 'failed' = () =>
			'verified'
	) {}
	async verify(paymentEvidence: ObpEnvelope) {
		return { status: this.decide(paymentEvidence) };
	}
}

export interface BusinessNodeConfig {
	/** This node's organization (own keys, own database). */
	org: ObpOrganization;
	/** Preconfigured trust: own org grants + trusted counterparties. */
	registry: ObpRegistry;
	stores: ObpStores;
	/** grantId → secret key for this org's signers. */
	signers: Map<string, Uint8Array>;
	transport?: ObpTransport;
	settlementVerifier?: SettlementVerifier;
	policy?: ObpPolicyEngine;
	/** Default validity window for issued documents (ms). */
	defaultValidityMs?: number;
	now?: () => Date;
}

export interface IssueInput {
	documentType: ObpDocumentType;
	/** Pre-agreed document id; generated when omitted. */
	documentId?: string;
	signerKeyId: string;
	recipient: string;
	currency: string;
	lines?: ObpLineItem[];
	totalsMinor?: number;
	references?: ObpReference[];
	settlement?: ObpSettlement;
	deliveryTerms?: ObpDeliveryTerms;
	taxMinor?: number;
	shippingMinor?: number;
	expiresAt?: string;
	note?: string;
	/** Confidential by default; fail closed when the transport cannot encrypt. */
	confidential?: boolean;
}

export interface RespondInput {
	documentId: string;
	action: 'accept' | 'reject' | 'cancel';
	signerKeyId: string;
	note?: string;
}

export type ReceiveResult = {
	decision: ObpDecision;
	error?: ObpError;
	duplicate: boolean;
	document?: ObpDocumentProjection;
};

export type SendResult = {
	envelope: ObpEnvelope;
	/** Transport-level delivery state; business acceptance is separate. */
	delivered: boolean;
	transportError?: string;
};

export class BusinessNode {
	readonly org: ObpOrganization;
	private readonly registry: ObpRegistry;
	private readonly stores: ObpStores;
	private readonly signers: Map<string, Uint8Array>;
	private readonly transport?: ObpTransport;
	private readonly settlementVerifier?: SettlementVerifier;
	private readonly policy: ObpPolicyEngine;
	private readonly defaultValidityMs: number;
	private readonly now: () => Date;
	/** Serializes receive() so duplicate/concurrent delivery is deterministic. */
	private receiveChain: Promise<unknown> = Promise.resolve();

	constructor(config: BusinessNodeConfig) {
		this.org = config.org;
		this.registry = config.registry;
		this.stores = config.stores;
		this.signers = config.signers;
		this.transport = config.transport;
		this.settlementVerifier = config.settlementVerifier;
		this.policy = config.policy ?? new DefaultObpPolicy();
		this.defaultValidityMs = config.defaultValidityMs ?? 7 * 24 * 60 * 60 * 1000;
		this.now = config.now ?? (() => new Date());
	}

	// ── Outgoing ────────────────────────────────────────────────────

	/** Compose, authorize, sign and queue a new document for delivery. */
	async issue(input: IssueInput): Promise<SendResult> {
		const nowIso = this.now().toISOString();
		const unsigned: ObpUnsignedEnvelope = {
			protocol: OBP_PROTOCOL,
			version: OBP_VERSION,
			messageId: crypto.randomUUID(),
			documentId: input.documentId ?? crypto.randomUUID(),
			documentType: input.documentType,
			action: 'issue',
			issuer: this.org.orgId,
			signerKeyId: input.signerKeyId,
			signerPubkey: '',
			recipient: input.recipient,
			createdAt: nowIso,
			expiresAt:
				input.expiresAt ?? new Date(this.now().getTime() + this.defaultValidityMs).toISOString(),
			currency: input.currency,
			lines: input.lines ?? [],
			totalsMinor:
				input.totalsMinor ??
				(input.lines ?? []).reduce((sum, l) => sum + l.quantity * l.unitPriceMinor, 0),
			taxMinor: input.taxMinor,
			shippingMinor: input.shippingMinor,
			references: input.references ?? [],
			settlement: input.settlement,
			deliveryTerms: input.deliveryTerms,
			note: input.note
		};

		const grant = this.resolveOwnSigner(unsigned.signerKeyId, unsigned.documentType, 'issue');
		unsigned.signerPubkey = grant.pubkey;

		const invalid = validateEnvelope(unsigned, { partial: true });
		if (invalid) throw new ObpInvalidError(invalid);

		if (unsigned.action === 'issue' && unsigned.documentType !== 'rfq') {
			await this.preloadDocs(unsigned.references.map((r) => r.documentId));
			const refError = checkIssueReferences(unsigned, (id) => this.syncView.get(id));
			if (refError) throw new ObpInvalidError(refError);
		}

		const approvedToday = await this.paymentsApprovedTodayMinor();
		const evaluation = this.policy.evaluate(unsigned, grant, { approvedTodayMinor: approvedToday });
		await this.stores.savePolicyRecord(evaluation.record);
		if (evaluation.decision === 'deny') throw new ObpPolicyDeniedError(evaluation.error!);
		if (evaluation.decision === 'requires_approval') {
			const pendingId = crypto.randomUUID();
			await this.stores.savePendingApproval({
				pendingId,
				envelopeDraft: unsigned,
				policyRecord: evaluation.record,
				requestedAt: nowIso
			});
			await this.stores.appendAudit({
				at: this.now().toISOString(),
				kind: 'approval',
				documentId: unsigned.documentId,
				detail: `approval required: ${evaluation.record.reason}`
			});
			throw new ObpApprovalRequiredError(pendingId, evaluation.record);
		}

		return this.send(unsigned);
	}

	/** Record a human approval and complete the held send. */
	async approve(pendingId: string, approverGrantId: string): Promise<SendResult> {
		const pending = await this.stores.getPendingApproval(pendingId);
		if (!pending || pending.resolvedAt) {
			throw new ObpInvalidError({ code: 'OBP-E13', message: `no pending approval ${pendingId}` });
		}
		const approver = this.registry.getGrant(approverGrantId);
		if (!approver || approver.orgId !== this.org.orgId || approver.role !== 'owner') {
			throw new ObpInvalidError({
				code: 'OBP-E12',
				message: `approver ${approverGrantId} is not an owner of ${this.org.orgId}`
			});
		}
		const signer = this.registry.getGrant(pending.envelopeDraft.signerKeyId);
		if (!signer) {
			throw new ObpInvalidError({
				code: 'OBP-E04',
				message: `original signer ${pending.envelopeDraft.signerKeyId} gone`
			});
		}
		const evaluation = this.policy.evaluate(pending.envelopeDraft, signer, {
			hasHumanApproval: true,
			approvedTodayMinor: await this.paymentsApprovedTodayMinor()
		});
		if (evaluation.decision === 'deny') throw new ObpPolicyDeniedError(evaluation.error!);
		await this.stores.resolvePendingApproval(pendingId, approverGrantId);
		await this.stores.savePolicyRecord({
			...evaluation.record,
			approvedByGrantId: approverGrantId,
			approvedAt: this.now().toISOString()
		});
		await this.stores.appendAudit({
			at: this.now().toISOString(),
			kind: 'approval',
			documentId: pending.envelopeDraft.documentId,
			detail: `approved by ${approverGrantId}`
		});
		return this.send(pending.envelopeDraft);
	}

	/** accept / reject / cancel an existing (in- or outbound) document. */
	async respond(input: RespondInput): Promise<SendResult> {
		const doc = await this.stores.getDocument(input.documentId);
		if (!doc) {
			throw new ObpInvalidError({
				code: 'OBP-E09',
				message: `document ${input.documentId} not found`
			});
		}
		const unsigned: ObpUnsignedEnvelope = {
			protocol: OBP_PROTOCOL,
			version: OBP_VERSION,
			messageId: crypto.randomUUID(),
			documentId: doc.documentId,
			documentType: doc.documentType,
			action: input.action,
			issuer: this.org.orgId,
			signerKeyId: input.signerKeyId,
			signerPubkey: '',
			recipient: doc.issuer === this.org.orgId ? doc.recipient : doc.issuer,
			createdAt: this.now().toISOString(),
			expiresAt: new Date(this.now().getTime() + this.defaultValidityMs).toISOString(),
			currency: doc.currency,
			lines: [],
			totalsMinor: 0,
			references: [],
			note: input.note
		};
		const grant = this.resolveOwnSigner(unsigned.signerKeyId, doc.documentType, input.action);
		unsigned.signerPubkey = grant.pubkey;

		const invalid = validateEnvelope(unsigned, { partial: true });
		if (invalid) throw new ObpInvalidError(invalid);

		const transitionError = checkTransition(
			{
				documentId: doc.documentId,
				action: input.action,
				issuer: this.org.orgId,
				createdAt: unsigned.createdAt
			},
			doc
		);
		if (transitionError) throw new ObpInvalidError(transitionError);

		const evaluation = this.policy.evaluate(unsigned, grant, {});
		if (evaluation.decision === 'deny') throw new ObpPolicyDeniedError(evaluation.error!);
		await this.stores.savePolicyRecord(evaluation.record);

		return this.send(unsigned);
	}

	/** Retry all undelivered outbox entries (e.g. after a restart). */
	async retryOutbox(): Promise<{ retried: number; delivered: number }> {
		const pending = await this.stores.pendingOutbox();
		let delivered = 0;
		for (const entry of pending) {
			if (entry.lastError === 'encryption-unavailable') continue;
			const result = await this.attemptDelivery(entry, true);
			if (result.delivered) delivered++;
		}
		return { retried: pending.length, delivered };
	}

	// ── Incoming ────────────────────────────────────────────────────

	/** Bind a transport handler; used by LoopbackNetwork.connect. */
	bindTransportHandler(): (envelope: unknown) => void {
		return (envelope: unknown) => {
			void this.receive(envelope as ObpEnvelope);
		};
	}

	/**
	 * Full inbound verification pipeline. The inbound message and its
	 * decision are persisted atomically; duplicates return the stored
	 * decision without re-applying effects.
	 */
	receive(envelope: unknown): Promise<ReceiveResult> {
		const run = this.verifyAndAccept(envelope);
		this.receiveChain = this.receiveChain.then(
			() => run,
			() => run
		);
		return run;
	}

	private async verifyAndAccept(envelopeRaw: unknown): Promise<ReceiveResult> {
		const envelope = envelopeRaw as ObpEnvelope;
		const drop = (error: ObpError): ReceiveResult => ({
			decision: 'rejected',
			error,
			duplicate: false
		});

		// 1. Schema & version. Garbage is dropped without persistence.
		const invalid = validateEnvelope(envelope);
		if (invalid) return drop(invalid);

		// 2. Payload hash binds the fields; signature covers the same bytes.
		if (!verifyPayloadHash(envelope)) {
			return drop({ code: 'OBP-E02', message: 'payloadHash does not match canonical bytes' });
		}
		if (!verifyEnvelopeSignature(envelope, envelope.signerPubkey)) {
			return drop({ code: 'OBP-E02', message: 'signature verification failed' });
		}

		// From here the message is well-formed and authenticated: persist
		// every decision so replays deterministically return the same one.
		const rejectPersisted = async (error: ObpError): Promise<ReceiveResult> => {
			const stored = await this.stores.recordInbox(envelope.messageId, {
				envelope,
				receivedAt: this.now().toISOString(),
				decision: 'rejected',
				error
			});
			await this.stores.appendAudit({
				at: this.now().toISOString(),
				kind: 'receive',
				messageId: envelope.messageId,
				documentId: envelope.documentId,
				detail: `rejected ${envelope.documentType}.${envelope.action}: ${error.code}`
			});
			return { decision: 'rejected', error, duplicate: stored.duplicate };
		};

		// 3. Issuer trust + signer delegation.
		const delegation = verifyDelegation(this.registry, {
			issuer: envelope.issuer,
			signerKeyId: envelope.signerKeyId,
			pubkey: envelope.signerPubkey,
			documentType: envelope.documentType,
			action: envelope.action,
			at: this.now()
		});
		if ('error' in delegation) return rejectPersisted(delegation.error);

		// 4. Audience.
		if (envelope.recipient !== this.org.orgId) {
			return rejectPersisted({
				code: 'OBP-E07',
				message: `message for ${envelope.recipient}, this node is ${this.org.orgId}`
			});
		}

		// 5. Expiry.
		if (isExpired(envelope, this.now())) {
			return rejectPersisted({
				code: 'OBP-E08',
				message: `message expired at ${envelope.expiresAt}`
			});
		}

		// 6. Idempotency: replayed messageId returns the same decision.
		const prior = await this.stores.getInbox(envelope.messageId);
		if (prior) {
			return {
				decision: prior.decision,
				error: prior.error,
				duplicate: true,
				document: await this.stores.getDocument(envelope.documentId)
			};
		}

		// 7. Lifecycle: references + transitions against local projections.
		let lifecycleError: ObpError | null = null;
		if (envelope.action === 'issue') {
			if (envelope.documentType !== 'rfq') {
				await this.preloadDocs(envelope.references.map((r) => r.documentId));
				lifecycleError = checkIssueReferences(envelope, (id) => this.syncView.get(id));
			}
		} else {
			const doc = await this.stores.getDocument(envelope.documentId);
			lifecycleError = checkTransition(
				{
					documentId: envelope.documentId,
					action: envelope.action,
					issuer: envelope.issuer,
					createdAt: envelope.createdAt
				},
				doc
			);
		}
		if (lifecycleError) return rejectPersisted(lifecycleError);

		// 8. Persist message + accepted decision atomically, then project.
		const stored = await this.stores.recordInbox(envelope.messageId, {
			envelope,
			receivedAt: this.now().toISOString(),
			decision: 'accepted'
		});
		if (stored.duplicate) {
			return {
				decision: stored.stored.decision,
				error: stored.stored.error,
				duplicate: true,
				document: await this.stores.getDocument(envelope.documentId)
			};
		}
		const doc = await this.stores.appendDocument(envelope, 'accepted');
		await this.stores.appendAudit({
			at: this.now().toISOString(),
			kind: 'receive',
			messageId: envelope.messageId,
			documentId: envelope.documentId,
			detail: `accepted ${envelope.documentType}.${envelope.action}`
		});

		// 9. Payment evidence enters settlement verification (never auto-paid).
		if (envelope.documentType === 'payment_evidence' && envelope.action === 'issue') {
			const invoiceRef = envelope.references.find((r) => r.documentType === 'invoice');
			if (invoiceRef) await this.stores.setSettlement(invoiceRef.documentId, 'pending');
			await this.verifySettlement(envelope, invoiceRef?.documentId);
		}

		return { decision: 'accepted', duplicate: false, document: doc };
	}

	// ── Queries ─────────────────────────────────────────────────────

	async getDocument(documentId: string): Promise<ObpDocumentProjection | undefined> {
		return this.stores.getDocument(documentId);
	}
	async listDocuments(): Promise<ObpDocumentProjection[]> {
		return this.stores.listDocuments();
	}
	async getDocumentLog(documentId: string): Promise<ObpStoredMessage[]> {
		return this.stores.getDocumentLog(documentId);
	}
	async listAudit(limit?: number) {
		return this.stores.listAudit(limit);
	}
	async pendingOutbox() {
		return this.stores.pendingOutbox();
	}

	// ── Internals ───────────────────────────────────────────────────

	/** Payment evidence totals already approved today (spend context). */
	private async paymentsApprovedTodayMinor(): Promise<number> {
		const entries = await this.stores.pendingOutbox();
		const today = this.now().toISOString().slice(0, 10);
		return entries
			.filter(
				(e) =>
					e.envelope.documentType === 'payment_evidence' &&
					e.envelope.action === 'issue' &&
					e.envelope.issuer === this.org.orgId &&
					e.envelope.createdAt.slice(0, 10) === today
			)
			.reduce((sum, e) => sum + e.envelope.totalsMinor, 0);
	}

	private async verifySettlement(evidence: ObpEnvelope, invoiceId?: string): Promise<void> {
		if (!this.settlementVerifier || !invoiceId) return;
		const outcome = await this.settlementVerifier.verify(evidence);
		await this.stores.setSettlement(
			invoiceId,
			outcome.status === 'verified' ? 'verified' : outcome.status
		);
		await this.stores.appendAudit({
			at: this.now().toISOString(),
			kind: 'settlement',
			documentId: invoiceId,
			messageId: evidence.messageId,
			detail: `settlement ${outcome.status}${outcome.detail ? `: ${outcome.detail}` : ''}`
		});
	}

	private resolveOwnSigner(grantId: string, documentType: ObpDocumentType, action: ObpAction) {
		const grant = this.registry.getGrant(grantId);
		if (!grant || grant.orgId !== this.org.orgId) {
			throw new ObpInvalidError({
				code: 'OBP-E04',
				message: `signer ${grantId} is not a grant of ${this.org.orgId}`
			});
		}
		if (!this.signers.has(grantId)) {
			throw new ObpInvalidError({
				code: 'OBP-E04',
				message: `no secret key loaded for signer ${grantId}`
			});
		}
		const failure = verifyDelegation(this.registry, {
			issuer: this.org.orgId,
			signerKeyId: grantId,
			pubkey: grant.pubkey,
			documentType,
			action,
			at: this.now()
		});
		if ('error' in failure) throw new ObpInvalidError(failure.error);
		return grant;
	}

	/** Sign, queue in the outbox, attempt delivery, project locally. */
	private async send(unsigned: ObpUnsignedEnvelope): Promise<SendResult> {
		const secretKey = this.signers.get(unsigned.signerKeyId)!;
		const envelope = signEnvelope(unsigned, secretKey);
		const entry: ObpOutboxEntry = {
			envelope,
			queuedAt: this.now().toISOString(),
			attempts: 0
		};
		await this.stores.enqueueOutbox(entry);
		await this.stores.appendDocument(envelope, 'accepted');
		await this.stores.appendAudit({
			at: this.now().toISOString(),
			kind: 'send',
			messageId: envelope.messageId,
			documentId: envelope.documentId,
			detail: `sent ${envelope.documentType}.${envelope.action}`
		});
		const delivery = await this.attemptDelivery(entry, false);
		if (!delivery.ok && delivery.error === 'encryption-unavailable') {
			await this.stores.appendAudit({
				at: this.now().toISOString(),
				kind: 'send',
				messageId: envelope.messageId,
				detail: 'held in outbox: confidential document, transport cannot encrypt'
			});
		}

		// The payer also verifies settlement through its own wallet/provider
		// ("pay approved invoice"), so both sides converge on the same
		// payment fact independently of each other's nodes.
		if (envelope.documentType === 'payment_evidence' && envelope.action === 'issue') {
			const invoiceRef = envelope.references.find((r) => r.documentType === 'invoice');
			if (invoiceRef) {
				await this.stores.setSettlement(invoiceRef.documentId, 'pending');
				await this.verifySettlement(envelope, invoiceRef.documentId);
			}
		}

		return {
			envelope,
			delivered: delivery.ok,
			transportError: delivery.ok ? undefined : delivery.error
		};
	}

	private async attemptDelivery(
		entry: ObpOutboxEntry,
		isRetry: boolean
	): Promise<ObpTransportResult & { delivered: boolean }> {
		if (!this.transport)
			return { ok: false, error: 'no-transport', retryable: false, delivered: false };
		// Every v0.1 document type is bilateral and confidential; public
		// offers arrive with the discovery extension and an explicit
		// visibility policy.
		const confidential = true;
		const result = await this.transport.deliver(entry.envelope, {
			confidential,
			recipient: entry.envelope.recipient
		});
		await this.stores.updateOutbox(entry.envelope.messageId, {
			attempts: entry.attempts + 1,
			lastAttemptAt: this.now().toISOString(),
			lastError: result.ok ? undefined : result.error,
			deliveredAt: result.ok ? this.now().toISOString() : undefined,
			transportId: result.transportId
		});
		if (isRetry) {
			await this.stores.appendAudit({
				at: this.now().toISOString(),
				kind: 'retry',
				messageId: entry.envelope.messageId,
				detail: result.ok ? 'delivered on retry' : `retry failed: ${result.error}`
			});
		}
		return { ...result, delivered: result.ok };
	}

	private syncView = new Map<string, ObpDocumentProjection | undefined>();

	/** Preload projections for synchronous lifecycle checks. */
	private async preloadDocs(ids: string[]): Promise<void> {
		this.syncView.clear();
		for (const id of ids) this.syncView.set(id, await this.stores.getDocument(id));
	}
}
