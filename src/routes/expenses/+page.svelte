<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteDate } from 'svelte/reactivity';
	import { t } from '$lib/i18n/i18n.svelte';
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
	import RawDataDialog from '$lib/components/ui/RawDataDialog.svelte';
	import { createListControls } from '$lib/utils/list.svelte';
	import { glo } from '$nostr/store.svelte';
	import { dataSync } from '$nostr/sync.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { confirm } from '$lib/stores/confirm.svelte';
	import { formatMoney, relativeTime, normalizeCurrencyCode } from '$lib/utils/format';
	import { newRecordId, nextReadableNumber } from '$lib/utils/record-id';
	import {
		TYPE,
		KIND,
		statusColor,
		statusLabel,
		EXPENSE_CATEGORIES,
		type Expense,
		type ExpenseCategory,
		type ExpenseStatus
	} from '$lib/domain';

	onMount(() => {
		dataSync.pageSync([TYPE.expense], { scope: 'expenses' });
	});

	const currency = $derived(tenant.state.currency);
	const displayCurrency = $derived(normalizeCurrencyCode(currency));
	const expenses = $derived(glo.all<Expense, typeof TYPE.expense>(TYPE.expense));

	function matchesCurrency(e: { data: Expense }): boolean {
		return normalizeCurrencyCode(e.data.currency || currency) === displayCurrency;
	}

	type PayMethod = 'cash' | 'bank' | 'card' | 'other';

	const METHOD_KEYS: { value: PayMethod; key: string }[] = [
		{ value: 'cash', key: 'expenses.methodCash' },
		{ value: 'bank', key: 'expenses.methodBank' },
		{ value: 'card', key: 'expenses.methodCard' },
		{ value: 'other', key: 'expenses.methodOther' }
	];

	const STATUS_VALUES: ExpenseStatus[] = [
		'draft',
		'submitted',
		'approved',
		'paid',
		'pending',
		'cancelled'
	];

	function catLabel(c: ExpenseCategory): string {
		return t(`expense.category.${c}`);
	}
	function catIcon(c: ExpenseCategory): string {
		return (
			EXPENSE_CATEGORIES.find((x) => x.value === c) ??
			EXPENSE_CATEGORIES[EXPENSE_CATEGORIES.length - 1]
		).icon;
	}

	// Filters
	let catFilter = $state('__all__');
	let statusFilter = $state('__all__');
	let dateFrom = $state('');
	let dateTo = $state('');

	const categoryFilterOptions = $derived([
		{ value: '__all__', label: t('expenses.allCategories') },
		...EXPENSE_CATEGORIES.map((c) => ({ value: c.value, label: catLabel(c.value) }))
	]);
	const statusFilterOptions = $derived([
		{ value: '__all__', label: t('expenses.allStatuses') },
		...STATUS_VALUES.map((s) => ({ value: s, label: statusLabel(s) }))
	]);

	const filtered = $derived(
		expenses.filter((e) => {
			if (catFilter !== '__all__' && e.data.category !== catFilter) return false;
			if (statusFilter !== '__all__' && e.data.status !== statusFilter) return false;
			if (dateFrom && new Date(e.data.occurredAt) < new Date(dateFrom)) return false;
			if (dateTo) {
				const to = new SvelteDate(dateTo);
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
			(e.data.payee ?? '').toLowerCase().includes(q) ||
			(e.data.number ?? '').toLowerCase().includes(q),
		sortOptions: () => [
			{ key: 'date', label: t('common.date'), value: (e) => e.data.occurredAt },
			{ key: 'amount', label: t('common.amount'), value: (e) => e.data.amount },
			{ key: 'category', label: t('common.category'), value: (e) => e.data.category }
		],
		defaultSortKey: 'date',
		defaultSortDir: 'desc',
		defaultViewMode: 'table',
		storageKey: 'expenses'
	});

	// Totals reflect the currently visible (filtered + searched) set, restricted
	// to the active currency so mixed-currency sums stay correct.
	const scoped = $derived(controls.list);
	const totalOut = $derived(
		scoped
			.filter((e) => e.data.status !== 'cancelled' && matchesCurrency(e))
			.reduce((s, e) => s + e.data.amount, 0)
	);
	const monthOut = $derived(
		scoped
			.filter((e) => {
				if (e.data.status === 'cancelled' || !matchesCurrency(e)) return false;
				const d = new Date(e.data.occurredAt);
				const now = new Date();
				return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
			})
			.reduce((s, e) => s + e.data.amount, 0)
	);
	const entries = $derived(scoped.length);
	const mixedCurrencyCount = $derived(expenses.filter((e) => !matchesCurrency(e)).length);

	const hasActiveFilters = $derived(
		catFilter !== '__all__' ||
			statusFilter !== '__all__' ||
			dateFrom !== '' ||
			dateTo !== '' ||
			controls.search !== ''
	);

	function clearFilters() {
		catFilter = '__all__';
		statusFilter = '__all__';
		dateFrom = '';
		dateTo = '';
		controls.search = '';
	}

	function todayInput(): string {
		return new Date().toISOString().slice(0, 10);
	}

	// Create / edit dialog — one form, `editingId` switches the mode.
	let open = $state(false);
	let editingId = $state<string | null>(null);
	let desc = $state('');
	let amount = $state<number | ''>('');
	let cat = $state<ExpenseCategory>('other');
	let payee = $state('');
	let method = $state<PayMethod>('cash');
	let expStatus = $state<ExpenseStatus>('paid');
	let receiptUrl = $state('');
	let expDate = $state('');
	const isEditing = $derived(editingId !== null);

	function openCreate() {
		editingId = null;
		desc = '';
		amount = '';
		cat = 'other';
		payee = '';
		method = 'cash';
		expStatus = 'paid';
		receiptUrl = '';
		expDate = todayInput();
		open = true;
	}

	function openEdit(e: { id: string; data: Expense }) {
		editingId = e.id;
		desc = e.data.description ?? '';
		amount = e.data.amount ?? 0;
		cat = e.data.category;
		payee = e.data.payee ?? '';
		method = (e.data.method as PayMethod) ?? 'cash';
		expStatus = e.data.status;
		receiptUrl = e.data.reference ?? '';
		expDate = e.data.occurredAt
			? new Date(e.data.occurredAt).toISOString().slice(0, 10)
			: todayInput();
		open = true;
	}

	function numericAmount(v: number | ''): number {
		const n = typeof v === 'number' ? v : Number(v);
		return Number.isFinite(n) ? n : 0;
	}

	async function save() {
		if (!desc.trim()) return toast.warning(t('expenses.descriptionRequired'));
		const amt = numericAmount(amount);
		if (amt <= 0) return toast.warning(t('expenses.amountRequired'));

		const editing = editingId !== null;
		const existing = editing ? expenses.find((x) => x.id === editingId) : undefined;
		await glo.upsert<Expense>(
			TYPE.expense,
			{
				number:
					existing?.data.number ??
					nextReadableNumber({ prefix: 'EXP', scope: tenant.state.locationId }),
				description: desc.trim(),
				category: cat,
				amount: amt,
				currency,
				payee: payee.trim() || undefined,
				status: expStatus,
				method,
				reference: receiptUrl.trim() || undefined,
				occurredAt: expDate ? new Date(expDate).toISOString() : new Date().toISOString()
			},
			{ id: editingId ?? newRecordId('expense') }
		);
		toast.success(editing ? t('expenses.updated') : t('expenses.recorded'));
		open = false;
	}

	async function removeExpense(e: { id: string; data: Expense }) {
		const ok = await confirm({
			title: t('expenses.deleteTitle'),
			message: t('expenses.deleteMsg'),
			detail: e.data.description,
			tone: 'danger',
			confirmText: t('common.delete')
		});
		if (!ok) return;
		glo.remove(TYPE.expense, e.id);
		toast.info(t('expenses.removed'));
	}

	function exportCsv() {
		const csvRows: string[][] = [
			[
				t('common.date'),
				t('common.code'),
				t('common.description'),
				t('common.category'),
				t('expenses.payee'),
				t('common.method'),
				t('common.status'),
				t('common.amount'),
				t('common.currency')
			]
		];
		for (const e of scoped) {
			const d = e.data;
			csvRows.push([
				d.occurredAt ? new Date(d.occurredAt).toISOString().slice(0, 10) : '',
				d.number ?? '',
				d.description ?? '',
				d.category ?? '',
				d.payee ?? '',
				d.method ?? '',
				d.status ?? '',
				String(d.amount ?? 0),
				d.currency ?? currency
			]);
		}
		const csv = csvRows
			.map((r) => r.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(','))
			.join('\n');
		const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `expenses_${new Date().toISOString().slice(0, 10)}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	}

	function fullDate(iso: string): string {
		const d = new Date(iso);
		return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString();
	}

	// Raw data viewer
	let rawOpen = $state(false);
	let rawItem = $state<unknown>(null);
</script>

<svelte:head><title>{t('common.appName')} · {t('nav.expenses')}</title></svelte:head>

<div class="space-y-4">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h1 class="font-display text-xl font-bold tracking-tight">{t('nav.expenses')}</h1>
			<p class="text-[12.5px] text-(--ui-text-muted)">
				{t('expenses.subtitle', { kind: KIND.expense })}
			</p>
		</div>
		<div class="flex items-center gap-2">
			<Button
				variant="subtle"
				size="sm"
				icon="lucide:download"
				disabled={scoped.length === 0}
				onclick={exportCsv}>{t('expenses.exportCsv')}</Button
			>
			<Button color="primary" icon="lucide:plus" onclick={openCreate}
				>{t('common.add') + ' ' + t('common.expense')}</Button
			>
		</div>
	</div>

	<div class="grid grid-cols-3 gap-3">
		<div class="surface-card p-4">
			<div class="text-[11px] font-semibold text-(--ui-text-dimmed)">{t('expenses.totalOut')}</div>
			<div class="mt-1 font-display text-lg font-bold tabular-nums">
				{formatMoney(totalOut, currency)}
			</div>
		</div>
		<div class="surface-card p-4">
			<div class="text-[11px] font-semibold text-(--ui-text-dimmed)">{t('common.thisMonth')}</div>
			<div class="mt-1 font-display text-lg font-bold tabular-nums">
				{formatMoney(monthOut, currency)}
			</div>
		</div>
		<div class="surface-card p-4">
			<div class="text-[11px] font-semibold text-(--ui-text-dimmed)">{t('expenses.entries')}</div>
			<div class="mt-1 font-display text-lg font-bold tabular-nums">{entries}</div>
		</div>
	</div>

	{#if mixedCurrencyCount > 0}
		<p class="flex items-center gap-1.5 text-[12px] text-(--ui-text-dimmed)">
			<Icon name="lucide:info" class="size-3.5" />
			{t('expenses.mixedCurrency', { count: mixedCurrencyCount })}
		</p>
	{/if}

	{#if expenses.length || hasActiveFilters}
		<ListToolbar
			bind:search={controls.search}
			bind:sortKey={controls.sortKey}
			bind:sortDir={controls.sortDir}
			viewMode={controls.viewMode}
			sortItems={controls.sortItems}
			allowViewModes={['table']}
			applySort={controls.applySort}
			searchPlaceholder={t('expenses.searchPlaceholder')}
		>
			{#snippet filters()}
				<div class="flex flex-wrap items-center gap-2">
					<Select
						class="w-auto"
						aria-label={t('expenses.allCategories')}
						bind:value={catFilter}
						options={categoryFilterOptions}
					/>
					<Select
						class="w-auto"
						aria-label={t('expenses.allStatuses')}
						bind:value={statusFilter}
						options={statusFilterOptions}
					/>
					<input
						type="date"
						bind:value={dateFrom}
						aria-label={t('common.date')}
						class="h-9.5 rounded-lg border border-(--ui-border) bg-(--ui-bg-muted) px-3 text-[13px] font-medium text-(--ui-text) focus:border-(--ui-color-primary-500) focus:outline-none"
					/>
					<span class="text-[12px] text-(--ui-text-dimmed)">→</span>
					<input
						type="date"
						bind:value={dateTo}
						aria-label={t('common.date')}
						class="h-9.5 rounded-lg border border-(--ui-border) bg-(--ui-bg-muted) px-3 text-[13px] font-medium text-(--ui-text) focus:border-(--ui-color-primary-500) focus:outline-none"
					/>
					{#if hasActiveFilters}
						<button
							type="button"
							onclick={clearFilters}
							class="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold text-(--ui-text-muted) hover:bg-(--ui-bg-accented) hover:text-(--ui-text)"
						>
							<Icon name="lucide:x" class="size-3.5" />
							{t('common.clear')}
						</button>
					{/if}
				</div>
			{/snippet}
		</ListToolbar>
	{/if}

	{#if expenses.length === 0}
		<EmptyState
			icon="lucide:wallet"
			title={t('expenses.noExpenses')}
			description={t('expenses.noExpensesDesc')}
		>
			{#snippet actions()}
				<Button color="primary" size="sm" icon="lucide:plus" onclick={openCreate}
					>{t('common.add') + ' ' + t('common.expense')}</Button
				>
			{/snippet}
		</EmptyState>
	{:else if controls.list.length === 0}
		<EmptyState
			icon="lucide:search-x"
			title={t('expenses.noMatching')}
			description={t('common.tryDifferentSearch')}
		>
			{#snippet actions()}
				<Button variant="subtle" size="sm" icon="lucide:filter-x" onclick={clearFilters}
					>{t('common.resetFilters')}</Button
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
							applySort={controls.applySort}>{t('common.date')}</SortableTh
						>
						<th class="px-5 py-2.5">{t('common.description')}</th>
						<SortableTh
							column="category"
							active={controls.sortKey === 'category'}
							direction={controls.sortDir}
							applySort={controls.applySort}>{t('common.category')}</SortableTh
						>
						<th class="px-5 py-2.5">{t('common.status')}</th>
						<th class="px-5 py-2.5">{t('settings.receipt')}</th>
						<SortableTh
							column="amount"
							active={controls.sortKey === 'amount'}
							direction={controls.sortDir}
							align="right"
							applySort={controls.applySort}>{t('common.amount')}</SortableTh
						>
						<th class="w-10 px-5 py-2.5"></th>
					</tr>
				</thead>
				<tbody class="divide-y divide-(--ui-border-muted) text-[13px]">
					{#each controls.pagedList as e (e.id)}
						<tr>
							<td
								class="px-5 py-3 text-[12px] text-(--ui-text-dimmed)"
								title={fullDate(e.data.occurredAt)}>{relativeTime(e.data.occurredAt)}</td
							>
							<td class="px-5 py-3">
								<div class="font-semibold">{e.data.description}</div>
								{#if e.data.payee}
									<div class="text-[11px] text-(--ui-text-dimmed)">{e.data.payee}</div>
								{/if}
							</td>
							<td class="px-5 py-3">
								<span class="inline-flex items-center gap-1">
									<Icon name={catIcon(e.data.category)} class="size-3.5 text-(--ui-text-dimmed)" />
									{catLabel(e.data.category)}
								</span>
							</td>
							<td class="px-5 py-3"
								><Badge color={statusColor(e.data.status)}>{statusLabel(e.data.status)}</Badge></td
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
										{t('common.view')}
									</a>
								{:else}
									<span class="text-(--ui-text-dimmed)">—</span>
								{/if}
							</td>
							<td class="px-5 py-3 text-right font-semibold text-(--tone-error-text) tabular-nums">
								−{formatMoney(e.data.amount, e.data.currency || currency)}
							</td>
							<td class="px-5 py-3 text-right">
								<RowActions
									actions={[
										[
											{
												label: t('common.edit'),
												icon: 'lucide:pencil',
												onSelect: () => openEdit({ id: e.id, data: e.data })
											},
											{
												label: t('common.viewRaw'),
												icon: 'lucide:code',
												onSelect: () => {
													rawItem = glo.get('expense', e.id);
													rawOpen = true;
												}
											}
										],
										[
											{
												label: t('common.delete'),
												icon: 'lucide:trash-2',
												danger: true,
												onSelect: () => void removeExpense({ id: e.id, data: e.data })
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

<!-- Create / Edit Dialog -->
<Dialog
	bind:open
	title={(isEditing ? t('common.edit') : t('common.add')) + ' ' + t('common.expense')}
	size="lg"
>
	<div class="space-y-3">
		<div>
			<label for="exp-desc" class="mb-1.5 block text-[12px] font-semibold text-(--ui-text-muted)"
				>{t('common.description')}</label
			>
			<Input id="exp-desc" bind:value={desc} class="w-full" />
		</div>
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label
					for="exp-amount"
					class="mb-1.5 block text-[12px] font-semibold text-(--ui-text-muted)"
					>{t('common.amount')} ({currency})</label
				>
				<Input
					id="exp-amount"
					bind:value={amount}
					type="number"
					min="0"
					step="0.01"
					class="w-full"
				/>
			</div>
			<div>
				<label for="exp-cat" class="mb-1.5 block text-[12px] font-semibold text-(--ui-text-muted)"
					>{t('common.category')}</label
				>
				<Select
					id="exp-cat"
					bind:value={cat}
					options={EXPENSE_CATEGORIES.map((c) => ({ value: c.value, label: catLabel(c.value) }))}
					class="w-full"
				/>
			</div>
		</div>
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label for="exp-payee" class="mb-1.5 block text-[12px] font-semibold text-(--ui-text-muted)"
					>{t('expenses.payee')}</label
				>
				<Input
					id="exp-payee"
					bind:value={payee}
					placeholder={t('expenses.payeePlaceholder')}
					class="w-full"
				/>
			</div>
			<div>
				<label
					for="exp-method"
					class="mb-1.5 block text-[12px] font-semibold text-(--ui-text-muted)"
					>{t('common.method')}</label
				>
				<Select
					id="exp-method"
					bind:value={method}
					options={METHOD_KEYS.map((m) => ({ value: m.value, label: t(m.key) }))}
					class="w-full"
				/>
			</div>
		</div>
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label for="exp-date" class="mb-1.5 block text-[12px] font-semibold text-(--ui-text-muted)"
					>{t('common.date')}</label
				>
				<input
					id="exp-date"
					type="date"
					bind:value={expDate}
					class="h-9.5 w-full rounded-lg border border-(--ui-border) bg-(--ui-bg-muted) px-3 text-[13.5px] text-(--ui-text) focus:border-(--ui-color-primary-500) focus:outline-none"
				/>
			</div>
			<div>
				<label
					for="exp-status"
					class="mb-1.5 block text-[12px] font-semibold text-(--ui-text-muted)"
					>{t('common.status')}</label
				>
				<Select
					id="exp-status"
					bind:value={expStatus}
					options={STATUS_VALUES.map((s) => ({ value: s, label: statusLabel(s) }))}
					class="w-full"
				/>
			</div>
		</div>
		<div>
			<label for="exp-receipt" class="mb-1.5 block text-[12px] font-semibold text-(--ui-text-muted)"
				>{t('expenses.receiptUrl')}</label
			>
			<Input
				id="exp-receipt"
				bind:value={receiptUrl}
				icon="lucide:paperclip"
				placeholder={t('expenses.receiptPlaceholder')}
				class="w-full"
			/>
		</div>
	</div>
	{#snippet footer()}
		<Button color="neutral" variant="ghost" onclick={() => (open = false)}
			>{t('common.cancel')}</Button
		>
		<Button color="primary" icon="lucide:check" onclick={save}>
			{isEditing ? t('common.saveChanges') : t('common.save')}
		</Button>
	{/snippet}
</Dialog>

<RawDataDialog bind:open={rawOpen} data={rawItem} title={t('expenses.rawData')} />
