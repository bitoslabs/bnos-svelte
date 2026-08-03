/**
 * Formatting helpers shared across bdGo OS modules.
 */

const moneyFormatters = new Map<string, Intl.NumberFormat>();
const numberFormatters = new Map<string, Intl.NumberFormat>();
const relativeFormatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const CURRENCY_ALIAS: Record<string, string> = {
	'$': 'USD',
	'US$': 'USD',
	'USD': 'USD',
	'₭': 'LAK',
	'LAK': 'LAK',
	'฿': 'THB',
	'THB': 'THB',
	'¥': 'JPY',
	'JPY': 'JPY',
	'CNY': 'CNY',
	'€': 'EUR',
	'EUR': 'EUR',
	'£': 'GBP',
	'GBP': 'GBP',
	'BTC': 'BTC',
	'SATS': 'SATS'
};

export function normalizeCurrencyCode(currency = 'USD'): string {
	const normalized = currency.trim().toUpperCase();
	return CURRENCY_ALIAS[normalized] ?? normalized ?? 'USD';
}

function moneyFormatter(currency: string, wholeNumber: boolean) {
	const normalizedCurrency = normalizeCurrencyCode(currency);
	const key = `${normalizedCurrency}:${wholeNumber ? '0' : '2'}`;
	let formatter = moneyFormatters.get(key);
	if (!formatter) {
		if (normalizedCurrency === 'SATS') {
			formatter = new Intl.NumberFormat('en-US', {
				maximumFractionDigits: 0
			});
		} else {
			formatter = new Intl.NumberFormat('en-US', {
				style: 'currency',
				currency: normalizedCurrency,
				maximumFractionDigits: wholeNumber ? 0 : 2
			});
		}
		moneyFormatters.set(key, formatter);
	}
	return formatter;
}

function numberFormatter(fractionDigits?: number) {
	const key = fractionDigits === undefined ? 'default' : String(fractionDigits);
	let formatter = numberFormatters.get(key);
	if (!formatter) {
		formatter = new Intl.NumberFormat('en-US', {
			maximumFractionDigits: fractionDigits
		});
		numberFormatters.set(key, formatter);
	}
	return formatter;
}

export function formatMoney(value: number | string, currency = 'USD'): string {
	const n = typeof value === 'string' ? Number(value) : value;
	const normalizedCurrency = normalizeCurrencyCode(currency);
	const amount = Number.isFinite(n) ? n : 0;
	if (normalizedCurrency === 'SATS') {
		return `${numberFormatter(0).format(amount)} SATS`;
	}
	return moneyFormatter(normalizedCurrency, Number.isInteger(amount)).format(amount);
}

export function formatNumber(value: number | string, fractionDigits?: number): string {
	const n = typeof value === 'string' ? Number(value) : value;
	return numberFormatter(fractionDigits).format(Number.isFinite(n) ? n : 0);
}

export function formatInt(value: number | string): string {
	const n = typeof value === 'string' ? Number(value) : value;
	return numberFormatter(0).format(Number.isFinite(n) ? n : 0);
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
			return relativeFormatter.format(-Math.round(diff / ms), unit);
		}
	}
	return '';
}
