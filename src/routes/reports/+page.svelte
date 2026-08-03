<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { glo } from '$nostr/store.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { formatMoney, formatInt } from '$lib/utils/format';
	import { startOfDay, type DashboardOrder } from '$lib/dashboard/metrics';
	import type { GloOrder, GloProduct } from '@bitos/bnos-core/glo';
	import { TYPE, type Expense, type ExpenseCategory } from '$lib/domain';

	// ── Data hydration ──────────────────────────────────────────────
	onMount(() => {
		glo.hydrate('commerce.order');
		glo.hydrate('catalog.product');
		glo.hydrate(TYPE.expense);
	});

	const orders = $derived(glo.all<GloOrder, 'commerce.order'>('commerce.order'));
	const products = $derived(glo.all<GloProduct, 'catalog.product'>('catalog.product'));
	const expenses = $derived(glo.all<Expense, typeof TYPE.expense>(TYPE.expense));
	const currency = $derived(tenant.state.currency);

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

	/** Duration of the selected range, used to compute the previous period. */
	const rangeDuration = $derived(rangeEnd - rangeStart);
	const prevStart = $derived(rangeStart - rangeDuration);
	const prevEnd = $derived(rangeStart);

	// ── Filtered orders ─────────────────────────────────────────────
	const filteredOrders = $derived(
		orders.filter((o) => {
			const t = new Date(o.data.occurredAt || o.data.createdAt || 0).getTime();
			return t >= rangeStart && t <= rangeEnd;
		})
	);

	const prevOrders = $derived(
		orders.filter((o) => {
			const t = new Date(o.data.occurredAt || o.data.createdAt || 0).getTime();
			return t >= prevStart && t < prevEnd;
		})
	);

	const isLoading = $derived(glo.hydrating);
	const hasData = $derived(filteredOrders.length > 0);

	// ── Summary stats ───────────────────────────────────────────────
	const totalRevenue = $derived(filteredOrders.reduce((s, o) => s + (o.data.total ?? 0), 0));
	const orderCount = $derived(filteredOrders.length);
	const avgOrderValue = $derived(orderCount > 0 ? totalRevenue / orderCount : 0);
	const itemsSold = $derived(
		filteredOrders.reduce(
			(s, o) => s + (o.data.lines ?? []).reduce((ls, l) => ls + l.quantity, 0),
			0
		)
	);

	// Previous period stats
	const prevRevenue = $derived(prevOrders.reduce((s, o) => s + (o.data.total ?? 0), 0));
	const prevCount = $derived(prevOrders.length);
	const prevAOV = $derived(prevCount > 0 ? prevRevenue / prevCount : 0);
	const prevItems = $derived(
		prevOrders.reduce(
			(s, o) => s + (o.data.lines ?? []).reduce((ls, l) => ls + l.quantity, 0),
			0
		)
	);

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
		const numDays = Math.min(Math.ceil((rangeEnd - rangeStart) / MS_DAY) + 1, 31);
		const now = new Date();
		for (let i = numDays - 1; i >= 0; i--) {
			const d = new Date(now);
			d.setHours(0, 0, 0, 0);
			d.setDate(d.getDate() - i);
			const start = d.getTime();
			const end = start + MS_DAY;
			const total = filteredOrders
				.filter((o) => {
					const t = new Date(o.data.occurredAt || o.data.createdAt || 0).getTime();
					return t >= start && t < end;
				})
				.reduce((s, o) => s + (o.data.total ?? 0), 0);
			days.push({
				label:
					numDays <= 7
						? d.toLocaleDateString('en-US', { weekday: 'short' })
						: `${d.getDate()}/${d.getMonth() + 1}`,
				sublabel: numDays > 7 && i === 0 ? 'today' : '',
				total,
				isToday: i === 0
			});
		}
		return days;
	});
	const maxRevenueDay = $derived(Math.max(1, ...revenueByDay.map((d) => d.total)));

	// ── Hourly sales ────────────────────────────────────────────────
	const hourlySales = $derived.by(() => {
		const hours: { hour: number; label: string; total: number; count: number }[] = [];
		const startHour = 6;
		const endHour = 23;
		for (let h = startHour; h <= endHour; h++) {
			const total = filteredOrders
				.filter((o) => new Date(o.data.occurredAt || o.data.createdAt || 0).getHours() === h)
				.reduce((s, o) => s + (o.data.total ?? 0), 0);
			const count = filteredOrders.filter(
				(o) => new Date(o.data.occurredAt || o.data.createdAt || 0).getHours() === h
			).length;
			hours.push({
				hour: h,
				label: `${h % 12 || 12}${h < 12 ? 'a' : 'p'}`,
				total,
				count
			});
		}
		return hours;
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
		const map = new Map<string, { total: number; count: number }>();
		for (const o of filteredOrders) {
			const method = (o.data as DashboardOrder).method ?? 'cash';
			const e = map.get(method) ?? { total: 0, count: 0 };
			e.total += o.data.total ?? 0;
			e.count += 1;
			map.set(method, e);
		}
		const total = totalRevenue || 1;
		return [...map.entries()]
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
		const map = new Map<string, { name: string; qty: number; revenue: number }>();
		for (const o of filteredOrders) {
			for (const l of o.data.lines ?? []) {
				const key = l.productId || l.name || 'unknown';
				const name =
					products.find((p) => p.id === key)?.data.name ?? l.name ?? 'Unknown product';
				const e = map.get(key) ?? { name, qty: 0, revenue: 0 };
				e.qty += l.quantity;
				e.revenue += l.total ?? l.quantity * l.unitPrice;
				map.set(key, e);
			}
		}
		return [...map.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 10);
	});

	// ── Expenses & P&L ─────────────────────────────────────────────
	const filteredExpenses = $derived(
		expenses.filter((e) => {
			const t = new Date(e.data.occurredAt || 0).getTime();
			return t >= rangeStart && t <= rangeEnd;
		})
	);
	const totalExpenses = $derived(filteredExpenses.reduce((s, e) => s + (e.data.amount ?? 0), 0));
	const netProfit = $derived(totalRevenue - totalExpenses);

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
		const map = new Map<string, { total: number; count: number }>();
		for (const e of filteredExpenses) {
			const cat = e.data.category ?? 'other';
			const entry = map.get(cat) ?? { total: 0, count: 0 };
			entry.total += e.data.amount ?? 0;
			entry.count += 1;
			map.set(cat, entry);
		}
		const total = totalExpenses || 1;
		return [...map.entries()]
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
			const date = d.occurredAt || d.createdAt || '';
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

<svelte:head><title>BNOS · Reports</title></svelte:head>

<div class="space-y-5">
	<!-- Header -->
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h1 class="font-display text-xl font-bold tracking-tight">Reports</h1>
			<p class="text-[12.5px] text-[var(--ui-text-muted)]">
				Derived live from signed order records
			</p>
		</div>
		<Button variant="subtle" size="sm" icon="lucide:download" onclick={exportCSV} disabled={!hasData}>
			Export CSV
		</Button>
	</div>

	<!-- Date range selector -->
	<div class="flex flex-wrap items-center gap-2">
		{#each rangePresets as rp (rp.key)}
			<button
				class="rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors tabular-nums
					{rangePreset === rp.key
					? 'bg-primary-500 text-white'
					: 'bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)] hover:text-[var(--ui-text)] hover:bg-[var(--interactive-hover-bg)]'}"
				onclick={() => (rangePreset = rp.key)}
			>
				{rp.label}
			</button>
		{/each}
		{#if showCustom}
			<div class="flex items-center gap-1.5">
				<input
					type="date"
					class="rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-2.5 py-1.5 text-[13px] text-[var(--ui-text)] outline-none focus:border-primary-500"
					bind:value={customStart}
				/>
				<span class="text-[12px] text-[var(--ui-text-dimmed)]">→</span>
				<input
					type="date"
					class="rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-2.5 py-1.5 text-[13px] text-[var(--ui-text)] outline-none focus:border-primary-500"
					bind:value={customEnd}
				/>
			</div>
		{/if}
	</div>

	<!-- Loading state -->
	{#if isLoading && !hasData}
		<div class="flex h-64 flex-col items-center justify-center gap-3 text-[var(--ui-text-dimmed)]">
			<Icon name="lucide:loader-circle" class="size-8 animate-spin" />
			<span class="text-[13px]">Loading orders…</span>
		</div>
	{:else if !hasData}
		<!-- Empty state -->
		<div class="surface-card flex h-64 flex-col items-center justify-center gap-3">
			<Icon name="lucide:chart-no-axes-column" class="size-10 text-[var(--ui-text-dimmed)]" />
			<div class="text-center">
				<p class="font-display text-[15px] font-semibold">No data for this period</p>
				<p class="text-[12.5px] text-[var(--ui-text-muted)]">
				Try a different date range, or make some sales first.
				</p>
			</div>
		</div>
	{:else}
		<!-- Summary stat cards -->
		<div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
			{@render statCard({
				label: 'Revenue',
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
		<div class="grid grid-cols-2 gap-3 lg:grid-cols-3">
			<div class="surface-card p-4">
				<div class="mb-2 flex items-center justify-between">
					<span class="text-[11.5px] font-semibold uppercase tracking-wide text-[var(--ui-text-dimmed)]">Revenue</span>
					<Icon name="lucide:trending-up" class="size-4 text-emerald-600 dark:text-emerald-400" />
				</div>
				<div class="font-display text-xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{formatMoney(totalRevenue, currency)}</div>
			</div>
			<div class="surface-card p-4">
				<div class="mb-2 flex items-center justify-between">
					<span class="text-[11.5px] font-semibold uppercase tracking-wide text-[var(--ui-text-dimmed)]">Expenses</span>
					<Icon name="lucide:trending-down" class="size-4 text-rose-500" />
				</div>
				<div class="font-display text-xl font-bold tabular-nums text-rose-500">{formatMoney(totalExpenses, currency)}</div>
				{#if expenseBreakdown.length > 0}
					<div class="mt-1 text-[11px] text-[var(--ui-text-dimmed)]">{expenseBreakdown.length} categories</div>
				{/if}
			</div>
			<div class="surface-card p-4">
				<div class="mb-2 flex items-center justify-between">
					<span class="text-[11.5px] font-semibold uppercase tracking-wide text-[var(--ui-text-dimmed)]">Net Profit</span>
					<Icon name="lucide:wallet" class="size-4 {netProfit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'}" />
				</div>
				<div class="font-display text-xl font-bold tabular-nums {netProfit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'}">{formatMoney(netProfit, currency)}</div>
				<div class="mt-0.5 text-[12px] font-semibold tabular-nums text-[var(--ui-text-dimmed)]">
					{totalRevenue > 0 ? ((netProfit / totalRevenue) * 100).toFixed(1) : '0.0'}% margin
				</div>
			</div>
		</div>

		<!-- Revenue chart + Payment breakdown -->
		<div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
			<!-- Revenue chart (2 cols) -->
			<div class="surface-card p-5 lg:col-span-2">
				<div class="mb-4 flex items-center justify-between">
					<h2 class="font-display text-[15px] font-semibold tracking-tight">Revenue</h2>
					<div class="flex items-baseline gap-2">
						<span class="font-display text-lg font-bold tabular-nums text-primary-600 dark:text-primary-400">
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
								class="pointer-events-none absolute -top-8 z-10 hidden whitespace-nowrap rounded-md bg-[var(--ui-bg-elevated)] px-2 py-1 text-[11px] font-semibold shadow-md tabular-nums group-hover:block border border-[var(--ui-border)]"
							>
								{formatMoney(day.total, currency)}
							</div>
							<div
								class="w-full rounded-t-md transition-all
									{day.total > 0
									? 'bg-gradient-to-t from-primary-500/30 to-primary-500 hover:from-primary-500/50 hover:to-primary-400'
									: 'bg-[var(--ui-bg-accented)]'}"
								style="height: {Math.max(3, (day.total / maxRevenueDay) * 160)}px"
							></div>
							<span class="text-[10px] font-semibold text-[var(--ui-text-dimmed)]">
								{day.label}
							</span>
						</div>
					{/each}
				</div>
			</div>

			<!-- Payment method breakdown -->
			<div class="surface-card p-5">
				<h2 class="mb-4 font-display text-[15px] font-semibold tracking-tight">
					Payment Methods
				</h2>
				{#if paymentBreakdown.length === 0}
					<div class="flex h-32 items-center justify-center text-[12.5px] text-[var(--ui-text-dimmed)]">
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
										<span class="text-[var(--ui-text-muted)]">
											{formatMoney(pm.total, currency)}
										</span>
										<span class="font-semibold">{pm.percent.toFixed(0)}%</span>
									</div>
								</div>
								<div class="h-2 overflow-hidden rounded-full bg-[var(--ui-bg-accented)]">
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
			<h2 class="mb-4 font-display text-[15px] font-semibold tracking-tight">
				Expense Breakdown
			</h2>
			{#if expenseBreakdown.length === 0}
				<div class="flex h-32 items-center justify-center text-[12.5px] text-[var(--ui-text-dimmed)]">
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
									<span class="text-[10px] text-[var(--ui-text-dimmed)]">({ec.count})</span>
								</div>
								<div class="flex items-center gap-2 tabular-nums">
									<span class="text-[var(--ui-text-muted)]">{formatMoney(ec.total, currency)}</span>
									<span class="font-semibold">{ec.percent.toFixed(0)}%</span>
								</div>
							</div>
							<div class="h-2 overflow-hidden rounded-full bg-[var(--ui-bg-accented)]">
								<div class="h-full rounded-full transition-all" style="width: {ec.percent}%; background: {ec.color}"></div>
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
					<span class="text-[12px] text-[var(--ui-text-muted)]">
						Peak: <span class="font-semibold text-[var(--ui-text)]">{peakHour.label}</span>
						· <span class="tabular-nums">{formatMoney(peakHour.total, currency)}</span>
					</span>
				{/if}
			</div>
			<div class="flex h-36 items-end justify-between gap-1">
				{#each hourlySales as hr (hr.hour)}
					<div class="group relative flex flex-1 flex-col items-center gap-1">
						<div
							class="pointer-events-none absolute -top-8 z-10 hidden whitespace-nowrap rounded-md bg-[var(--ui-bg-elevated)] px-2 py-1 text-[11px] font-semibold shadow-md tabular-nums group-hover:block border border-[var(--ui-border)]"
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
						<span class="text-[10px] font-semibold text-[var(--ui-text-dimmed)]">{hr.label}</span>
					</div>
				{/each}
			</div>
		</div>

		<!-- Top products table -->
		<div class="surface-card p-5">
			<h2 class="mb-4 font-display text-[15px] font-semibold tracking-tight">Top Products</h2>
			{#if topProducts.length === 0}
				<div class="flex h-32 items-center justify-center gap-2 text-[12.5px] text-[var(--ui-text-dimmed)]">
					<Icon name="lucide:package-open" class="size-5" />
					No product sales in this period.
				</div>
			{:else}
				<div class="overflow-x-auto">
					<table class="w-full text-left text-[13px]">
						<thead>
							<tr class="border-b border-[var(--ui-border)] text-[11.5px] uppercase tracking-wide text-[var(--ui-text-dimmed)]">
								<th class="py-2 pr-3 font-semibold">#</th>
								<th class="py-2 pr-3 font-semibold">Product</th>
								<th class="py-2 pr-3 text-right font-semibold">Qty</th>
								<th class="py-2 pr-3 text-right font-semibold">Revenue</th>
								<th class="py-2 text-right font-semibold">% Rev</th>
							</tr>
						</thead>
						<tbody>
							{#each topProducts as p, i (p.name + i)}
								<tr
									class="border-b border-[var(--ui-border)]/50 transition-colors hover:bg-[var(--ui-bg-accented)]/50"
								>
									<td class="py-2.5 pr-3 tabular-nums text-[var(--ui-text-dimmed)]">{i + 1}</td>
									<td class="py-2.5 pr-3 font-semibold">{p.name}</td>
									<td class="py-2.5 pr-3 text-right tabular-nums">{formatInt(p.qty)}</td>
									<td class="py-2.5 pr-3 text-right tabular-nums">
										{formatMoney(p.revenue, currency)}
									</td>
									<td class="py-2.5 text-right tabular-nums text-[var(--ui-text-muted)]">
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
</div>

{#snippet statCard(props: { label: string; value: string; change: number | null; icon: string; accent: string })}
	<div class="surface-card p-4">
		<div class="mb-2 flex items-center justify-between">
			<span class="text-[11.5px] font-semibold uppercase tracking-wide text-[var(--ui-text-dimmed)]">
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
				<span class="font-normal text-[var(--ui-text-dimmed)]"> vs prev</span>
			</div>
		{:else}
			<div class="mt-0.5 text-[12px] text-[var(--ui-text-dimmed)]">— vs prev</div>
		{/if}
	</div>
{/snippet}
