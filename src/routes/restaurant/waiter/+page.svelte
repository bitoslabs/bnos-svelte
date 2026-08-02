<script lang="ts">
	import { onMount } from 'svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import { glo } from '$nostr/store.svelte';
	import { dataSync } from '$nostr/sync.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { relativeTime } from '$lib/utils/format';
	import type { GloOrder } from '@bitos/bnos-core/glo';
	import type { Staff } from '$lib/domain';

	interface WaiterAssignment {
		orderId: string;
		waiterName: string;
	}

	const WAITER_TYPE = 'restaurant.waiter-assignment';

	onMount(() => {
		dataSync.pageSync(['commerce.order', 'identity.staff', WAITER_TYPE], {
			scope: 'restaurant-waiter'
		});
	});

	// ── Data ──
	const allOrders = $derived(glo.all<GloOrder, 'commerce.order'>('commerce.order'));
	const staff = $derived(glo.all<Staff, 'identity.staff'>('identity.staff').map((s) => s.data));

	const activeStatuses: string[] = ['pending', 'confirmed', 'preparing', 'ready', 'served'];
	const openOrders = $derived(
		allOrders
			.filter((o) => {
				const status = (o.data.status ?? '').toLowerCase();
				return activeStatuses.includes(status);
			})
			.sort((a, b) => new Date(b.data.occurredAt ?? 0).getTime() - new Date(a.data.occurredAt ?? 0).getTime())
	);

	// Waiter assignments
	const assignments = $derived(
		glo.all<WaiterAssignment, typeof WAITER_TYPE>(WAITER_TYPE).map((g) => ({ orderId: g.data.orderId, waiterName: g.data.waiterName }))
	);

	function waiterFor(orderId: string): string {
		return assignments.find((a) => a.orderId === orderId)?.waiterName ?? '';
	}

	// ── Filters ──
	let filterStatus = $state<string>('all');
	let filterWaiter = $state<string>('all');

	const filteredOrders = $derived(
		openOrders.filter((o) => {
			const status = (o.data.status ?? '').toLowerCase();
			const matchesStatus = filterStatus === 'all' || status === filterStatus;
			const w = waiterFor(o.id);
			const matchesWaiter = filterWaiter === 'all' || w === filterWaiter;
			return matchesStatus && matchesWaiter;
		})
	);

	const statusTabs = [
		{ key: 'all', label: 'All' },
		{ key: 'pending', label: 'Pending' },
		{ key: 'confirmed', label: 'Confirmed' },
		{ key: 'preparing', label: 'Cooking' },
		{ key: 'ready', label: 'Ready' },
		{ key: 'served', label: 'Served' }
	];

	const NEXT_STATUS: Record<string, string> = {
		pending: 'confirmed',
		confirmed: 'preparing',
		preparing: 'ready',
		ready: 'served',
		served: 'completed'
	};

	const STATUS_COLOR: Record<string, 'neutral' | 'warning' | 'info' | 'success' | 'primary'> = {
		pending: 'warning',
		confirmed: 'info',
		preparing: 'primary',
		ready: 'success',
		served: 'neutral',
		completed: 'neutral'
	};

	// Waiter list
	const waiterNames = $derived(
		[...new Set([
			...staff.filter((s) => s.role === 'waiter').map((s) => s.name),
			...assignments.map((a) => a.waiterName)
		])].sort()
	);

	// Grouped by waiter for assignment view
	// Stats
	const stats = $derived({
		total: openOrders.length,
		pending: openOrders.filter((o) => (o.data.status ?? '').toLowerCase() === 'pending').length,
		preparing: openOrders.filter((o) => (o.data.status ?? '').toLowerCase() === 'preparing').length,
		ready: openOrders.filter((o) => (o.data.status ?? '').toLowerCase() === 'ready').length
	});

	// ── Actions ──
	async function updateStatus(orderId: string) {
		const order = glo.get('commerce.order', orderId);
		if (!order) {
			toast.warning('Order not found');
			return;
		}
		const current = ((order.data as { status?: string }).status ?? '').toLowerCase();
		const next = NEXT_STATUS[current];
		if (!next) return;
		await glo.upsert('commerce.order', { ...(order.data as Record<string, unknown>), status: next }, { id: order.id });
		toast.success(`Order → ${next}`);
	}

	async function assignWaiter(orderId: string, waiterName: string) {
		await glo.upsert(WAITER_TYPE, { orderId, waiterName } as WaiterAssignment, { id: `wa-${orderId}` });
		toast.success(`Assigned to ${waiterName}`);
	}

	let viewMode = $state<'orders' | 'waiters'>('orders');
	const wg = $derived((() => {
		const groups: Record<string, typeof openOrders> = {};
		for (const o of openOrders) {
			const w = waiterFor(o.id) || 'Unassigned';
			(groups[w] ??= []).push(o);
		}
		return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
	})());
</script>

<svelte:head><title>BNOS · Waiter</title></svelte:head>

<div class="space-y-4">
	<!-- Header -->
	<div class="flex items-center justify-between">
		<div>
			<h1 class="font-display text-xl font-bold tracking-tight">Waiter station</h1>
			<p class="text-[12.5px] text-[var(--ui-text-muted)]">Open tabs &amp; table service</p>
		</div>
		<!-- View toggle -->
		<div class="flex items-center gap-0.5 rounded-lg bg-[var(--ui-bg-muted)] p-0.5">
			<button
				type="button"
				class="flex items-center gap-1 rounded-md px-3 py-1.5 text-[12px] font-bold transition-colors
					{viewMode === 'orders' ? 'bg-[var(--ui-bg-elevated)] text-primary-600 dark:text-primary-400 shadow-sm' : 'text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'}"
				onclick={() => (viewMode = 'orders')}
			>
				<Icon name="lucide:clipboard-list" class="size-3.5" />
				Orders
			</button>
			<button
				type="button"
				class="flex items-center gap-1 rounded-md px-3 py-1.5 text-[12px] font-bold transition-colors
					{viewMode === 'waiters' ? 'bg-[var(--ui-bg-elevated)] text-primary-600 dark:text-primary-400 shadow-sm' : 'text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'}"
				onclick={() => (viewMode = 'waiters')}
			>
				<Icon name="lucide:users" class="size-3.5" />
				Waiters
			</button>
		</div>
	</div>

	<!-- Stats bar -->
	<div class="flex flex-wrap items-center gap-3">
		{#each [
			{ label: 'Open', value: stats.total, color: 'bg-[var(--ui-text-dimmed)]' },
			{ label: 'Pending', value: stats.pending, color: 'bg-amber-500' },
			{ label: 'Cooking', value: stats.preparing, color: 'bg-blue-500' },
			{ label: 'Ready', value: stats.ready, color: 'bg-emerald-500' }
		] as stat (stat.label)}
			<div class="flex items-center gap-2 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-3 py-1.5">
				<span class="size-2 rounded-full {stat.color}"></span>
				<span class="text-[12px] font-semibold text-[var(--ui-text-muted)]">{stat.label}</span>
				<span class="text-[14px] font-bold tabular-nums">{stat.value}</span>
			</div>
		{/each}
	</div>

	{#if viewMode === 'orders'}
		<!-- Filters -->
		<div class="flex flex-wrap items-center gap-2">
			<!-- Status tabs -->
			<div class="flex flex-wrap items-center gap-1">
				{#each statusTabs as tab (tab.key)}
					<button
						type="button"
						class="rounded-lg px-2.5 py-1 text-[12px] font-bold transition-colors
							{filterStatus === tab.key
							? 'bg-primary-500/10 text-primary-700 dark:text-primary-300'
							: 'text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)]'}"
						onclick={() => (filterStatus = tab.key)}
					>
						{tab.label}
					</button>
				{/each}
			</div>
			<!-- Waiter filter -->
			{#if waiterNames.length > 0}
				<div class="ml-auto">
					<Select
						size="sm"
						value={filterWaiter}
						options={[{ value: 'all', label: 'All waiters' }, ...waiterNames.map((w) => ({ value: w, label: w }))]}
						onchange={(e: Event) => (filterWaiter = (e.currentTarget as HTMLSelectElement).value)}
					/>
				</div>
			{/if}
		</div>

		<!-- Order list -->
		{#if filteredOrders.length === 0}
			<EmptyState icon="lucide:concierge-bell" title="No open tabs" description="Orders started from the POS that aren't yet completed show up here." />
		{:else}
			<ul class="space-y-2">
				{#each filteredOrders as o (o.id)}
					{@const status = (o.data.status ?? '').toLowerCase()}
					{@const w = waiterFor(o.id)}
					<li class="surface-card flex items-center gap-3 p-4">
						<Icon name="lucide:receipt-text" class="size-5 shrink-0 text-primary-500" />

						<!-- Info -->
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2">
								<span class="font-semibold">{o.data.number ?? o.id.slice(0, 8)}</span>
								{#if (o.data as { tableId?: string }).tableId}
									<span class="rounded bg-blue-100 dark:bg-blue-900/30 px-1.5 py-0.5 text-[10px] font-bold text-blue-700 dark:text-blue-400">
										Table {(o.data as { tableId?: string }).tableId}
									</span>
								{/if}
								<span class="text-[11px] text-[var(--ui-text-muted)]">
									{o.data.lines?.length ?? 0} items · {relativeTime(o.data.occurredAt ?? '')}
								</span>
							</div>
							{#if o.data.lines && o.data.lines.length > 0}
								<div class="mt-0.5 truncate text-[11px] text-[var(--ui-text-muted)]">
									{o.data.lines.map((l) => `×${l.quantity} ${l.name}`).join(' · ')}
								</div>
							{/if}
						</div>

						<!-- Waiter assignment -->
						<div class="shrink-0">
							<Select
								size="sm"
								value={w}
								options={[{ value: '', label: 'Unassigned' }, ...waiterNames.map((wn) => ({ value: wn, label: wn }))]}
								onchange={(e: Event) => assignWaiter(o.id, (e.currentTarget as HTMLSelectElement).value)}
							/>
						</div>

						<!-- Status badge -->
						<Badge color={STATUS_COLOR[status] ?? 'neutral'}>{status}</Badge>

						<!-- Advance button -->
						{#if NEXT_STATUS[status] && status !== 'served'}
							<Button size="sm" color="primary" variant="soft" onclick={() => updateStatus(o.id)}>
								{NEXT_STATUS[status]}
								<Icon name="lucide:arrow-right" class="size-3.5" />
							</Button>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	{:else if viewMode === 'waiters'}
		<!-- Waiter group view -->
		{#if wg.length === 0 || (wg.length === 1 && wg[0][0] === 'Unassigned')}
			<EmptyState icon="lucide:user-cog" title="No waiter assignments" description="Assign waiters to orders from the Orders view." />
		{:else}
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{#each wg as [waiterName, orders] (waiterName)}
					<div class="rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] p-4">
						<!-- Waiter header -->
						<div class="mb-3 flex items-center gap-2">
							<div class="grid size-9 place-items-center rounded-full bg-primary-500/10 text-[13px] font-bold text-primary-600 dark:text-primary-400">
								{waiterName === 'Unassigned' ? '?' : waiterName.split(' ').map((n) => n[0]).slice(0, 2).join('')}
							</div>
							<div>
								<div class="text-[14px] font-bold">{waiterName}</div>
								<div class="text-[11px] text-[var(--ui-text-muted)]">{orders.length} table{orders.length !== 1 ? 's' : ''}</div>
							</div>
						</div>
						<!-- Orders -->
						<ul class="space-y-1.5">
							{#each orders as o (o.id)}
								{@const status = (o.data.status ?? '').toLowerCase()}
								<li class="flex items-center gap-2 rounded-lg bg-[var(--ui-bg-elevated)] px-3 py-2">
									<span class="text-[12px] font-mono font-bold">{o.data.number ?? o.id.slice(0, 6)}</span>
									{#if (o.data as { tableId?: string }).tableId}
										<span class="text-[10px] text-[var(--ui-text-muted)]">T:{(o.data as { tableId?: string }).tableId}</span>
									{/if}
									<span class="ml-auto">
										<Badge color={STATUS_COLOR[status] ?? 'neutral'}>{status}</Badge>
									</span>
								</li>
							{/each}
						</ul>
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</div>
