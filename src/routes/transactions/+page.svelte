<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import ListToolbar from '$lib/components/list/ListToolbar.svelte';
	import SortableTh from '$lib/components/list/SortableTh.svelte';
	import Pagination from '$lib/components/list/Pagination.svelte';
	import { createListControls } from '$lib/utils/list.svelte';
	import { glo } from '$nostr/store.svelte';
	import { dataSync } from '$nostr/sync.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { session } from '$nostr/session.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatMoney, formatInt, relativeTime } from '$lib/utils/format';
	import { newRecordId, nextReadableNumber } from '$lib/utils/record-id';
	import { toOrderRows, type DashboardOrder, type OrderRow } from '$lib/dashboard/metrics';
	import RawDataDialog from '$lib/components/ui/RawDataDialog.svelte';
	import { TYPE, type Shift } from '$lib/domain';

	onMount(() => {
		dataSync.pageSync([TYPE.order, TYPE.payment, TYPE.shift], { scope: 'transactions' });
	});

	const currency = $derived(tenant.state.currency);
	const orderObjects = $derived(glo.all<DashboardOrder, 'commerce.order'>('commerce.order'));

	const METHODS = ['__all__', 'cash', 'card', 'qr', 'lightning'] as const;
	// Raw data viewer
	let rawOpen = $state(false);
	let rawItem = $state<any>(null);

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

	// ── Shift management ──
	const shifts = $derived(glo.all<Shift, typeof TYPE.shift>(TYPE.shift));
	const activeShift = $derived(shifts.find((s) => s.data.status === 'active'));

	let closeShiftDlg = $state(false);
	let closeOpeningCash = $state<number | ''>('');
	let closeCountedCash = $state<number | ''>('');

	function openShiftPanel() {
		closeOpeningCash = activeShift?.data.openingCash ?? '';
		closeCountedCash = '';
		closeShiftDlg = true;
	}

	async function openShift() {
		const openingCash =
			typeof closeOpeningCash === 'number' ? closeOpeningCash : Number(closeOpeningCash) || 0;
		try {
			await glo.upsert<Shift>(
				TYPE.shift,
				{
					number: nextReadableNumber({ prefix: 'SFT', scope: tenant.state.locationId }),
					status: 'active',
					openedAt: new Date().toISOString(),
					openingCash,
					staffId: session.pubkey ?? undefined,
					staffName: session.snapshot?.npub ?? undefined,
					branchId: tenant.state.locationId ?? undefined,
					terminalId: undefined,
					currency
				},
				{ id: newRecordId('shift') }
			);
			toast.success('Shift opened');
		} catch (e) {
			toast.error('Failed to open shift', e instanceof Error ? e.message : undefined);
		}
	}

	async function closeShift() {
		if (!activeShift) return;
		const shift = activeShift;
		const endedAt = new Date().toISOString();

		// Compute actual totals from orders during shift period
		const shiftOrders = glo.all<any, 'commerce.order'>('commerce.order').filter((o) => {
			const d = o.data as any;
			return (
				d.cashierPubkey === shift.data.staffId &&
				new Date(d.occurredAt).getTime() >= new Date(shift.data.openedAt).getTime() &&
				new Date(d.occurredAt).getTime() <= new Date(endedAt).getTime()
			);
		});

		const totalSales = shiftOrders.reduce((sum, o) => sum + (o.data.total ?? 0), 0);
		const totalOrders = shiftOrders.length;
		const cashOrders = shiftOrders.filter((o) => (o.data as any).method === 'cash');
		const cashSales = cashOrders.reduce((sum, o) => sum + (o.data.total ?? 0), 0);
		const cardOrders = shiftOrders.filter((o) => (o.data as any).method === 'card');
		const cardSales = cardOrders.reduce((sum, o) => sum + (o.data.total ?? 0), 0);
		const lightningOrders = shiftOrders.filter((o) => (o.data as any).method === 'lightning');
		const lightningSales = lightningOrders.reduce((sum, o) => sum + (o.data.total ?? 0), 0);
		const qrOrders = shiftOrders.filter((o) => (o.data as any).method === 'qr');
		const qrSales = qrOrders.reduce((sum, o) => sum + (o.data.total ?? 0), 0);
		const otherSales = totalSales - cashSales - cardSales - lightningSales - qrSales;

		const countedCash =
			typeof closeCountedCash === 'number' ? closeCountedCash : Number(closeCountedCash) || 0;
		const openingCash = shift.data.openingCash ?? 0;
		const expectedCash = openingCash + cashSales;
		const difference = countedCash - expectedCash;

		try {
			await glo.upsert<Shift>(
				TYPE.shift,
				{
					...shift.data,
					status: 'closed',
					closedAt: endedAt,
					closingCash: countedCash,
					expectedCash,
					difference,
					variance: difference,
					totalSales,
					totalOrders,
					cashSales,
					cardSales,
					lightningSales,
					qrSales,
					otherSales
				},
				{ id: shift.id }
			);
			toast.success('Shift closed', `Sales: ${formatMoney(totalSales, currency)}`);
			closeShiftDlg = false;
		} catch (e) {
			toast.error('Failed to close shift', e instanceof Error ? e.message : undefined);
		}
	}
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

	<!-- Shift panel -->
	<div class="surface-card p-4">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<div class="flex items-center gap-3">
				<div
					class="flex size-10 items-center justify-center rounded-xl {activeShift
						? 'bg-emerald-500/10'
						: 'bg-[var(--ui-bg-accented)]'}"
				>
					<Icon
						name={activeShift ? 'lucide:circle-check' : 'lucide:circle'}
						class="size-5 {activeShift ? 'text-emerald-500' : 'text-[var(--ui-text-muted)]'}"
					/>
				</div>
				<div>
					<div class="text-[13px] font-semibold">
						{activeShift ? 'Shift Active' : 'No Active Shift'}
					</div>
					{#if activeShift}
						<div class="text-[11.5px] text-[var(--ui-text-dimmed)]">
							Opened {relativeTime(activeShift.data.openedAt)}
						</div>
					{:else}
						<div class="text-[11.5px] text-[var(--ui-text-dimmed)]">
							Open a shift to track sales
						</div>
					{/if}
				</div>
			</div>
			<div class="flex gap-2">
				{#if activeShift}
					<Button
						color="error"
						variant="subtle"
						size="sm"
						icon="lucide:square"
						onclick={openShiftPanel}>Close Shift</Button
					>
				{:else}
					<div class="flex items-center gap-2">
						<Input
							bind:value={closeOpeningCash}
							type="number"
							min="0"
							step="0.01"
							placeholder="Opening cash"
							class="w-36"
						/>
						<Button
							color="primary"
							variant="subtle"
							size="sm"
							icon="lucide:play"
							onclick={openShift}>Open Shift</Button
						>
					</div>
				{/if}
			</div>
		</div>
		{#if activeShift?.data.totalSales != null}
			<div class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
				<div>
					<span class="text-[11px] text-[var(--ui-text-dimmed)]">Total Sales</span>
					<div class="font-bold tabular-nums">
						{formatMoney(activeShift.data.totalSales ?? 0, currency)}
					</div>
				</div>
				<div>
					<span class="text-[11px] text-[var(--ui-text-dimmed)]">Orders</span>
					<div class="font-bold tabular-nums">{formatInt(activeShift.data.totalOrders ?? 0)}</div>
				</div>
				<div>
					<span class="text-[11px] text-[var(--ui-text-dimmed)]">Cash Sales</span>
					<div class="font-bold tabular-nums">
						{formatMoney(activeShift.data.cashSales ?? 0, currency)}
					</div>
				</div>
				<div>
					<span class="text-[11px] text-[var(--ui-text-dimmed)]">Card Sales</span>
					<div class="font-bold tabular-nums">
						{formatMoney(activeShift.data.cardSales ?? 0, currency)}
					</div>
				</div>
			</div>
		{/if}
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

<RawDataDialog bind:open={rawOpen} data={rawItem} title="Transaction Raw Data" />

<!-- Close Shift Dialog -->
{#if closeShiftDlg}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
		role="dialog"
		aria-modal="true"
	>
		<div
			class="w-full max-w-md rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-bg-elevated)] p-5 shadow-xl"
		>
			<h3 class="mb-4 font-display text-base font-bold">Close Shift</h3>
			<div class="space-y-3">
				<div class="rounded-lg bg-[var(--ui-bg-accented)] p-3 text-[12.5px]">
					<div>
						Opened: <span class="font-semibold"
							>{activeShift ? relativeTime(activeShift.data.openedAt) : ''}</span
						>
					</div>
					<div>
						Opening Cash: <span class="font-semibold tabular-nums"
							>{formatMoney(activeShift?.data.openingCash ?? 0, currency)}</span
						>
					</div>
				</div>
				<label class="block">
					<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>Counted Cash</span
					>
					<Input
						bind:value={closeCountedCash}
						type="number"
						step="0.01"
						placeholder="0.00"
						class="w-full"
					/>
				</label>
			</div>
			<div class="mt-4 flex justify-end gap-2">
				<Button color="neutral" variant="ghost" onclick={() => (closeShiftDlg = false)}
					>Cancel</Button
				>
				<Button color="error" icon="lucide:square" onclick={closeShift}>Close Shift</Button>
			</div>
		</div>
	</div>
{/if}
