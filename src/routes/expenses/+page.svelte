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
	import { tenant } from '$nostr/tenant.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatMoney, relativeTime } from '$lib/utils/format';
	import { TYPE, statusColor, EXPENSE_CATEGORIES, type Expense, type ExpenseCategory } from '$lib/domain';

	onMount(() => { glo.hydrate(TYPE.expense); void glo.sync(TYPE.expense); });

	const currency = $derived(tenant.state.currency);
	const expenses = $derived(glo.all<Expense, typeof TYPE.expense>(TYPE.expense));

	let catFilter = $state('__all__');
	const filtered = $derived(expenses.filter((e) => catFilter === '__all__' || e.data.category === catFilter));
	const controls = createListControls<{ id: string; data: Expense }>({
		items: () => filtered,
		search: (e, q) => (e.data.description ?? '').toLowerCase().includes(q),
		sortOptions: () => [
			{ key: 'date', label: 'Date', value: (e) => e.data.occurredAt },
			{ key: 'amount', label: 'Amount', value: (e) => e.data.amount },
			{ key: 'category', label: 'Category', value: (e) => e.data.category }
		],
		defaultSortKey: 'date', defaultSortDir: 'desc', defaultViewMode: 'table', storageKey: 'expenses'
	});

	const totalOut = $derived(expenses.filter((e) => e.data.status !== 'cancelled').reduce((s, e) => s + e.data.amount, 0));
	const monthOut = $derived(expenses.filter((e) => e.data.status !== 'cancelled' && new Date(e.data.occurredAt).getMonth() === new Date().getMonth()).reduce((s, e) => s + e.data.amount, 0));

	let open = $state(false);
	let desc = $state(''); let amount = $state<number | ''>(''); let cat = $state<ExpenseCategory>('other'); let payee = $state(''); let method = $state<'cash' | 'bank' | 'card' | 'other'>('cash');

	function openCreate() { desc = ''; amount = ''; cat = 'other'; payee = ''; method = 'cash'; open = true; }
	async function save() {
		if (!desc.trim()) return toast.warning('Description required');
		await glo.upsert<Expense>(TYPE.expense, { number: 'EXP-' + Date.now().toString().slice(-6), description: desc.trim(), category: cat, amount: typeof amount === 'number' ? amount : Number(amount) || 0, currency, payee: payee.trim() || undefined, status: 'paid', method, occurredAt: new Date().toISOString() });
		toast.success('Expense recorded'); open = false;
	}
	function catMeta(c: ExpenseCategory) { return EXPENSE_CATEGORIES.find((x) => x.value === c) ?? EXPENSE_CATEGORIES[EXPENSE_CATEGORIES.length - 1]; }
</script>

<svelte:head><title>bdGo OS · Expenses</title></svelte:head>

<div class="space-y-4">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h1 class="font-display text-xl font-bold tracking-tight">Expenses</h1>
			<p class="text-[12.5px] text-[var(--ui-text-muted)]">Outgoing costs · kind 30802</p>
		</div>
		<Button color="primary" icon="lucide:plus" onclick={openCreate}>Add expense</Button>
	</div>

	<div class="grid grid-cols-3 gap-3">
		<div class="surface-card p-4"><div class="text-[11px] font-semibold text-[var(--ui-text-dimmed)]">Total out</div><div class="mt-1 font-display text-lg font-bold tabular-nums">{formatMoney(totalOut, currency)}</div></div>
		<div class="surface-card p-4"><div class="text-[11px] font-semibold text-[var(--ui-text-dimmed)]">This month</div><div class="mt-1 font-display text-lg font-bold tabular-nums">{formatMoney(monthOut, currency)}</div></div>
		<div class="surface-card p-4"><div class="text-[11px] font-semibold text-[var(--ui-text-dimmed)]">Entries</div><div class="mt-1 font-display text-lg font-bold tabular-nums">{expenses.length}</div></div>
	</div>

	{#if expenses.length || controls.search}
		<ListToolbar bind:search={controls.search} bind:sortKey={controls.sortKey} bind:sortDir={controls.sortDir} viewMode={controls.viewMode} sortItems={controls.sortItems} allowViewModes={['table']} applySort={controls.applySort} searchPlaceholder="Search description or payee…">
			{#snippet filters()}
				<div class="relative inline-flex items-center rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)]">
					<select bind:value={catFilter} class="h-9 appearance-none rounded-lg bg-transparent py-0 pr-8 pl-3 text-[13px] font-medium focus:outline-none">
						<option value="__all__">All categories</option>
						{#each EXPENSE_CATEGORIES as c (c.value)}<option value={c.value}>{c.label}</option>{/each}
					</select>
					<Icon name="lucide:chevron-down" class="pointer-events-none absolute right-2 size-3.5 text-[var(--ui-text-dimmed)]" />
				</div>
			{/snippet}
		</ListToolbar>
	{/if}

	{#if controls.list.length === 0}
		<EmptyState icon="lucide:wallet" title="No expenses" description="Record rent, supplies, salaries and more.">
			{#snippet actions()}<Button color="primary" size="sm" icon="lucide:plus" onclick={openCreate}>Add expense</Button>{/snippet}
		</EmptyState>
	{:else}
		<div class="data-panel">
			<table class="table-surface w-full text-left">
				<thead><tr>
					<SortableTh column="date" active={controls.sortKey === 'date'} direction={controls.sortDir} applySort={controls.applySort}>Date</SortableTh>
					<th class="px-5 py-2.5">Description</th>
					<SortableTh column="category" active={controls.sortKey === 'category'} direction={controls.sortDir} applySort={controls.applySort}>Category</SortableTh>
					<th class="px-5 py-2.5">Status</th>
					<SortableTh column="amount" active={controls.sortKey === 'amount'} direction={controls.sortDir} align="right" applySort={controls.applySort}>Amount</SortableTh>
					<th class="w-10 px-5 py-2.5"></th>
				</tr></thead>
				<tbody class="divide-y divide-[var(--ui-border-muted)] text-[13px]">
					{#each controls.pagedList as e (e.id)}
						<tr>
							<td class="px-5 py-3 text-[12px] text-[var(--ui-text-dimmed)]">{relativeTime(e.data.occurredAt)}</td>
							<td class="px-5 py-3"><div class="font-semibold">{e.data.description}</div>{#if e.data.payee}<div class="text-[11px] text-[var(--ui-text-dimmed)]">{e.data.payee}</div>{/if}</td>
							<td class="px-5 py-3"><span class="inline-flex items-center gap-1"><Icon name={catMeta(e.data.category).icon} class="size-3.5 text-[var(--ui-text-dimmed)]" />{catMeta(e.data.category).label}</span></td>
							<td class="px-5 py-3"><Badge color={statusColor(e.data.status)}>{e.data.status}</Badge></td>
							<td class="px-5 py-3 text-right font-semibold tabular-nums text-[var(--tone-error-text)]">−{formatMoney(e.data.amount, e.data.currency || currency)}</td>
							<td class="px-5 py-3 text-right"><RowActions actions={[[{ label: 'Delete', icon: 'lucide:trash-2', danger: true, onSelect: () => { glo.remove(TYPE.expense, e.id); toast.info('Removed'); } }]]} /></td>
						</tr>
					{/each}
				</tbody>
			</table>
			<Pagination controls={controls} />
		</div>
	{/if}
</div>

<Dialog bind:open={open} title="Add expense">
	<div class="space-y-3">
		<label class="block"><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Description</span><Input bind:value={desc} class="w-full" /></label>
		<div class="grid grid-cols-2 gap-3">
			<label class="block"><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Amount ({currency})</span><Input bind:value={amount} type="number" min="0" step="0.01" class="w-full" /></label>
			<label class="block"><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Category</span>
				<Select bind:value={cat} options={EXPENSE_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))} class="w-full" />
			</label>
		</div>
		<div class="grid grid-cols-2 gap-3">
			<label class="block"><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Payee</span><Input bind:value={payee} class="w-full" /></label>
			<label class="block"><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Method</span>
				<Select bind:value={method} options={[{ value: 'cash', label: 'Cash' }, { value: 'bank', label: 'Bank' }, { value: 'card', label: 'Card' }, { value: 'other', label: 'Other' }]} class="w-full" />
			</label>
		</div>
	</div>
	{#snippet footer()}<Button color="neutral" variant="ghost" onclick={() => (open = false)}>Cancel</Button><Button color="primary" icon="lucide:check" onclick={save}>Save</Button>{/snippet}
</Dialog>
