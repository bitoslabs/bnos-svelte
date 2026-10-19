import { describe, expect, it } from 'vitest';
import { latestRows, lowStockSummary, type OrderRow } from './metrics';

function row(id: string, atMs: number): OrderRow {
	return {
		id,
		number: id,
		status: 'completed',
		total: 1,
		items: 1,
		method: 'cash',
		type: 'pos',
		customerName: '',
		atMs
	};
}

describe('latestRows', () => {
	it('returns the newest rows in descending order', () => {
		const rows = [row('a', 10), row('b', 40), row('c', 20), row('d', 30)];
		expect(latestRows(rows, 2).map((r) => r.id)).toEqual(['b', 'd']);
	});

	it('handles fewer rows than the limit and non-positive limits', () => {
		expect(latestRows([row('a', 1)], 5).map((r) => r.id)).toEqual(['a']);
		expect(latestRows([row('a', 1)], 0)).toEqual([]);
	});
});

describe('lowStockSummary', () => {
	it('only includes products with stock tracking enabled', () => {
		const summary = lowStockSummary([
			{ id: 'tracked', data: { name: 'Tracked', trackInventory: true, stockLevel: 2 } },
			{
				id: 'untracked-stock',
				data: { name: 'Untracked stock', trackInventory: false, stockLevel: 0 }
			},
			{
				id: 'untracked-config',
				data: { name: 'Untracked config', inventory: { lowStockThreshold: 2 } }
			}
		]);

		expect(summary.tracked).toBe(1);
		expect(summary.low).toBe(1);
		expect(summary.out).toBe(0);
		expect(summary.items.map((item) => item.id)).toEqual(['tracked']);
	});
});
