<script lang="ts">
	/**
	 * Marketplace overview — a command center answering "what needs me?".
	 * KPIs, channel sync health, orders to act on, and top listings, all from
	 * the reactive GLO store (commerce.order filtered to remote sources).
	 */
	import { resolve } from '$app/paths';
	import { t } from '$lib/i18n/i18n.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { glo } from '$nostr/store.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { formatMoney, formatInt, relativeTime, titleCase } from '$lib/utils/format';
	import {
		TYPE,
		statusColor,
		isRemoteSource,
		channelMeta,
		listingStatusLabel,
		ratingStars,
		sourceLabel,
		sourceIcon
	} from '$lib/domain';
	import type {
		MarketplaceConnection,
		MarketplaceProduct,
		MarketplaceReview
	} from '$lib/domain';
	import type { DashboardOrder } from '$lib/dashboard/metrics';
	import { toOrderRows, metricsSummary } from '$lib/dashboard/metrics';

	const currency = $derived(tenant.state.currency);

	const connections = $derived(
		glo.all<MarketplaceConnection, typeof TYPE.marketplaceConnection>(TYPE.marketplaceConnection)
	);
	const reviews = $derived(
		glo.all<MarketplaceReview, typeof TYPE.marketplaceReview>(TYPE.marketplaceReview)
	);
	const listings = $derived(
		glo.all<MarketplaceProduct, typeof TYPE.marketplaceProduct>(TYPE.marketplaceProduct)
	);
	const allOrders = $derived(glo.all<DashboardOrder, 'commerce.order'>('commerce.order'));

	// Marketplace orders = remote-source orders (web/social/marketplace/delivery)
	const mpOrders = $derived(allOrders.filter((o) => isRemoteSource(o.data.source)));
	const mpRows = $derived(toOrderRows(mpOrders));
	const summary = $derived(metricsSummary(mpRows));

	// ── Channel health ───────────────────────────────────────
	const connectedChannels = $derived(connections.filter((c) => c.data.status === 'connected'));
	const channelRevenue = $derived.by(() => {
		const map = new Map<string, { total: number; count: number }>();
		for (const o of mpRows) {
			const conn = connections.find((c) => c.data.type === o.source);
			const key = conn?.id ?? o.source ?? 'other';
			const e = map.get(key) ?? { total: 0, count: 0 };
			e.total += o.total;
			e.count += 1;
			map.set(key, e);
		}
		return map;
	});

	// ── Action queue ─────────────────────────────────────────
	const ordersToAct = $derived(
		mpRows
			.filter((o) => !['completed', 'cancelled', 'refunded'].includes(o.status.toLowerCase()))
			.sort((a, b) => b.atMs - a.atMs)
			.slice(0, 5)
	);

	const avgRating = $derived.by(() => {
		const r = reviews.map((x) => x.data.rating).filter((x) => x > 0);
		return r.length ? r.reduce((s, x) => s + x, 0) / r.length : 0;
	});

	const conversionRate = $derived.by(() => {
		const views = listings.reduce((s, l) => s + (l.data.views ?? 0), 0);
		const conv = listings.reduce((s, l) => s + (l.data.conversions ?? 0), 0);
		return views > 0 ? (conv / views) * 100 : 0;
	});

	const hasChannels = $derived(connections.length > 0);
</script>

<svelte:head><title>{t('common.appName')} · {t('nav.marketplace')}</title></svelte:head>

<div class="space-y-5">
<!-- KPI cards -->
<div class="grid grid-cols-2 gap-3 xl:grid-cols-4">
	<div class="metric-card flex items-center gap-3 p-4">
		<div class="grid size-9 place-items-center rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-400">
			<Icon name="lucide:dollar-sign" class="size-4.5" />
		</div>
		<div class="min-w-0">
			<div class="text-[11px] font-semibold text-[var(--ui-text-dimmed)]">Channel revenue</div>
			<div class="truncate font-display text-lg font-bold tabular-nums">
				{formatMoney(summary.allTimeTotal, currency)}
			</div>
		</div>
	</div>
	<div class="metric-card flex items-center gap-3 p-4">
		<div class="grid size-9 place-items-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
			<Icon name="lucide:shopping-bag" class="size-4.5" />
		</div>
		<div class="min-w-0">
			<div class="text-[11px] font-semibold text-[var(--ui-text-dimmed)]">Orders</div>
			<div class="font-display text-lg font-bold tabular-nums">{formatInt(summary.allTimeCount)}</div>
		</div>
	</div>
	<div class="metric-card flex items-center gap-3 p-4">
		<div class="grid size-9 place-items-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
			<Icon name="lucide:mouse-pointer-click" class="size-4.5" />
		</div>
		<div class="min-w-0">
			<div class="text-[11px] font-semibold text-[var(--ui-text-dimmed)]">Conversion</div>
			<div class="font-display text-lg font-bold tabular-nums">{conversionRate.toFixed(1)}%</div>
		</div>
	</div>
	<div class="metric-card flex items-center gap-3 p-4">
		<div class="grid size-9 place-items-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
			<Icon name="lucide:star" class="size-4.5" />
		</div>
		<div class="min-w-0">
			<div class="text-[11px] font-semibold text-[var(--ui-text-dimmed)]">Avg. rating</div>
			<div class="font-display text-lg font-bold tabular-nums">
				{avgRating > 0 ? avgRating.toFixed(2) : '—'}
			</div>
		</div>
	</div>
</div>

{#if !hasChannels && listings.length === 0}
	<!-- First-run: web-store-first. No external channel required to start selling. -->
	<EmptyState
		icon="lucide:store"
		title={t('common.startWebStore')}
		description="Publish your first listing and it goes live on your storefront instantly — no external channel required. Connect TikTok, Facebook or Shopee later to reach more buyers."
	>
		{#snippet actions()}
			<Button color="primary" icon="lucide:plus" href={resolve('/marketplace/listings')}
				>Publish a listing</Button
			>
			<Button color="neutral" variant="subtle" icon="lucide:radio" href={resolve('/marketplace/channels')}
				>Connect a channel</Button
			>
		{/snippet}
	</EmptyState>
{:else}
	<div class="grid gap-5 lg:grid-cols-3">
		<!-- Orders to act on (2/3) -->
		<div class="lg:col-span-2">
			<div class="surface-card p-0">
				<div class="flex items-center justify-between px-5 py-3.5">
					<div class="flex items-center gap-2">
						<Icon name="lucide:alarm-clock" class="size-4 text-primary-500" />
						<h2 class="font-display text-[14px] font-semibold">Orders to act on</h2>
						<span class="rounded-full bg-primary-500/10 px-2 py-0.5 text-[10px] font-bold text-primary-600 dark:text-primary-400">
							{ordersToAct.length}
						</span>
					</div>
					<Button size="sm" color="neutral" variant="ghost" trailingIcon="lucide:arrow-right" href={resolve('/marketplace/orders')}>
						All orders
					</Button>
				</div>
				{#if ordersToAct.length === 0}
					<div class="px-5 pb-6 pt-2 text-center">
						<Icon name="lucide:party-popper" class="mx-auto size-7 text-emerald-500" />
						<p class="mt-2 text-[13px] font-semibold">You're all caught up</p>
						<p class="text-[11.5px] text-[var(--ui-text-dimmed)]">No pending marketplace orders.</p>
					</div>
				{:else}
					<div class="divide-y divide-[var(--ui-border-muted)]">
						{#each ordersToAct as o (o.id)}
							<a
								href={resolve(`/orders/${o.id}`)}
								class="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-[var(--ui-bg-accented)]/50"
							>
								<div class="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)]">
									<Icon name={sourceIcon(o.source)} class="size-4" />
								</div>
								<div class="min-w-0 flex-1">
									<div class="flex items-center gap-2">
										<span class="font-mono text-[12.5px] font-semibold">{o.number}</span>
										<Badge color={statusColor(o.status)}>{titleCase(o.status)}</Badge>
									</div>
									<p class="truncate text-[11px] text-[var(--ui-text-dimmed)]">
										{sourceLabel(o.source)}{#if o.customerName} · {o.customerName}{/if}
									</p>
								</div>
								<div class="text-right">
									<div class="font-semibold tabular-nums">{formatMoney(o.total, currency)}</div>
									<div class="text-[10.5px] text-[var(--ui-text-dimmed)]">{relativeTime(o.atMs)}</div>
								</div>
							</a>
						{/each}
					</div>
				{/if}
			</div>
		</div>

		<!-- Channel health (1/3) -->
		<div class="surface-card p-0">
			<div class="flex items-center justify-between px-5 py-3.5">
				<div class="flex items-center gap-2">
					<Icon name="lucide:radio" class="size-4 text-primary-500" />
					<h2 class="font-display text-[14px] font-semibold">{t('common.channel')}</h2>
				</div>
				<Button size="sm" color="neutral" variant="ghost" trailingIcon="lucide:arrow-right" href={resolve('/marketplace/channels')}>
					Manage
				</Button>
			</div>
			<div class="divide-y divide-[var(--ui-border-muted)]">
				{#each connections.slice(0, 5) as c (c.id)}
					{@const m = channelMeta(c.data.type)}
					{@const rev = channelRevenue.get(c.id)}
					<div class="flex items-center gap-3 px-5 py-3">
						<div class="grid size-8 shrink-0 place-items-center rounded-lg {m.color}">
							<Icon name={m.icon} class="size-4" />
						</div>
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-1.5">
								<span class="truncate text-[12.5px] font-semibold">{c.data.name}</span>
								{#if c.data.status === 'connected'}
									<span class="live-dot" aria-label="connected"></span>
								{/if}
							</div>
							<p class="text-[10.5px] text-[var(--ui-text-dimmed)]">
								{rev ? `${rev.count} orders · ${formatMoney(rev.total, currency)}` : 'No orders yet'}
							</p>
						</div>
						<Badge color={c.data.status === 'connected' ? 'success' : c.data.status === 'error' ? 'info' : 'neutral'}>
							{titleCase(c.data.status)}
						</Badge>
					</div>
				{/each}
			</div>
		</div>
	</div>

	<!-- Top listings -->
	{#if listings.length > 0}
		<div class="surface-card p-0">
			<div class="flex items-center justify-between px-5 py-3.5">
				<div class="flex items-center gap-2">
					<Icon name="lucide:trending-up" class="size-4 text-primary-500" />
					<h2 class="font-display text-[14px] font-semibold">Top listings</h2>
				</div>
				<Button size="sm" color="neutral" variant="ghost" trailingIcon="lucide:arrow-right" href={resolve('/marketplace/listings')}>
					All listings
				</Button>
			</div>
			<div class="grid grid-cols-1 divide-y divide-[var(--ui-border-muted)] sm:grid-cols-2 sm:divide-x lg:grid-cols-3">
				{#each listings.slice(0, 6) as l (l.id)}
					<div class="flex items-center gap-3 px-5 py-3.5">
						<div class="grid size-10 shrink-0 place-items-center rounded-lg bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)]">
							<Icon name="lucide:package" class="size-4.5" />
						</div>
						<div class="min-w-0 flex-1">
							<p class="truncate text-[12.5px] font-semibold">{l.data.productName}</p>
							<div class="mt-0.5 flex items-center gap-2 text-[10.5px] text-[var(--ui-text-dimmed)]">
								<Badge color={statusColor(l.data.status)}>{listingStatusLabel(l.data.status)}</Badge>
								<span>{l.data.channelIds.length} ch.</span>
							</div>
						</div>
						<div class="text-right">
							<div class="font-semibold tabular-nums">{formatMoney(l.data.price, currency)}</div>
							{#if (l.data.conversions ?? 0) > 0}
								<div class="text-[10px] text-[var(--ui-text-dimmed)]">{l.data.conversions} sold</div>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Review spotlight -->
	{#if reviews.length > 0}
		<div class="grid gap-3 sm:grid-cols-2">
			{#each reviews.filter((r) => r.data.status === 'published' || r.data.status === 'replied').slice(0, 2) as r (r.id)}
				<div class="surface-card p-4">
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2">
							<div class="grid size-8 place-items-center rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
								<Icon name="lucide:user" class="size-4" />
							</div>
							<div>
								<p class="text-[12.5px] font-semibold">{r.data.customerName}</p>
								<p class="text-[10.5px] text-[var(--ui-text-dimmed)]">
									{r.data.channelName ?? 'Verified buyer'}
								</p>
							</div>
						</div>
						<span class="font-mono text-amber-500" title={`${r.data.rating}/5`}>
							{ratingStars(r.data.rating)}
						</span>
					</div>
					{#if r.data.body}
						<p class="mt-2 line-clamp-2 text-[12px] text-[var(--ui-text-muted)]">"{r.data.body}"</p>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
{/if}
</div>
