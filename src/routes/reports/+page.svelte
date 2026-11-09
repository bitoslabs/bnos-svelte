<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { SvelteDate } from 'svelte/reactivity';
	import { t } from '$lib/i18n/i18n.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import DateTimePicker from '$lib/components/ui/DateTimePicker.svelte';
	import { glo } from '$nostr/store.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { formatMoney, formatInt } from '$lib/utils/format';
	import { startOfDay, type DashboardOrder } from '$lib/dashboard/metrics';
	import type { GloOrder, GloPayment, GloProduct } from '@bitos/bnos-core/glo';
	import { TYPE, type Expense, type Income, type Refund } from '$lib/domain';
	import {
		buildReportSnapshot,
		fromMinorUnits,
		type ReportSnapshot
	} from '$lib/domain/report-snapshot';
	import {
		businessTimeZone,
		dayPeriod,
		ensureDailySnapshot,
		findSnapshot,
		publishReportSnapshot
	} from '$lib/reports/snapshot-service';
	import { toast } from '$lib/stores/toast.svelte';
	import { dataService } from '$lib/data-service/state.svelte';
	import type { ServiceReportSummary } from '$lib/data-service/protocol';

	// ── Data hydration ──────────────────────────────────────────────
	onMount(() => {
		glo.hydrate('commerce.order');
		glo.hydrate('commerce.payment');
		glo.hydrate(TYPE.refund);
		glo.hydrate('catalog.product');
		glo.hydrate(TYPE.expense);
		glo.hydrate(TYPE.income);
		glo.hydrate(TYPE.reportSnapshot);
	});

	const orders = $derived(glo.all<GloOrder, 'commerce.order'>('commerce.order'));
	const products = $derived(glo.all<GloProduct, 'catalog.product'>('catalog.product'));
	const expenses = $derived(glo.all<Expense, typeof TYPE.expense>(TYPE.expense));
	const incomes = $derived(glo.all<Income, typeof TYPE.income>(TYPE.income));
	const currency = $derived(tenant.state.currency);

	// Refresh today's aggregate snapshot when the page has real data and the
	// stored snapshot is stale. Missing periods stay gaps, never zeros.
	let snapshotRequested = false;
	$effect(() => {
		if (snapshotRequested) return;
		if (!glo.isHydrated('commerce.order') || !glo.isHydrated('commerce.payment')) return;
		if (!glo.isHydrated('catalog.product') || !glo.isHydrated(TYPE.refund)) return;
		// Periods depend on the organization timezone; wait for it before saving.
		if (!glo.isHydrated(TYPE.organization)) return;
		if (!orders.length) return;
		snapshotRequested = true;
		void ensureDailySnapshot().catch(() => {});
	});

	// ── Date range state ────────────────────────────────────────────
	type RangePreset = 'today' | '7d' | '30d' | 'month' | 'custom';

	const MS_DAY = 86_400_000;

	let rangePreset = $state<RangePreset>('7d');
	let customStart = $state<string>('');
	let customEnd = $state<string>('');

	const rangeStart = $derived.by(() => {
		const now = new Date();
		switch (rangePreset) {
			case 'today':
				return startOfDay(now);
			case '7d':
				return startOfDay(now) - 6 * MS_DAY;
			case '30d':
				return startOfDay(now) - 29 * MS_DAY;
			case 'month': {
				const d = new Date(now.getFullYear(), now.getMonth(), 1);
				return d.getTime();
			}
			case 'custom':
				return customStart ? new Date(customStart + 'T00:00:00').getTime() : 0;
		}
	});

	const rangeEnd = $derived.by(() => {
		if (rangePreset === 'custom' && customEnd) {
			return new Date(customEnd + 'T23:59:59').getTime();
		}
		return Date.now();
	});
	const customRangeReady = $derived(
		rangePreset !== 'custom' ||
			(Boolean(customStart) && Boolean(customEnd) && rangeStart <= rangeEnd)
	);

	/** Duration of the selected range, used to compute the previous period. */
	const rangeDuration = $derived(rangeEnd - rangeStart);
	const prevStart = $derived(rangeStart - rangeDuration);
	const prevEnd = $derived(rangeStart);

	// ── Filtered orders ─────────────────────────────────────────────
	const filteredOrders = $derived(
		customRangeReady
			? orders.filter((o) => {
					const t = new Date(o.data.occurredAt || o.data.occurredAt || 0).getTime();
					return t >= rangeStart && t <= rangeEnd;
				})
			: []
	);

	const prevOrders = $derived(
		orders.filter((o) => {
			const t = new Date(o.data.occurredAt || o.data.occurredAt || 0).getTime();
			return t >= prevStart && t < prevEnd;
		})
	);

	const isLoading = $derived(glo.hydrating);
	const hasData = $derived(filteredOrders.length > 0);

	// ── Report snapshots ────────────────────────────────────────────
	const snapshotRows = $derived.by(() =>
		glo
			.all<ReportSnapshot, typeof TYPE.reportSnapshot>(TYPE.reportSnapshot)
			.map((object) => ({ object, data: object.data }))
			.sort(
				(a, b) =>
					Date.parse(b.data.periodStart) - Date.parse(a.data.periodStart) ||
					Date.parse(b.data.generatedAt) - Date.parse(a.data.generatedAt)
			)
	);
	const todayPeriod = $derived.by(() => dayPeriod());
	const latestDay = $derived(
		findSnapshot({ granularity: 'day', periodStart: todayPeriod.periodStart })
	);
	const hasOrdersToday = $derived(
		orders.some((order) => {
			const at = Date.parse(order.data.occurredAt);
			return Number.isFinite(at) && at >= todayPeriod.periodStart && at < todayPeriod.periodEnd;
		})
	);
	const todayDrift = $derived.by(() => {
		const stored = latestDay?.data;
		if (!stored) return null;
		const live = buildReportSnapshot({
			periodStart: todayPeriod.periodStart,
			periodEnd: todayPeriod.periodEnd,
			granularity: 'day',
			orders,
			payments: glo.all<GloPayment, 'commerce.payment'>('commerce.payment'),
			refunds: glo.all<Refund, typeof TYPE.refund>(TYPE.refund),
			products: glo.all<GloProduct, 'catalog.product'>('catalog.product'),
			currency: tenant.state.currency,
			locationId: tenant.state.locationId ?? undefined,
			timezone: businessTimeZone()
		});
		return {
			ordersDelta: live.ordersCount - stored.ordersCount,
			netDelta: live.netMinor - stored.netMinor
		};
	});
	const snapshotDataReady = $derived(
		glo.isHydrated('commerce.order') &&
			glo.isHydrated('commerce.payment') &&
			glo.isHydrated(TYPE.refund) &&
			glo.isHydrated('catalog.product') &&
			glo.isHydrated(TYPE.organization)
	);
	let showAllSnapshots = $state(false);
	let snapshotBusy = $state(false);
	let snapshotError = $state<string | null>(null);
	const visibleSnapshots = $derived(showAllSnapshots ? snapshotRows : snapshotRows.slice(0, 6));

	// ── Service-computed summary (optional) ─────────────────────────
	const reporting = $derived(dataService.metadata?.capabilities.reporting === true);
	type ServerSummaryState = {
		loading: boolean;
		error: string | null;
		value: ServiceReportSummary | null;
		fetchedAt: number | null;
		key: string | null;
	};
	let serverSummary = $state<ServerSummaryState>({
		loading: false,
		error: null,
		value: null,
		fetchedAt: null,
		key: null
	});
	const liveRangeSnapshot = $derived.by(() => {
		if (!serverSummary.value) return null;
		return buildReportSnapshot({
			periodStart: rangeStart,
			periodEnd: Math.max(rangeEnd + 1, rangeStart + 1),
			granularity: 'day',
			orders,
			payments: glo.all<GloPayment, 'commerce.payment'>('commerce.payment'),
			refunds: glo.all<Refund, typeof TYPE.refund>(TYPE.refund),
			products: glo.all<GloProduct, 'catalog.product'>('catalog.product'),
			currency: tenant.state.currency,
			locationId: tenant.state.locationId ?? undefined,
			timezone: businessTimeZone()
		});
	});
	const serverSummaryTotals = $derived.by(() => {
		const summary = serverSummary.value;
		if (!summary) return null;
		let grossMinor = 0;
		let ordersCount = 0;
		for (const bucket of summary.buckets) {
			grossMinor += bucket.grossMinor;
			ordersCount += bucket.ordersCount;
		}
		return { grossMinor, ordersCount, buckets: summary.buckets.length };
	});
	const serverSummaryDelta = $derived.by(() => {
		const totals = serverSummaryTotals;
		const live = liveRangeSnapshot;
		if (!totals || !live) return null;
		return {
			gross: totals.grossMinor - live.grossMinor,
			orders: totals.ordersCount - live.ordersCount
		};
	});
	const summaryRequestKey = $derived(
		`${rangeStart}:${rangeEnd}:${currency}:${tenant.state.locationId ?? ''}`
	);
	let autoSummaryKey = '';
	$effect(() => {
		if (!reporting || !customRangeReady || !snapshotDataReady) return;
		// Multi-day/closed ranges load their server aggregate automatically.
		if (rangePreset === 'today') return;
		const key = summaryRequestKey;
		if (autoSummaryKey === key) return;
		autoSummaryKey = key;
		void loadServerSummary();
	});

	// ── Summary stats (one pass per period) ─────────────────────────
	const stats = $derived.by(() => {
		let revenue = 0;
		let items = 0;
		for (const o of filteredOrders) {
			revenue += o.data.total ?? 0;
			for (const line of o.data.lines ?? []) items += line.quantity;
		}
		const count = filteredOrders.length;
		return { revenue, count, items, aov: count > 0 ? revenue / count : 0 };
	});
	const totalRevenue = $derived(stats.revenue);
	const orderCount = $derived(stats.count);
	const avgOrderValue = $derived(stats.aov);
	const itemsSold = $derived(stats.items);

	// Previous period stats
	const prevStats = $derived.by(() => {
		let revenue = 0;
		let items = 0;
		for (const o of prevOrders) {
			revenue += o.data.total ?? 0;
			for (const line of o.data.lines ?? []) items += line.quantity;
		}
		const count = prevOrders.length;
		return { revenue, count, items, aov: count > 0 ? revenue / count : 0 };
	});
	const prevRevenue = $derived(prevStats.revenue);
	const prevCount = $derived(prevStats.count);
	const prevAOV = $derived(prevStats.aov);
	const prevItems = $derived(prevStats.items);

	function pctChange(curr: number, prev: number): number | null {
		if (prev === 0) return curr > 0 ? 100 : null;
		return ((curr - prev) / prev) * 100;
	}

	const revenueChange = $derived(pctChange(totalRevenue, prevRevenue));
	const countChange = $derived(pctChange(orderCount, prevCount));
	const aovChange = $derived(pctChange(avgOrderValue, prevAOV));
	const itemsChange = $derived(pctChange(itemsSold, prevItems));

	// ── Revenue by day (bar chart) ──────────────────────────────────
	const revenueByDay = $derived.by(() => {
		const days: { label: string; sublabel: string; total: number; isToday: boolean }[] = [];
		if (!customRangeReady) return days;
		const rangeDayStart = new SvelteDate(rangeStart);
		rangeDayStart.setHours(0, 0, 0, 0);
		const rangeDayEnd = new SvelteDate(rangeEnd);
		rangeDayEnd.setHours(0, 0, 0, 0);
		const today = startOfDay(new SvelteDate());
		const numDays = Math.min(
			Math.max(1, Math.round((rangeDayEnd.getTime() - rangeDayStart.getTime()) / MS_DAY) + 1),
			31
		);
		for (let i = 0; i < numDays; i++) {
			const d = new SvelteDate(rangeDayStart);
			d.setDate(rangeDayStart.getDate() + i);
			days.push({
				label:
					numDays <= 7
						? d.toLocaleDateString('en-US', { weekday: 'short' })
						: `${d.getDate()}/${d.getMonth() + 1}`,
				sublabel: numDays > 7 && d.getTime() === today ? 'today' : '',
				total: 0,
				isToday: d.getTime() === today
			});
		}
		// One pass over the orders instead of re-scanning them for every day.
		const dayStartMs = rangeDayStart.getTime();
		for (const o of filteredOrders) {
			const t = new Date(o.data.occurredAt || o.data.occurredAt || 0).getTime();
			if (!Number.isFinite(t)) continue;
			const index = Math.round((startOfDay(new SvelteDate(t)) - dayStartMs) / MS_DAY);
			const day = days[index];
			if (day) day.total += o.data.total ?? 0;
		}
		return days;
	});
	const maxRevenueDay = $derived(Math.max(1, ...revenueByDay.map((d) => d.total)));

	// ── Hourly sales ────────────────────────────────────────────────
	const hourlySales = $derived.by(() => {
		const startHour = 6;
		const endHour = 23;
		const totals = Array.from({ length: endHour - startHour + 1 }, () => 0);
		const counts = Array.from({ length: endHour - startHour + 1 }, () => 0);
		for (const o of filteredOrders) {
			const at = new Date(o.data.occurredAt || o.data.occurredAt || 0);
			const hour = at.getHours();
			if (!Number.isFinite(at.getTime()) || hour < startHour || hour > endHour) continue;
			totals[hour - startHour] += o.data.total ?? 0;
			counts[hour - startHour] += 1;
		}
		return totals.map((total, index) => {
			const hour = startHour + index;
			return {
				hour,
				label: `${hour % 12 || 12}${hour < 12 ? 'a' : 'p'}`,
				total,
				count: counts[index]
			};
		});
	});
	const maxHourTotal = $derived(Math.max(1, ...hourlySales.map((h) => h.total)));
	const peakHour = $derived.by(() => {
		let peak = hourlySales[0];
		for (const h of hourlySales) if (h.total > peak.total) peak = h;
		return peak;
	});

	// ── Payment method breakdown ────────────────────────────────────
	const PAYMENT_META: Record<string, { label: string; icon: string; color: string }> = {
		cash: { label: 'Cash', icon: 'lucide:banknote', color: '#22c55e' },
		card: { label: 'Card', icon: 'lucide:credit-card', color: '#3b82f6' },
		qr: { label: 'QR', icon: 'lucide:qr-code', color: '#8b5cf6' },
		lightning: { label: 'Lightning', icon: 'lucide:zap', color: '#f59e0b' },
		ecash: { label: 'eCash', icon: 'lucide:coins', color: '#ec4899' },
		bank_transfer: { label: 'Bank', icon: 'lucide:landmark', color: '#06b6d4' },
		mobile_payment: { label: 'Mobile', icon: 'lucide:smartphone', color: '#10b981' },
		split: { label: 'Split', icon: 'lucide:square-split-horizontal', color: '#6366f1' },
		other: { label: 'Other', icon: 'lucide:circle-dot', color: '#94a3b8' }
	};

	const paymentBreakdown = $derived.by(() => {
		const map: Record<string, { total: number; count: number }> = {};
		for (const o of filteredOrders) {
			const method = (o.data as DashboardOrder).method ?? 'cash';
			const entry = (map[method] ??= { total: 0, count: 0 });
			entry.total += o.data.total ?? 0;
			entry.count += 1;
		}
		const total = totalRevenue || 1;
		return Object.entries(map)
			.map(([key, v]) => ({
				key,
				...(PAYMENT_META[key] ?? {
					label: key.charAt(0).toUpperCase() + key.slice(1),
					icon: 'lucide:circle-dot',
					color: '#94a3b8'
				}),
				total: v.total,
				count: v.count,
				percent: (v.total / total) * 100
			}))
			.sort((a, b) => b.total - a.total);
	});

	// ── Top products ────────────────────────────────────────────────
	const topProducts = $derived.by(() => {
		const names: Record<string, string> = {};
		for (const p of products) names[p.id] = p.data.name;
		const map: Record<string, { name: string; qty: number; revenue: number }> = {};
		for (const o of filteredOrders) {
			for (const l of o.data.lines ?? []) {
				const key = l.productId || l.name || 'unknown';
				const name = names[key] ?? l.name ?? 'Unknown product';
				const entry = (map[key] ??= { name, qty: 0, revenue: 0 });
				entry.qty += l.quantity;
				entry.revenue += l.total ?? l.quantity * l.unitPrice;
			}
		}
		return Object.values(map)
			.sort((a, b) => b.revenue - a.revenue)
			.slice(0, 10);
	});

	// ── Expenses & P&L ─────────────────────────────────────────────
	// Cancelled and draft entries are excluded from totals (matching the
	// dashboard's expenseSummary) so the P&L only counts settled money.
	const filteredExpenses = $derived(
		expenses.filter((e) => {
			if (e.data.status === 'cancelled' || e.data.status === 'draft') return false;
			const ms = new Date(e.data.occurredAt || 0).getTime();
			return ms >= rangeStart && ms <= rangeEnd;
		})
	);
	const totalExpenses = $derived(filteredExpenses.reduce((s, e) => s + (e.data.amount ?? 0), 0));

	const filteredIncome = $derived(
		incomes.filter((e) => {
			if (e.data.status === 'cancelled' || e.data.status === 'draft') return false;
			const ms = new Date(e.data.occurredAt || 0).getTime();
			return ms >= rangeStart && ms <= rangeEnd;
		})
	);
	const totalIncome = $derived(filteredIncome.reduce((s, e) => s + (e.data.amount ?? 0), 0));

	const netProfit = $derived(totalRevenue + totalIncome - totalExpenses);
	const netBasis = $derived(totalRevenue + totalIncome);

	const EXPENSE_CATS: Record<string, { label: string; icon: string; color: string }> = {
		rent: { label: 'Rent', icon: 'lucide:building-2', color: '#ef4444' },
		utilities: { label: 'Utilities', icon: 'lucide:plug', color: '#f97316' },
		supplies: { label: 'Supplies', icon: 'lucide:package', color: '#3b82f6' },
		salaries: { label: 'Salaries', icon: 'lucide:users', color: '#8b5cf6' },
		marketing: { label: 'Marketing', icon: 'lucide:megaphone', color: '#ec4899' },
		maintenance: { label: 'Maintenance', icon: 'lucide:wrench', color: '#14b8a6' },
		transport: { label: 'Transport', icon: 'lucide:truck', color: '#06b6d4' },
		taxes: { label: 'Taxes', icon: 'lucide:landmark', color: '#f59e0b' },
		insurance: { label: 'Insurance', icon: 'lucide:shield', color: '#10b981' },
		depreciation: { label: 'Depreciation', icon: 'lucide:trending-down', color: '#6366f1' },
		professional_services: { label: 'Professional', icon: 'lucide:briefcase', color: '#a855f7' },
		technology: { label: 'Technology', icon: 'lucide:cpu', color: '#0ea5e9' },
		food_cost: { label: 'Food Cost', icon: 'lucide:utensils', color: '#f43f5e' },
		other: { label: 'Other', icon: 'lucide:circle-dot', color: '#94a3b8' }
	};

	const expenseBreakdown = $derived.by(() => {
		const map: Record<string, { total: number; count: number }> = {};
		for (const e of filteredExpenses) {
			const cat = e.data.category ?? 'other';
			const entry = (map[cat] ??= { total: 0, count: 0 });
			entry.total += e.data.amount ?? 0;
			entry.count += 1;
		}
		const total = totalExpenses || 1;
		return Object.entries(map)
			.map(([key, v]) => ({
				key,
				...(EXPENSE_CATS[key] ?? { label: key, icon: 'lucide:circle-dot', color: '#94a3b8' }),
				total: v.total,
				count: v.count,
				percent: (v.total / total) * 100
			}))
			.sort((a, b) => b.total - a.total);
	});

	// ── CSV export ──────────────────────────────────────────────────
	function exportCSV() {
		const lines: string[] = [];

		// Summary section
		lines.push('# Summary');
		lines.push('Metric,Value');
		lines.push(`Total Revenue,${totalRevenue.toFixed(2)}`);
		lines.push(`Other Income,${totalIncome.toFixed(2)}`);
		lines.push(`Expenses,${totalExpenses.toFixed(2)}`);
		lines.push(`Net Profit,${netProfit.toFixed(2)}`);
		lines.push(`Order Count,${orderCount}`);
		lines.push(`Average Order Value,${avgOrderValue.toFixed(2)}`);
		lines.push(`Items Sold,${itemsSold}`);
		lines.push(`Currency,${currency}`);
		lines.push(`Period Start,${new Date(rangeStart).toISOString()}`);
		lines.push(`Period End,${new Date(rangeEnd).toISOString()}`);
		lines.push('');

		// Orders detail
		lines.push('# Orders');
		lines.push('Order ID,Number,Date,Status,Total,Payment Method,Items');
		for (const o of filteredOrders) {
			const d = o.data;
			const date = d.occurredAt || '';
			const method = (d as DashboardOrder).method ?? 'cash';
			const itemCount = (d.lines ?? []).reduce((s, l) => s + l.quantity, 0);
			const row = [
				o.id,
				`"${d.number ?? o.id.slice(0, 8)}"`,
				`"${date}"`,
				d.status ?? 'completed',
				(d.total ?? 0).toFixed(2),
				method,
				itemCount
			];
			lines.push(row.join(','));
		}
		lines.push('');

		// Top products
		lines.push('# Top Products');
		lines.push('Product,Quantity,Revenue');
		for (const p of topProducts) {
			lines.push(`"${p.name}",${p.qty},${p.revenue.toFixed(2)}`);
		}
		lines.push('');

		// Payment breakdown
		lines.push('# Payment Methods');
		lines.push('Method,Count,Total,Percent');
		for (const p of paymentBreakdown) {
			lines.push(`${p.label},${p.count},${p.total.toFixed(2)},${p.percent.toFixed(1)}%`);
		}
		lines.push('');

		// Expenses
		lines.push('# Expenses');
		lines.push('Date,Description,Category,Amount,Currency');
		for (const e of filteredExpenses) {
			lines.push(
				`"${e.data.occurredAt}",${JSON.stringify(e.data.description ?? '')},${e.data.category ?? ''},${(e.data.amount ?? 0).toFixed(2)},${e.data.currency ?? currency}`
			);
		}
		lines.push('');

		// Other income
		lines.push('# Other Income');
		lines.push('Date,Description,Category,Amount,Currency');
		for (const e of filteredIncome) {
			lines.push(
				`"${e.data.occurredAt}",${JSON.stringify(e.data.description ?? '')},${e.data.category ?? ''},${(e.data.amount ?? 0).toFixed(2)},${e.data.currency ?? currency}`
			);
		}

		// Download
		const bom = '\uFEFF'; // UTF-8 BOM for Excel
		const blob = new Blob([bom + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		const fmtDate = new Date().toISOString().slice(0, 10);
		a.download = `bnos_report_${rangePreset}_${fmtDate}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	}

	// ── Snapshot actions + labels ───────────────────────────────────
	function relativeTime(isoOrEpoch: string | number): string {
		const at = typeof isoOrEpoch === 'number' ? isoOrEpoch : Date.parse(isoOrEpoch);
		if (!Number.isFinite(at)) return '—';
		const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
		if (seconds < 60) return 'just now';
		const minutes = Math.round(seconds / 60);
		if (minutes < 60) return `${minutes}m ago`;
		const hours = Math.round(minutes / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.round(hours / 24);
		return `${days}d ago`;
	}

	function formatSnapshotPeriod(data: ReportSnapshot): string {
		const start = new Date(data.periodStart);
		if (!Number.isFinite(start.getTime())) return '—';
		try {
			return new Intl.DateTimeFormat(undefined, {
				year: 'numeric',
				month: 'short',
				day: 'numeric',
				timeZone: data.timezone
			}).format(start);
		} catch {
			return start.toLocaleDateString();
		}
	}

	function snapshotScope(data: ReportSnapshot): string {
		if (!data.locationId) return 'All locations';
		const location = glo.get(TYPE.location, data.locationId) as
			{ data?: { name?: string } } | undefined;
		return location?.data?.name ?? data.locationId.slice(0, 8);
	}

	function snapshotPublished(object: unknown): boolean {
		return Boolean((object as { __eventId?: string })?.__eventId);
	}

	async function loadServerSummary() {
		if (!reporting) return;
		const key = summaryRequestKey;
		serverSummary = { loading: true, error: null, value: null, fetchedAt: null, key };
		try {
			const value = await dataService.fetchReportSummary({
				granularity: 'day',
				periodStart: rangeStart,
				periodEnd: Math.max(rangeEnd + 1, rangeStart + 1),
				locationId: tenant.state.locationId ?? undefined
			});
			if (serverSummary.key !== key) return;
			serverSummary = { loading: false, error: null, value, fetchedAt: Date.now(), key };
		} catch (error) {
			if (serverSummary.key !== key) return;
			serverSummary = {
				loading: false,
				error: error instanceof Error ? error.message : 'Server summary unavailable',
				value: null,
				fetchedAt: null,
				key
			};
		}
	}

	async function saveSnapshot() {
		snapshotBusy = true;
		snapshotError = null;
		try {
			const { periodStart, periodEnd } = dayPeriod();
			const result = await publishReportSnapshot({
				granularity: 'day',
				periodStart,
				periodEnd,
				audit: true
			});
			toast.success(
				'Snapshot saved',
				`${formatMoney(fromMinorUnits(result.snapshot.netMinor, result.snapshot.currency), result.snapshot.currency)} net`
			);
		} catch (error) {
			snapshotError = error instanceof Error ? error.message : 'Could not save snapshot';
		} finally {
			snapshotBusy = false;
		}
	}

	async function republishSnapshot(data: ReportSnapshot) {
		snapshotBusy = true;
		snapshotError = null;
		try {
			await publishReportSnapshot({
				granularity: data.granularity,
				periodStart: Date.parse(data.periodStart),
				periodEnd: Date.parse(data.periodEnd),
				locationId: data.locationId ?? null,
				audit: true
			});
			toast.success('Snapshot re-published');
		} catch (error) {
			snapshotError = error instanceof Error ? error.message : 'Could not publish snapshot';
		} finally {
			snapshotBusy = false;
		}
	}

	async function copySnapshotId(id: string) {
		try {
			await navigator.clipboard.writeText(id);
			toast.success('Snapshot id copied');
		} catch {
			toast.error('Could not copy snapshot id');
		}
	}

	// ── Helpers ─────────────────────────────────────────────────────
	function fmtPct(val: number | null): string {
		if (val === null) return '—';
		const sign = val >= 0 ? '+' : '';
		return `${sign}${val.toFixed(1)}%`;
	}

	const rangePresets: { key: RangePreset; label: string }[] = [
		{ key: 'today', label: 'Today' },
		{ key: '7d', label: '7D' },
		{ key: '30d', label: '30D' },
		{ key: 'month', label: 'This Month' },
		{ key: 'custom', label: 'Custom' }
	];

	let showCustom = $derived(rangePreset === 'custom');
</script>

<svelte:head><title>{t('common.appName')} · {t('nav.reports')}</title></svelte:head>

<div class="space-y-5">
	<!-- Header -->
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h1 class="font-display text-xl font-bold tracking-tight">{t('nav.reports')}</h1>
			<p class="text-[12.5px] text-(--ui-text-muted)">
				Live from signed orders · period snapshots for faster, consistent reports
			</p>
		</div>
		<div class="flex flex-wrap items-center gap-2">
			<Button
				href={resolve('/reports/snapshots')}
				color="neutral"
				variant="subtle"
				size="sm"
				icon="lucide:history"
			>
				Snapshots
			</Button>
			<Button
				variant="subtle"
				size="sm"
				icon="lucide:download"
				onclick={exportCSV}
				disabled={!hasData}
			>
				Export CSV
			</Button>
		</div>
	</div>

	<!-- Date range selector -->
	<div class="flex flex-wrap items-center gap-2">
		{#each rangePresets as rp (rp.key)}
			<button
				class="rounded-lg px-3 py-1.5 text-[13px] font-semibold tabular-nums transition-colors
					{rangePreset === rp.key
					? 'bg-primary-500 text-white'
					: 'bg-(--ui-bg-accented) text-(--ui-text-muted) hover:bg-(--interactive-hover-bg) hover:text-(--ui-text)'}"
				onclick={() => (rangePreset = rp.key)}
			>
				{rp.label}
			</button>
		{/each}
		{#if showCustom}
			<div class="flex items-center gap-1.5">
				<DateTimePicker
					bind:value={customStart}
					placeholder={t('common.from')}
					ariaLabel={t('common.from')}
					class="min-w-32"
				/>
				<span class="text-[12px] text-(--ui-text-dimmed)" aria-hidden="true">→</span>
				<DateTimePicker
					bind:value={customEnd}
					placeholder={t('common.to')}
					ariaLabel={t('common.to')}
					class="min-w-32"
				/>
			</div>
		{/if}
	</div>

	<!-- Snapshot status -->
	<div class="surface-card flex flex-wrap items-center justify-between gap-3 px-4 py-3">
		<div class="flex min-w-0 items-start gap-3">
			<div class="rounded-lg bg-primary-500/10 p-2 text-primary-600 dark:text-primary-400">
				<Icon name="lucide:file-chart-column" class="size-4" />
			</div>
			<div class="min-w-0">
				<div class="flex flex-wrap items-center gap-2">
					<span class="text-[13px] font-semibold">Report snapshot</span>
					{#if latestDay}
						{@const drift = todayDrift}
						{#if drift && (drift.ordersDelta !== 0 || drift.netDelta !== 0)}
							<Badge color="warning">Live changed</Badge>
						{:else}
							<Badge color="success">In sync</Badge>
						{/if}
					{:else}
						<Badge color="neutral">Live only</Badge>
					{/if}
				</div>
				<div class="mt-0.5 text-[11px] leading-relaxed text-(--ui-text-dimmed)">
					{#if latestDay}
						{latestDay.data.granularity} · {formatSnapshotPeriod(latestDay.data)} · {snapshotScope(
							latestDay.data
						)} · {latestDay.data.currency} · generated {relativeTime(latestDay.data.generatedAt)}
						{#if todayDrift && todayDrift.ordersDelta > 0}
							· {todayDrift.ordersDelta} new order{todayDrift.ordersDelta === 1 ? '' : 's'} since snapshot
						{:else if todayDrift && (todayDrift.netDelta !== 0 || todayDrift.ordersDelta !== 0)}
							· live totals changed since snapshot
						{/if}
					{:else}
						No snapshot for today yet. Save one to sync a period checkpoint to relays.
					{/if}
				</div>
			</div>
		</div>
		<div class="flex flex-wrap items-center justify-end gap-2">
			{#if snapshotError}
				<span role="alert" class="text-[11px] text-(--tone-error-text)">{snapshotError}</span>
			{/if}
			<Button
				color="primary"
				variant="soft"
				size="sm"
				onclick={saveSnapshot}
				disabled={snapshotBusy || !hasOrdersToday || !snapshotDataReady}
			>
				<Icon name="lucide:file-chart-column" class="size-4" />
				{snapshotBusy ? 'Saving…' : 'Save snapshot'}
			</Button>
		</div>
	</div>

	{#if reporting}
		<!-- Optional server-computed summary -->
		<div class="surface-card px-4 py-3">
			<div class="flex flex-wrap items-center justify-between gap-2">
				<div class="flex min-w-0 items-center gap-2">
					<Icon name="lucide:database" class="size-4 text-primary-500" />
					<span class="text-[13px] font-semibold">Server summary</span>
					{#if serverSummary.value}
						<Badge color="info">{serverSummary.value.snapshot ? 'Snapshot' : 'Partial'}</Badge>
						{#if serverSummaryDelta}
							{#if serverSummaryDelta.gross === 0 && serverSummaryDelta.orders === 0}
								<Badge color="success">Matches live</Badge>
							{:else}
								<Badge color="warning">Differs from live</Badge>
							{/if}
						{/if}
					{/if}
				</div>
				<Button
					color="neutral"
					variant="subtle"
					size="sm"
					onclick={loadServerSummary}
					disabled={serverSummary.loading || !customRangeReady}
				>
					<Icon name="lucide:cloud-download" class="size-4" />
					{serverSummary.loading ? 'Loading…' : serverSummary.value ? 'Refresh' : 'Load summary'}
				</Button>
			</div>
			{#if serverSummary.loading}
				<p class="mt-2 text-[12px] text-(--ui-text-dimmed)">Loading the server aggregate…</p>
			{:else if serverSummary.error}
				<p role="alert" class="mt-2 text-[12px] text-(--tone-error-text)">
					{serverSummary.error} — using live local data.
				</p>
			{:else if serverSummary.value && serverSummaryTotals}
				<div class="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
					<div class="rounded-lg bg-(--ui-bg-muted) p-3">
						<div class="text-[10.5px] font-semibold text-(--ui-text-dimmed) uppercase">Gross</div>
						<div class="mt-0.5 font-display text-[15px] font-bold tabular-nums">
							{formatMoney(
								fromMinorUnits(serverSummaryTotals.grossMinor, serverSummary.value.currency),
								serverSummary.value.currency
							)}
						</div>
					</div>
					<div class="rounded-lg bg-(--ui-bg-muted) p-3">
						<div class="text-[10.5px] font-semibold text-(--ui-text-dimmed) uppercase">Orders</div>
						<div class="mt-0.5 font-display text-[15px] font-bold tabular-nums">
							{formatInt(serverSummaryTotals.ordersCount)}
						</div>
					</div>
					<div class="rounded-lg bg-(--ui-bg-muted) p-3">
						<div class="text-[10.5px] font-semibold text-(--ui-text-dimmed) uppercase">
							Avg order
						</div>
						<div class="mt-0.5 font-display text-[15px] font-bold tabular-nums">
							{formatMoney(
								fromMinorUnits(
									serverSummaryTotals.ordersCount
										? Math.round(serverSummaryTotals.grossMinor / serverSummaryTotals.ordersCount)
										: 0,
									serverSummary.value.currency
								),
								serverSummary.value.currency
							)}
						</div>
					</div>
					<div class="rounded-lg bg-(--ui-bg-muted) p-3">
						<div class="text-[10.5px] font-semibold text-(--ui-text-dimmed) uppercase">Periods</div>
						<div class="mt-0.5 font-display text-[15px] font-bold tabular-nums">
							{formatInt(serverSummaryTotals.buckets)}
						</div>
					</div>
				</div>
				<p class="mt-2 text-[11px] leading-relaxed text-(--ui-text-dimmed)">
					{serverSummary.value.snapshot ? 'Snapshot' : 'Partial snapshot'} · generated {relativeTime(
						serverSummary.value.generatedAt * 1000
					)} · {serverSummary.value.currency}
					{#if serverSummaryDelta}
						· live delta: {serverSummaryDelta.orders >= 0 ? '+' : ''}{serverSummaryDelta.orders}
						order{Math.abs(serverSummaryDelta.orders) === 1 ? '' : 's'},
						{serverSummaryDelta.gross >= 0 ? '+' : '−'}{formatMoney(
							fromMinorUnits(Math.abs(serverSummaryDelta.gross), serverSummary.value.currency),
							serverSummary.value.currency
						)} gross
					{/if}
				</p>
				{#if serverSummary.value.watermark !== null}
					<p class="mt-1 text-[11px] text-(--ui-text-dimmed)">
						Newest stored snapshot {relativeTime(serverSummary.value.watermark * 1000)}. Missing
						periods are gaps, not zeros.
					</p>
				{/if}
			{:else}
				<p class="mt-2 text-[12px] text-(--ui-text-muted)">
					Load the service-computed aggregate for this period. Local data remains the source of
					truth.
				</p>
			{/if}
		</div>
	{/if}

	<!-- Loading state -->
	{#if isLoading && !hasData}
		<div class="flex h-64 flex-col items-center justify-center gap-3 text-(--ui-text-dimmed)">
			<Icon name="lucide:loader-circle" class="size-8 animate-spin" />
			<span class="text-[13px]">Loading orders…</span>
		</div>
	{:else if !hasData}
		<!-- Empty state -->
		<div class="surface-card flex h-64 flex-col items-center justify-center gap-3">
			<Icon name="lucide:chart-no-axes-column" class="size-10 text-(--ui-text-dimmed)" />
			<div class="text-center">
				<p class="font-display text-[15px] font-semibold">No data for this period</p>
				<p class="text-[12.5px] text-(--ui-text-muted)">
					Try a different date range, or make some sales first.
				</p>
			</div>
		</div>
	{:else}
		<!-- Summary stat cards -->
		<div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
			{@render statCard({
				label: t('dashboard.revenue'),
				value: formatMoney(totalRevenue, currency),
				change: revenueChange,
				icon: 'lucide:trending-up',
				accent: 'text-primary-600 dark:text-primary-400'
			})}
			{@render statCard({
				label: 'Orders',
				value: formatInt(orderCount),
				change: countChange,
				icon: 'lucide:receipt',
				accent: 'text-blue-600 dark:text-blue-400'
			})}
			{@render statCard({
				label: 'Avg Order',
				value: formatMoney(avgOrderValue, currency),
				change: aovChange,
				icon: 'lucide:scale',
				accent: 'text-amber-600 dark:text-amber-400'
			})}
			{@render statCard({
				label: 'Items Sold',
				value: formatInt(itemsSold),
				change: itemsChange,
				icon: 'lucide:shopping-bag',
				accent: 'text-emerald-600 dark:text-emerald-400'
			})}
		</div>

		<!-- P&L Summary -->
		<div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
			<div class="surface-card p-4">
				<div class="mb-2 flex items-center justify-between">
					<span class="text-[11.5px] font-semibold tracking-wide text-(--ui-text-dimmed) uppercase"
						>{t('dashboard.revenue')}</span
					>
					<Icon name="lucide:trending-up" class="size-4 text-emerald-600 dark:text-emerald-400" />
				</div>
				<div
					class="font-display text-xl font-bold text-emerald-600 tabular-nums dark:text-emerald-400"
				>
					{formatMoney(totalRevenue, currency)}
				</div>
			</div>
			<div class="surface-card p-4">
				<div class="mb-2 flex items-center justify-between">
					<span class="text-[11.5px] font-semibold tracking-wide text-(--ui-text-dimmed) uppercase"
						>Expenses</span
					>
					<Icon name="lucide:trending-down" class="size-4 text-rose-500" />
				</div>
				<div class="font-display text-xl font-bold text-rose-500 tabular-nums">
					{formatMoney(totalExpenses, currency)}
				</div>
				{#if expenseBreakdown.length > 0}
					<div class="mt-1 text-[11px] text-(--ui-text-dimmed)">
						{expenseBreakdown.length} categories
					</div>
				{/if}
			</div>
			<div class="surface-card p-4">
				<div class="mb-2 flex items-center justify-between">
					<span class="text-[11.5px] font-semibold tracking-wide text-(--ui-text-dimmed) uppercase"
						>{t('nav.income')}</span
					>
					<Icon name="lucide:hand-coins" class="size-4 text-emerald-500" />
				</div>
				<div
					class="font-display text-xl font-bold text-emerald-600 tabular-nums dark:text-emerald-400"
				>
					{formatMoney(totalIncome, currency)}
				</div>
				{#if filteredIncome.length > 0}
					<div class="mt-1 text-[11px] text-(--ui-text-dimmed)">
						{filteredIncome.length} entries
					</div>
				{/if}
			</div>
			<div class="surface-card p-4">
				<div class="mb-2 flex items-center justify-between">
					<span class="text-[11.5px] font-semibold tracking-wide text-(--ui-text-dimmed) uppercase"
						>Net Profit</span
					>
					<Icon
						name="lucide:wallet"
						class="size-4 {netProfit >= 0
							? 'text-emerald-600 dark:text-emerald-400'
							: 'text-rose-500'}"
					/>
				</div>
				<div
					class="font-display text-xl font-bold tabular-nums {netProfit >= 0
						? 'text-emerald-600 dark:text-emerald-400'
						: 'text-rose-500'}"
				>
					{formatMoney(netProfit, currency)}
				</div>
				<div class="mt-0.5 text-[12px] font-semibold text-(--ui-text-dimmed) tabular-nums">
					{netBasis > 0 ? ((netProfit / netBasis) * 100).toFixed(1) : '0.0'}% margin
				</div>
			</div>
		</div>

		<!-- Revenue chart + Payment breakdown -->
		<div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
			<!-- Revenue chart (2 cols) -->
			<div class="surface-card p-5 lg:col-span-2">
				<div class="mb-4 flex items-center justify-between">
					<h2 class="font-display text-[15px] font-semibold tracking-tight">
						{t('dashboard.revenue')}
					</h2>
					<div class="flex items-baseline gap-2">
						<span
							class="font-display text-lg font-bold text-primary-600 tabular-nums dark:text-primary-400"
						>
							{formatMoney(totalRevenue, currency)}
						</span>
						{#if revenueChange !== null}
							<span
								class="text-[12px] font-semibold tabular-nums {revenueChange >= 0
									? 'text-emerald-600 dark:text-emerald-400'
									: 'text-red-500'}"
							>
								{fmtPct(revenueChange)}
							</span>
						{/if}
					</div>
				</div>
				<div class="flex h-44 items-end justify-between gap-1">
					{#each revenueByDay as day (day.label + day.sublabel)}
						<div class="group relative flex flex-1 flex-col items-center gap-1.5">
							<!-- Tooltip -->
							<div
								class="pointer-events-none absolute -top-8 z-10 hidden rounded-md border border-(--ui-border) bg-(--ui-bg-elevated) px-2 py-1 text-[11px] font-semibold whitespace-nowrap tabular-nums shadow-md group-hover:block"
							>
								{formatMoney(day.total, currency)}
							</div>
							<div
								class="w-full rounded-t-md transition-all
									{day.total > 0
									? 'bg-gradient-to-t from-primary-500/30 to-primary-500 hover:from-primary-500/50 hover:to-primary-400'
									: 'bg-(--ui-bg-accented)'}"
								style="height: {Math.max(3, (day.total / maxRevenueDay) * 160)}px"
							></div>
							<span class="text-[10px] font-semibold text-(--ui-text-dimmed)">
								{day.label}
							</span>
						</div>
					{/each}
				</div>
			</div>

			<!-- Payment method breakdown -->
			<div class="surface-card p-5">
				<h2 class="mb-4 font-display text-[15px] font-semibold tracking-tight">Payment Methods</h2>
				{#if paymentBreakdown.length === 0}
					<div class="flex h-32 items-center justify-center text-[12.5px] text-(--ui-text-dimmed)">
						No payment data
					</div>
				{:else}
					<div class="space-y-3">
						{#each paymentBreakdown as pm (pm.key)}
							<div>
								<div class="mb-1 flex items-center justify-between text-[12.5px]">
									<div class="flex items-center gap-1.5">
										<span style="color: {pm.color}"><Icon name={pm.icon} class="size-3.5" /></span>
										<span class="font-semibold">{pm.label}</span>
									</div>
									<div class="flex items-center gap-2 tabular-nums">
										<span class="text-(--ui-text-muted)">
											{formatMoney(pm.total, currency)}
										</span>
										<span class="font-semibold">{pm.percent.toFixed(0)}%</span>
									</div>
								</div>
								<div class="h-2 overflow-hidden rounded-full bg-(--ui-bg-accented)">
									<div
										class="h-full rounded-full transition-all"
										style="width: {pm.percent}%; background: {pm.color}"
									></div>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>

		<!-- Expense category breakdown -->
		<div class="surface-card p-5">
			<h2 class="mb-4 font-display text-[15px] font-semibold tracking-tight">Expense Breakdown</h2>
			{#if expenseBreakdown.length === 0}
				<div class="flex h-32 items-center justify-center text-[12.5px] text-(--ui-text-dimmed)">
					No expenses in this period
				</div>
			{:else}
				<div class="space-y-3">
					{#each expenseBreakdown as ec (ec.key)}
						<div>
							<div class="mb-1 flex items-center justify-between text-[12.5px]">
								<div class="flex items-center gap-1.5">
									<span style="color: {ec.color}"><Icon name={ec.icon} class="size-3.5" /></span>
									<span class="font-semibold">{ec.label}</span>
									<span class="text-[10px] text-(--ui-text-dimmed)">({ec.count})</span>
								</div>
								<div class="flex items-center gap-2 tabular-nums">
									<span class="text-(--ui-text-muted)">{formatMoney(ec.total, currency)}</span>
									<span class="font-semibold">{ec.percent.toFixed(0)}%</span>
								</div>
							</div>
							<div class="h-2 overflow-hidden rounded-full bg-(--ui-bg-accented)">
								<div
									class="h-full rounded-full transition-all"
									style="width: {ec.percent}%; background: {ec.color}"
								></div>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Hourly sales chart -->
		<div class="surface-card p-5">
			<div class="mb-4 flex items-center justify-between">
				<h2 class="font-display text-[15px] font-semibold tracking-tight">Sales by Hour</h2>
				{#if peakHour && peakHour.total > 0}
					<span class="text-[12px] text-(--ui-text-muted)">
						Peak: <span class="font-semibold text-(--ui-text)">{peakHour.label}</span>
						· <span class="tabular-nums">{formatMoney(peakHour.total, currency)}</span>
					</span>
				{/if}
			</div>
			<div class="flex h-36 items-end justify-between gap-1">
				{#each hourlySales as hr (hr.hour)}
					<div class="group relative flex flex-1 flex-col items-center gap-1">
						<div
							class="pointer-events-none absolute -top-8 z-10 hidden rounded-md border border-(--ui-border) bg-(--ui-bg-elevated) px-2 py-1 text-[11px] font-semibold whitespace-nowrap tabular-nums shadow-md group-hover:block"
						>
							{formatMoney(hr.total, currency)} · {hr.count} orders
						</div>
						<div
							class="w-full rounded-t-md transition-all
								{hr.total === maxHourTotal && hr.total > 0
								? 'bg-gradient-to-t from-amber-500/40 to-amber-500'
								: 'bg-gradient-to-t from-blue-500/30 to-blue-500'}"
							style="height: {Math.max(3, (hr.total / maxHourTotal) * 130)}px"
						></div>
						<span class="text-[10px] font-semibold text-(--ui-text-dimmed)">{hr.label}</span>
					</div>
				{/each}
			</div>
		</div>

		<!-- Top products table -->
		<div class="surface-card p-5">
			<h2 class="mb-4 font-display text-[15px] font-semibold tracking-tight">Top Products</h2>
			{#if topProducts.length === 0}
				<div
					class="flex h-32 items-center justify-center gap-2 text-[12.5px] text-(--ui-text-dimmed)"
				>
					<Icon name="lucide:package-open" class="size-5" />
					No product sales in this period.
				</div>
			{:else}
				<div class="overflow-x-auto">
					<table class="w-full text-left text-[13px]">
						<thead>
							<tr
								class="border-b border-(--ui-border) text-[11.5px] tracking-wide text-(--ui-text-dimmed) uppercase"
							>
								<th class="py-2 pr-3 font-semibold">#</th>
								<th class="py-2 pr-3 font-semibold">{t('common.product')}</th>
								<th class="py-2 pr-3 text-right font-semibold">{t('common.qty')}</th>
								<th class="py-2 pr-3 text-right font-semibold">{t('dashboard.revenue')}</th>
								<th class="py-2 text-right font-semibold">% Rev</th>
							</tr>
						</thead>
						<tbody>
							{#each topProducts as p, i (p.name + i)}
								<tr
									class="border-b border-(--ui-border)/50 transition-colors hover:bg-(--ui-bg-accented)/50"
								>
									<td class="py-2.5 pr-3 text-(--ui-text-dimmed) tabular-nums">{i + 1}</td>
									<td class="py-2.5 pr-3 font-semibold">{p.name}</td>
									<td class="py-2.5 pr-3 text-right tabular-nums">{formatInt(p.qty)}</td>
									<td class="py-2.5 pr-3 text-right tabular-nums">
										{formatMoney(p.revenue, currency)}
									</td>
									<td class="py-2.5 text-right text-(--ui-text-muted) tabular-nums">
										{totalRevenue > 0 ? ((p.revenue / totalRevenue) * 100).toFixed(1) : '0.0'}%
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>
	{/if}

	<!-- Snapshot history -->
	<div class="surface-card overflow-hidden">
		<div class="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
			<div class="flex items-center gap-2">
				<Icon name="lucide:history" class="size-4 text-primary-500" />
				<h2 class="font-display text-[14px] font-semibold tracking-tight">Snapshots</h2>
				<Badge color="neutral">{snapshotRows.length}</Badge>
			</div>
			{#if snapshotRows.length > 6}
				<Button
					color="neutral"
					variant="ghost"
					size="sm"
					onclick={() => (showAllSnapshots = !showAllSnapshots)}
				>
					{showAllSnapshots ? 'Show less' : `Show all ${snapshotRows.length}`}
				</Button>
			{/if}
		</div>
		{#if !snapshotRows.length}
			<p class="border-t border-(--ui-border-muted) px-5 py-6 text-[12.5px] text-(--ui-text-muted)">
				No snapshots yet. Open Reports with sales or close a shift to create one.
			</p>
		{:else}
			<div class="overflow-x-auto border-t border-(--ui-border-muted)">
				<table class="w-full min-w-[820px] text-[12px]">
					<thead class="bg-(--ui-bg-muted)/50">
						<tr class="text-left text-(--ui-text-dimmed)">
							<th class="px-5 py-2.5 font-semibold">Period</th>
							<th class="px-3 py-2.5 font-semibold">Type</th>
							<th class="px-3 py-2.5 font-semibold">Scope</th>
							<th class="px-3 py-2.5 text-right font-semibold">Gross</th>
							<th class="px-3 py-2.5 text-right font-semibold">Net</th>
							<th class="px-3 py-2.5 text-right font-semibold">Orders</th>
							<th class="px-3 py-2.5 font-semibold">Generated</th>
							<th class="px-3 py-2.5 font-semibold">Status</th>
							<th class="px-5 py-2.5 text-right font-semibold">Actions</th>
						</tr>
					</thead>
					<tbody>
						{#each visibleSnapshots as row (row.object.id)}
							<tr
								class="border-t border-(--ui-border)/50 transition-colors hover:bg-(--ui-bg-accented)/40"
							>
								<td class="px-5 py-2.5 font-semibold whitespace-nowrap">
									{formatSnapshotPeriod(row.data)}
								</td>
								<td class="px-3 py-2.5">
									<Badge color="neutral">{row.data.granularity}</Badge>
								</td>
								<td class="px-3 py-2.5 text-(--ui-text-muted)">{snapshotScope(row.data)}</td>
								<td class="px-3 py-2.5 text-right tabular-nums">
									{formatMoney(
										fromMinorUnits(row.data.grossMinor, row.data.currency),
										row.data.currency
									)}
								</td>
								<td class="px-3 py-2.5 text-right font-semibold tabular-nums">
									{formatMoney(
										fromMinorUnits(row.data.netMinor, row.data.currency),
										row.data.currency
									)}
								</td>
								<td class="px-3 py-2.5 text-right tabular-nums">
									{formatInt(row.data.ordersCount)}
								</td>
								<td class="px-3 py-2.5 whitespace-nowrap text-(--ui-text-muted)">
									{relativeTime(row.data.generatedAt)}
								</td>
								<td class="px-3 py-2.5">
									<Badge color={snapshotPublished(row.object) ? 'success' : 'neutral'}>
										{snapshotPublished(row.object) ? 'Published' : 'Local'}
									</Badge>
								</td>
								<td class="px-5 py-2.5">
									<div class="flex items-center justify-end gap-1">
										<Button
											color="neutral"
											variant="ghost"
											size="icon-sm"
											aria-label="Re-publish snapshot"
											title="Re-publish snapshot"
											onclick={() => republishSnapshot(row.data)}
											disabled={snapshotBusy}
										>
											<Icon name="lucide:refresh-cw" class="size-4" />
										</Button>
										<Button
											color="neutral"
											variant="ghost"
											size="icon-sm"
											aria-label="Copy snapshot id"
											title="Copy snapshot id"
											onclick={() => copySnapshotId(row.object.id)}
										>
											<Icon name="lucide:copy" class="size-4" />
										</Button>
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
</div>

{#snippet statCard(props: {
	label: string;
	value: string;
	change: number | null;
	icon: string;
	accent: string;
})}
	<div class="surface-card p-4">
		<div class="mb-2 flex items-center justify-between">
			<span class="text-[11.5px] font-semibold tracking-wide text-(--ui-text-dimmed) uppercase">
				{props.label}
			</span>
			<Icon name={props.icon} class="size-4 {props.accent}" />
		</div>
		<div class="font-display text-xl font-bold tabular-nums">{props.value}</div>
		{#if props.change !== null}
			<div
				class="mt-0.5 text-[12px] font-semibold tabular-nums {props.change >= 0
					? 'text-emerald-600 dark:text-emerald-400'
					: 'text-red-500'}"
			>
				<span class="mr-0.5">{props.change >= 0 ? '▲' : '▼'}</span>
				{fmtPct(props.change)}
				<span class="font-normal text-(--ui-text-dimmed)"> vs prev</span>
			</div>
		{:else}
			<div class="mt-0.5 text-[12px] text-(--ui-text-dimmed)">— vs prev</div>
		{/if}
	</div>
{/snippet}
