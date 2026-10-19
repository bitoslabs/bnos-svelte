import { describe, expect, it } from 'vitest';
import { mapLimit } from './async';

describe('mapLimit', () => {
	it('preserves input order', async () => {
		const out = await mapLimit([1, 2, 3, 4], 2, async (n) => {
			await new Promise((r) => setTimeout(r, (5 - n) * 2));
			return n * 10;
		});
		expect(out).toEqual([10, 20, 30, 40]);
	});

	it('never exceeds the concurrency limit', async () => {
		let active = 0;
		let peak = 0;
		await mapLimit(
			Array.from({ length: 10 }, (_, i) => i),
			3,
			async () => {
				active++;
				peak = Math.max(peak, active);
				await new Promise((r) => setTimeout(r, 2));
				active--;
			}
		);
		expect(peak).toBe(3);
	});

	it('handles an empty list and an invalid limit', async () => {
		await expect(mapLimit([], 2, async () => 1)).resolves.toEqual([]);
		await expect(mapLimit([1], 0, async () => 1)).rejects.toThrow('limit must be positive');
	});
});
