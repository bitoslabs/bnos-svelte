/**
 * Pure helpers behind `NumberInput.svelte` — sanitising, grouping, parsing and
 * caret mapping for a numeric text field. Kept outside the component so the
 * edge cases (partial input like `-`, `.`, `1.`, pasted separators, fraction
 * caps) can be unit-tested without a DOM.
 */

export interface NumericOptions {
	/** Keep a leading minus sign (defaults to false). */
	allowNegative?: boolean;
	/** Cap the number of fraction digits accepted while typing. */
	maxDecimals?: number;
	/** Thousands separator; also stripped from pasted input. */
	groupSeparator?: string;
}

const SIGNIFICANT = /[\d.-]/;
const SIGNIFICANT_ALL = /[\d.-]/g;

/**
 * Reduce arbitrary typed/pasted text to a numeric string: optional leading
 * minus, digits, and at most one decimal point. Group separators are dropped,
 * so selecting and retyping a formatted value never breaks the parse.
 */
export function sanitizeNumericInput(raw: string, opts: NumericOptions = {}): string {
	const { allowNegative = false, maxDecimals, groupSeparator = ',' } = opts;
	const negative = allowNegative && raw.trimStart().startsWith('-');
	let body = raw
		.split(groupSeparator)
		.join('')
		.replace(/[^\d.-]/g, '');
	// Only a leading sign is meaningful; drop any other minus signs.
	body = body.replace(/-/g, '');

	const dot = body.indexOf('.');
	if (dot !== -1) {
		body = `${body.slice(0, dot + 1)}${body.slice(dot + 1).replace(/\./g, '')}`;
		if (maxDecimals !== undefined && maxDecimals >= 0) {
			const [integer, fraction] = body.split('.');
			body = `${integer}.${fraction.slice(0, maxDecimals)}`;
		}
	}

	return negative ? `-${body}` : body;
}

/** Insert thousands separators into the integer part, keeping any fraction. */
export function groupNumeric(body: string, grouping = true, groupSeparator = ','): string {
	if (!body) return '';
	const negative = body.startsWith('-');
	const unsigned = negative ? body.slice(1) : body;
	const [integer, fraction] = unsigned.split('.');
	const grouped = grouping
		? (integer ?? '').replace(/\B(?=(\d{3})+(?!\d))/g, groupSeparator)
		: (integer ?? '');
	const withFraction = unsigned.includes('.') ? `${grouped}.${fraction ?? ''}` : grouped;
	return negative ? `-${withFraction}` : withFraction;
}

/** Display value → number, or `''` while the field holds only a partial token. */
export function parseNumericInput(display: string, groupSeparator = ','): number | '' {
	const clean = display.split(groupSeparator).join('');
	if (!clean || clean === '-' || clean === '.' || clean === '-.') return '';
	const value = Number(clean);
	return Number.isFinite(value) ? value : '';
}

/** Canonical display value for a bound number (padding decimals when asked). */
export function formatNumericValue(
	value: number | '',
	opts: { decimals?: number; grouping?: boolean; groupSeparator?: string } = {}
): string {
	if (value === '' || !Number.isFinite(value)) return '';
	const { decimals, grouping = true, groupSeparator = ',' } = opts;
	const body =
		decimals === undefined
			? String(value)
			: roundNumeric(value, decimals).toFixed(Math.max(0, decimals));
	return groupNumeric(body, grouping, groupSeparator);
}

/** How many characters survive sanitising in `text` (used to restore the caret). */
export function numericCharCount(text: string): number {
	return (text.match(SIGNIFICANT_ALL) ?? []).length;
}

/** Position in `text` right after its `charCount`-th significant character. */
export function caretAfterNumericChars(text: string, charCount: number): number {
	if (charCount <= 0) return 0;
	let seen = 0;
	for (let i = 0; i < text.length; i += 1) {
		if (SIGNIFICANT.test(text[i])) {
			seen += 1;
			if (seen >= charCount) return i + 1;
		}
	}
	return text.length;
}

export function clampNumeric(value: number, min?: number, max?: number): number {
	let next = value;
	if (min !== undefined && next < min) next = min;
	if (max !== undefined && next > max) next = max;
	return next;
}

/** Round to `digits` fraction digits without float dust (0.1 + 0.2 → 0.3). */
export function roundNumeric(value: number, digits = 2): number {
	const factor = 10 ** Math.max(0, digits);
	return Math.round((value + Number.EPSILON) * factor) / factor;
}
