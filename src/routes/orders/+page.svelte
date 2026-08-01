<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import ListToolbar from '$lib/components/list/ListToolbar.svelte';
	import SortableTh from '$lib/components/list/SortableTh.svelte';
	import Pagination from '$lib/components/list/Pagination.svelte';
	import RowActions, { type RowAction } from '$lib/components/list/RowActions.svelte';
	import { createListControls } from '$lib/utils/list.svelte';
	import { glo } from '$nostr/store.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatMoney, formatInt, relativeTime } from '$lib/utils/format';
	import { toOrderRows, type DashboardOrder, type OrderRow } from '$lib/dashboard/metrics';

	onMount(() => {
		glo.hydrate('commerce.order');
		void glo.sync('commerce.order');
	});

	const currency = $derived(tenant.state.currency);
	const orderObjects = $derived(glo.all<DashboardOrder, 'commerce.order'>('commerce.order'));

	// status filter
	const STATUSES = ['__all__', 'paid', 'pending', 'cancelled', 'refunded'] as const;
	let statusFilter = $state<string>('__all__');
	const statusFiltered = $derived(
		toOrderRows(orderObjects as never).filter(
			(o) => statusFilter === '__all__' || o.status.toLowerCase().includes(statusFilter)
		)
	);

	const controls = createListControls<OrderRow>({
		items: () => statusFiltered,
		search: (o, q) => o.number.toLowerCase().includes(q) || o.status.toLowerCase().includes(q),
		sortOptions: () => [
			{ key: 'number', label: 'Order no.', value: (o) => o.number },
			{ key: 'status', label: 'Status', value: (o) => o.status },
			{ key: 'total', label: 'Total', value: (o) => o.total },
			{ key: 'items', label: 'Items', value: (o) => o.items },
			{ key: 'date', label: 'Date', value: (o) => o.atMs }
		],
		defaultSortKey: 'date',
		defaultSortDir: 'desc',
		defaultViewMode: 'table',
		storageKey: 'orders'
	});

	const totalRevenue = $derived(statusFiltered.reduce((s, o) => s + o.total, 0));
	const avgValue = $derived(statusFiltered.length ? totalRevenue / statusFiltered.length : 0);

	function statusColor(status: string): 'success' | 'info' | 'warning' | 'neutral' {
		const s = status.toLowerCase();
		if (s.includes('paid') || s.includes('complete')) return 'success';
		if (s.includes('pending')) return 'warning';
		if (s.includes('cancel') || s.includes('refund')) return 'info';
		return 'neutral';
	}

	function rowActions(o: OrderRow): RowAction[][] {
		return [
			[
				{
					label: 'View details',
					icon: 'lucide:eye',
					onSelect: () => toast.info(`Order ${o.number}`)
				}
			],
			[
				{
					label: 'Delete',
					icon: 'lucide:trash-2',
					danger: true,
					onSelect: () => {
						glo.remove('commerce.order', o.id);
						toast.info('Order removed');
					}
				}
			]
		];
	}
</script>

<svelte:head><title>bdGo OS · Orders</title></svelte:head>

<div class="space-y-4">
	<!-- header + KPIs -->
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h1 class="font-display text-xl font-bold tracking-tight">Orders</h1>
			<p class="text-[12.5px] text-[var(--ui-text-muted)]">
				{formatInt(statusFiltered.length)} orders · {formatMoney(totalRevenue, currency)} · kind 30200
			</p>
		</div>
		<Button color="primary" icon="lucide:scan-line" href="/pos">New sale</Button>
	</div>

	<div class="grid grid-cols-3 gap-3">
		<div class="metric-card p-4">
			<div class="text-[11px] font-semibold text-[var(--ui-text-dimmed)]">Orders</div>
			<div class="mt-1 font-display text-lg font-bold tabular-nums">
				{formatInt(statusFiltered.length)}
			</div>
		</div>
		<div class="metric-card p-4">
			<div class="text-[11px] font-semibold text-[var(--ui-text-dimmed)]">Revenue</div>
			<div class="mt-1 font-display text-lg font-bold tabular-nums">
				{formatMoney(totalRevenue, currency)}
			</div>
		</div>
		<div class="metric-card p-4">
			<div class="text-[11px] font-semibold text-[var(--ui-text-dimmed)]">Avg. order</div>
			<div class="mt-1 font-display text-lg font-bold tabular-nums">
				{formatMoney(avgValue, currency)}
			</div>
		</div>
	</div>

	{#if statusFiltered.length || controls.search}
		<ListToolbar
			bind:search={controls.search}
			bind:sortKey={controls.sortKey}
			bind:sortDir={controls.sortDir}
			bind:viewMode={controls.viewMode}
			sortItems={controls.sortItems}
			searchPlaceholder="Search order no. or status…"
			applySort={controls.applySort}
			setViewMode={controls.setViewMode}
		>
			{#snippet filters()}
				<div
					class="relative inline-flex items-center rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)]"
				>
					<select
						bind:value={statusFilter}
						class="h-9 appearance-none rounded-lg bg-transparent py-0 pr-8 pl-3 text-[13px] font-medium capitalize focus:outline-none"
					>
						{#each STATUSES as s (s)}
							<option value={s}>{s === '__all__' ? 'All statuses' : s}</option>
						{/each}
					</select>
					<Icon
						name="lucide:chevron-down"
						class="pointer-events-none absolute right-2 size-3.5 text-[var(--ui-text-dimmed)]"
					/>
				</div>
			{/snippet}
		</ListToolbar>
	{/if}

	{#if controls.list.length === 0}
		<EmptyState
			icon="lucide:receipt-text"
			title={controls.search ? 'No matching orders' : 'No orders yet'}
			description={controls.search
				? 'Try a different search or filter.'
				: 'Sales made from the POS appear here as signed Nostr order records.'}
		>
			{#snippet actions()}
				{#if !controls.search}
					<Button color="primary" size="sm" icon="lucide:scan-line" href="/pos">Open POS</Button>
				{/if}
			{/snippet}
		</EmptyState>
	{:else if controls.viewMode === 'grid'}
		<!-- GRID VIEW -->
		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
			{#each controls.pagedList as o (o.id)}
				<div class="metric-card p-4">
					<div class="mb-2 flex items-start justify-between">
						<div class="font-mono text-[13px] font-semibold">{o.number}</div>
						<Badge color={statusColor(o.status)}>{o.status}</Badge>
					</div>
					<div class="font-display text-xl font-bold tabular-nums">
						{formatMoney(o.total, currency)}
					</div>
					<div class="mt-1 flex items-center gap-2 text-[11.5px] text-[var(--ui-text-muted)]">
						<Icon name="lucide:boxes" class="size-3.5" />
						{o.items} items · <span class="capitalize">{o.method}</span>
					</div>
					<div
						class="mt-3 flex items-center justify-between border-t border-[var(--ui-border-muted)] pt-2.5"
					>
						<span class="text-[11.5px] text-[var(--ui-text-dimmed)]">{relativeTime(o.atMs)}</span>
						<RowActions actions={rowActions(o)} />
					</div>
				</div>
			{/each}
		</div>
	{:else}
		<!-- TABLE VIEW -->
		<div class="data-panel">
			<div class="overflow-x-auto">
				<table class="table-surface w-full text-left">
					<thead>
						<tr>
							<SortableTh
								column="number"
								active={controls.sortKey === 'number'}
								direction={controls.sortDir}
								applySort={controls.applySort}>Order</SortableTh
							>
							<SortableTh
								column="status"
								active={controls.sortKey === 'status'}
								direction={controls.sortDir}
								applySort={controls.applySort}>Status</SortableTh
							>
							<SortableTh
								column="items"
								active={controls.sortKey === 'items'}
								direction={controls.sortDir}
								align="right"
								applySort={controls.applySort}>Items</SortableTh
							>
							<SortableTh
								column="total"
								active={controls.sortKey === 'total'}
								direction={controls.sortDir}
								align="right"
								applySort={controls.applySort}>Total</SortableTh
							>
							<SortableTh
								column="date"
								active={controls.sortKey === 'date'}
								direction={controls.sortDir}
								align="right"
								applySort={controls.applySort}>Date</SortableTh
							>
							<th class="w-10 px-5 py-2.5"></th>
						</tr>
					</thead>
					<tbody class="divide-y divide-[var(--ui-border-muted)] text-[13px]">
						{#each controls.pagedList as o (o.id)}
							<tr>
								<td class="px-5 py-3 font-mono text-[12.5px]">{o.number}</td>
								<td class="px-5 py-3"><Badge color={statusColor(o.status)}>{o.status}</Badge></td>
								<td class="px-5 py-3 text-right text-[var(--ui-text-muted)] tabular-nums"
									>{o.items}</td
								>
								<td class="px-5 py-3 text-right font-semibold tabular-nums"
									>{formatMoney(o.total, currency)}</td
								>
								<td class="px-5 py-3 text-right text-[12px] text-[var(--ui-text-dimmed)]"
									>{relativeTime(o.atMs)}</td
								>
								<td class="px-5 py-3 text-right"><RowActions actions={rowActions(o)} /></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<Pagination {controls} />
		</div>
	{/if}
</div>
