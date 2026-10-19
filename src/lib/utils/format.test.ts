import { describe, expect, it } from 'vitest';
import { localDayKey } from './format';

describe('localDayKey', () => {
	it('ignores the time of day', () => {
		const early = new Date(2026, 0, 2, 0, 1);
		const late = new Date(2026, 0, 2, 23, 59);
		expect(localDayKey(early)).toBe(localDayKey(late));
	});

	it('separates different local days', () => {
		expect(localDayKey(new Date(2026, 0, 2))).not.toBe(localDayKey(new Date(2026, 0, 3)));
	});

	it('returns an empty key for invalid input', () => {
		expect(localDayKey('not-a-date')).toBe('');
	});
});
