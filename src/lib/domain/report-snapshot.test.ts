import { describe, expect, it } from 'vitest';
import {
	buildReportSnapshot,
	fromMinorUnits,
	parseReportSnapshot,
	snapshotId,
	toMinorUnits,
	type SnapshotOrderRecord,
	type SnapshotPaymentRecord,
	type SnapshotRefundRecord
} from './report-snapshot';

const START = Date.parse('2026-11-09T00:00:00.000Z');
const END = Date.parse('2026-11-10T00:00:00.000Z');

function order(
	id: string,
	input: {
		at: string;
		subtotal: number;
		discount?: number;
		tax?: number;
		total: number;
		method?: string;
		currency?: string;
		branchId?: string;
		status?: string;
		lines?: { productId?: string; name?: string; quantity: number; total: number }[];
		extra?: Record<string, unknown>;
	}
): SnapshotOrderRecord {
	return {
		id,
		scope: { locationId: input.branchId },
		data: {
			status: input.status ?? 'completed',
			currency: input.currency ?? 'USD',
			subtotal: input.subtotal,
			discount: input.discount ?? 0,
			tax: input.tax ?? 0,
			total: input.total,
			occurredAt: input.at,
			method: input.method,
			branchId: input.branchId,
			lines: (input.lines ?? []).map((line, index) => ({
				id: `${id}-${index}`,
				name: line.name ?? 'Item',
				quantity: line.quantity,
				unitPrice: line.total / line.quantity,
				total: line.total,
				productId: line.productId
			})),
			...input.extra
		} as SnapshotOrderRecord['data']
	};
}

function payment(
	id: string,
	input: { at: string; amount: number; method: string; currency?: string; branchId?: string }
): SnapshotPaymentRecord {
	return {
		id,
		scope: { locationId: input.branchId },
		data: {
			amount: input.amount,
			method: input.method,
			currency: input.currency ?? 'USD',
			status: 'completed',
			paidAt: input.at,
			branchId: input.branchId
		}
	};
}

function refund(
	id: string,
	input: { at: string; amount: number; status?: string; currency?: string; branchId?: string }
): SnapshotRefundRecord {
	return {
		id,
		scope: { locationId: input.branchId },
		data: {
			status: (input.status ?? 'completed') as SnapshotRefundRecord['data']['status'],
			totalAmount: input.amount,
			currency: input.currency ?? 'USD',
			completedAt: input.at,
			branchId: input.branchId
		}
	};
}

describe('toMinorUnits', () => {
	it('uses the currency minor digits', () => {
		expect(toMinorUnits(12.34, 'USD')).toBe(1234);
		expect(toMinorUnits(12.345, 'USD')).toBe(1235);
		expect(toMinorUnits(100.9, 'LAK')).toBe(101);
		expect(toMinorUnits(0.00000001, 'BTC')).toBe(1);
		expect(toMinorUnits(5, 'SAT')).toBe(5);
		expect(toMinorUnits(Number.NaN, 'USD')).toBe(0);
	});

	it('converts minor units back for display', () => {
		expect(fromMinorUnits(12_750, 'USD')).toBe(127.5);
		expect(fromMinorUnits(101, 'LAK')).toBe(101);
		expect(fromMinorUnits(1, 'BTC')).toBe(0.00000001);
		expect(fromMinorUnits(Number.NaN, 'USD')).toBe(0);
	});
});

describe('buildReportSnapshot', () => {
	it('reconciles gross, discounts, tax, refunds and net', () => {
		const snapshot = buildReportSnapshot({
			periodStart: START,
			periodEnd: END,
			granularity: 'day',
			currency: 'USD',
			now: END,
			orders: [
				order('o1', {
					at: '2026-11-09T10:00:00.000Z',
					subtotal: 100,
					discount: 10,
					tax: 5,
					total: 95,
					method: 'cash',
					lines: [
						{ productId: 'p1', quantity: 2, total: 40 },
						{ productId: 'p2', quantity: 1, total: 60 }
					]
				}),
				order('o2', {
					at: '2026-11-09T12:00:00.000Z',
					subtotal: 50,
					tax: 2.5,
					total: 52.5,
					method: 'card',
					lines: [{ productId: 'p1', quantity: 1, total: 50 }]
				})
			],
			payments: [
				payment('pay1', { at: '2026-11-09T10:00:00.000Z', amount: 95, method: 'cash' }),
				payment('pay2', { at: '2026-11-09T12:00:00.000Z', amount: 52.5, method: 'card' })
			],
			refunds: [refund('r1', { at: '2026-11-09T13:00:00.000Z', amount: 20 })],
			products: []
		});

		expect(snapshot.grossMinor).toBe(15_000);
		expect(snapshot.discountMinor).toBe(1_000);
		expect(snapshot.taxMinor).toBe(750);
		expect(snapshot.refundMinor).toBe(2_000);
		expect(snapshot.netMinor).toBe(12_750);
		expect(snapshot.ordersCount).toBe(2);
		expect(snapshot.itemsCount).toBe(4);
		expect(snapshot.avgTicketMinor).toBe(7_375);
		expect(snapshot.payments).toEqual({ cash: 9_500, card: 5_250 });
		expect(snapshot.orderStatus).toEqual({ completed: 2 });
		expect(snapshot.timezone).toBeUndefined();
		expect(snapshot.topProducts).toEqual([
			{ productId: 'p1', qty: 3, revenueMinor: 9_000 },
			{ productId: 'p2', qty: 1, revenueMinor: 6_000 }
		]);
	});

	it('uses a half-open period (end exclusive)', () => {
		const snapshot = buildReportSnapshot({
			periodStart: START,
			periodEnd: END,
			granularity: 'day',
			currency: 'USD',
			orders: [
				order('start', { at: new Date(START).toISOString(), subtotal: 10, total: 10 }),
				order('inside', { at: new Date(END - 1).toISOString(), subtotal: 20, total: 20 }),
				order('end', { at: new Date(END).toISOString(), subtotal: 40, total: 40 })
			],
			payments: [],
			refunds: [],
			products: []
		});
		expect(snapshot.ordersCount).toBe(2);
		expect(snapshot.grossMinor).toBe(3_000);
	});

	it('filters by currency and location', () => {
		const snapshot = buildReportSnapshot({
			periodStart: START,
			periodEnd: END,
			granularity: 'day',
			currency: 'USD',
			locationId: 'branch-a',
			orders: [
				order('usd-a', {
					at: '2026-11-09T09:00:00.000Z',
					subtotal: 10,
					total: 10,
					branchId: 'branch-a'
				}),
				order('usd-b', {
					at: '2026-11-09T09:00:00.000Z',
					subtotal: 20,
					total: 20,
					branchId: 'branch-b'
				}),
				order('eur-a', {
					at: '2026-11-09T09:00:00.000Z',
					subtotal: 30,
					total: 30,
					currency: 'EUR',
					branchId: 'branch-a'
				})
			],
			payments: [],
			refunds: [],
			products: []
		});
		expect(snapshot.ordersCount).toBe(1);
		expect(snapshot.grossMinor).toBe(1_000);
		expect(snapshot.locationId).toBe('branch-a');
	});

	it('ignores non-completed refunds', () => {
		const snapshot = buildReportSnapshot({
			periodStart: START,
			periodEnd: END,
			granularity: 'day',
			currency: 'USD',
			orders: [],
			payments: [],
			refunds: [
				refund('pending', { at: '2026-11-09T09:00:00.000Z', amount: 10, status: 'pending' }),
				refund('done', { at: '2026-11-09T09:00:00.000Z', amount: 5 })
			],
			products: []
		});
		expect(snapshot.refundMinor).toBe(500);
		expect(snapshot.netMinor).toBe(-500);
	});

	it('orders top products by quantity and caps the list', () => {
		const lines = Array.from({ length: 60 }, (_, index) => ({
			productId: `p${index}`,
			quantity: index + 1,
			total: (index + 1) * 10
		}));
		const snapshot = buildReportSnapshot({
			periodStart: START,
			periodEnd: END,
			granularity: 'day',
			currency: 'USD',
			orders: [
				order('o1', {
					at: '2026-11-09T09:00:00.000Z',
					subtotal: 18_300,
					total: 18_300,
					lines
				})
			],
			payments: [],
			refunds: [],
			products: []
		});
		expect(snapshot.topProducts).toHaveLength(50);
		expect(snapshot.topProducts[0]).toEqual({
			productId: 'p59',
			qty: 60,
			revenueMinor: 60_000
		});
		expect(snapshot.topProducts.at(-1)?.productId).toBe('p10');
	});

	it('contains aggregates only — no customer identifiers or free text', () => {
		const snapshot = buildReportSnapshot({
			periodStart: START,
			periodEnd: END,
			granularity: 'day',
			currency: 'USD',
			orders: [
				order('o1', {
					at: '2026-11-09T09:00:00.000Z',
					subtotal: 10,
					total: 10,
					extra: {
						customerName: 'Alice Example',
						customerPubkey: 'deadbeef',
						notes: 'Deliver to 123 Secret Street',
						shipping: { phone: '+15551234567', address: '123 Secret Street' }
					}
				})
			],
			payments: [],
			refunds: [],
			products: []
		});
		const serialized = JSON.stringify(snapshot);
		expect(serialized).not.toContain('Alice');
		expect(serialized).not.toContain('deadbeef');
		expect(serialized).not.toContain('Secret Street');
		expect(serialized).not.toContain('15551234567');
		expect(Object.keys(snapshot).sort()).toEqual(
			[
				'avgTicketMinor',
				'currency',
				'discountMinor',
				'generatedAt',
				'granularity',
				'grossMinor',
				'itemsCount',
				'netMinor',
				'orderStatus',
				'ordersCount',
				'payments',
				'periodEnd',
				'periodStart',
				'refundMinor',
				'taxMinor',
				'topProducts',
				'type',
				'version'
			].sort()
		);
	});

	it('returns empty aggregates for an empty period', () => {
		const snapshot = buildReportSnapshot({
			periodStart: START,
			periodEnd: END,
			granularity: 'day',
			currency: 'USD',
			timezone: 'Asia/Bangkok',
			orders: [],
			payments: [],
			refunds: [],
			products: []
		});
		expect(snapshot.timezone).toBe('Asia/Bangkok');
		expect(snapshot).toMatchObject({
			grossMinor: 0,
			netMinor: 0,
			ordersCount: 0,
			itemsCount: 0,
			avgTicketMinor: 0,
			payments: {},
			orderStatus: {},
			topProducts: []
		});
	});
});

describe('parseReportSnapshot', () => {
	it('parses a service response and normalizes aggregate fields', () => {
		const parsed = parseReportSnapshot({
			granularity: 'week',
			periodStart: new Date(START).toISOString(),
			periodEnd: new Date(END).toISOString(),
			locationId: 'loc-1',
			timezone: 'Asia/Bangkok',
			currency: 'usd',
			grossMinor: 15_000.4,
			netMinor: 12_750,
			taxMinor: 750,
			discountMinor: 1_000,
			refundMinor: 2_000,
			ordersCount: 2,
			itemsCount: 4,
			avgTicketMinor: 7_375,
			payments: { cash: 9_500 },
			orderStatus: { completed: 2 },
			topProducts: [{ productId: 'p1', qty: 3, revenueMinor: 9_000 }],
			generatedAt: new Date(END).toISOString(),
			customerName: 'ignored'
		});

		expect(parsed).toMatchObject({
			type: 'report.snapshot',
			version: 1,
			granularity: 'week',
			currency: 'USD',
			grossMinor: 15_000,
			netMinor: 12_750,
			locationId: 'loc-1',
			timezone: 'Asia/Bangkok',
			payments: { cash: 9_500 },
			orderStatus: { completed: 2 },
			topProducts: [{ productId: 'p1', qty: 3, revenueMinor: 9_000 }]
		});
		expect(JSON.stringify(parsed)).not.toContain('customerName');
	});

	it('rejects malformed money and period fields', () => {
		expect(() => parseReportSnapshot(null)).toThrow('must be an object');
		expect(() =>
			parseReportSnapshot({ periodStart: 'x', periodEnd: 'y', currency: 'USD' })
		).toThrow('grossMinor');
		expect(() =>
			parseReportSnapshot({
				periodStart: '',
				periodEnd: new Date(END).toISOString(),
				currency: 'USD'
			})
		).toThrow('periodStart');
	});
});

describe('snapshotId', () => {
	const base = {
		workspaceId: 'org-1',
		locationId: 'loc-1',
		granularity: 'day' as const,
		periodStart: START,
		currency: 'USD'
	};

	it('is deterministic and segment-safe', () => {
		const first = snapshotId(base);
		expect(first).toBe(snapshotId({ ...base }));
		expect(first).toMatch(/^snap-[0-9a-f]{40}$/);
	});

	it('changes with period, currency, location and granularity', () => {
		expect(snapshotId({ ...base, periodStart: START + 1 })).not.toBe(snapshotId(base));
		expect(snapshotId({ ...base, currency: 'THB' })).not.toBe(snapshotId(base));
		expect(snapshotId({ ...base, locationId: 'loc-2' })).not.toBe(snapshotId(base));
		expect(snapshotId({ ...base, granularity: 'week' })).not.toBe(snapshotId(base));
		expect(snapshotId({ ...base, timezone: 'Asia/Bangkok' })).not.toBe(snapshotId(base));
	});
});
