<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import ListToolbar from '$lib/components/list/ListToolbar.svelte';
	import SortableTh from '$lib/components/list/SortableTh.svelte';
	import Pagination from '$lib/components/list/Pagination.svelte';
	import RowActions from '$lib/components/list/RowActions.svelte';
	import { createListControls } from '$lib/utils/list.svelte';
	import { glo } from '$nostr/store.svelte';
	import { dataSync } from '$nostr/sync.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatMoney, relativeTime } from '$lib/utils/format';
	import { newRecordId, nextReadableNumber } from '$lib/utils/record-id';
	import {
		TYPE,
		statusColor,
		EXPENSE_CATEGORIES,
		type Expense,
		type ExpenseCategory,
		type ExpenseStatus
	} from '$lib/domain';
	import RawDataDialog from '$lib/components/ui/RawDataDialog.svelte';

	onMount(() => {
		dataSync.pageSync([TYPE.expense], { scope: 'expenses' });
	});

	const currency = $derived(tenant.state.currency);
	const expenses = $derived(glo.all<Expense, typeof TYPE.expense>(TYPE.expense));

	// Filters
	// Raw data viewer
	let rawOpen = $state(false);
	let rawItem = $state<any>(null);

	let catFilter = $state('__all__');
	let statusFilter = $state('__all__');
	let dateFrom = $state('');
	let dateTo = $state('');

	const filtered = $derived(
		expenses.filter((e) => {
			if (catFilter !== '__all__' && e.data.category !== catFilter) return false;
			if (statusFilter !== '__all__' && e.data.status !== statusFilter) return false;
			if (dateFrom && new Date(e.data.occurredAt) < new Date(dateFrom)) return false;
			if (dateTo) {
				const to = new Date(dateTo);
				to.setHours(23, 59, 59, 999);
				if (new Date(e.data.occurredAt) > to) return false;
			}
			return true;
		})
	);

	const controls = createListControls<{ id: string; data: Expense }>({
		items: () => filtered,
		search: (e, q) =>
			(e.data.description ?? '').toLowerCase().includes(q) ||
			(e.data.payee ?? '').toLowerCase().includes(q),
		sortOptions: () => [
			{ key: 'date', label: 'Date', value: (e) => e.data.occurredAt },
			{ key: 'amount', label: 'Amount', value: (e) => e.data.amount },
			{ key: 'category', label: 'Category', value: (e) => e.data.category }
		],
		defaultSortKey: 'date',
		defaultSortDir: 'desc',
		defaultViewMode: 'table',
		storageKey: 'expenses'
	});

	const totalOut = $derived(
		expenses.filter((e) => e.data.status !== 'cancelled').reduce((s, e) => s + e.data.amount, 0)
	);
	const monthOut = $derived(
		expenses
			.filter(
				(e) =>
					e.data.status !== 'cancelled' &&
					new Date(e.data.occurredAt).getMonth() === new Date().getMonth()
			)
			.reduce((s, e) => s + e.data.amount, 0)
	);

	const STATUS_OPTIONS = [
		{ value: '__all__', label: 'All statuses' },
		{ value: 'draft', label: 'Draft' },
		{ value: 'submitted', label: 'Submitted' },
		{ value: 'approved', label: 'Approved' },
		{ value: 'paid', label: 'Paid' },
		{ value: 'cancelled', label: 'Cancelled' }
	];

	// Create dialog
	let open = $state(false);
	let desc = $state('');
	let amount = $state<number | ''>('');
	let cat = $state<ExpenseCategory>('other');
	let payee = $state('');
	let method = $state<'cash' | 'bank' | 'card' | 'other'>('cash');
	let expStatus = $state<ExpenseStatus>('paid');
	let receiptUrl = $state('');
	let expDate = $state(new Date().toISOString().slice(0, 10));

	function openCreate() {
		desc = '';
		amount = '';
		cat = 'other';
		payee = '';
		method = 'cash';
		expStatus = 'draft';
		receiptUrl = '';
		expDate = new Date().toISOString().slice(0, 10);
		open = true;
	}

	async function save() {
		if (!desc.trim()) return toast.warning('Description required');
		await glo.upsert<Expense>(
			TYPE.expense,
			{
				number: nextReadableNumber({ prefix: 'EXP', scope: tenant.state.locationId }),
				description: desc.trim(),
				category: cat,
				amount: typeof amount === 'number' ? amount : Number(amount) || 0,
				currency,
				payee: payee.trim() || undefined,
				status: expStatus,
				method,
				reference: receiptUrl.trim() || undefined,
				occurredAt: new Date(expDate).toISOString()
			},
			{ id: newRecordId('expense') }
		);
		toast.success('Expense recorded');
		open = false;
	}

	// Edit dialog
	let editOpen = $state(false);
	let editId = $state('');
	let editDesc = $state('');
	let editAmount = $state<number | ''>('');
	let editCat = $state<ExpenseCategory>('other');
	let editPayee = $state('');
	let editMethod = $state<'cash' | 'bank' | 'card' | 'other'>('cash');
	let editStatus = $state<ExpenseStatus>('paid');
	let editReceiptUrl = $state('');
	let editDate = $state('');

	function openEdit(e: { id: string; data: Expense }) {
		editId = e.id;
		editDesc = e.data.description ?? '';
		editAmount = e.data.amount ?? 0;
		editCat = e.data.category;
		editPayee = e.data.payee ?? '';
		editMethod = (e.data.method as 'cash' | 'bank' | 'card' | 'other') ?? 'cash';
		editStatus = e.data.status;
		editReceiptUrl = e.data.reference ?? '';
		editDate = e.data.occurredAt ? new Date(e.data.occurredAt).toISOString().slice(0, 10) : '';
		editOpen = true;
	}

	async function saveEdit() {
		if (!editDesc.trim()) return toast.warning('Description required');
		const existing = expenses.find((expense) => expense.id === editId);
		await glo.upsert<Expense>(
			TYPE.expense,
			{
				number:
					existing?.data.number ??
					nextReadableNumber({ prefix: 'EXP', scope: tenant.state.locationId }),
				description: editDesc.trim(),
				category: editCat,
				amount: typeof editAmount === 'number' ? editAmount : Number(editAmount) || 0,
				currency,
				payee: editPayee.trim() || undefined,
				status: editStatus,
				method: editMethod,
				reference: editReceiptUrl.trim() || undefined,
				occurredAt: editDate ? new Date(editDate).toISOString() : new Date().toISOString()
			},
			{ id: editId }
		);
		toast.success('Expense updated');
		editOpen = false;
	}

	function catMeta(c: ExpenseCategory) {
		return (
			EXPENSE_CATEGORIES.find((x) => x.value === c) ??
			EXPENSE_CATEGORIES[EXPENSE_CATEGORIES.length - 1]
		);
	}

	function clearFilters() {
		catFilter = '__all__';
		statusFilter = '__all__';
		dateFrom = '';
		dateTo = '';
	}

	const hasActiveFilters = $derived(
		catFilter !== '__all__' || statusFilter !== '__all__' || dateFrom !== '' || dateTo !== ''
	);
</script>

<svelte:head><title>BNOS · Expenses</title></svelte:head>

<div class="space-y-4">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h1 class="font-display text-xl font-bold tracking-tight">Expenses</h1>
			<p class="text-[12.5px] text-[var(--ui-text-muted)]">Outgoing costs · kind 30802</p>
		</div>
		<Button color="primary" icon="lucide:plus" onclick={openCreate}>Add expense</Button>
	</div>

	<div class="grid grid-cols-3 gap-3">
		<div class="surface-card p-4">
			<div class="text-[11px] font-semibold text-[var(--ui-text-dimmed)]">Total out</div>
			<div class="mt-1 font-display text-lg font-bold tabular-nums">
				{formatMoney(totalOut, currency)}
			</div>
		</div>
		<div class="surface-card p-4">
			<div class="text-[11px] font-semibold text-[var(--ui-text-dimmed)]">This month</div>
			<div class="mt-1 font-display text-lg font-bold tabular-nums">
				{formatMoney(monthOut, currency)}
			</div>
		</div>
		<div class="surface-card p-4">
			<div class="text-[11px] font-semibold text-[var(--ui-text-dimmed)]">Entries</div>
			<div class="mt-1 font-display text-lg font-bold tabular-nums">{expenses.length}</div>
		</div>
	</div>

	{#if expenses.length || controls.search}
		<ListToolbar
			bind:search={controls.search}
			bind:sortKey={controls.sortKey}
			bind:sortDir={controls.sortDir}
			viewMode={controls.viewMode}
			sortItems={controls.sortItems}
			allowViewModes={['table']}
			applySort={controls.applySort}
			searchPlaceholder="Search description or payee…"
		>
			{#snippet filters()}
				<div class="flex flex-wrap items-center gap-2">
					<div
						class="relative inline-flex items-center rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)]"
					>
						<select
							bind:value={catFilter}
							class="h-9 appearance-none rounded-lg bg-transparent py-0 pr-8 pl-3 text-[13px] font-medium focus:outline-none"
						>
							<option value="__all__">All categories</option>
							{#each EXPENSE_CATEGORIES as c (c.value)}
								<option value={c.value}>{c.label}</option>
							{/each}
						</select>
						<Icon
							name="lucide:chevron-down"
							class="pointer-events-none absolute right-2 size-3.5 text-[var(--ui-text-dimmed)]"
						/>
					</div>
					<div
						class="relative inline-flex items-center rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)]"
					>
						<select
							bind:value={statusFilter}
							class="h-9 appearance-none rounded-lg bg-transparent py-0 pr-8 pl-3 text-[13px] font-medium focus:outline-none"
						>
							{#each STATUS_OPTIONS as s (s.value)}
								<option value={s.value}>{s.label}</option>
							{/each}
						</select>
						<Icon
							name="lucide:chevron-down"
							class="pointer-events-none absolute right-2 size-3.5 text-[var(--ui-text-dimmed)]"
						/>
					</div>
					<input
						type="date"
						bind:value={dateFrom}
						class="h-9 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-3 text-[13px] font-medium text-[var(--ui-text)] focus:border-[var(--ui-color-primary-500)] focus:outline-none"
						placeholder="From"
					/>
					<span class="text-[12px] text-[var(--ui-text-dimmed)]">→</span>
					<input
						type="date"
						bind:value={dateTo}
						class="h-9 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-3 text-[13px] font-medium text-[var(--ui-text)] focus:border-[var(--ui-color-primary-500)] focus:outline-none"
						placeholder="To"
					/>
					{#if hasActiveFilters}
						<button
							type="button"
							onclick={clearFilters}
							class="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]"
						>
							<Icon name="lucide:x" class="size-3.5" />
							Clear
						</button>
					{/if}
				</div>
			{/snippet}
		</ListToolbar>
	{/if}

	{#if controls.list.length === 0}
		<EmptyState
			icon="lucide:wallet"
			title="No expenses"
			description="Record rent, supplies, salaries and more."
		>
			{#snippet actions()}
				<Button color="primary" size="sm" icon="lucide:plus" onclick={openCreate}
					>Add expense</Button
				>
			{/snippet}
		</EmptyState>
	{:else}
		<div class="data-panel">
			<table class="table-surface w-full text-left">
				<thead>
					<tr>
						<SortableTh
							column="date"
							active={controls.sortKey === 'date'}
							direction={controls.sortDir}
							applySort={controls.applySort}>Date</SortableTh
						>
						<th class="px-5 py-2.5">Description</th>
						<SortableTh
							column="category"
							active={controls.sortKey === 'category'}
							direction={controls.sortDir}
							applySort={controls.applySort}>Category</SortableTh
						>
						<th class="px-5 py-2.5">Status</th>
						<th class="px-5 py-2.5">Receipt</th>
						<SortableTh
							column="amount"
							active={controls.sortKey === 'amount'}
							direction={controls.sortDir}
							align="right"
							applySort={controls.applySort}>Amount</SortableTh
						>
						<th class="w-10 px-5 py-2.5"></th>
					</tr>
				</thead>
				<tbody class="divide-y divide-[var(--ui-border-muted)] text-[13px]">
					{#each controls.pagedList as e (e.id)}
						<tr>
							<td class="px-5 py-3 text-[12px] text-[var(--ui-text-dimmed)]"
								>{relativeTime(e.data.occurredAt)}</td
							>
							<td class="px-5 py-3">
								<div class="font-semibold">{e.data.description}</div>
								{#if e.data.payee}
									<div class="text-[11px] text-[var(--ui-text-dimmed)]">{e.data.payee}</div>
								{/if}
							</td>
							<td class="px-5 py-3">
								<span class="inline-flex items-center gap-1">
									<Icon
										name={catMeta(e.data.category).icon}
										class="size-3.5 text-[var(--ui-text-dimmed)]"
									/>
									{catMeta(e.data.category).label}
								</span>
							</td>
							<td class="px-5 py-3"
								><Badge color={statusColor(e.data.status)}>{e.data.status}</Badge></td
							>
							<td class="px-5 py-3">
								{#if e.data.reference}
									<a
										href={e.data.reference}
										target="_blank"
										rel="noopener"
										class="inline-flex items-center gap-1 text-[12px] font-medium text-primary-600 hover:underline dark:text-primary-400"
									>
										<Icon name="lucide:paperclip" class="size-3.5" />
										View
									</a>
								{:else}
									<span class="text-[var(--ui-text-dimmed)]">—</span>
								{/if}
							</td>
							<td
								class="px-5 py-3 text-right font-semibold text-[var(--tone-error-text)] tabular-nums"
							>
								−{formatMoney(e.data.amount, e.data.currency || currency)}
							</td>
							<td class="px-5 py-3 text-right">
								<RowActions
									actions={[
										[
											{
												label: 'Edit',
												icon: 'lucide:pencil',
												onSelect: () => openEdit({ id: e.id, data: e.data })
											},
											{
												label: 'View raw',
												icon: 'lucide:code',
												onSelect: () => {
													rawItem = glo.get('expense', e.id);
													rawOpen = true;
												}
											}
										],
										[
											{
												label: 'Delete',
												icon: 'lucide:trash-2',
												danger: true,
												onSelect: () => {
													glo.remove(TYPE.expense, e.id);
													toast.info('Removed');
												}
											}
										]
									]}
								/>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
			<Pagination {controls} />
		</div>
	{/if}
</div>

<!-- Create Dialog -->
<Dialog bind:open title="Add expense" size="lg">
	<div class="space-y-3">
		<label class="block">
			<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
				>Description</span
			>
			<Input bind:value={desc} class="w-full" />
		</label>
		<div class="grid grid-cols-2 gap-3">
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
					>Amount ({currency})</span
				>
				<Input bind:value={amount} type="number" min="0" step="0.01" class="w-full" />
			</label>
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
					>Category</span
				>
				<Select
					bind:value={cat}
					options={EXPENSE_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
					class="w-full"
				/>
			</label>
		</div>
		<div class="grid grid-cols-2 gap-3">
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Payee</span
				>
				<Input bind:value={payee} class="w-full" />
			</label>
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
					>Method</span
				>
				<Select
					bind:value={method}
					options={[
						{ value: 'cash', label: 'Cash' },
						{ value: 'bank', label: 'Bank' },
						{ value: 'card', label: 'Card' },
						{ value: 'other', label: 'Other' }
					]}
					class="w-full"
				/>
			</label>
		</div>
		<div class="grid grid-cols-2 gap-3">
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Date</span>
				<input
					type="date"
					bind:value={expDate}
					class="h-9.5 w-full rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-3 text-[13.5px] text-[var(--ui-text)] focus:border-[var(--ui-color-primary-500)] focus:outline-none"
				/>
			</label>
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
					>Status</span
				>
				<Select
					bind:value={expStatus}
					options={[
						{ value: 'draft', label: 'Draft' },
						{ value: 'submitted', label: 'Submitted' },
						{ value: 'approved', label: 'Approved' },
						{ value: 'paid', label: 'Paid' },
						{ value: 'cancelled', label: 'Cancelled' }
					]}
					class="w-full"
				/>
			</label>
		</div>
		<label class="block">
			<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
				>Receipt URL</span
			>
			<Input
				bind:value={receiptUrl}
				icon="lucide:paperclip"
				placeholder="https://…"
				class="w-full"
			/>
		</label>
	</div>
	{#snippet footer()}
		<Button color="neutral" variant="ghost" onclick={() => (open = false)}>Cancel</Button>
		<Button color="primary" icon="lucide:check" onclick={save}>Save</Button>
	{/snippet}
</Dialog>

<!-- Edit Dialog -->
<Dialog bind:open={editOpen} title="Edit expense" size="lg">
	<div class="space-y-3">
		<label class="block">
			<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
				>Description</span
			>
			<Input bind:value={editDesc} class="w-full" />
		</label>
		<div class="grid grid-cols-2 gap-3">
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
					>Amount ({currency})</span
				>
				<Input bind:value={editAmount} type="number" min="0" step="0.01" class="w-full" />
			</label>
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
					>Category</span
				>
				<Select
					bind:value={editCat}
					options={EXPENSE_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
					class="w-full"
				/>
			</label>
		</div>
		<div class="grid grid-cols-2 gap-3">
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Payee</span
				>
				<Input bind:value={editPayee} class="w-full" />
			</label>
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
					>Method</span
				>
				<Select
					bind:value={editMethod}
					options={[
						{ value: 'cash', label: 'Cash' },
						{ value: 'bank', label: 'Bank' },
						{ value: 'card', label: 'Card' },
						{ value: 'other', label: 'Other' }
					]}
					class="w-full"
				/>
			</label>
		</div>
		<div class="grid grid-cols-2 gap-3">
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Date</span>
				<input
					type="date"
					bind:value={editDate}
					class="h-9.5 w-full rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-3 text-[13.5px] text-[var(--ui-text)] focus:border-[var(--ui-color-primary-500)] focus:outline-none"
				/>
			</label>
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
					>Status</span
				>
				<Select
					bind:value={editStatus}
					options={[
						{ value: 'draft', label: 'Draft' },
						{ value: 'submitted', label: 'Submitted' },
						{ value: 'approved', label: 'Approved' },
						{ value: 'paid', label: 'Paid' },
						{ value: 'cancelled', label: 'Cancelled' }
					]}
					class="w-full"
				/>
			</label>
		</div>
		<label class="block">
			<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
				>Receipt URL</span
			>
			<Input
				bind:value={editReceiptUrl}
				icon="lucide:paperclip"
				placeholder="https://…"
				class="w-full"
			/>
		</label>
	</div>
	{#snippet footer()}
		<Button color="neutral" variant="ghost" onclick={() => (editOpen = false)}>Cancel</Button>
		<Button color="primary" icon="lucide:check" onclick={saveEdit}>Save changes</Button>
	{/snippet}
</Dialog>

<RawDataDialog bind:open={rawOpen} data={rawItem} title="Expense Raw Data" />
