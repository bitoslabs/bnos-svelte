<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import ListToolbar from '$lib/components/list/ListToolbar.svelte';
	import SortableTh from '$lib/components/list/SortableTh.svelte';
	import Pagination from '$lib/components/list/Pagination.svelte';
	import { createListControls } from '$lib/utils/list.svelte';
	import { glo } from '$nostr/store.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { formatMoney, formatInt, relativeTime } from '$lib/utils/format';
	import { toOrderRows, type DashboardOrder, type OrderRow } from '$lib/dashboard/metrics';

	onMount(() => {
		glo.hydrate('commerce.order');
		void glo.sync('commerce.order');
	});

	const currency = $derived(tenant.state.currency);
	const orderObjects = $derived(glo.all<DashboardOrder, 'commerce.order'>('commerce.order'));

	const METHODS = ['__all__', 'cash', 'card', 'qr', 'lightning'] as const;
	let methodFilter = $state<string>('__all__');

	const ledger = $derived(
		toOrderRows(orderObjects as never)
			.filter((o) => methodFilter === '__all__' || o.method === methodFilter)
			.sort((a, b) => b.atMs - a.atMs)
			.map((o) => ({ ...o, ref: o.number, description: `${o.items} items · ${o.method}` }))
	);

	const controls = createListControls<OrderRow & { ref: string; description: string }>({
		items: () => ledger,
		search: (r, q) => r.ref.toLowerCase().includes(q) || r.method.toLowerCase().includes(q),
		sortOptions: () => [
			{ key: 'ref', label: 'Reference', value: (r) => r.ref },
			{ key: 'method', label: 'Method', value: (r) => r.method },
			{ key: 'status', label: 'Status', value: (r) => r.status },
			{ key: 'amount', label: 'Amount', value: (r) => r.total },
			{ key: 'date', label: 'Date', value: (r) => r.atMs }
		],
		defaultSortKey: 'date',
		defaultSortDir: 'desc',
		defaultViewMode: 'table',
		storageKey: 'transactions'
	});

	const inflow = $derived(ledger.reduce((s, o) => s + o.total, 0));
	const count = $derived(ledger.length);
</script>

<svelte:head><title>BNOS · Transactions</title></svelte:head>

<div class="space-y-4">
	<div>
		<h1 class="font-display text-xl font-bold tracking-tight">Transactions</h1>
		<p class="text-[12.5px] text-[var(--ui-text-muted)]">Sales ledger · kind 30200/30201</p>
	</div>

	<div class="grid grid-cols-3 gap-3">
		<div class="metric-card p-4">
			<div class="text-[11px] font-semibold text-[var(--ui-text-dimmed)]">Total inflow</div>
			<div class="mt-1 font-display text-lg font-bold tabular-nums">
				{formatMoney(inflow, currency)}
			</div>
		</div>
		<div class="metric-card p-4">
			<div class="text-[11px] font-semibold text-[var(--ui-text-dimmed)]">Entries</div>
			<div class="mt-1 font-display text-lg font-bold tabular-nums">{formatInt(count)}</div>
		</div>
		<div class="metric-card p-4">
			<div class="text-[11px] font-semibold text-[var(--ui-text-dimmed)]">Avg. value</div>
			<div class="mt-1 font-display text-lg font-bold tabular-nums">
				{formatMoney(count ? inflow / count : 0, currency)}
			</div>
		</div>
	</div>

	{#if ledger.length || controls.search}
		<ListToolbar
			bind:search={controls.search}
			bind:sortKey={controls.sortKey}
			bind:sortDir={controls.sortDir}
			bind:viewMode={controls.viewMode}
			sortItems={controls.sortItems}
			searchPlaceholder="Search reference or method…"
			allowViewModes={['table']}
			applySort={controls.applySort}
			setViewMode={controls.setViewMode}
		>
			{#snippet filters()}
				<div
					class="relative inline-flex items-center rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)]"
				>
					<select
						bind:value={methodFilter}
						class="h-9 appearance-none rounded-lg bg-transparent py-0 pr-8 pl-3 text-[13px] font-medium capitalize focus:outline-none"
					>
						{#each METHODS as mth (mth)}
							<option value={mth}>{mth === '__all__' ? 'All methods' : mth}</option>
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

	{#if ledger.length === 0}
		<EmptyState
			icon="lucide:arrow-left-right"
			title="No transactions yet"
			description="Completed sales from the POS populate this ledger."
		/>
	{:else}
		<div class="data-panel">
			<div class="overflow-x-auto">
				<table class="table-surface w-full text-left">
					<thead>
						<tr>
							<SortableTh
								column="ref"
								active={controls.sortKey === 'ref'}
								direction={controls.sortDir}
								applySort={controls.applySort}>Reference</SortableTh
							>
							<SortableTh
								column="method"
								active={controls.sortKey === 'method'}
								direction={controls.sortDir}
								applySort={controls.applySort}>Method</SortableTh
							>
							<SortableTh
								column="status"
								active={controls.sortKey === 'status'}
								direction={controls.sortDir}
								applySort={controls.applySort}>Status</SortableTh
							>
							<SortableTh
								column="amount"
								active={controls.sortKey === 'amount'}
								direction={controls.sortDir}
								align="right"
								applySort={controls.applySort}>Amount</SortableTh
							>
							<SortableTh
								column="date"
								active={controls.sortKey === 'date'}
								direction={controls.sortDir}
								align="right"
								applySort={controls.applySort}>Date</SortableTh
							>
						</tr>
					</thead>
					<tbody class="divide-y divide-[var(--ui-border-muted)] text-[13px]">
						{#each controls.pagedList as row (row.id)}
							<tr>
								<td class="px-5 py-3">
									<div class="font-mono text-[12.5px]">{row.ref}</div>
									<div class="text-[11px] text-[var(--ui-text-dimmed)]">{row.description}</div>
								</td>
								<td class="px-5 py-3"
									><span class="text-[var(--ui-text-muted)] capitalize">{row.method}</span></td
								>
								<td class="px-5 py-3"
									><Badge color={row.status.includes('paid') ? 'success' : 'neutral'}
										>{row.status}</Badge
									></td
								>
								<td
									class="px-5 py-3 text-right font-semibold text-[var(--tone-success-text)] tabular-nums"
									>+{formatMoney(row.total, currency)}</td
								>
								<td class="px-5 py-3 text-right text-[12px] text-[var(--ui-text-dimmed)]"
									>{relativeTime(row.atMs)}</td
								>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<Pagination {controls} />
		</div>
	{/if}
</div>
