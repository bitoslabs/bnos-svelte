<script lang="ts">
	/**
	 * Marketplace Orders — every order originating from a connected channel
	 * (web, social, marketplace, delivery). Reuses commerce.order (30200),
	 * filtered by REMOTE_SOURCES. Deep-links into the shared order detail.
	 */
	import { resolve } from '$app/paths';
	import { t } from '$lib/i18n/i18n.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Pagination from '$lib/components/list/Pagination.svelte';
	import SortableTh from '$lib/components/list/SortableTh.svelte';
	import { createListControls } from '$lib/utils/list.svelte';
	import { glo } from '$nostr/store.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { formatMoney, formatInt, relativeTime, titleCase } from '$lib/utils/format';
	import { toOrderRows, type DashboardOrder } from '$lib/dashboard/metrics';
	import { TYPE, statusColor, ORDER_SOURCES, sourceLabel, sourceIcon, isRemoteSource } from '$lib/domain';

	const currency = $derived(tenant.state.currency);
	const orders = $derived(glo.all<DashboardOrder, 'commerce.order'>('commerce.order'));

	const mpRows = $derived(toOrderRows(orders.filter((o) => isRemoteSource(o.data.source))));

	// ── Filters ─────────────────────────────────────────────
	let sourceFilter = $state<string>('__all__');
	let statusFilter = $state<string>('__all__');
	let search = $state('');

	const REMOTE_SOURCE_OPTIONS = ORDER_SOURCES.filter((s) => isRemoteSource(s.value));

	const filtered = $derived(
		mpRows.filter((o) => {
			if (sourceFilter !== '__all__' && o.source !== sourceFilter) return false;
			if (statusFilter !== '__all__' && !o.status.toLowerCase().includes(statusFilter)) return false;
			if (search.trim()) {
				const q = search.trim().toLowerCase();
				return (
					o.number.toLowerCase().includes(q) ||
					(o.customerName ?? '').toLowerCase().includes(q) ||
					sourceLabel(o.source).toLowerCase().includes(q)
				);
			}
			return true;
		})
	);

	const controls = createListControls({
		items: () => filtered,
		search: () => true,
		sortOptions: () => [
			{ key: 'number', label: 'Order', value: (o: (typeof mpRows)[number]) => o.number },
			{ key: 'status', label: 'Status', value: (o) => o.status },
			{ key: 'total', label: 'Total', value: (o) => o.total },
			{ key: 'date', label: 'Date', value: (o) => o.atMs }
		],
		defaultSortKey: 'date',
		defaultSortDir: 'desc',
		defaultViewMode: 'table',
		storageKey: 'mp-orders'
	});

	// ── Stats ───────────────────────────────────────────────
	const revenue = $derived(filtered.reduce((s, o) => s + o.total, 0));
	const pending = $derived(filtered.filter((o) => o.status.toLowerCase().includes('pending')).length);
	const awaitingFulfillment = $derived(
		filtered.filter((o) => !['completed', 'cancelled', 'refunded'].includes(o.status.toLowerCase())).length
	);

	// ── Source breakdown ────────────────────────────────────
	const sourceBreakdown = $derived.by(() => {
		const map = new Map<string, { count: number; total: number }>();
		for (const o of mpRows) {
			const k = o.source ?? 'other';
			const e = map.get(k) ?? { count: 0, total: 0 };
			e.count++;
			e.total += o.total;
			map.set(k, e);
		}
		return [...map.entries()].sort((a, b) => b[1].total - a[1].total);
	});
</script>

<svelte:head><title>{t('nav.marketplace')} · {t('nav.marketplaceOrders')}</title></svelte:head>

<div class="space-y-4">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h2 class="font-display text-lg font-bold tracking-tight">Marketplace Orders</h2>
			<p class="text-[12px] text-[var(--ui-text-muted)]">{formatInt(filtered.length)} orders · {formatMoney(revenue, currency)}</p>
		</div>
		<Button color="neutral" variant="subtle" size="sm" icon="lucide:receipt-text" href={resolve('/orders')}>All orders</Button>
	</div>

	<!-- Stats -->
	<div class="grid grid-cols-3 gap-3">
		<div class="metric-card p-3.5">
			<p class="text-[10px] font-semibold text-[var(--ui-text-dimmed)] uppercase">{t('dashboard.revenue')}</p>
			<p class="mt-0.5 text-xl font-black tabular-nums">{formatMoney(revenue, currency)}</p>
		</div>
		<div class="metric-card p-3.5">
			<p class="text-[10px] font-semibold text-[var(--ui-text-dimmed)] uppercase">To fulfill</p>
			<p class="mt-0.5 text-xl font-black text-amber-500 tabular-nums">{awaitingFulfillment}</p>
		</div>
		<div class="metric-card p-3.5">
			<p class="text-[10px] font-semibold text-[var(--ui-text-dimmed)] uppercase">{t('status.pending')}</p>
			<p class="mt-0.5 text-xl font-black text-blue-500 tabular-nums">{pending}</p>
		</div>
	</div>

	<!-- Source breakdown chips -->
	{#if sourceBreakdown.length > 0}
		<div class="flex flex-wrap items-center gap-1.5">
			<span class="text-[11px] font-semibold text-[var(--ui-text-dimmed)]">By channel:</span>
			{#each sourceBreakdown as [src, v] (src)}
				<button
					type="button"
					onclick={() => (sourceFilter = sourceFilter === src ? '__all__' : src)}
					class="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-all {sourceFilter === src ? 'bg-primary-500/15 text-primary-600 ring-1 ring-primary-500/30 dark:text-primary-300' : 'bg-[var(--ui-bg-muted)] text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'}"
				>
					<Icon name={sourceIcon(src)} class="size-3" />
					{sourceLabel(src)}
					<span class="tabular-nums">{v.count}</span>
				</button>
			{/each}
		</div>
	{/if}

	{#if mpRows.length === 0}
		<EmptyState
			icon="lucide:shopping-bag"
			title={t('marketplace.noChannelOrders')}
			description="Orders received from your connected channels will appear here. Make sure your channels are synced."
		>
			{#snippet actions()}
				<Button color="primary" size="sm" icon="lucide:radio" href={resolve('/marketplace/channels')}>Manage channels</Button>
			{/snippet}
		</EmptyState>
	{:else}
		<!-- Toolbar -->
		<div class="flex flex-wrap items-center gap-2">
			<div class="relative min-w-48 flex-1">
				<Icon name="lucide:search" class="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--ui-text-dimmed)]" />
				<input bind:value={search} placeholder="Search order, customer…" class="w-full rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] py-2 pr-3 pl-9 text-[13px] placeholder:text-[var(--ui-text-dimmed)] focus:border-[var(--ui-color-primary-500)] focus:outline-none" />
			</div>
			<div class="relative inline-flex items-center rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)]">
				<select bind:value={statusFilter} class="h-9 appearance-none rounded-lg bg-transparent py-0 pr-8 pl-3 text-[13px] font-medium focus:outline-none">
					<option value="__all__">All statuses</option>
					<option value="pending">{t('status.pending')}</option>
					<option value="confirmed">Confirmed</option>
					<option value="preparing">Preparing</option>
					<option value="ready">Ready</option>
					<option value="completed">{t('status.completed')}</option>
					<option value="cancelled">{t('status.cancelled')}</option>
				</select>
				<Icon name="lucide:chevron-down" class="pointer-events-none absolute right-2 size-3.5 text-[var(--ui-text-dimmed)]" />
			</div>
		</div>

		<div class="data-panel">
			<div class="overflow-x-auto">
				<table class="table-surface w-full text-left">
					<thead>
						<tr>
							<SortableTh column="number" active={controls.sortKey === 'number'} direction={controls.sortDir} applySort={controls.applySort}>{t('common.order')}</SortableTh>
							<th class="px-5 py-2.5 text-[11px] font-semibold tracking-wider text-[var(--ui-text-dimmed)] uppercase">Channel</th>
							<th class="px-5 py-2.5 text-[11px] font-semibold tracking-wider text-[var(--ui-text-dimmed)] uppercase">{t('common.customer')}</th>
							<SortableTh column="status" active={controls.sortKey === 'status'} direction={controls.sortDir} applySort={controls.applySort}>{t('common.status')}</SortableTh>
							<SortableTh column="total" active={controls.sortKey === 'total'} direction={controls.sortDir} align="right" applySort={controls.applySort}>{t('common.total')}</SortableTh>
							<SortableTh column="date" active={controls.sortKey === 'date'} direction={controls.sortDir} align="right" applySort={controls.applySort}>{t('common.date')}</SortableTh>
						</tr>
					</thead>
					<tbody class="divide-y divide-[var(--ui-border-muted)] text-[13px]">
						{#each controls.pagedList as o (o.id)}
							<tr class="cursor-pointer transition-colors hover:bg-[var(--ui-bg-accented)]/50">
								<td class="px-5 py-3"><a href={resolve(`/orders/${o.id}`)} class="font-mono text-[12.5px] font-semibold hover:text-primary-500">{o.number}</a></td>
								<td class="px-5 py-3">
									<span class="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--ui-text-muted)]">
										<Icon name={sourceIcon(o.source)} class="size-3" />{sourceLabel(o.source)}
									</span>
								</td>
								<td class="px-5 py-3 text-[var(--ui-text-muted)]">{o.customerName || '—'}</td>
								<td class="px-5 py-3"><Badge color={statusColor(o.status)}>{titleCase(o.status)}</Badge></td>
								<td class="px-5 py-3 text-right font-semibold tabular-nums">{formatMoney(o.total, currency)}</td>
								<td class="px-5 py-3 text-right text-[12px] text-[var(--ui-text-dimmed)]">{relativeTime(o.atMs)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<Pagination {controls} />
		</div>
	{/if}
</div>
