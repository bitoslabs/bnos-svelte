import { describe, expect, it } from 'vitest';
import { lowStockSummary } from './metrics';

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
