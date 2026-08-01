<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { glo } from '$nostr/store.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { session } from '$nostr/session.svelte';
	import { formatMoney, formatInt, relativeTime } from '$lib/utils/format';
	import {
		toOrderRows,
		metricsSummary,
		buildHourly,
		buildChartBars,
		paymentBreakdown,
		orderTypeSegments,
		topProducts,
		greeting,
		type DashboardOrder
	} from '$lib/dashboard/metrics';
	import type { GloOrder, GloProduct, GloCustomer } from '@bitos/bnos-core/glo';

	onMount(() => {
		glo.hydrate('commerce.order');
		glo.hydrate('catalog.product');
		glo.hydrate('crm.customer');
		void glo.syncAll(['commerce.order', 'catalog.product', 'crm.customer']);

		// live clock
		const tick = () =>
			(clock = new Date().toLocaleTimeString('en-US', {
				hour: '2-digit',
				minute: '2-digit',
				second: '2-digit',
				hour12: true
			}));
		tick();
		const id = setInterval(tick, 1000);
		return () => clearInterval(id);
	});

	const orderObjects = $derived(glo.all<DashboardOrder, 'commerce.order'>('commerce.order'));
	const rows = $derived(toOrderRows(orderObjects as never));
	const todayRows = $derived(rows.filter((o) => o.atMs >= startToday()));
	const currency = $derived(tenant.state.currency);

	const m = $derived(metricsSummary(rows));
	const hourly = $derived(buildHourly(rows));
	const chartBars = $derived(buildChartBars(rows));
	const payments = $derived(paymentBreakdown(todayRows));
	const segments = $derived(orderTypeSegments(todayRows));
	const products = $derived(topProducts(orderObjects as never));
	const recent = $derived([...rows].sort((a, b) => b.atMs - a.atMs).slice(0, 8));
	const productCount = $derived(glo.all<GloProduct, 'catalog.product'>('catalog.product').length);
	const customerCount = $derived(glo.all<GloCustomer, 'crm.customer'>('crm.customer').length);

	let clock = $state('');

	function startToday() {
		const x = new Date();
		x.setHours(0, 0, 0, 0);
		return x.getTime();
	}

	function statusColor(status: string): 'success' | 'info' | 'warning' | 'neutral' {
		const s = status.toLowerCase();
		if (s.includes('paid') || s.includes('complete') || s.includes('done')) return 'success';
		if (s.includes('pending') || s.includes('draft')) return 'warning';
		if (s.includes('cancel') || s.includes('refund')) return 'info';
		return 'neutral';
	}

	const quickActions = $derived([
		{
			to: '/pos',
			icon: 'lucide:scan-line',
			label: 'New sale',
			desc: 'Open the POS',
			color: 'text-primary-500',
			bg: 'bg-primary-500/10'
		},
		{
			to: '/orders',
			icon: 'lucide:receipt-text',
			label: 'Orders',
			desc: `${m.allTimeCount} total`,
			color: 'text-blue-500',
			bg: 'bg-blue-500/10'
		},
		{
			to: '/catalog',
			icon: 'lucide:package',
			label: 'Catalog',
			desc: `${productCount} products`,
			color: 'text-orange-500',
			bg: 'bg-orange-500/10'
		},
		{
			to: '/customers',
			icon: 'lucide:users',
			label: 'Customers',
			desc: `${customerCount} people`,
			color: 'text-emerald-500',
			bg: 'bg-emerald-500/10'
		}
	]);
</script>

<svelte:head><title>BNOS · Dashboard</title></svelte:head>

<div class="space-y-6 pt-1 pb-12">
	<!-- Welcome header -->
	<header class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<p class="text-[12px] font-semibold tracking-wider text-[var(--ui-text-dimmed)] uppercase">
				{greeting()}
			</p>
			<h1 class="font-display text-2xl font-bold tracking-tight">
				{tenant.state.organizationName || 'Your store'}
			</h1>
			<p class="mt-0.5 text-[12.5px] text-[var(--ui-text-muted)]">
				{session.shortNpub ?? 'Nostr identity'} · {tenant.state.currency}
			</p>
		</div>
		<div
			class="flex items-center gap-2 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-4 py-2"
		>
			<Icon name="lucide:clock" class="size-4 text-[var(--ui-text-dimmed)]" />
			<span class="font-mono text-[14px] font-semibold tabular-nums">{clock}</span>
		</div>
	</header>

	<!-- Quick actions -->
	<div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
		{#each quickActions as action (action.label)}
			<a
				href={action.to}
				class="surface-card group flex items-center gap-3 p-4 transition-colors hover:border-[var(--ui-border-accented)]"
			>
				<div class="grid size-10 shrink-0 place-items-center rounded-xl {action.bg} {action.color}">
					<Icon name={action.icon} class="size-5" />
				</div>
				<div class="min-w-0">
					<div class="text-[13px] font-semibold">{action.label}</div>
					<div class="truncate text-[11.5px] text-[var(--ui-text-muted)]">{action.desc}</div>
				</div>
			</a>
		{/each}
	</div>

	<!-- Main grid -->
	<div class="grid grid-cols-1 gap-5 xl:grid-cols-12">
		<!-- LEFT COLUMN -->
		<div class="flex flex-col gap-5 xl:col-span-5">
			<!-- Today's sales -->
			<div class="accent-bar surface-card p-5" style="--accent: var(--ui-color-primary-500);">
				<div class="flex items-start justify-between">
					<div>
						<div class="text-[12px] font-semibold text-[var(--ui-text-muted)]">Today's sales</div>
						<div class="mt-1 font-display text-3xl font-bold tracking-tight tabular-nums">
							{formatMoney(m.todaysTotal, currency)}
						</div>
					</div>
					{#if m.salesChange !== 0}
						<span
							class="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold {m.salesChange >=
							0
								? 'tone-success'
								: 'tone-error'}"
						>
							<Icon
								name={m.salesChange >= 0 ? 'lucide:trending-up' : 'lucide:trending-down'}
								class="size-3"
							/>
							{m.salesChange >= 0 ? '+' : ''}{m.salesChange.toFixed(1)}%
						</span>
					{/if}
				</div>
				<div class="mt-4 grid grid-cols-2 gap-3">
					<div class="rounded-lg bg-[var(--ui-bg-muted)] p-3">
						<div class="text-[11px] text-[var(--ui-text-dimmed)]">Orders</div>
						<div class="font-display text-lg font-bold tabular-nums">
							{formatInt(m.todaysCount)}
						</div>
					</div>
					<div class="rounded-lg bg-[var(--ui-bg-muted)] p-3">
						<div class="text-[11px] text-[var(--ui-text-dimmed)]">Avg. order</div>
						<div class="font-display text-lg font-bold tabular-nums">
							{formatMoney(m.avgOrder, currency)}
						</div>
					</div>
				</div>
			</div>

			<!-- Hourly sales -->
			<div class="surface-card p-5">
				<div class="mb-4 flex items-center justify-between">
					<h3 class="font-display text-[15px] font-semibold tracking-tight">Hourly sales</h3>
					<span class="text-[11px] text-[var(--ui-text-dimmed)]">today</span>
				</div>
				{#if hourly.length}
					<div class="flex h-32 items-end justify-between gap-1">
						{#each hourly as hr (hr.label)}
							<div class="flex flex-1 flex-col items-center gap-1">
								<div
									class="w-full rounded-t-md transition-all {hr.isPeak
										? 'bg-primary-500'
										: 'bg-primary-500/40'}"
									style="height: {Math.max(3, hr.height)}%"
									title={formatMoney(hr.value, currency)}
								></div>
								<span class="text-[9.5px] font-semibold text-[var(--ui-text-dimmed)]"
									>{hr.label}</span
								>
							</div>
						{/each}
					</div>
				{:else}
					<p class="py-8 text-center text-[12.5px] text-[var(--ui-text-dimmed)]">
						No sales yet today.
					</p>
				{/if}
			</div>

			<!-- Payment breakdown -->
			<div class="surface-card p-5">
				<h3 class="mb-3 font-display text-[15px] font-semibold tracking-tight">Payment methods</h3>
				{#if payments.length}
					<div class="space-y-2.5">
						{#each payments as p (p.key)}
							<div class="flex items-center gap-3">
								<div
									class="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)]"
								>
									<Icon name={p.icon} class="size-4" />
								</div>
								<div class="min-w-0 flex-1">
									<div class="flex items-center justify-between text-[12.5px]">
										<span class="font-semibold">{p.label}</span>
										<span class="text-[var(--ui-text-muted)] tabular-nums"
											>{formatMoney(p.total, currency)}</span
										>
									</div>
									<div class="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--ui-bg-accented)]">
										<div
											class="h-full rounded-full bg-primary-500"
											style="width: {p.percent}%"
										></div>
									</div>
								</div>
							</div>
						{/each}
					</div>
				{:else}
					<p class="py-4 text-center text-[12.5px] text-[var(--ui-text-dimmed)]">
						No payments today.
					</p>
				{/if}
			</div>

			<!-- Order types + top products -->
			<div class="surface-card p-5">
				<h3 class="mb-3 font-display text-[15px] font-semibold tracking-tight">Order types</h3>
				{#if segments.length}
					<div class="mb-4 flex flex-wrap gap-2">
						{#each segments as s (s.key)}
							<span
								class="inline-flex items-center gap-1.5 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-2.5 py-1 text-[11.5px] font-semibold"
							>
								<Icon name={s.icon} class="size-3.5 text-[var(--ui-text-dimmed)]" />
								{s.label}
								<span class="text-[var(--ui-text-dimmed)] tabular-nums">{s.count}</span>
							</span>
						{/each}
					</div>
				{:else}
					<p class="mb-4 text-[12.5px] text-[var(--ui-text-dimmed)]">No orders today.</p>
				{/if}

				<div class="border-t border-[var(--ui-border-muted)] pt-3">
					<h4 class="mb-2 text-[12px] font-semibold text-[var(--ui-text-muted)]">Top products</h4>
					{#if products.length}
						<ol class="space-y-1.5">
							{#each products as p, i (p.name)}
								<li class="flex items-center gap-2.5 text-[12.5px]">
									<span
										class="grid size-5 shrink-0 place-items-center rounded-full bg-primary-500/10 text-[10px] font-bold text-primary-600 dark:text-primary-400"
										>{i + 1}</span
									>
									<span class="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
									<span class="shrink-0 text-[var(--ui-text-muted)] tabular-nums"
										>{formatInt(p.qty)} sold</span
									>
								</li>
							{/each}
						</ol>
					{:else}
						<p class="text-[12px] text-[var(--ui-text-dimmed)]">No product sales yet.</p>
					{/if}
				</div>
			</div>
		</div>

		<!-- RIGHT COLUMN -->
		<div class="flex flex-col gap-5 xl:col-span-7">
			<!-- Metrics row -->
			<div class="grid grid-cols-3 gap-3">
				<div class="metric-card p-4">
					<div class="text-[11px] font-semibold text-[var(--ui-text-dimmed)]">Today</div>
					<div class="mt-1 font-display text-lg font-bold tabular-nums">
						{formatMoney(m.todaysTotal, currency)}
					</div>
					<div class="text-[11px] text-[var(--ui-text-muted)]">{m.todaysCount} orders</div>
				</div>
				<div class="metric-card p-4">
					<div class="text-[11px] font-semibold text-[var(--ui-text-dimmed)]">This week</div>
					<div class="mt-1 font-display text-lg font-bold tabular-nums">
						{formatMoney(m.weekTotal, currency)}
					</div>
					<div class="text-[11px] text-[var(--ui-text-muted)]">{m.weekCount} orders</div>
				</div>
				<div class="metric-card p-4">
					<div class="text-[11px] font-semibold text-[var(--ui-text-dimmed)]">This month</div>
					<div class="mt-1 font-display text-lg font-bold tabular-nums">
						{formatMoney(m.monthTotal, currency)}
					</div>
					<div class="text-[11px] text-[var(--ui-text-muted)]">{m.monthCount} orders</div>
				</div>
			</div>

			<!-- Sales chart (7 days) -->
			<div class="surface-card p-5">
				<div class="mb-4 flex items-center justify-between">
					<h3 class="font-display text-[15px] font-semibold tracking-tight">Sales · last 7 days</h3>
					<span
						class="font-display text-base font-bold text-primary-600 tabular-nums dark:text-primary-400"
					>
						{formatMoney(
							chartBars.reduce((s, b) => s + b.value, 0),
							currency
						)}
					</span>
				</div>
				<div class="flex h-44 items-end justify-between gap-2">
					{#each chartBars as bar (bar.label)}
						<div class="flex flex-1 flex-col items-center gap-1.5">
							<div
								class="w-full rounded-t-md transition-all {bar.isCurrent
									? 'bg-primary-500'
									: 'bg-primary-500/40'}"
								style="height: {Math.max(4, bar.height * 1.4)}px"
								title={formatMoney(bar.value, currency)}
							></div>
							<span
								class="text-[10.5px] font-semibold {bar.isCurrent
									? 'text-primary-500'
									: 'text-[var(--ui-text-dimmed)]'}"
							>
								{bar.label}
							</span>
						</div>
					{/each}
				</div>
			</div>

			<!-- Recent orders -->
			<div class="data-panel">
				<div
					class="flex items-center justify-between border-b border-[var(--ui-border-muted)] px-5 py-3.5"
				>
					<h3 class="font-display text-[15px] font-semibold tracking-tight">Recent orders</h3>
					<a
						href="/orders"
						class="text-[12.5px] font-semibold text-primary-600 hover:underline dark:text-primary-400"
						>View all</a
					>
				</div>
				{#if recent.length === 0}
					<div class="p-5">
						<EmptyState
							icon="lucide:receipt-text"
							title="No orders yet"
							description="Start a sale from the POS to see orders appear here, signed and synced over Nostr."
						>
							{#snippet actions()}
								<Button color="primary" size="sm" icon="lucide:scan-line" href="/pos"
									>Open POS</Button
								>
							{/snippet}
						</EmptyState>
					</div>
				{:else}
					<table class="table-surface w-full text-left">
						<thead class="text-[11px] tracking-wider text-[var(--ui-text-dimmed)] uppercase">
							<tr>
								<th class="px-5 py-2.5 font-semibold">Order</th>
								<th class="px-5 py-2.5 font-semibold">Status</th>
								<th class="px-5 py-2.5 text-right font-semibold">Total</th>
								<th class="px-5 py-2.5 text-right font-semibold">When</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-[var(--ui-border-muted)] text-[13px]">
							{#each recent as o (o.id)}
								<tr>
									<td class="px-5 py-3 font-mono text-[12.5px]">{o.number}</td>
									<td class="px-5 py-3"><Badge color={statusColor(o.status)}>{o.status}</Badge></td>
									<td class="px-5 py-3 text-right font-semibold tabular-nums"
										>{formatMoney(o.total, currency)}</td
									>
									<td class="px-5 py-3 text-right text-[12px] text-[var(--ui-text-dimmed)]"
										>{relativeTime(o.atMs)}</td
									>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
			</div>
		</div>
	</div>
</div>
