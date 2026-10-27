<script lang="ts">
	import { onMount } from 'svelte';
	import { t } from '$lib/i18n/i18n.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import FilterChips from '$lib/components/ui/FilterChips.svelte';
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
			.sort(
				(a, b) =>
					new Date(b.data.occurredAt ?? 0).getTime() - new Date(a.data.occurredAt ?? 0).getTime()
			)
	);

	// Waiter assignments
	const assignments = $derived(
		glo
			.all<WaiterAssignment, typeof WAITER_TYPE>(WAITER_TYPE)
			.map((g) => ({ orderId: g.data.orderId, waiterName: g.data.waiterName }))
	);
	const waiterByOrder = $derived.by(() => {
		const map: Record<string, string> = {};
		for (const a of assignments) map[a.orderId] = a.waiterName;
		return map;
	});

	function waiterFor(orderId: string): string {
		return waiterByOrder[orderId] ?? '';
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

	const STATUS_META: Record<
		string,
		{ labelKey: string; dot: string; badge: 'neutral' | 'warning' | 'info' | 'success' | 'primary' }
	> = {
		pending: { labelKey: 'status.pending', dot: 'bg-amber-500', badge: 'warning' },
		confirmed: { labelKey: 'status.confirmed', dot: 'bg-blue-500', badge: 'info' },
		preparing: { labelKey: 'restaurant.cooking', dot: 'bg-indigo-500', badge: 'primary' },
		ready: { labelKey: 'status.ready', dot: 'bg-emerald-500', badge: 'success' },
		served: { labelKey: 'status.served', dot: 'bg-gray-400', badge: 'neutral' },
		completed: { labelKey: 'status.completed', dot: 'bg-gray-400', badge: 'neutral' }
	};
	const STATUS_FLOW = ['pending', 'confirmed', 'preparing', 'ready', 'served'] as const;

	const NEXT_STATUS: Record<string, string> = {
		pending: 'confirmed',
		confirmed: 'preparing',
		preparing: 'ready',
		ready: 'served',
		served: 'completed'
	};

	// Waiter list
	const waiterNames = $derived(
		[
			...new Set([
				...staff.filter((s) => s.role === 'waiter').map((s) => s.name),
				...assignments.map((a) => a.waiterName)
			])
		].sort()
	);

	// Grouped by waiter for assignment view
	// Stats
	const stats = $derived.by(() => {
		const counts = { pending: 0, confirmed: 0, preparing: 0, ready: 0, served: 0 };
		for (const o of openOrders) {
			const status = (o.data.status ?? '').toLowerCase();
			if (status in counts) counts[status as keyof typeof counts]++;
		}
		return { total: openOrders.length, ...counts };
	});

	const statusTabs = $derived([
		{ value: 'all', label: t('common.all'), count: stats.total },
		...STATUS_FLOW.map((key) => ({
			value: key,
			label: t(STATUS_META[key].labelKey),
			count: stats[key],
			dot: STATUS_META[key].dot
		}))
	]);

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
		await glo.upsert(
			'commerce.order',
			{ ...(order.data as Record<string, unknown>), status: next },
			{ id: order.id }
		);
		toast.success(`Order → ${next}`);
	}

	async function assignWaiter(orderId: string, waiterName: string) {
		await glo.upsert(WAITER_TYPE, { orderId, waiterName } as WaiterAssignment, {
			id: `wa-${orderId}`
		});
		toast.success(`Assigned to ${waiterName}`);
	}

	let viewMode = $state<'orders' | 'waiters'>('orders');
	const wg = $derived(
		(() => {
			const groups: Record<string, typeof openOrders> = {};
			for (const o of openOrders) {
				const w = waiterFor(o.id) || 'Unassigned';
				(groups[w] ??= []).push(o);
			}
			return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
		})()
	);
</script>

<svelte:head><title>{t('common.appName')} · {t('nav.waiter')}</title></svelte:head>

<div class="space-y-4">
	<!-- Header -->
	<div class="flex items-center justify-between">
		<div>
			<h1 class="font-display text-xl font-bold tracking-tight">
				{t('restaurant.waiterStation')}
			</h1>
			<p class="text-[12.5px] text-(--ui-text-muted)">{t('restaurant.waiterStationDesc')}</p>
		</div>
		<!-- View toggle -->
		<div class="segmented flex items-center gap-0.5" role="group" aria-label={t('common.view')}>
			<button
				type="button"
				aria-pressed={viewMode === 'orders'}
				class="focus-ring flex items-center gap-1 rounded-md px-3 py-1.5 text-[12px] font-bold transition-colors
					{viewMode === 'orders'
					? 'bg-(--ui-bg-elevated) text-(--ui-text) shadow-sm'
					: 'text-(--ui-text-muted) hover:text-(--ui-text)'}"
				onclick={() => (viewMode = 'orders')}
			>
				<Icon name="lucide:clipboard-list" class="size-3.5" />
				{t('restaurant.orders')}
			</button>
			<button
				type="button"
				aria-pressed={viewMode === 'waiters'}
				class="focus-ring flex items-center gap-1 rounded-md px-3 py-1.5 text-[12px] font-bold transition-colors
					{viewMode === 'waiters'
					? 'bg-(--ui-bg-elevated) text-(--ui-text) shadow-sm'
					: 'text-(--ui-text-muted) hover:text-(--ui-text)'}"
				onclick={() => (viewMode = 'waiters')}
			>
				<Icon name="lucide:users" class="size-3.5" />
				{t('restaurant.waiters')}
			</button>
		</div>
	</div>

	{#if viewMode === 'orders'}
		<!-- Filters -->
		<div class="flex flex-wrap items-center gap-2">
			<!-- Status filter chips -->
			<FilterChips bind:value={filterStatus} options={statusTabs} label={t('common.status')} />
			<!-- Waiter filter -->
			{#if waiterNames.length > 0}
				<div class="ml-auto">
					<Select
						size="sm"
						value={filterWaiter}
						options={[
							{ value: 'all', label: t('restaurant.allWaiters') },
							...waiterNames.map((w) => ({ value: w, label: w }))
						]}
						onchange={(e: Event) => (filterWaiter = (e.currentTarget as HTMLSelectElement).value)}
					/>
				</div>
			{/if}
		</div>

		<!-- Order list -->
		{#if filteredOrders.length === 0}
			<EmptyState
				icon="lucide:concierge-bell"
				title={t('common.noOpenTabs')}
				description={t('restaurant.noOpenTabsDesc')}
			/>
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
									<span
										class="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
									>
										{t('common.table')}
										{(o.data as { tableId?: string }).tableId}
									</span>
								{/if}
								<span class="text-[11px] text-(--ui-text-muted)">
									{t('restaurant.itemsCount', { count: o.data.lines?.length ?? 0 })} ·
									{relativeTime(o.data.occurredAt ?? '')}
								</span>
							</div>
							{#if o.data.lines && o.data.lines.length > 0}
								<div class="mt-0.5 truncate text-[11px] text-(--ui-text-muted)">
									{o.data.lines.map((l) => `×${l.quantity} ${l.name}`).join(' · ')}
								</div>
							{/if}
						</div>

						<!-- Waiter assignment -->
						<div class="shrink-0">
							<Select
								size="sm"
								value={w}
								options={[
									{ value: '', label: t('restaurant.unassigned') },
									...waiterNames.map((wn) => ({ value: wn, label: wn }))
								]}
								onchange={(e: Event) =>
									assignWaiter(o.id, (e.currentTarget as HTMLSelectElement).value)}
							/>
						</div>

						<!-- Status badge -->
						<Badge color={STATUS_META[status]?.badge ?? 'neutral'}>
							{t(STATUS_META[status]?.labelKey ?? 'common.status')}
						</Badge>

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
			<EmptyState
				icon="lucide:user-cog"
				title={t('restaurant.noWaiterAssignments')}
				description={t('restaurant.waiterAssign')}
			/>
		{:else}
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{#each wg as [waiterName, orders] (waiterName)}
					<div class="rounded-xl border border-(--ui-border) bg-(--ui-bg-muted) p-4">
						<!-- Waiter header -->
						<div class="mb-3 flex items-center gap-2">
							<div
								class="grid size-9 place-items-center rounded-full bg-primary-500/10 text-[13px] font-bold text-primary-600 dark:text-primary-400"
							>
								{waiterName === 'Unassigned'
									? '?'
									: waiterName
											.split(' ')
											.map((n) => n[0])
											.slice(0, 2)
											.join('')}
							</div>
							<div>
								<div class="text-[14px] font-bold">
									{waiterName === 'Unassigned' ? t('restaurant.unassigned') : waiterName}
								</div>
								<div class="text-[11px] text-(--ui-text-muted)">
									{t('restaurant.tables', { count: orders.length })}
								</div>
							</div>
						</div>
						<!-- Orders -->
						<ul class="space-y-1.5">
							{#each orders as o (o.id)}
								{@const status = (o.data.status ?? '').toLowerCase()}
								<li class="flex items-center gap-2 rounded-lg bg-(--ui-bg-elevated) px-3 py-2">
									<span class="font-mono text-[12px] font-bold"
										>{o.data.number ?? o.id.slice(0, 6)}</span
									>
									{#if (o.data as { tableId?: string }).tableId}
										<span class="text-[10px] text-(--ui-text-muted)"
											>T:{(o.data as { tableId?: string }).tableId}</span
										>
									{/if}
									<span class="ml-auto">
										<Badge color={STATUS_META[status]?.badge ?? 'neutral'}>
											{t(STATUS_META[status]?.labelKey ?? 'common.status')}
										</Badge>
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
