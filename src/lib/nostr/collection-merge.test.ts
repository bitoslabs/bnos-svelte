import { describe, expect, it } from 'vitest';
import { mergeHydratedCollection } from './collection-merge';

type Item = { id: string; value: string };

describe('mergeHydratedCollection', () => {
	it('keeps stored records that were not touched locally', () => {
		const merged = mergeHydratedCollection<Item>(
			[{ id: 'new', value: 'local' }],
			[{ id: 'stored', value: 'disk' }]
		);
		expect(merged).toHaveLength(2);
		expect(merged).toContainEqual({ id: 'stored', value: 'disk' });
		expect(merged).toContainEqual({ id: 'new', value: 'local' });
	});

	it('lets a local update win over the stored copy', () => {
		const merged = mergeHydratedCollection<Item>(
			[{ id: 'a', value: 'local' }],
			[{ id: 'a', value: 'disk' }]
		);
		expect(merged).toEqual([{ id: 'a', value: 'local' }]);
	});

	it('does not resurrect records removed before hydration finished', () => {
		const merged = mergeHydratedCollection<Item>(
			[],
			[
				{ id: 'a', value: 'disk' },
				{ id: 'b', value: 'disk' }
			],
			{ a: true }
		);
		expect(merged).toEqual([{ id: 'b', value: 'disk' }]);
	});

	it('preserves stored order for untouched records', () => {
		const merged = mergeHydratedCollection<Item>(
			[],
			[
				{ id: 'a', value: '1' },
				{ id: 'b', value: '2' },
				{ id: 'c', value: '3' }
			]
		);
		expect(merged.map((item) => item.id)).toEqual(['a', 'b', 'c']);
	});
});
