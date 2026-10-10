/**
 * Wallet-independent settlement verification for Lightning payments.
 *
 * A BOLT-11 payment hash is the SHA-256 of its preimage, so a claimed
 * settlement can be **cryptographically verified locally** — no wallet
 * RPC required: `sha256(preimage) === paymentHash`. Only evidence whose
 * preimage matches flips an invoice to `verified`; anything else stays
 * `pending` (manual/bank/unverified claims) or `failed` (mismatch).
 *
 * For non-Lightning methods (or wallets that support `lookup_invoice`),
 * plug a provider-backed verifier alongside this one; the node keeps
 * payment `pending` until one returns `verified`.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { fromHex, toHex } from '../canonical';
import type { SettlementVerifier } from './business-node';
import type { ObpEnvelope } from '../types';

const PREIMAGE_PREFIX = 'preimage:';

export class LightningPreimageVerifier implements SettlementVerifier {
	async verify(paymentEvidence: ObpEnvelope): Promise<{
		status: 'verified' | 'pending' | 'failed';
		detail?: string;
	}> {
		const settlement = paymentEvidence.settlement;
		if (!settlement) return { status: 'pending', detail: 'no settlement claim' };

		if (settlement.method === 'lightning') {
			const preimage = settlement.detail?.startsWith(PREIMAGE_PREFIX)
				? settlement.detail.slice(PREIMAGE_PREFIX.length)
				: undefined;
			if (!preimage) {
				return { status: 'pending', detail: 'no preimage presented' };
			}
			try {
				const derived = toHex(sha256(fromHex(preimage)));
				if (derived === settlement.externalId) {
					return { status: 'verified', detail: 'preimage matches payment hash' };
				}
				return { status: 'failed', detail: 'preimage does not match payment hash' };
			} catch {
				return { status: 'failed', detail: 'malformed preimage' };
			}
		}

		// Manual/bank/mobile claims are never auto-verified: a human or a
		// provider-backed verifier must confirm them.
		return { status: 'pending', detail: `method ${settlement.method} requires provider verification` };
	}
}
