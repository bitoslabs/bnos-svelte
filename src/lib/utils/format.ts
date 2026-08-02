/**
 * Formatting helpers shared across bdGo OS modules.
 */

export function formatMoney(value: number | string, currency = 'USD'): string {
	const n = typeof value === 'string' ? Number(value) : value;
	if (!Number.isFinite(n)) return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(0);
	return new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency,
		maximumFractionDigits: Number.isInteger(n) ? 0 : 2
	}).format(n);
}

export function formatNumber(value: number | string, fractionDigits?: number): string {
	const n = typeof value === 'string' ? Number(value) : value;
	return new Intl.NumberFormat('en-US', {
		maximumFractionDigits: fractionDigits
	}).format(n);
}

export function formatInt(value: number | string): string {
	return new Intl.NumberFormat('en-US').format(typeof value === 'string' ? Number(value) : value);
}

export function initials(name: string): string {
	return name
		.split(/\s+/)
		.map((w) => w[0])
		.slice(0, 2)
		.join('')
		.toUpperCase();
}

export function initialsFrom(name: string | null, email: string | null): string {
	const base = (name || email || '?').trim();
	const parts = base.split(/\s+/).filter(Boolean);
	if (!parts.length) return '?';
	if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
	return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function titleCase(value: string): string {
	return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function truncateNpub(npub: string, head = 8, tail = 6): string {
	if (!npub || npub.length <= head + tail) return npub;
	return `${npub.slice(0, head)}…${npub.slice(-tail)}`;
}

export function relativeTime(isoOrEpoch: string | number): string {
	const t = typeof isoOrEpoch === 'number' ? isoOrEpoch : new Date(isoOrEpoch).getTime();
	if (!Number.isFinite(t)) return '';
	const diff = Date.now() - t;
	const abs = Math.abs(diff);
	const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
	const units: [Intl.RelativeTimeFormatUnit, number][] = [
		['year', 31_536_000_000],
		['month', 2_592_000_000],
		['day', 86_400_000],
		['hour', 3_600_000],
		['minute', 60_000],
		['second', 1000]
	];
	for (const [unit, ms] of units) {
		if (abs >= ms || unit === 'second') {
			return rtf.format(-Math.round(diff / ms), unit);
		}
	}
	return '';
}
