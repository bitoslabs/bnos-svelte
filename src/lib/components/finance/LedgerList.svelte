<script lang="ts">
	/* eslint-disable svelte/no-navigation-without-resolve -- external attachment URLs */
	/**
	 * Shared finance ledger table — drives both the Expenses and Income pages.
	 * All entity-specific behaviour (types, categories, field mapping, labels,
	 * amount sign/tone) is injected via {@link LedgerConfig}, so the two ledgers
	 * never fork. See `finance/ledger.ts`.
	 */
	import { onMount, untrack } from 'svelte';
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
	import { statusColor, statusLabel } from '$lib/domain';
	import type { LedgerConfig, LedgerValues } from './ledger';

	let { config }: { config: LedgerConfig } = $props();

	onMount(() => {
		dataSync.pageSync([config.type], { scope: config.scope });
	});

	const labels = $derived(config.labels);
	const displayCurrency = $derived(normalizeCurrencyCode(config.currency));
	const entries = $derived(glo.all<Record<string, unknown>>(config.type));

	function str(data: Record<string, unknown>, key: string): string {
		const v = data[key];
		return typeof v === 'string' ? v : '';
	}
	function amountOf(data: Record<string, unknown>): number {
		const n = Number(data.amount);
		return Number.isFinite(n) ? n : 0;
	}
	function matchesCurrency(data: Record<string, unknown>): boolean {
		return normalizeCurrencyCode(str(data, 'currency') || config.currency) === displayCurrency;
	}

	const categoryFilterOptions = $derived([
		{ value: '__all__', label: labels.allCategories },
		...config.categories.map((c) => ({ value: c.value, label: config.categoryLabel(c.value) }))
	]);
	const categoryFormOptions = $derived(
		config.categories.map((c) => ({ value: c.value, label: config.categoryLabel(c.value) }))
	);
	const statusFilterOptions = $derived([
		{ value: '__all__', label: labels.allStatuses },
		...config.statuses
	]);

	// Filters
	let catFilter = $state('__all__');
	let statusFilter = $state('__all__');
	let dateFrom = $state('');
	let dateTo = $state('');

	const filtered = $derived.by(() => {
		const fromMs = dateFrom ? new Date(dateFrom).getTime() : null;
		const to = dateTo ? new SvelteDate(dateTo) : null;
		if (to) to.setHours(23, 59, 59, 999);
		const toMs = to ? to.getTime() : null;
		return entries.filter((e) => {
			const d = e.data as Record<string, unknown>;
			if (catFilter !== '__all__' && str(d, 'category') !== catFilter) return false;
			if (statusFilter !== '__all__' && str(d, 'status') !== statusFilter) return false;
			const at = new Date(str(d, 'occurredAt')).getTime();
			if (fromMs !== null && at < fromMs) return false;
			if (toMs !== null && at > toMs) return false;
			return true;
		});
	});

	const controls = createListControls<{ id: string; data: Record<string, unknown> }>({
		items: () => filtered,
		search: (e, q) =>
			str(e.data, 'description').toLowerCase().includes(q) ||
			config.getParty(e.data).toLowerCase().includes(q) ||
			config.getNumber(e.data).toLowerCase().includes(q),
		sortOptions: () => [
			{ key: 'date', label: labels.date, value: (e) => str(e.data, 'occurredAt') },
			{ key: 'amount', label: labels.amount, value: (e) => amountOf(e.data) },
			{ key: 'category', label: labels.category, value: (e) => str(e.data, 'category') }
		],
		defaultSortKey: 'date',
		defaultSortDir: 'desc',
		defaultViewMode: 'table',
		storageKey: untrack(() => config.type)
	});

	// Totals reflect the visible (filtered + searched) set, restricted to the
	// active currency so mixed-currency sums stay correct.
	const scoped = $derived(controls.list);
	const totals = $derived.by(() => {
		const now = new Date();
		let totalOut = 0;
		let monthOut = 0;
		for (const e of scoped) {
			if (str(e.data, 'status') === 'cancelled' || !matchesCurrency(e.data)) continue;
			const amount = amountOf(e.data);
			totalOut += amount;
			const d = new Date(str(e.data, 'occurredAt'));
			if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) {
				monthOut += amount;
			}
		}
		return { totalOut, monthOut };
	});
	const entriesCount = $derived(scoped.length);
	const mixedCurrencyCount = $derived(
		entries.filter((e) => !matchesCurrency(e.data as Record<string, unknown>)).length
	);
	const mixedCurrencyText = $derived(t('finance.mixedCurrency', { count: mixedCurrencyCount }));

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
	let description = $state('');
	let amount = $state<number | ''>('');
	let category = $state('');
	let party = $state('');
	let method = $state('cash');
	let status = $state('paid');
	let reference = $state('');
	let occurredAt = $state('');
	const isEditing = $derived(editingId !== null);

	function openCreate() {
		editingId = null;
		description = '';
		amount = '';
		category = config.categories[config.categories.length - 1]?.value ?? 'other';
		party = '';
		method = config.methods[0]?.value ?? 'cash';
		status = 'paid';
		reference = '';
		occurredAt = todayInput();
		open = true;
	}

	function openEdit(entry: { id: string; data: Record<string, unknown> }) {
		editingId = entry.id;
		const v = config.readValues(entry.data);
		description = v.description;
		amount = v.amount;
		category = v.category;
		party = v.party;
		method = v.method;
		status = v.status;
		reference = v.reference;
		occurredAt = v.occurredAt;
		open = true;
	}

	function currentValues(): LedgerValues {
		const n = typeof amount === 'number' ? amount : Number(amount);
		return {
			description: description.trim(),
			amount: Number.isFinite(n) ? n : 0,
			category,
			party: party.trim(),
			method,
			status,
			reference: reference.trim(),
			occurredAt
		};
	}

	async function save() {
		if (!description.trim()) return toast.warning(labels.descRequiredMsg);
		const values = currentValues();
		if (values.amount <= 0) return toast.warning(labels.amountRequiredMsg);

		const editing = editingId !== null;
		const existing = editing ? entries.find((x) => x.id === editingId) : undefined;
		const existingNumber = existing ? config.getNumber(existing.data) : '';
		const number =
			existingNumber ||
			nextReadableNumber({ prefix: config.numberPrefix, scope: tenant.state.locationId });

		await glo.upsert(config.type, config.buildData(values, { currency: config.currency, number }), {
			id: editingId ?? newRecordId(config.scope)
		});
		toast.success(editing ? labels.updatedMsg : labels.createdMsg);
		open = false;
	}

	async function remove(entry: { id: string; data: Record<string, unknown> }) {
		const ok = await confirm({
			title: labels.deleteTitle,
			message: labels.deleteMsg,
			detail: str(entry.data, 'description'),
			tone: 'danger',
			confirmText: labels.delete || 'Delete'
		});
		if (!ok) return;
		glo.remove(config.type, entry.id);
		toast.info(labels.removedMsg);
	}

	function exportCsv() {
		const header = [
			'date',
			'number',
			'description',
			'category',
			'party',
			'method',
			'status',
			'amount',
			'currency'
		];
		const rows: string[][] = [header];
		for (const e of scoped) {
			const d = e.data;
			rows.push([
				str(d, 'occurredAt') ? new Date(str(d, 'occurredAt')).toISOString().slice(0, 10) : '',
				config.getNumber(d),
				str(d, 'description'),
				str(d, 'category'),
				config.getParty(d),
				str(d, 'method'),
				str(d, 'status'),
				String(amountOf(d)),
				str(d, 'currency') || config.currency
			]);
		}
		const csv = rows
			.map((r) => r.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(','))
			.join('\n');
		const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${labels.exportFilePrefix}_${new Date().toISOString().slice(0, 10)}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	}

	function fullDate(iso: string): string {
		const d = new Date(iso);
		return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString();
	}

	function catIcon(value: string): string {
		return config.categories.find((c) => c.value === value)?.icon ?? 'lucide:circle-dot';
	}

	// Raw data viewer
	let rawOpen = $state(false);
	let rawItem = $state<unknown>(null);
</script>

<div class="space-y-4">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h1 class="font-display text-xl font-bold tracking-tight">{labels.title}</h1>
			<p class="text-[12.5px] text-(--ui-text-muted)">{labels.subtitle}</p>
		</div>
		<div class="flex items-center gap-2">
			<Button
				variant="subtle"
				size="sm"
				icon="lucide:download"
				disabled={scoped.length === 0}
				onclick={exportCsv}>{labels.export}</Button
			>
			<Button color="primary" icon="lucide:plus" onclick={openCreate}>{labels.add}</Button>
		</div>
	</div>

	<div class="grid grid-cols-3 gap-3">
		<div class="surface-card p-4">
			<div class="text-[11px] font-semibold text-(--ui-text-dimmed)">{labels.totalOut}</div>
			<div class="mt-1 font-display text-lg font-bold tabular-nums">
				{formatMoney(totals.totalOut, config.currency)}
			</div>
		</div>
		<div class="surface-card p-4">
			<div class="text-[11px] font-semibold text-(--ui-text-dimmed)">{labels.thisMonth}</div>
			<div class="mt-1 font-display text-lg font-bold tabular-nums">
				{formatMoney(totals.monthOut, config.currency)}
			</div>
		</div>
		<div class="surface-card p-4">
			<div class="text-[11px] font-semibold text-(--ui-text-dimmed)">{labels.entries}</div>
			<div class="mt-1 font-display text-lg font-bold tabular-nums">{entriesCount}</div>
		</div>
	</div>

	{#if mixedCurrencyCount > 0}
		<p class="flex items-center gap-1.5 text-[12px] text-(--ui-text-dimmed)">
			<Icon name="lucide:info" class="size-3.5" />
			{mixedCurrencyText}
		</p>
	{/if}

	{#if entries.length || hasActiveFilters}
		<ListToolbar
			bind:search={controls.search}
			bind:sortKey={controls.sortKey}
			bind:sortDir={controls.sortDir}
			viewMode={controls.viewMode}
			sortItems={controls.sortItems}
			allowViewModes={['table']}
			applySort={controls.applySort}
			searchPlaceholder={labels.searchPlaceholder}
		>
			{#snippet filters()}
				<div class="flex flex-wrap items-center gap-2">
					<Select
						class="w-auto"
						aria-label={labels.allCategories}
						bind:value={catFilter}
						options={categoryFilterOptions}
					/>
					<Select
						class="w-auto"
						aria-label={labels.allStatuses}
						bind:value={statusFilter}
						options={statusFilterOptions}
					/>
					<input
						type="date"
						bind:value={dateFrom}
						aria-label={labels.date}
						class="h-9.5 rounded-lg border border-(--ui-border) bg-(--ui-bg-muted) px-3 text-[13px] font-medium text-(--ui-text) focus:border-(--ui-color-primary-500) focus:outline-none"
					/>
					<span class="text-[12px] text-(--ui-text-dimmed)">→</span>
					<input
						type="date"
						bind:value={dateTo}
						aria-label={labels.date}
						class="h-9.5 rounded-lg border border-(--ui-border) bg-(--ui-bg-muted) px-3 text-[13px] font-medium text-(--ui-text) focus:border-(--ui-color-primary-500) focus:outline-none"
					/>
					{#if hasActiveFilters}
						<button
							type="button"
							onclick={clearFilters}
							class="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold text-(--ui-text-muted) hover:bg-(--ui-bg-accented) hover:text-(--ui-text)"
						>
							<Icon name="lucide:x" class="size-3.5" />
							{labels.clear}
						</button>
					{/if}
				</div>
			{/snippet}
		</ListToolbar>
	{/if}

	{#if entries.length === 0}
		<EmptyState icon={config.emptyIcon} title={labels.noDataTitle} description={labels.noDataDesc}>
			{#snippet actions()}
				<Button color="primary" size="sm" icon="lucide:plus" onclick={openCreate}
					>{labels.add}</Button
				>
			{/snippet}
		</EmptyState>
	{:else if controls.list.length === 0}
		<EmptyState icon="lucide:search-x" title={labels.noMatchTitle} description={labels.noMatchDesc}>
			{#snippet actions()}
				<Button variant="subtle" size="sm" icon="lucide:filter-x" onclick={clearFilters}
					>{labels.resetFilters}</Button
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
							applySort={controls.applySort}>{labels.date}</SortableTh
						>
						<th class="px-5 py-2.5">{labels.description}</th>
						<SortableTh
							column="category"
							active={controls.sortKey === 'category'}
							direction={controls.sortDir}
							applySort={controls.applySort}>{labels.category}</SortableTh
						>
						<th class="px-5 py-2.5">{labels.status}</th>
						<th class="px-5 py-2.5">{labels.receiptUrl}</th>
						<SortableTh
							column="amount"
							active={controls.sortKey === 'amount'}
							direction={controls.sortDir}
							align="right"
							applySort={controls.applySort}>{labels.amount}</SortableTh
						>
						<th class="w-10 px-5 py-2.5"></th>
					</tr>
				</thead>
				<tbody class="divide-y divide-(--ui-border-muted) text-[13px]">
					{#each controls.pagedList as e (e.id)}
						<tr>
							<td
								class="px-5 py-3 text-[12px] text-(--ui-text-dimmed)"
								title={fullDate(str(e.data, 'occurredAt'))}
								>{relativeTime(str(e.data, 'occurredAt'))}</td
							>
							<td class="px-5 py-3">
								<div class="font-semibold">{str(e.data, 'description')}</div>
								{#if config.getParty(e.data)}
									<div class="text-[11px] text-(--ui-text-dimmed)">{config.getParty(e.data)}</div>
								{/if}
							</td>
							<td class="px-5 py-3">
								<span class="inline-flex items-center gap-1">
									<Icon
										name={catIcon(str(e.data, 'category'))}
										class="size-3.5 text-(--ui-text-dimmed)"
									/>
									{config.categoryLabel(str(e.data, 'category'))}
								</span>
							</td>
							<td class="px-5 py-3"
								><Badge color={statusColor(str(e.data, 'status'))}
									>{statusLabel(str(e.data, 'status'))}</Badge
								></td
							>
							<td class="px-5 py-3">
								{#if str(e.data, 'reference')}
									<a
										href={str(e.data, 'reference')}
										target="_blank"
										rel="noopener"
										class="inline-flex items-center gap-1 text-[12px] font-medium text-primary-600 hover:underline dark:text-primary-400"
									>
										<Icon name="lucide:paperclip" class="size-3.5" />
										{labels.view}
									</a>
								{:else}
									<span class="text-(--ui-text-dimmed)">—</span>
								{/if}
							</td>
							<td
								class="px-5 py-3 text-right font-semibold tabular-nums {config.tone === 'success'
									? 'text-(--tone-success-text)'
									: 'text-(--tone-error-text)'}"
							>
								{config.sign}{formatMoney(
									amountOf(e.data),
									str(e.data, 'currency') || config.currency
								)}
							</td>
							<td class="px-5 py-3 text-right">
								<RowActions
									actions={[
										[
											{
												label: labels.edit,
												icon: 'lucide:pencil',
												onSelect: () => openEdit({ id: e.id, data: e.data })
											},
											{
												label: labels.viewRaw,
												icon: 'lucide:code',
												onSelect: () => {
													rawItem = glo.get(config.type, e.id);
													rawOpen = true;
												}
											}
										],
										[
											{
												label: labels.delete,
												icon: 'lucide:trash-2',
												danger: true,
												onSelect: () => void remove({ id: e.id, data: e.data })
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
<Dialog bind:open title={isEditing ? labels.edit : labels.add} size="lg">
	<div class="space-y-3">
		<div>
			<label for="fin-desc" class="mb-1.5 block text-[12px] font-semibold text-(--ui-text-muted)"
				>{labels.description}</label
			>
			<Input id="fin-desc" bind:value={description} class="w-full" />
		</div>
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label
					for="fin-amount"
					class="mb-1.5 block text-[12px] font-semibold text-(--ui-text-muted)"
					>{labels.amount} ({config.currency})</label
				>
				<Input
					id="fin-amount"
					bind:value={amount}
					type="number"
					min="0"
					step="0.01"
					class="w-full"
				/>
			</div>
			<div>
				<label for="fin-cat" class="mb-1.5 block text-[12px] font-semibold text-(--ui-text-muted)"
					>{labels.category}</label
				>
				<Select id="fin-cat" bind:value={category} options={categoryFormOptions} class="w-full" />
			</div>
		</div>
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label for="fin-party" class="mb-1.5 block text-[12px] font-semibold text-(--ui-text-muted)"
					>{labels.party}</label
				>
				<Input
					id="fin-party"
					bind:value={party}
					placeholder={labels.partyPlaceholder}
					class="w-full"
				/>
			</div>
			<div>
				<label
					for="fin-method"
					class="mb-1.5 block text-[12px] font-semibold text-(--ui-text-muted)"
					>{labels.method}</label
				>
				<Select id="fin-method" bind:value={method} options={config.methods} class="w-full" />
			</div>
		</div>
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label for="fin-date" class="mb-1.5 block text-[12px] font-semibold text-(--ui-text-muted)"
					>{labels.date}</label
				>
				<input
					id="fin-date"
					type="date"
					bind:value={occurredAt}
					class="h-9.5 w-full rounded-lg border border-(--ui-border) bg-(--ui-bg-muted) px-3 text-[13.5px] text-(--ui-text) focus:border-(--ui-color-primary-500) focus:outline-none"
				/>
			</div>
			<div>
				<label
					for="fin-status"
					class="mb-1.5 block text-[12px] font-semibold text-(--ui-text-muted)"
					>{labels.status}</label
				>
				<Select id="fin-status" bind:value={status} options={config.statuses} class="w-full" />
			</div>
		</div>
		<div>
			<label for="fin-receipt" class="mb-1.5 block text-[12px] font-semibold text-(--ui-text-muted)"
				>{labels.receiptUrl}</label
			>
			<Input
				id="fin-receipt"
				bind:value={reference}
				icon="lucide:paperclip"
				placeholder={labels.receiptPlaceholder}
				class="w-full"
			/>
		</div>
	</div>
	{#snippet footer()}
		<Button color="neutral" variant="ghost" onclick={() => (open = false)}>{labels.cancel}</Button>
		<Button color="primary" icon="lucide:check" onclick={save}
			>{isEditing ? labels.saveChanges : labels.save}</Button
		>
	{/snippet}
</Dialog>

<RawDataDialog bind:open={rawOpen} data={rawItem} title={labels.rawDataTitle} />
