import { describe, expect, it } from 'vitest';
import {
	buildLoyaltyTx,
	creditForPoints,
	maxRedeem,
	pointsForCredit,
	pointsForSpend
} from './loyalty';

describe('loyalty engine', () => {
	it('earns whole points for spend (floored)', () => {
		expect(pointsForSpend(100, 1)).toBe(100);
		expect(pointsForSpend(99.9, 1)).toBe(99);
		expect(pointsForSpend(50, 2)).toBe(100); // 2 pts per unit
		expect(pointsForSpend(0, 1)).toBe(0);
		expect(pointsForSpend(-10, 1)).toBe(0);
	});

	it('converts points ↔ credit', () => {
		// pointValue 0.01 → 100 pts = $1
		expect(creditForPoints(100, 0.01)).toBe(1);
		expect(creditForPoints(250, 0.01)).toBe(2.5);
		expect(pointsForCredit(1, 0.01)).toBe(100); // ceil
		expect(pointsForCredit(2.5, 0.01)).toBe(250);
	});

	it('caps redemption at the sale total and the balance', () => {
		// balance 1000 pts @0.01 = $10 credit possible, but sale only $6
		const r = maxRedeem(1000, 0.01, 6);
		expect(r.credit).toBe(6);
		expect(r.points).toBe(600);
		expect(r.remainderPoints).toBe(400);

		// balance smaller than the cap → redeem all
		const r2 = maxRedeem(300, 0.01, 1000);
		expect(r2.credit).toBe(3);
		expect(r2.points).toBe(300);
		expect(r2.remainderPoints).toBe(0);
	});

	it('returns zeros for no balance / no cap', () => {
		expect(maxRedeem(0, 0.01, 100)).toEqual({ credit: 0, points: 0, remainderPoints: 0 });
		expect(maxRedeem(500, 0.01, 0)).toEqual({ credit: 0, points: 0, remainderPoints: 500 });
	});

	it('builds a ledger transaction record', () => {
		const tx = buildLoyaltyTx({
			customerId: 'c1',
			type: 'earn',
			points: 50,
			balanceAfter: 150,
			reason: 'Sale reward',
			orderId: 'ORD-1'
		});
		expect(tx).toMatchObject({ customerId: 'c1', type: 'earn', points: 50, balanceAfter: 150 });
	});
});
