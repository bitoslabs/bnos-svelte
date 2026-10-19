import { describe, expect, it } from 'vitest';
import { buildSearchIndex, topScored } from './search';

describe('buildSearchIndex', () => {
	it('lowercases the combined search text per id', () => {
		expect(
			buildSearchIndex(
				[
					{ id: 'a', name: 'Latte', sku: 'L-1' },
					{ id: 'b', name: 'Mocha', sku: 'M-2' }
				],
				(item) => `${item.name} ${item.sku}`
			)
		).toEqual({ a: 'latte l-1', b: 'mocha m-2' });
	});
});

describe('topScored', () => {
	it('returns the highest scores in descending order', () => {
		expect(topScored([3, 1, 4, 2], 2, (n) => n)).toEqual([4, 3]);
	});

	it('discards negative scores', () => {
		expect(topScored([-1, 5, -2, 2], 3, (n) => n)).toEqual([5, 2]);
	});

	it('handles limits and ties deterministically', () => {
		expect(topScored([1, 1, 1], 2, (n) => n)).toEqual([1, 1]);
		expect(topScored([1, 2], 0, (n) => n)).toEqual([]);
	});

	it('works with an iterable', () => {
		expect(topScored(new Set([4, 2, 8]), 2, (n) => n)).toEqual([8, 4]);
	});
});
