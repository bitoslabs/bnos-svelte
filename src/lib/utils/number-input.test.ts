import { describe, expect, it } from 'vitest';
import {
	caretAfterNumericChars,
	clampNumeric,
	formatNumericValue,
	groupNumeric,
	numericCharCount,
	parseNumericInput,
	roundNumeric,
	sanitizeNumericInput
} from './number-input';

describe('sanitizeNumericInput', () => {
	it('keeps digits and a single decimal point', () => {
		expect(sanitizeNumericInput('1a2.3b4')).toBe('12.34');
		expect(sanitizeNumericInput('1.2.3')).toBe('1.23');
	});

	it('strips grouping separators from pasted values', () => {
		expect(sanitizeNumericInput('1,234,567.89')).toBe('1234567.89');
	});

	it('only accepts a leading minus when negatives are allowed', () => {
		expect(sanitizeNumericInput('12-3')).toBe('123');
		expect(sanitizeNumericInput('-12', { allowNegative: true })).toBe('-12');
		expect(sanitizeNumericInput('12-3', { allowNegative: true })).toBe('123');
	});

	it('caps fraction digits while typing', () => {
		expect(sanitizeNumericInput('1.23456', { maxDecimals: 2 })).toBe('1.23');
		expect(sanitizeNumericInput('1.23456', { maxDecimals: 0 })).toBe('1.');
	});

	it('keeps partial input usable', () => {
		expect(sanitizeNumericInput('')).toBe('');
		expect(sanitizeNumericInput('.')).toBe('.');
		expect(sanitizeNumericInput('-', { allowNegative: true })).toBe('-');
	});
});

describe('groupNumeric', () => {
	it('groups the integer part only', () => {
		expect(groupNumeric('1234567.891')).toBe('1,234,567.891');
		expect(groupNumeric('999')).toBe('999');
	});

	it('preserves a trailing decimal point', () => {
		expect(groupNumeric('1234.')).toBe('1,234.');
	});

	it('can be disabled', () => {
		expect(groupNumeric('1234567', false)).toBe('1234567');
	});

	it('keeps the sign in front of the grouped digits', () => {
		expect(groupNumeric('-1234.5')).toBe('-1,234.5');
	});
});

describe('parseNumericInput', () => {
	it('parses formatted values', () => {
		expect(parseNumericInput('1,234.56')).toBe(1234.56);
	});

	it('returns an empty value for partial tokens', () => {
		expect(parseNumericInput('')).toBe('');
		expect(parseNumericInput('-')).toBe('');
		expect(parseNumericInput('.')).toBe('');
	});

	it('parses a trailing decimal point as the integer', () => {
		expect(parseNumericInput('12.')).toBe(12);
	});
});

describe('formatNumericValue', () => {
	it('pads decimals on demand', () => {
		expect(formatNumericValue(1234.5, { decimals: 2 })).toBe('1,234.50');
		expect(formatNumericValue(1000, { decimals: 2 })).toBe('1,000.00');
	});

	it('rounds before padding, matching the blur behaviour', () => {
		expect(formatNumericValue(1.005, { decimals: 2 })).toBe('1.01');
	});

	it('leaves the value alone without a fixed precision', () => {
		expect(formatNumericValue(1234.5)).toBe('1,234.5');
	});

	it('renders empty values as an empty string', () => {
		expect(formatNumericValue('')).toBe('');
	});
});

describe('caret helpers', () => {
	it('counts digits, dots and signs', () => {
		expect(numericCharCount('1,234.5')).toBe(6);
	});

	it('skips inserted separators when restoring the caret', () => {
		const formatted = '1,234.56';
		expect(caretAfterNumericChars(formatted, 1)).toBe(1);
		expect(caretAfterNumericChars(formatted, 4)).toBe(5);
		expect(caretAfterNumericChars(formatted, 7)).toBe(8);
		expect(caretAfterNumericChars(formatted, 99)).toBe(formatted.length);
	});
});

describe('clampNumeric / roundNumeric', () => {
	it('clamps to the given bounds', () => {
		expect(clampNumeric(-5, 0)).toBe(0);
		expect(clampNumeric(50, 0, 10)).toBe(10);
		expect(clampNumeric(5)).toBe(5);
	});

	it('rounds without float dust', () => {
		expect(roundNumeric(0.1 + 0.2, 2)).toBe(0.3);
		expect(roundNumeric(1.005, 2)).toBe(1.01);
	});
});
