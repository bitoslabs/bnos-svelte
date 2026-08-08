<script lang="ts">
	/**
	 * Analytics — channel performance, revenue trend, top products, and a
	 * conversion funnel. All derived from the reactive GLO store using the
	 * shared dashboard metrics engine (no chart library added).
	 */
	import Icon from '$lib/components/ui/Icon.svelte';
	import { t } from '$lib/i18n/i18n.svelte';
	import { glo } from '$nostr/store.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { formatMoney, formatInt, titleCase } from '$lib/utils/format';
	import {
		TYPE,
		isRemoteSource,
		channelMeta,
		sourceLabel,
		sourceIcon
	} from '$lib/domain';
	import type {
		MarketplaceConnection,
		MarketplaceProduct,
		MarketplaceReview
	} from '$lib/domain';
	import type { DashboardOrder } from '$lib/dashboard/metrics';
	import { toOrderRows, buildChartBars, type OrderRow } from '$lib/dashboard/metrics';

	const currency = $derived(tenant.state.currency);
	const orders = $derived(glo.all<DashboardOrder, 'commerce.order'>('commerce.order'));
	const listings = $derived(
		glo.all<MarketplaceProduct, typeof TYPE.marketplaceProduct>(TYPE.marketplaceProduct)
	);
	const connections = $derived(
		glo.all<MarketplaceConnection, typeof TYPE.marketplaceConnection>(TYPE.marketplaceConnection)
	);
	const reviews = $derived(
		glo.all<MarketplaceReview, typeof TYPE.marketplaceReview>(TYPE.marketplaceReview)
	);

	const mpRows = $derived(toOrderRows(orders.filter((o) => isRemoteSource(o.data.source))));

	// 7-day revenue trend
	const bars = $derived(buildChartBars(mpRows as OrderRow[]));
	const maxBar = $derived(Math.max(...bars.map((b) => b.value), 0));
	const trendTotal = $derived(bars.reduce((s, b) => s + b.value, 0));

	// Channel breakdown
	const channelPerf = $derived.by(() => {
		const map = new Map<string, { total: number; count: number; source: string }>();
		for (const o of mpRows) {
			const src = o.source ?? 'other';
			const e = map.get(src) ?? { total: 0, count: 0, source: src };
			e.total += o.total;
			e.count += 1;
			map.set(src, e);
		}
		const grand = [...map.values()].reduce((s, e) => s + e.total, 0) || 1;
		return [...map.values()]
			.map((e) => ({ ...e, percent: (e.total / grand) * 100 }))
			.sort((a, b) => b.total - a.total);
	});

	// Conversion funnel
	const funnel = $derived.by(() => {
		const views = listings.reduce((s, l) => s + (l.data.views ?? 0), 0);
		const clicks = listings.reduce((s, l) => s + (l.data.clicks ?? 0), 0);
		const conv = listings.reduce((s, l) => s + (l.data.conversions ?? 0), 0);
		return { views, clicks, conv };
	});
	const funnelMax = $derived(Math.max(funnel.views, funnel.clicks, funnel.conv, 1));

	// Top products
	const topListings = $derived(
		[...listings]
			.sort((a, b) => (b.data.conversions ?? 0) - (a.data.conversions ?? 0))
			.slice(0, 5)
	);

	// Avg rating
	const avgRating = $derived.by(() => {
		const r = reviews.map((x) => x.data.rating).filter((x) => x > 0);
		return r.length ? r.reduce((s, x) => s + x, 0) / r.length : 0;
	});

	// AOV
	const aov = $derived(mpRows.length ? trendTotal / Math.max(mpRows.length, 1) : 0);

	const isEmpty = $derived(mpRows.length === 0 && listings.length === 0);
</script>

<svelte:head><title>{t('nav.marketplace')} · {t('nav.analytics')}</title></svelte:head>

<div class="space-y-5">
	<div>
		<h2 class="font-display text-lg font-bold tracking-tight">Analytics</h2>
		<p class="text-[12px] text-[var(--ui-text-muted)]">Channel performance & conversion insights</p>
	</div>

	{#if isEmpty}
		<div class="surface-card p-10 text-center">
			<div class="mx-auto grid size-14 place-items-center rounded-2xl bg-[var(--ui-bg-accented)] text-[var(--ui-text-dimmed)]">
				<Icon name="lucide:chart-column" class="size-7" />
			</div>
			<p class="mt-4 text-[14px] font-semibold">No analytics data yet</p>
			<p class="mx-auto mt-1 max-w-sm text-[12px] text-[var(--ui-text-dimmed)]">
				Once you connect channels and receive orders, revenue trends, conversion funnels, and product performance will populate here.
			</p>
		</div>
	{:else}
		<!-- KPI strip -->
		<div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
			<div class="metric-card p-4">
				<p class="text-[10px] font-semibold text-[var(--ui-text-dimmed)] uppercase">7-day revenue</p>
				<p class="mt-1 font-display text-xl font-black tabular-nums">{formatMoney(trendTotal, currency)}</p>
			</div>
			<div class="metric-card p-4">
				<p class="text-[10px] font-semibold text-[var(--ui-text-dimmed)] uppercase">Avg order value</p>
				<p class="mt-1 font-display text-xl font-black tabular-nums">{formatMoney(aov, currency)}</p>
			</div>
			<div class="metric-card p-4">
				<p class="text-[10px] font-semibold text-[var(--ui-text-dimmed)] uppercase">Conversions</p>
				<p class="mt-1 font-display text-xl font-black tabular-nums">{formatInt(funnel.conv)}</p>
			</div>
			<div class="metric-card p-4">
				<p class="text-[10px] font-semibold text-[var(--ui-text-dimmed)] uppercase">Avg rating</p>
				<p class="mt-1 font-display text-xl font-black tabular-nums">{avgRating > 0 ? avgRating.toFixed(2) : '—'}</p>
			</div>
		</div>

		<div class="grid gap-5 lg:grid-cols-3">
			<!-- Revenue trend -->
			<div class="surface-card p-5 lg:col-span-2">
				<div class="mb-4 flex items-center justify-between">
					<div class="flex items-center gap-2">
						<Icon name="lucide:trending-up" class="size-4 text-primary-500" />
						<h3 class="font-display text-[14px] font-semibold">Revenue · last 7 days</h3>
					</div>
					<span class="text-[12px] font-bold tabular-nums">{formatMoney(trendTotal, currency)}</span>
				</div>
				<div class="flex h-44 items-end gap-2">
					{#each bars as b (b.label)}
						<div class="flex flex-1 flex-col items-center gap-1.5">
							<div class="relative flex w-full flex-1 items-end">
								<div
									class="w-full rounded-t-md transition-all {b.isCurrent ? 'bg-primary-500' : 'bg-primary-500/40'}"
									style="height:{Math.max(b.height, 2)}%"
									title={formatMoney(b.value, currency)}
								></div>
							</div>
							<span class="text-[10px] font-medium text-[var(--ui-text-dimmed)]">{b.label}</span>
						</div>
					{/each}
				</div>
			</div>

			<!-- Conversion funnel -->
			<div class="surface-card p-5">
				<div class="mb-4 flex items-center gap-2">
					<Icon name="lucide:filter" class="size-4 text-primary-500" />
					<h3 class="font-display text-[14px] font-semibold">Conversion funnel</h3>
				</div>
				<div class="space-y-3">
					{#each [{ label: 'Views', value: funnel.views, icon: 'lucide:eye', color: 'bg-blue-500' }, { label: 'Clicks', value: funnel.clicks, icon: 'lucide:mouse-pointer-click', color: 'bg-violet-500' }, { label: 'Orders', value: funnel.conv, icon: 'lucide:shopping-bag', color: 'bg-emerald-500' }] as f (f.label)}
						<div>
							<div class="mb-1 flex items-center justify-between text-[11.5px]">
								<span class="inline-flex items-center gap-1 font-medium text-[var(--ui-text-muted)]">
									<Icon name={f.icon} class="size-3" />{f.label}
								</span>
								<span class="font-bold tabular-nums">{formatInt(f.value)}</span>
							</div>
							<div class="h-2.5 overflow-hidden rounded-full bg-[var(--ui-bg-accented)]">
								<div class="h-full rounded-full {f.color} transition-all" style="width:{(f.value / funnelMax) * 100}%"></div>
							</div>
						</div>
					{/each}
					{#if funnel.views > 0}
						<div class="rounded-lg bg-[var(--ui-bg-accented)] p-2.5 text-center">
							<span class="text-[10.5px] text-[var(--ui-text-dimmed)]">View→Order rate </span>
							<span class="font-bold text-primary-600 dark:text-primary-400">{((funnel.conv / funnel.views) * 100).toFixed(1)}%</span>
						</div>
					{/if}
				</div>
			</div>
		</div>

		<div class="grid gap-5 lg:grid-cols-2">
			<!-- Channel performance -->
			<div class="surface-card p-5">
				<div class="mb-4 flex items-center gap-2">
					<Icon name="lucide:pie-chart" class="size-4 text-primary-500" />
					<h3 class="font-display text-[14px] font-semibold">Channel performance</h3>
				</div>
				{#if channelPerf.length === 0}
					<p class="py-6 text-center text-[12px] text-[var(--ui-text-dimmed)]">No channel revenue yet.</p>
				{:else}
					<div class="space-y-3">
						{#each channelPerf as c (c.source)}
							{@const m = channelMeta(c.source)}
							<div class="flex items-center gap-3">
								<div class="grid size-8 shrink-0 place-items-center rounded-lg {m.color}">
									<Icon name={m.icon} class="size-4" />
								</div>
								<div class="min-w-0 flex-1">
									<div class="mb-1 flex items-center justify-between text-[11.5px]">
										<span class="font-semibold">{sourceLabel(c.source)}</span>
										<span class="font-bold tabular-nums">{formatMoney(c.total, currency)}</span>
									</div>
									<div class="h-2 overflow-hidden rounded-full bg-[var(--ui-bg-accented)]">
										<div class="h-full rounded-full bg-primary-500" style="width:{c.percent}%"></div>
									</div>
								</div>
								<span class="w-12 text-right text-[10.5px] tabular-nums text-[var(--ui-text-dimmed)]">{c.percent.toFixed(0)}%</span>
							</div>
						{/each}
					</div>
				{/if}
			</div>

			<!-- Top listings -->
			<div class="surface-card p-5">
				<div class="mb-4 flex items-center gap-2">
					<Icon name="lucide:trophy" class="size-4 text-primary-500" />
					<h3 class="font-display text-[14px] font-semibold">Top listings</h3>
				</div>
				{#if topListings.length === 0}
					<p class="py-6 text-center text-[12px] text-[var(--ui-text-dimmed)]">No listing performance data yet.</p>
				{:else}
					<div class="space-y-1">
						{#each topListings as l, i (l.id)}
							<div class="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-[var(--ui-bg-accented)]/50">
								<span class="grid size-6 shrink-0 place-items-center rounded-md bg-[var(--ui-bg-accented)] text-[11px] font-bold tabular-nums text-[var(--ui-text-muted)]">{i + 1}</span>
								<div class="min-w-0 flex-1">
									<p class="truncate text-[12.5px] font-semibold">{l.data.productName}</p>
									<p class="text-[10.5px] text-[var(--ui-text-dimmed)]">{l.data.channelIds.length} channels · {l.data.views ?? 0} views</p>
								</div>
								<div class="text-right">
									<div class="text-[12px] font-bold tabular-nums">{formatInt(l.data.conversions ?? 0)} sold</div>
									<div class="text-[10.5px] tabular-nums text-[var(--ui-text-dimmed)]">{formatMoney((l.data.conversions ?? 0) * l.data.price, currency)}</div>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>
