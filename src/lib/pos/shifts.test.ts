import { describe, expect, it } from 'vitest';
import { computeShiftSummary, shiftMatchesBranch } from './shifts.svelte';

describe('shiftMatchesBranch', () => {
	/** A shift "belongs" to a branch when its `branchId` equals the target. Both
	 *  `undefined` collapse to "no branch" so single-site tenants keep matching
	 *  their legacy global shifts. */
	it('matches when both branch ids are present and equal', () => {
		expect(shiftMatchesBranch({ data: { branchId: 'loc-1' } }, 'loc-1')).toBe(true);
	});

	it('does not match a different branch', () => {
		expect(shiftMatchesBranch({ data: { branchId: 'loc-1' } }, 'loc-2')).toBe(false);
	});

	it('matches undefined ↔ null/undefined (single-site legacy shifts)', () => {
		expect(shiftMatchesBranch({ data: { branchId: undefined } }, null)).toBe(true);
		expect(shiftMatchesBranch({ data: { branchId: undefined } }, undefined)).toBe(true);
		expect(shiftMatchesBranch({ data: {} }, null)).toBe(true);
	});

	it('does not match a branch shift against a null target (cross-branch isolation)', () => {
		// The core fix: branch A's shift must NOT be treated as the active shift
		// when the device is operating on branch B (or single-site mode).
		expect(shiftMatchesBranch({ data: { branchId: 'loc-1' } }, 'loc-2')).toBe(false);
		expect(shiftMatchesBranch({ data: { branchId: 'loc-1' } }, null)).toBe(false);
	});
});

describe('computeShiftSummary', () => {
	const order = (total: number, status = 'completed') => ({ data: { total, status } });
	const payment = (amount: number, method: string, status = 'completed') => ({
		data: { amount, method, status }
	});
	const cashEvent = (
		amount: number,
		type: 'cash_in' | 'cash_out' | 'paid_out' | 'bank_deposit'
	) => ({
		data: { amount, type }
	});

	it('returns zero summary for empty inputs', () => {
		const s = computeShiftSummary({
			openingCash: 0,
			orders: [],
			payments: [],
			cashEvents: []
		});
		expect(s).toMatchObject({
			totalOrders: 0,
			totalSales: 0,
			cashSales: 0,
			cardSales: 0,
			lightningSales: 0,
			qrSales: 0,
			otherSales: 0,
			totalCashIn: 0,
			totalCashOut: 0,
			expectedCash: 0
		});
	});

	it('aggregates gross sales from order totals and counts orders', () => {
		const s = computeShiftSummary({
			openingCash: 0,
			orders: [order(1000), order(2500), order(400)],
			payments: [],
			cashEvents: []
		});
		expect(s.totalOrders).toBe(3);
		expect(s.totalSales).toBe(3900);
	});

	it('splits tender totals by payment method', () => {
		const s = computeShiftSummary({
			openingCash: 0,
			orders: [order(6000)],
			payments: [
				payment(1000, 'cash'),
				payment(2000, 'card'),
				payment(1500, 'lightning'),
				payment(1000, 'qr'),
				payment(500, 'coupon')
			],
			cashEvents: []
		});
		expect(s.cashSales).toBe(1000);
		expect(s.cardSales).toBe(2000);
		expect(s.lightningSales).toBe(1500);
		expect(s.qrSales).toBe(1000);
		expect(s.otherSales).toBe(500);
	});

	it('ignores pending / non-completed payments when totalling tenders', () => {
		const s = computeShiftSummary({
			openingCash: 0,
			orders: [],
			payments: [payment(1000, 'cash', 'pending'), payment(500, 'card', 'failed')],
			cashEvents: []
		});
		expect(s.cashSales).toBe(0);
		expect(s.cardSales).toBe(0);
	});

	it('computes expected cash = opening + cash sales + cash in − cash out − refunds', () => {
		const s = computeShiftSummary({
			openingCash: 500,
			orders: [order(3000, 'completed'), order(800, 'refunded')],
			payments: [payment(3000, 'cash')],
			cashEvents: [cashEvent(200, 'cash_in'), cashEvent(100, 'cash_out')]
		});
		// expected = 500 (opening) + 3000 (cash sales) + 200 (cash in)
		//          − 100 (cash out) − 800 (cash refund) = 2800
		expect(s.expectedCash).toBe(2800);
		expect(s.totalRefunds).toBe(1);
		expect(s.totalRefundAmount).toBe(800);
		expect(s.totalCashIn).toBe(200);
		expect(s.totalCashOut).toBe(100);
	});

	it('keeps opening float as expected cash when nothing happened', () => {
		const s = computeShiftSummary({
			openingCash: 250,
			orders: [],
			payments: [],
			cashEvents: []
		});
		expect(s.expectedCash).toBe(250);
	});
});
