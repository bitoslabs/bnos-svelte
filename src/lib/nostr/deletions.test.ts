import { describe, expect, it } from 'vitest';
import { TOMBSTONE_LIMIT, addTombstone, isTombstoned } from './deletions';

describe('deletion tombstones', () => {
	it('blocks relay copies at or before the deletion time', () => {
		const tombstones = { a: 1000 };
		expect(isTombstoned(tombstones, 'a', 999)).toBe(true);
		expect(isTombstoned(tombstones, 'a', 1000)).toBe(true);
		expect(isTombstoned(tombstones, 'a', 1001)).toBe(false);
	});

	it('ignores ids that were never deleted', () => {
		expect(isTombstoned({ a: 1000 }, 'b', 1)).toBe(false);
	});

	it('keeps only the newest ids when the limit is exceeded', () => {
		let tombstones = {};
		for (let i = 0; i < TOMBSTONE_LIMIT + 10; i++) {
			tombstones = addTombstone(tombstones, `id-${i}`, i);
		}
		const ids = Object.keys(tombstones);
		expect(ids).toHaveLength(TOMBSTONE_LIMIT);
		expect(ids).not.toContain('id-0');
		expect(ids).toContain(`id-${TOMBSTONE_LIMIT + 9}`);
	});
});
