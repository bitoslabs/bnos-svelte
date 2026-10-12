/**
 * Lightning preimage settlement verification tests — real SHA-256
 * preimage/payment-hash pairs, plus the pending/failed paths.
 */
import { describe, expect, it } from 'vitest';
import { sha256 } from '@noble/hashes/sha2.js';
import { toHex, fromHex } from '../canonical';
import { LightningPreimageVerifier } from './settlement';
import type { ObpEnvelope } from '../types';

const verifier = new LightningPreimageVerifier();

function evidence(settlement: ObpEnvelope['settlement']): ObpEnvelope {
	return { settlement } as ObpEnvelope;
}

describe('LightningPreimageVerifier', () => {
	it('verifies a genuine preimage against its payment hash', async () => {
		const preimage = fromHex('ab'.repeat(32));
		const paymentHash = toHex(sha256(preimage));
		const result = await verifier.verify(
			evidence({
				method: 'lightning',
				externalId: paymentHash,
				detail: `preimage:${'ab'.repeat(32)}`
			})
		);
		expect(result).toEqual({
			status: 'verified',
			detail: 'preimage matches payment hash'
		});
	});

	it('fails a preimage that does not match the payment hash', async () => {
		const result = await verifier.verify(
			evidence({
				method: 'lightning',
				externalId: 'cd'.repeat(32),
				detail: `preimage:${'ab'.repeat(32)}`
			})
		);
		expect(result.status).toBe('failed');
	});

	it('fails malformed preimages instead of crashing', async () => {
		const result = await verifier.verify(
			evidence({ method: 'lightning', externalId: '00'.repeat(32), detail: 'preimage:zzzz' })
		);
		expect(result.status).toBe('failed');
	});

	it('keeps lightning claims without a preimage pending', async () => {
		const result = await verifier.verify(
			evidence({ method: 'lightning', externalId: '00'.repeat(32) })
		);
		expect(result.status).toBe('pending');
	});

	it('never auto-verifies manual or bank methods', async () => {
		for (const method of ['manual', 'bank_transfer', 'mobile_payment']) {
			const result = await verifier.verify(evidence({ method, externalId: 'rcpt-1' }));
			expect(result.status).toBe('pending');
		}
	});
});
