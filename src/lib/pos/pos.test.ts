import { describe, expect, it } from 'vitest';
import { computeTotals, discountAmount, lineTotal, NO_DISCOUNT } from './totals';
import { availableFor, canSell, computeStock, stockKey } from './stock';

describe('pos totals', () => {
	it('applies a percentage discount capped at the subtotal', () => {
		expect(discountAmount(1000, { type: 'percent', value: 10 })).toBe(100);
		// cannot exceed subtotal
		expect(discountAmount(100, { type: 'percent', value: 200 })).toBe(100);
		expect(discountAmount(100, { type: 'fixed', value: 250 })).toBe(100);
		expect(discountAmount(100, NO_DISCOUNT)).toBe(0);
	});

	it('adds tax on top when prices are tax-exclusive', () => {
		const t = computeTotals({
			subtotal: 10000,
			discount: NO_DISCOUNT,
			taxRatePct: 10,
			taxIncluded: false
		});
		expect(t.tax).toBe(1000);
		expect(t.total).toBe(11000);
	});

	it('extracts tax when prices are tax-inclusive', () => {
		const t = computeTotals({
			subtotal: 11000,
			discount: NO_DISCOUNT,
			taxRatePct: 10,
			taxIncluded: true
		});
		// tax = 11000 - 11000/1.1 = 1000
		expect(t.tax).toBeCloseTo(1000, 1);
		expect(t.total).toBe(11000);
	});

	it('discount applies before tax on the taxable base', () => {
		const t = computeTotals({
			subtotal: 10000,
			discount: { type: 'fixed', value: 2000 },
			taxRatePct: 10,
			taxIncluded: false
		});
		expect(t.discountAmount).toBe(2000);
		expect(t.taxableBase).toBe(8000);
		expect(t.tax).toBe(800);
		expect(t.total).toBe(8800);
	});

	it('line total includes modifier adjustments', () => {
		expect(lineTotal(100, 2, 20)).toBe(240); // (100+20)*2
	});
});

describe('pos stock', () => {
	const adjustments = [
		{ data: { productId: 'p1', quantity: 10, occurredAt: 'a' } },
		{ data: { productId: 'p1', quantity: -3, occurredAt: 'b' } },
		{ data: { productId: 'p1', variantId: 'v1', quantity: 5, occurredAt: 'c' } },
		{ data: { productId: 'p2', quantity: 4, branchId: 'br1', occurredAt: 'd' } },
		{ data: { productId: 'p2', quantity: 2, branchId: 'br2', occurredAt: 'e' } }
	];

	it('aggregates quantity per product and variant key', () => {
		const map = computeStock(adjustments);
		expect(availableFor(map, 'p1')).toBe(7);
		expect(availableFor(map, 'p1', 'v1')).toBe(5);
		expect(stockKey('p1', 'v1')).toBe('p1:v1');
	});

	it('scopes to a branch when provided', () => {
		expect(availableFor(computeStock(adjustments, 'br1'), 'p2')).toBe(4);
		expect(availableFor(computeStock(adjustments, 'br2'), 'p2')).toBe(2);
	});

	it('blocks sale when out of stock and denial is on', () => {
		const blocked = canSell({
			trackInventory: true,
			denySaleWhenOutOfStock: true,
			allowBackorder: false,
			available: 2,
			requested: 3
		});
		expect(blocked.ok).toBe(false);
	});

	it('allows sale when backorder is permitted', () => {
		const ok = canSell({
			trackInventory: true,
			denySaleWhenOutOfStock: true,
			allowBackorder: true,
			available: 0,
			requested: 5
		});
		expect(ok.ok).toBe(true);
	});

	it('ignores inventory when not tracked', () => {
		const ok = canSell({
			trackInventory: false,
			denySaleWhenOutOfStock: true,
			available: 0,
			requested: 99
		});
		expect(ok.ok).toBe(true);
	});
});
