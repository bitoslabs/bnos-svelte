/**
 * Dashboard metrics — pure functions ported from bdgo-os `useDashboard` +
 * `dashboardHelpers`, computed from GLO `commerce.order` records. The dashboard
 * page calls these inside `$derived` so they recompute reactively as orders
 * change. No runes here → trivially testable.
 */
import type { GloOrder } from '@bitos/bnos-core/glo';

/** Local order view: GLO order data + a POS payment method (stored at checkout). */
export type DashboardOrder = GloOrder & { method?: string };

export type OrderRow = {
	id: string;
	number: string;
	status: string;
	total: number;
	items: number;
	method: string;
	type: string;
	atMs: number;
};

const MS_DAY = 86_400_000;

export function startOfDay(d: Date): number {
	const x = new Date(d);
	x.setHours(0, 0, 0, 0);
	return x.getTime();
}
export function startOfWeek(d: Date): number {
	const x = new Date(d);
	x.setHours(0, 0, 0, 0);
	x.setDate(x.getDate() - x.getDay());
	return x.getTime();
}
export function startOfMonth(d: Date): number {
	const x = new Date(d);
	x.setHours(0, 0, 0, 0);
	x.setDate(1);
	return x.getTime();
}

/** Flatten GLO order objects into the lightweight rows the dashboard reads. */
export function toOrderRows(
	objects: { id: string; data: DashboardOrder }[],
	paymentLookup?: Map<string, string>
): OrderRow[] {
	return objects.map((o) => {
		const d = o.data;
		const atMs = new Date(d.occurredAt || 0).getTime();
		const method = d.method
			?? (paymentLookup ? (paymentLookup.get(o.id) ?? 'cash') : 'cash');
		return {
			id: o.id,
			number: d.number ?? o.id.slice(0, 8),
			status: d.status ?? 'completed',
			total: d.total ?? 0,
			items: d.lines?.length ?? 0,
			method,
			type: d.fulfillmentType ?? 'pos',
			atMs: Number.isFinite(atMs) ? atMs : 0
		};
	});
}

export function sumTotal(rows: OrderRow[]): number {
	return rows.reduce((s, o) => s + o.total, 0);
}

export interface MetricSummary {
	todaysTotal: number;
	todaysCount: number;
	avgOrder: number;
	yesterdayTotal: number;
	salesChange: number; // % vs yesterday
	weekTotal: number;
	weekCount: number;
	monthTotal: number;
	monthCount: number;
	allTimeTotal: number;
	allTimeCount: number;
}

export function metricsSummary(rows: OrderRow[]): MetricSummary {
	const now = new Date();
	const todayStart = startOfDay(now);
	const yesterdayStart = todayStart - MS_DAY;
	const weekStart = startOfWeek(now);
	const monthStart = startOfMonth(now);

	const today = rows.filter((o) => o.atMs >= todayStart);
	const yesterday = rows.filter((o) => o.atMs >= yesterdayStart && o.atMs < todayStart);
	const week = rows.filter((o) => o.atMs >= weekStart);
	const month = rows.filter((o) => o.atMs >= monthStart);

	const todaysTotal = sumTotal(today);
	const yesterdayTotal = sumTotal(yesterday);
	const salesChange =
		yesterdayTotal > 0
			? ((todaysTotal - yesterdayTotal) / yesterdayTotal) * 100
			: todaysTotal > 0
				? 100
				: 0;

	return {
		todaysTotal,
		todaysCount: today.length,
		avgOrder: today.length ? todaysTotal / today.length : 0,
		yesterdayTotal,
		salesChange,
		weekTotal: sumTotal(week),
		weekCount: week.length,
		monthTotal: sumTotal(month),
		monthCount: month.length,
		allTimeTotal: sumTotal(rows),
		allTimeCount: rows.length
	};
}

export interface HourEntry {
	label: string;
	value: number;
	height: number; // 0..100
	isPeak: boolean;
}

/** Hourly sales for today, from 6am → current hour (bdgo-os buildHourlyData). */
export function buildHourly(rows: OrderRow[]): HourEntry[] {
	const todayStart = startOfDay(new Date());
	const currentHour = new Date().getHours();
	const startHour = 6;
	const endHour = Math.min(currentHour, 23);
	const hours: HourEntry[] = [];
	let max = 0;
	for (let h = startHour; h <= endHour; h++) {
		const from = todayStart + h * 3_600_000;
		const to = from + 3_600_000;
		const value = sumTotal(rows.filter((o) => o.atMs >= from && o.atMs < to));
		if (value > max) max = value;
		hours.push({
			label: `${h % 12 || 12}${h < 12 ? 'a' : 'p'}`,
			value,
			height: 0,
			isPeak: false
		});
	}
	const ceiling = max > 0 ? max * 1.1 : 1;
	for (const hr of hours) {
		hr.height = max > 0 ? (hr.value / ceiling) * 100 : 0;
		hr.isPeak = hr.value === max && max > 0;
	}
	return hours;
}

export interface DayBar {
	label: string;
	value: number;
	height: number;
	isCurrent: boolean;
}

/** Last 7 days revenue (bdgo-os buildChartBars). */
export function buildChartBars(rows: OrderRow[]): DayBar[] {
	const days: DayBar[] = [];
	const nowMs = Date.now();
	for (let i = 6; i >= 0; i--) {
		const d = new Date(nowMs - i * MS_DAY);
		const from = startOfDay(d);
		const to = from + MS_DAY;
		const value = sumTotal(rows.filter((o) => o.atMs >= from && o.atMs < to));
		days.push({
			label: d.toLocaleDateString('en-US', { weekday: 'short' }),
			value,
			height: 0,
			isCurrent: i === 0
		});
	}
	const max = Math.max(...days.map((b) => b.value), 0);
	const ceiling = max > 0 ? max * 1.2 : 100;
	for (const b of days) b.height = max > 0 ? Math.max((b.value / ceiling) * 100, 2) : 2;
	return days;
}

export interface BreakdownEntry {
	key: string;
	label: string;
	icon: string;
	total: number;
	count: number;
	percent: number; // share of the period total
}

const PAYMENT_META: Record<string, { label: string; icon: string }> = {
	cash: { label: 'Cash', icon: 'lucide:banknote' },
	card: { label: 'Card', icon: 'lucide:credit-card' },
	qr: { label: 'QR', icon: 'lucide:qr-code' },
	lightning: { label: 'Lightning', icon: 'lucide:zap' }
};

const TYPE_META: Record<string, { label: string; icon: string }> = {
	pos: { label: 'Counter', icon: 'lucide:scan-line' },
	'dine-in': { label: 'Dine-in', icon: 'lucide:utensils' },
	takeaway: { label: 'Takeaway', icon: 'lucide:shopping-bag' },
	delivery: { label: 'Delivery', icon: 'lucide:bike' }
};

function metaLookup(meta: Record<string, { label: string; icon: string }>, key: string) {
	return meta[key] ?? { label: key.charAt(0).toUpperCase() + key.slice(1), icon: 'lucide:circle-dot' };
}

export function paymentBreakdown(rows: OrderRow[]): BreakdownEntry[] {
	const map = new Map<string, { total: number; count: number }>();
	for (const o of rows) {
		const e = map.get(o.method) ?? { total: 0, count: 0 };
		e.total += o.total;
		e.count += 1;
		map.set(o.method, e);
	}
	const total = sumTotal(rows) || 1;
	return [...map.entries()]
		.map(([key, v]) => ({
			key,
			...metaLookup(PAYMENT_META, key),
			total: v.total,
			count: v.count,
			percent: (v.total / total) * 100
		}))
		.sort((a, b) => b.total - a.total);
}

export function orderTypeSegments(rows: OrderRow[]): BreakdownEntry[] {
	const map = new Map<string, { total: number; count: number }>();
	for (const o of rows) {
		const e = map.get(o.type) ?? { total: 0, count: 0 };
		e.total += o.total;
		e.count += 1;
		map.set(o.type, e);
	}
	const total = rows.length || 1;
	return [...map.entries()]
		.map(([key, v]) => ({
			key,
			...metaLookup(TYPE_META, key),
			total: v.total,
			count: v.count,
			percent: (v.count / total) * 100
		}))
		.sort((a, b) => b.count - a.count);
}

export interface TopProduct {
	name: string;
	qty: number;
	revenue: number;
}

/** Top products by quantity, across the given rows' line items. */
export function topProducts(
	objects: { data: GloOrder }[],
	limit = 5
): TopProduct[] {
	const map = new Map<string, TopProduct>();
	for (const o of objects) {
		for (const l of o.data.lines ?? []) {
			const name = l.name || '—';
			const e = map.get(name) ?? { name, qty: 0, revenue: 0 };
			e.qty += l.quantity;
			e.revenue += l.total;
			map.set(name, e);
		}
	}
	return [...map.values()].sort((a, b) => b.qty - a.qty).slice(0, limit);
}

export function greeting(): string {
	const h = new Date().getHours();
	if (h < 12) return 'Good morning';
	if (h < 17) return 'Good afternoon';
	return 'Good evening';
}
