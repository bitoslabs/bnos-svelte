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
	import RawDataDialog from '$lib/components/ui/RawDataDialog.svelte';
	import { createListControls } from '$lib/utils/list.svelte';
	import { glo } from '$nostr/store.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatMoney, formatInt, relativeTime, titleCase } from '$lib/utils/format';
	import { toOrderRows, type DashboardOrder, type OrderRow } from '$lib/dashboard/metrics';
	import { statusColor } from '$lib/domain';

	onMount(() => {
		glo.hydrate('commerce.order');
		glo.hydrate('commerce.payment');
		void glo.sync('commerce.order');
	});

	const currency = $derived(tenant.state.currency);
	const orderObjects = $derived(glo.all<DashboardOrder, 'commerce.order'>('commerce.order'));

	// Build payment method lookup: orderId → method
	const paymentMethodMap = $derived.by(() => {
		const payments = glo.all<any, 'commerce.payment'>('commerce.payment');
		const m = new Map<string, string>();
		for (const p of payments) {
			const oid = (p.data as any).orderId;
			if (oid) m.set(oid, (p.data as any).method ?? 'cash');
		}
		return m;
	});

	// ── Filters ──────────────────────────────────────────────
	const STATUSES = ['__all__', 'pending', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled'] as const;
	const TYPES = ['__all__', 'dine_in', 'takeaway', 'delivery', 'pickup'] as const;
	const DATE_RANGES = ['__all__', 'today', '7d', '30d'] as const;

	let statusFilter = $state<string>('__all__');
	let typeFilter = $state<string>('__all__');
	let dateRangeFilter = $state<string>('__all__');

	function matchDateRange(occurredAt: string | undefined): boolean {
		if (dateRangeFilter === '__all__') return true;
		const t = occurredAt ? new Date(occurredAt).getTime() : Date.now();
		const now = Date.now();
		const diff = now - t;
		if (dateRangeFilter === 'today') return diff < 86_400_000;
		if (dateRangeFilter === '7d') return diff < 7 * 86_400_000;
		if (dateRangeFilter === '30d') return diff < 30 * 86_400_000;
		return true;
	}

	const filteredByCriteria = $derived(
		toOrderRows(orderObjects as never, paymentMethodMap).filter((o) => {
			const s = o.status.toLowerCase();
			const matchesStatus =
				statusFilter === '__all__' ||
				s.includes(statusFilter) ||
				(statusFilter === 'completed' && (s.includes('paid') || s.includes('complete'))) ||
				(statusFilter === 'pending' && s.includes('pending'));
			const matchesType = typeFilter === '__all__' || (o as any).type === typeFilter;
			return matchesStatus && matchesType;
		})
	);

	const controls = createListControls<OrderRow>({
		items: () => filteredByCriteria,
		search: (o, q) =>
			o.number.toLowerCase().includes(q) ||
			o.status.toLowerCase().includes(q) ||
			((o as any).customerName ?? '').toLowerCase().includes(q) ||
			((o as any).type ?? '').toLowerCase().includes(q),
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

	// ── Expandable rows ──────────────────────────────────────
	let expandedId = $state<string | null>(null);

	// Raw data viewer
	let rawOpen = $state(false);
	let rawItem = $state<any>(null);

	function getOrderDetail(rowId: string) {
		return orderObjects.find((o) => o.id === rowId);
	}

	async function quickUpdateStatus(orderId: string, newStatus: string) {
		const obj = orderObjects.find((o) => o.id === orderId);
		if (!obj) return;
		await glo.upsert('commerce.order', { ...(obj.data as any), status: newStatus }, { id: orderId });
		toast.success(`Order → ${newStatus}`);
	}

	function printOrder(o: OrderRow) {
		const detail = getOrderDetail(o.id);
		const w = window.open('', '_blank', 'width=400,height=600');
		if (!w) return;
		const lines = detail?.data?.lines ?? [];
		const itemsHtml = lines.map((l: any) =>
			`<tr><td>${l.quantity}× ${l.productName || l.name || 'Item'}${l.variantName ? ` (${l.variantName})` : ''}</td><td style="text-align:right">${formatMoney((l.unitPrice || 0) * (l.quantity || 1), currency)}</td></tr>`
		).join('');
		w.document.write(
			`<html><head><title>Order ${o.number}</title><style>body{font-family:monospace;padding:16px;font-size:12px}h2{text-align:center}table{width:100%}td{padding:2px 0}.total{font-weight:bold;font-size:14px;border-top:1px dashed #000;padding-top:8px}</style></head><body><h2>${tenant.state.organizationName || 'BNOS'}</h2><p style="text-align:center">${o.number}</p><hr><table>${itemsHtml}</table><hr><table><tr class="total"><td>TOTAL</td><td style="text-align:right">${formatMoney(o.total, currency)}</td></tr></table><p style="text-align:center;margin-top:16px">Thank you!</p></body></html>`
		);
		w.document.close();
		w.print();
	}

	// ── Stats ────────────────────────────────────────────────
	const totalRevenue = $derived(filteredByCriteria.reduce((s, o) => s + o.total, 0));
	const pendingCount = $derived(filteredByCriteria.filter((o) => o.status.toLowerCase().includes('pending')).length);
	const completedCount = $derived(
		filteredByCriteria.filter((o) => {
			const s = o.status.toLowerCase();
			return s.includes('paid') || s.includes('complete');
		}).length
	);
	const avgValue = $derived(filteredByCriteria.length ? totalRevenue / filteredByCriteria.length : 0);

	// ── Bulk selection ───────────────────────────────────────
	let selectedIds = $state<Set<string>>(new Set());
	let selectAll = $state(false);

	function toggleSelectAll() {
		if (selectAll) {
			selectedIds = new Set();
			selectAll = false;
		} else {
			selectedIds = new Set(controls.pagedList.map((o) => o.id));
			selectAll = true;
		}
	}

	function toggleSelect(id: string) {
		const next = new Set(selectedIds);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selectedIds = next;
		selectAll = next.size === controls.pagedList.length && controls.pagedList.length > 0;
	}

	async function bulkUpdateStatus(newStatus: string) {
		if (selectedIds.size === 0) return;
		for (const rowId of selectedIds) {
			const obj = orderObjects.find((o) => o.id === rowId);
			if (obj) {
				await glo.upsert('commerce.order', { ...(obj.data as any), status: newStatus }, { id: rowId });
			}
		}
		toast.success(`${selectedIds.size} orders → ${newStatus}`);
		selectedIds = new Set();
		selectAll = false;
	}

	// ── CSV Export ───────────────────────────────────────────
	function exportCSV() {
		const rows = filteredByCriteria;
		const header = ['Order', 'Status', 'Type', 'Customer', 'Items', 'Total', 'Method', 'Date'];
		const lines = rows.map((o) => [
			o.number,
			o.status,
			(o as any).type ?? '',
			(o as any).customerName ?? '',
			String(o.items),
			String(o.total),
			(o as any).method ?? '',
			new Date(o.atMs).toISOString()
		]);
		const csv = [header, ...lines].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
		const blob = new Blob([csv], { type: 'text/csv' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
		a.click();
		URL.revokeObjectURL(url);
		toast.info('CSV exported');
	}

	function typeBadgeColor(type: string): 'success' | 'info' | 'warning' | 'neutral' {
		switch (type) {
			case 'dine_in': return 'info';
			case 'takeaway': return 'warning';
			case 'delivery': return 'success';
			case 'pickup': return 'neutral';
			default: return 'neutral';
		}
	}

	function typeIcon(type: string): string {
		switch (type) {
			case 'dine_in': return 'lucide:utensils';
			case 'takeaway': return 'lucide:shopping-bag';
			case 'delivery': return 'lucide:truck';
			case 'pickup': return 'lucide:package';
			default: return 'lucide:receipt';
		}
	}

	function rowActions(o: OrderRow): RowAction[][] {
		return [
			[
				{
					label: 'View details',
					icon: 'lucide:eye',
					onSelect: () => (window.location.href = `/orders/${o.id}`)
				},
				{
					label: 'Edit',
					icon: 'lucide:pencil',
					onSelect: () => (window.location.href = `/orders/${o.id}/edit`)
				},
				{
					label: 'View raw',
					icon: 'lucide:code',
					onSelect: () => { rawItem = glo.get('commerce.order', o.id); rawOpen = true; }
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

	function resetFilters() {
		statusFilter = '__all__';
		typeFilter = '__all__';
		dateRangeFilter = '__all__';
		controls.search = '';
	}

	const hasActiveFilters = $derived(
		statusFilter !== '__all__' || typeFilter !== '__all__' || dateRangeFilter !== '__all__' || controls.search
	);
</script>

<svelte:head><title>BNOS · Orders</title></svelte:head>

<div class="space-y-4">
	<!-- header + actions -->
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h1 class="font-display text-xl font-bold tracking-tight">Orders</h1>
			<p class="text-[12.5px] text-[var(--ui-text-muted)]">
				{formatInt(filteredByCriteria.length)} orders · {formatMoney(totalRevenue, currency)}
			</p>
		</div>
		<div class="flex items-center gap-2">
			<Button color="neutral" variant="subtle" size="sm" icon="lucide:download" onclick={exportCSV} disabled={filteredByCriteria.length === 0}>
				Export
			</Button>
			<Button color="primary" icon="lucide:plus" href="/orders/create">New Order</Button>
			<Button color="neutral" variant="subtle" size="sm" icon="lucide:scan-line" href="/pos">POS</Button>
		</div>
	</div>

	<!-- Stats cards -->
	<div class="grid grid-cols-2 gap-3 xl:grid-cols-4">
		<div class="metric-card flex items-center gap-3 p-4">
			<div class="grid size-9 place-items-center rounded-xl bg-primary-500/10 text-primary-600 dark:text-primary-400">
				<Icon name="lucide:receipt-text" class="size-4" />
			</div>
			<div>
				<div class="text-[11px] font-semibold text-[var(--ui-text-dimmed)]">Total Orders</div>
				<div class="font-display text-lg font-bold tabular-nums">{formatInt(filteredByCriteria.length)}</div>
			</div>
		</div>
		<div class="metric-card flex items-center gap-3 p-4">
			<div class="grid size-9 place-items-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
				<Icon name="lucide:clock" class="size-4" />
			</div>
			<div>
				<div class="text-[11px] font-semibold text-[var(--ui-text-dimmed)]">Pending</div>
				<div class="font-display text-lg font-bold tabular-nums">{formatInt(pendingCount)}</div>
			</div>
		</div>
		<div class="metric-card flex items-center gap-3 p-4">
			<div class="grid size-9 place-items-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
				<Icon name="lucide:circle-check" class="size-4" />
			</div>
			<div>
				<div class="text-[11px] font-semibold text-[var(--ui-text-dimmed)]">Completed</div>
				<div class="font-display text-lg font-bold tabular-nums">{formatInt(completedCount)}</div>
			</div>
		</div>
		<div class="metric-card flex items-center gap-3 p-4">
			<div class="grid size-9 place-items-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
				<Icon name="lucide:wallet" class="size-4" />
			</div>
			<div>
				<div class="text-[11px] font-semibold text-[var(--ui-text-dimmed)]">Revenue</div>
				<div class="font-display text-lg font-bold tabular-nums">{formatMoney(totalRevenue, currency)}</div>
			</div>
		</div>
	</div>

	<!-- Bulk action bar -->
	{#if selectedIds.size > 0}
		<div class="flex items-center justify-between rounded-xl border border-primary-500/30 bg-primary-500/5 px-4 py-2.5">
			<span class="text-[13px] font-semibold text-primary-700 dark:text-primary-300">
				{selectedIds.size} selected
			</span>
			<div class="flex items-center gap-1.5">
				<Button size="sm" color="neutral" variant="soft" onclick={() => bulkUpdateStatus('confirmed')}>Confirm</Button>
				<Button size="sm" color="neutral" variant="soft" onclick={() => bulkUpdateStatus('preparing')}>Preparing</Button>
				<Button size="sm" color="neutral" variant="soft" onclick={() => bulkUpdateStatus('ready')}>Ready</Button>
				<Button size="sm" color="primary" variant="solid" onclick={() => bulkUpdateStatus('completed')}>Complete</Button>
				<Button size="sm" color="neutral" variant="ghost" icon="lucide:x" onclick={() => { selectedIds = new Set(); selectAll = false; }} />
			</div>
		</div>
	{/if}

	{#if filteredByCriteria.length || hasActiveFilters}
		<ListToolbar
			bind:search={controls.search}
			bind:sortKey={controls.sortKey}
			bind:sortDir={controls.sortDir}
			bind:viewMode={controls.viewMode}
			sortItems={controls.sortItems}
			searchPlaceholder="Search order no, customer, status…"
			applySort={controls.applySort}
			setViewMode={controls.setViewMode}
		>
			{#snippet filters()}
				<!-- Status filter -->
				<div class="relative inline-flex items-center rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)]">
					<select bind:value={statusFilter} class="h-9 appearance-none rounded-lg bg-transparent py-0 pr-8 pl-3 text-[13px] font-medium capitalize focus:outline-none">
						{#each STATUSES as s (s)}
							<option value={s}>{s === '__all__' ? 'All statuses' : titleCase(s)}</option>
						{/each}
					</select>
					<Icon name="lucide:chevron-down" class="pointer-events-none absolute right-2 size-3.5 text-[var(--ui-text-dimmed)]" />
				</div>
				<!-- Type filter -->
				<div class="relative inline-flex items-center rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)]">
					<select bind:value={typeFilter} class="h-9 appearance-none rounded-lg bg-transparent py-0 pr-8 pl-3 text-[13px] font-medium capitalize focus:outline-none">
						{#each TYPES as t (t)}
							<option value={t}>{t === '__all__' ? 'All types' : titleCase(t)}</option>
						{/each}
					</select>
					<Icon name="lucide:chevron-down" class="pointer-events-none absolute right-2 size-3.5 text-[var(--ui-text-dimmed)]" />
				</div>
				<!-- Date range filter -->
				<div class="relative inline-flex items-center rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)]">
					<select bind:value={dateRangeFilter} class="h-9 appearance-none rounded-lg bg-transparent py-0 pr-8 pl-3 text-[13px] font-medium focus:outline-none">
						{#each DATE_RANGES as d (d)}
							<option value={d}>{d === '__all__' ? 'All time' : d === 'today' ? 'Today' : d === '7d' ? 'Last 7 days' : 'Last 30 days'}</option>
						{/each}
					</select>
					<Icon name="lucide:chevron-down" class="pointer-events-none absolute right-2 size-3.5 text-[var(--ui-text-dimmed)]" />
				</div>
				{#if hasActiveFilters}
					<Button size="sm" color="neutral" variant="ghost" icon="lucide:x" onclick={resetFilters}>Clear</Button>
				{/if}
			{/snippet}
		</ListToolbar>
	{/if}

	{#if filteredByCriteria.length === 0}
		<EmptyState
			icon="lucide:receipt-text"
			title={hasActiveFilters ? 'No matching orders' : 'No orders yet'}
			description={hasActiveFilters
				? 'Try a different search or filter.'
				: 'Create an order or make a sale from the POS to get started.'}
		>
			{#snippet actions()}
				{#if !hasActiveFilters}
					<Button color="primary" size="sm" icon="lucide:plus" href="/orders/create">Create Order</Button>
				{:else}
					<Button color="neutral" variant="subtle" size="sm" icon="lucide:rotate-ccw" onclick={resetFilters}>Reset filters</Button>
				{/if}
			{/snippet}
		</EmptyState>
	{:else if controls.viewMode === 'grid'}
		<!-- GRID VIEW -->
		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
			{#each controls.pagedList as o (o.id)}
				<div class="metric-card p-4">
					<div class="mb-2 flex items-start justify-between">
						<div class="font-mono text-[13px] font-semibold">
							<a href="/orders/{o.id}" class="hover:text-primary-500">{o.number}</a>
						</div>
						<div class="flex items-center gap-1.5">
							{#if (o as any).type}
								<Badge color={typeBadgeColor((o as any).type)}>
									<span class="inline-flex items-center gap-1">
										<Icon name={typeIcon((o as any).type)} class="size-3" />
										{titleCase((o as any).type)}
									</span>
								</Badge>
							{/if}
							<Badge color={statusColor(o.status)}>{titleCase(o.status)}</Badge>
						</div>
					</div>
					<div class="font-display text-xl font-bold tabular-nums">
						{formatMoney(o.total, currency)}
					</div>
					<div class="mt-1 flex items-center gap-2 text-[11.5px] text-[var(--ui-text-muted)]">
						<Icon name="lucide:boxes" class="size-3.5" />
						{o.items} items
						{#if (o as any).customerName}
							· <span>{(o as any).customerName}</span>
						{/if}
					</div>
					<div class="mt-3 flex items-center justify-between border-t border-[var(--ui-border-muted)] pt-2.5">
						<span class="text-[11.5px] text-[var(--ui-text-dimmed)]">{relativeTime(o.atMs)}</span>
						<RowActions actions={rowActions(o)} />
					</div>
				</div>
			{/each}
		</div>
		<Pagination {controls} class="mt-3 rounded-xl border border-[var(--ui-border)] shadow-sm" />
	{:else}
		<!-- TABLE VIEW -->
		<div class="data-panel">
			<div class="overflow-x-auto">
				<table class="table-surface w-full text-left">
					<thead>
						<tr>
							<th class="w-8 px-3 py-2.5">
								<input type="checkbox" checked={selectAll} onchange={toggleSelectAll} class="size-4 rounded border-[var(--ui-border)] accent-primary-500" />
							</th>
							<th class="w-8 px-2 py-2.5"></th>
							<SortableTh column="number" active={controls.sortKey === 'number'} direction={controls.sortDir} applySort={controls.applySort}>Order</SortableTh>
							<th class="px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--ui-text-dimmed)]">Type</th>
							<th class="px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--ui-text-dimmed)]">Customer</th>
							<SortableTh column="status" active={controls.sortKey === 'status'} direction={controls.sortDir} applySort={controls.applySort}>Status</SortableTh>
							<SortableTh column="items" active={controls.sortKey === 'items'} direction={controls.sortDir} align="right" applySort={controls.applySort}>Items</SortableTh>
							<SortableTh column="total" active={controls.sortKey === 'total'} direction={controls.sortDir} align="right" applySort={controls.applySort}>Total</SortableTh>
							<th class="px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--ui-text-dimmed)]">Method</th>
							<SortableTh column="date" active={controls.sortKey === 'date'} direction={controls.sortDir} align="right" applySort={controls.applySort}>Date</SortableTh>
							<th class="w-10 px-5 py-2.5"></th>
						</tr>
					</thead>
					<tbody class="divide-y divide-[var(--ui-border-muted)] text-[13px]">
						{#each controls.pagedList as o (o.id)}
							{@const detail = getOrderDetail(o.id)}
							<tr
								class="cursor-pointer transition-colors hover:bg-[var(--ui-bg-accented)]/50"
								onclick={() => (expandedId = expandedId === o.id ? null : o.id)}
							>
								<td class="px-3 py-3" onclick={(e) => e.stopPropagation()}>
									<input type="checkbox" checked={selectedIds.has(o.id)} onchange={() => toggleSelect(o.id)} class="size-4 rounded border-[var(--ui-border)] accent-primary-500" />
								</td>
								<td class="px-2 py-3 text-center" onclick={(e) => e.stopPropagation()}>
									<button
										type="button"
										class="grid size-6 place-items-center rounded-md text-[var(--ui-text-dimmed)] transition-transform duration-200 hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)] {expandedId === o.id ? 'rotate-90' : ''}"
										onclick={() => (expandedId = expandedId === o.id ? null : o.id)}
										aria-label="Toggle details"
									>
										<Icon name="lucide:chevron-right" class="size-4" />
									</button>
								</td>
								<td class="px-5 py-3">
									<div class="font-mono text-[12.5px] font-semibold">{o.number}</div>
								</td>
								<td class="px-5 py-3">
									{#if (o as any).type}
										<span class="inline-flex items-center gap-1 rounded-lg bg-[var(--ui-bg-muted)] px-2 py-0.5 text-[11px] font-semibold capitalize">
											<Icon name={typeIcon((o as any).type)} class="size-3" />
											{titleCase((o as any).type)}
										</span>
									{/if}
								</td>
								<td class="px-5 py-3 text-[var(--ui-text-muted)]">
									{(o as any).customerName ?? '—'}
								</td>
								<td class="px-5 py-3"><Badge color={statusColor(o.status)}>{titleCase(o.status)}</Badge></td>
								<td class="px-5 py-3 text-right text-[var(--ui-text-muted)] tabular-nums">{o.items}</td>
								<td class="px-5 py-3 text-right font-semibold tabular-nums">{formatMoney(o.total, currency)}</td>
								<td class="px-5 py-3 text-right">
									{#if o.method && o.method !== 'cash'}
										<span class="inline-flex items-center gap-1 text-[11.5px] font-semibold text-[var(--ui-text-muted)]">
											<Icon name={o.method === 'card' ? 'lucide:credit-card' : o.method === 'qr' ? 'lucide:qr-code' : o.method === 'lightning' ? 'lucide:zap' : 'lucide:circle-dot'} class="size-3" />
											<span class="capitalize">{o.method}</span>
										</span>
									{:else}
										<span class="inline-flex items-center gap-1 text-[11.5px] font-semibold text-[var(--ui-text-dimmed)]">
											<Icon name="lucide:banknote" class="size-3" />
											Cash
										</span>
									{/if}
								</td>
								<td class="px-5 py-3 text-right text-[12px] text-[var(--ui-text-dimmed)]">{relativeTime(o.atMs)}</td>
								<td class="px-5 py-3 text-right" onclick={(e) => e.stopPropagation()}>
									<RowActions actions={rowActions(o)} />
								</td>
							</tr>
							{#if expandedId === o.id}
								<tr class="bg-[var(--ui-bg-muted)]/40">
									<td colspan="99" class="px-4 py-4">
										<div class="grid gap-4 lg:grid-cols-3">
											<!-- Line items -->
											<div class="lg:col-span-2">
												<h4 class="mb-2 text-[11px] font-bold uppercase tracking-wider text-[var(--ui-text-dimmed)]">Items</h4>
												{#if detail?.data?.lines?.length}
													<div class="overflow-hidden rounded-lg border border-[var(--ui-border-muted)]">
														<table class="w-full text-left text-[12.5px]">
															<thead class="bg-[var(--ui-bg-accented)]/50 text-[10.5px] uppercase tracking-wider text-[var(--ui-text-dimmed)]">
																<tr>
																	<th class="px-3 py-1.5 font-semibold">Item</th>
																	<th class="px-3 py-1.5 text-right font-semibold">Qty</th>
																	<th class="px-3 py-1.5 text-right font-semibold">Price</th>
																	<th class="px-3 py-1.5 text-right font-semibold">Total</th>
																</tr>
															</thead>
															<tbody class="divide-y divide-[var(--ui-border-muted)]">
																{#each detail.data.lines as line, i (line.productId + '-' + i)}
																	<tr>
																		<td class="px-3 py-2">
																			<div class="font-semibold">{line.productName || line.name || 'Item'}</div>
																			{#if line.variantName}<span class="text-[11px] text-[var(--ui-text-dimmed)]">{line.variantName}</span>{/if}
																			{#if line.modifiers?.length}
																				<div class="text-[10.5px] text-[var(--ui-text-dimmed)]">{line.modifiers.map((m: any) => m.name).join(', ')}</div>
																			{/if}
																		</td>
																		<td class="px-3 py-2 text-right tabular-nums">{line.quantity}</td>
																		<td class="px-3 py-2 text-right tabular-nums">{formatMoney(line.unitPrice || 0, currency)}</td>
																		<td class="px-3 py-2 text-right font-semibold tabular-nums">{formatMoney((line.unitPrice || 0) * (line.quantity || 1), currency)}</td>
																	</tr>
																{/each}
															</tbody>
														</table>
													</div>
												{:else}
													<p class="text-[12px] text-[var(--ui-text-dimmed)]">No line items recorded.</p>
												{/if}
											</div>

											<!-- Sidebar: customer + payment + actions -->
											<div class="space-y-3">
												<!-- Customer info -->
												<div>
													<h4 class="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-[var(--ui-text-dimmed)]">Customer</h4>
													<div class="rounded-lg border border-[var(--ui-border-muted)] p-2.5 text-[12px]">
														<div class="font-semibold">{(detail?.data as any)?.customerName || 'Walk-in'}</div>
														{#if (detail?.data as any)?.shipping?.phone || (detail?.data as any)?.pickup?.phone}
															<div class="text-[11.5px] text-[var(--ui-text-muted)]">{(detail?.data as any)?.shipping?.phone || (detail?.data as any)?.pickup?.phone}</div>
														{/if}
														{#if (detail?.data as any)?.tableId}
															<div class="text-[11.5px] text-[var(--ui-text-muted)]">Table: {(detail?.data as any)?.tableId}</div>
														{/if}
													</div>
												</div>

												<!-- Payment info -->
												<div>
													<h4 class="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-[var(--ui-text-dimmed)]">Payment</h4>
													<div class="flex items-center justify-between rounded-lg border border-[var(--ui-border-muted)] p-2.5 text-[12px]">
														<div class="flex items-center gap-2">
															<Badge color="neutral">{(detail?.data as any)?.method || o.method || '—'}</Badge>
															<Badge color={statusColor(o.status)}>{titleCase(o.status)}</Badge>
														</div>
														<span class="font-display text-base font-bold tabular-nums">{formatMoney(o.total, currency)}</span>
													</div>
												</div>

												<!-- Quick actions -->
												<div>
													<h4 class="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-[var(--ui-text-dimmed)]">Actions</h4>
													<div class="flex flex-wrap gap-1.5">
														<Button size="sm" color="neutral" variant="soft" onclick={() => quickUpdateStatus(o.id, 'confirmed')}>Confirm</Button>
														<Button size="sm" color="neutral" variant="soft" onclick={() => quickUpdateStatus(o.id, 'preparing')}>Preparing</Button>
														<Button size="sm" color="neutral" variant="soft" onclick={() => quickUpdateStatus(o.id, 'ready')}>Ready</Button>
														<Button size="sm" color="primary" variant="solid" onclick={() => quickUpdateStatus(o.id, 'completed')}>Complete</Button>
													</div>
													<div class="mt-1.5 flex gap-1.5">
														<Button size="sm" color="neutral" variant="subtle" icon="lucide:printer" onclick={() => printOrder(o)}>Print</Button>
														<Button size="sm" color="neutral" variant="subtle" icon="lucide:eye" href={`/orders/${o.id}`}>Full detail</Button>
													</div>
												</div>
											</div>
										</div>
									</td>
								</tr>
							{/if}
						{/each}
					</tbody>
				</table>
			</div>
			<Pagination {controls} />
		</div>
	{/if}
</div>

<RawDataDialog bind:open={rawOpen} data={rawItem} title="Order Raw Data" />
