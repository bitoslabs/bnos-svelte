/**
 * OBP policy engine — spend authorization and human approval gates.
 *
 * Policy evaluation returns `allow`, `deny` or `requires_approval` with a
 * signed decision record and reason. Layered on top of `identity.ts`:
 * delegation says *who may sign at all*; policy says *whether this node
 * will let the money move without a human*.
 *
 * v0.1 rules from the system plan:
 * - humans sign purchase orders,
 * - every payment is approved,
 * - agents never receive signing or wallet authority.
 */
import type { ObpUnsignedEnvelope, ObpError } from './types';
import type { ObpKeyGrant } from './identity';

export type ObpPolicyDecision = 'allow' | 'deny' | 'requires_approval';

/** Extra context the node supplies when evaluating an outgoing action. */
export interface ObpPolicyContext {
	/** Minor units already approved today for this org (payments). */
	approvedTodayMinor?: number;
	/** An explicit human approval record exists for this action. */
	hasHumanApproval?: boolean;
}

/** Signed policy decision record (stored + auditable). */
export interface ObpPolicyRecord {
	decision: ObpPolicyDecision;
	reason: string;
	signerGrantId: string;
	documentId: string;
	evaluatedAt: string;
	/** Approver grant when `requires_approval` was later satisfied. */
	approvedByGrantId?: string;
	approvedAt?: string;
}

export interface ObpPolicyEngine {
	/**
	 * Evaluate an outgoing message under the local org's spending rules.
	 * `grant` is the resolved signing credential from the registry.
	 */
	evaluate(
		envelope: ObpUnsignedEnvelope,
		grant: ObpKeyGrant,
		context: ObpPolicyContext
	): { decision: ObpPolicyDecision; error?: ObpError; record: ObpPolicyRecord };
}

/**
 * Default v0.1 policy:
 *
 * | Action                  | owner          | staff/device | agent |
 * | ----------------------- | -------------- | ------------ | ----- |
 * | rfq/quote issue         | allow          | allow        | allow (drafting only) |
 * | accept/reject/cancel    | allow          | allow        | deny  |
 * | purchase_order issue    | allow          | requires_approval above grant limit | deny |
 * | invoice/receipt issue   | allow          | allow        | deny  |
 * | payment_evidence issue  | allow          | requires_approval (always) | deny  |
 */
export class DefaultObpPolicy implements ObpPolicyEngine {
	evaluate(
		envelope: ObpUnsignedEnvelope,
		grant: ObpKeyGrant,
		context: ObpPolicyContext
	): { decision: ObpPolicyDecision; error?: ObpError; record: ObpPolicyRecord } {
		const evaluatedAt = new Date().toISOString();
		const base = { signerGrantId: grant.grantId, documentId: envelope.documentId, evaluatedAt };
		const { action, documentType } = envelope;

		// Agents draft, humans decide: agents may only issue RFQs.
		if (grant.role === 'agent' && !(documentType === 'rfq' && action === 'issue')) {
			return {
				decision: 'deny',
				error: {
					code: 'OBP-E12',
					message: `agents may only draft rfq.issue in v0.1 (${grant.grantId})`
				},
				record: { ...base, decision: 'deny', reason: 'agent-scope' }
			};
		}

		if (documentType === 'purchase_order' && action === 'issue') {
			const limit = grant.scope.maxAmountMinor;
			if (limit !== undefined && envelope.currency !== (grant.scope.currency ?? envelope.currency)) {
				return {
					decision: 'deny',
					error: {
						code: 'OBP-E12',
						message: `grant limit currency ${grant.scope.currency} != envelope ${envelope.currency}; limits are never converted`
					},
					record: { ...base, decision: 'deny', reason: 'currency-mismatch' }
				};
			}
			const overLimit = limit !== undefined && envelope.totalsMinor > limit;
			const needsHuman = grant.role !== 'owner' || overLimit;
			if (needsHuman && !context.hasHumanApproval) {
				return {
					decision: 'requires_approval',
					error: {
						code: 'OBP-E13',
						message: overLimit
							? `purchase order ${envelope.totalsMinor} exceeds grant limit ${limit}; owner approval required`
							: `purchase orders require human approval in v0.1 (signer ${grant.grantId})`
					},
					record: { ...base, decision: 'requires_approval', reason: overLimit ? 'over-limit' : 'human-approval' }
				};
			}
			return { decision: 'allow', record: { ...base, decision: 'allow', reason: 'within-policy' } };
		}

		if (documentType === 'payment_evidence' && action === 'issue') {
			const daily = grant.scope.dailyLimitMinor;
			const approved = context.approvedTodayMinor ?? 0;
			if (daily !== undefined && approved + envelope.totalsMinor > daily) {
				return {
					decision: 'deny',
					error: {
						code: 'OBP-E12',
						message: `daily spend limit ${daily} exceeded (${approved} approved + ${envelope.totalsMinor} pending)`
					},
					record: { ...base, decision: 'deny', reason: 'daily-limit' }
				};
			}
			// Every payment is approved by a human in v0.1: the owner signing
			// the evidence IS the human approval; anyone else needs one.
			if (grant.role !== 'owner' && !context.hasHumanApproval) {
				return {
					decision: 'requires_approval',
					error: {
						code: 'OBP-E13',
						message: 'every payment requires human approval in v0.1'
					},
					record: { ...base, decision: 'requires_approval', reason: 'payment-approval' }
				};
			}
			return { decision: 'allow', record: { ...base, decision: 'allow', reason: 'payment-approved' } };
		}

		return { decision: 'allow', record: { ...base, decision: 'allow', reason: 'within-policy' } };
	}
}
