import { describe, expect, it } from 'vitest';
import {
	combineDateTimeInput,
	dateInputKey,
	dateRangeBounds,
	parseDateInput,
	parseDateTimeInput
} from './date-input';

describe('dateInputKey', () => {
	it('uses local date parts', () => {
		expect(dateInputKey(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
		expect(dateInputKey(new Date(2026, 11, 31))).toBe('2026-12-31');
	});
});

describe('parseDateInput', () => {
	it('returns a local date', () => {
		const date = parseDateInput('2026-02-28');
		expect(date?.getFullYear()).toBe(2026);
		expect(date?.getMonth()).toBe(1);
		expect(date?.getDate()).toBe(28);
		expect(date?.getHours()).toBe(0);
	});

	it('rejects invalid calendar days', () => {
		expect(parseDateInput('2026-02-30')).toBeNull();
		expect(parseDateInput('')).toBeNull();
		expect(parseDateInput('not-a-date')).toBeNull();
	});

	it('accepts a datetime value', () => {
		expect(parseDateInput('2026-01-05T14:30')?.getDate()).toBe(5);
	});
});

describe('parseDateTimeInput', () => {
	it('splits date and minutes', () => {
		expect(parseDateTimeInput('2026-01-05T14:30:45')).toEqual({
			date: '2026-01-05',
			time: '14:30'
		});
		expect(parseDateTimeInput('2026-01-05')).toEqual({ date: '2026-01-05', time: '' });
	});
});

describe('combineDateTimeInput', () => {
	it('defaults the time to midnight', () => {
		expect(combineDateTimeInput('2026-01-05', '')).toBe('2026-01-05T00:00');
		expect(combineDateTimeInput('2026-01-05', '09:15')).toBe('2026-01-05T09:15');
	});
});

describe('dateRangeBounds', () => {
	it('returns null bounds without a range', () => {
		expect(dateRangeBounds('', '')).toEqual({ start: null, endExclusive: null });
	});

	it('keeps single-ended ranges open at the other end', () => {
		const { start, endExclusive } = dateRangeBounds('2026-01-05', '');
		expect(start).toBe(new Date(2026, 0, 5).getTime());
		expect(endExclusive).toBe(new Date(2026, 0, 6).getTime());
	});

	it('covers both whole days regardless of order', () => {
		const { start, endExclusive } = dateRangeBounds('2026-01-10', '2026-01-05');
		expect(start).toBe(new Date(2026, 0, 5).getTime());
		expect(endExclusive).toBe(new Date(2026, 0, 11).getTime());
	});
});
