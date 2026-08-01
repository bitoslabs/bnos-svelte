<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import ListToolbar from '$lib/components/list/ListToolbar.svelte';
	import SortableTh from '$lib/components/list/SortableTh.svelte';
	import Pagination from '$lib/components/list/Pagination.svelte';
	import RowActions, { type RowAction } from '$lib/components/list/RowActions.svelte';
	import { createListControls } from '$lib/utils/list.svelte';
	import { glo } from '$nostr/store.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatInt, initialsFrom } from '$lib/utils/format';
	import type { GloCustomer, GloObject } from '@bitos/bnos-core/glo';

	type CustomerRow = GloObject<GloCustomer, 'crm.customer'>;

	onMount(() => {
		glo.hydrate('crm.customer');
		void glo.sync('crm.customer');
	});

	const customers = $derived(glo.all<GloCustomer, 'crm.customer'>('crm.customer'));
	const activeCustomers = $derived(
		customers.filter((c) => (c.data.status ?? 'active') === 'active').length
	);
	const withContact = $derived(
		customers.filter((c) => Boolean(c.data.phone?.trim() || c.data.email?.trim())).length
	);

	const controls = createListControls<CustomerRow>({
		items: () => customers,
		search: (c, q) =>
			(c.data.name ?? '').toLowerCase().includes(q) ||
			(c.data.phone ?? '').includes(q) ||
			(c.data.email ?? '').toLowerCase().includes(q),
		sortOptions: () => [
			{ key: 'name', label: 'Name', value: (c) => c.data.name ?? '~' },
			{ key: 'phone', label: 'Phone', value: (c) => c.data.phone ?? '~' },
			{ key: 'email', label: 'Email', value: (c) => c.data.email ?? '~' },
			{ key: 'status', label: 'Status', value: (c) => c.data.status ?? 'active' }
		],
		defaultSortKey: 'name',
		defaultViewMode: 'table',
		storageKey: 'customers'
	});

	// add dialog
	let open = $state(false);
	let name = $state('');
	let phone = $state('');
	let email = $state('');

	function openCreate() {
		name = phone = email = '';
		open = true;
	}
	async function save() {
		if (!name.trim()) {
			toast.warning('Name required');
			return;
		}
		await glo.upsert<GloCustomer>('crm.customer', {
			name: name.trim(),
			phone: phone.trim() || undefined,
			email: email.trim() || undefined,
			status: 'active'
		});
		toast.success('Customer added', name.trim());
		open = false;
	}

	function rowActions(c: CustomerRow): RowAction[][] {
		return [
			[
				{
					label: 'View',
					icon: 'lucide:eye',
					onSelect: () => toast.info(c.data.name ?? 'Customer')
				},
				{
					label: 'Delete',
					icon: 'lucide:trash-2',
					danger: true,
					onSelect: () => {
						glo.remove('crm.customer', c.id);
						toast.info('Customer removed');
					}
				}
			]
		];
	}
</script>

<svelte:head><title>bdGo OS · Customers</title></svelte:head>

<div class="space-y-5">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h1 class="font-display text-xl font-bold tracking-tight">Customers</h1>
			<p class="text-[12.5px] text-[var(--ui-text-muted)]">
				{formatInt(customers.length)} total · {formatInt(controls.list.length)} showing · kind 30300
			</p>
		</div>
		<Button color="primary" icon="lucide:user-plus" onclick={openCreate}>Add customer</Button>
	</div>

	<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
		<div class="metric-card p-4">
			<div class="text-[11px] font-semibold text-[var(--ui-text-dimmed)]">Customers</div>
			<div class="mt-1 font-display text-lg font-bold tabular-nums">
				{formatInt(customers.length)}
			</div>
		</div>
		<div class="metric-card p-4">
			<div class="text-[11px] font-semibold text-[var(--ui-text-dimmed)]">Active</div>
			<div class="mt-1 font-display text-lg font-bold tabular-nums">
				{formatInt(activeCustomers)}
			</div>
		</div>
		<div class="metric-card p-4">
			<div class="text-[11px] font-semibold text-[var(--ui-text-dimmed)]">With contact</div>
			<div class="mt-1 font-display text-lg font-bold tabular-nums">{formatInt(withContact)}</div>
		</div>
	</div>

	{#if customers.length || controls.search}
		<ListToolbar
			bind:search={controls.search}
			bind:sortKey={controls.sortKey}
			bind:sortDir={controls.sortDir}
			bind:viewMode={controls.viewMode}
			sortItems={controls.sortItems}
			searchPlaceholder="Search name, phone, email…"
			applySort={controls.applySort}
			setViewMode={controls.setViewMode}
		/>
	{/if}

	{#if controls.list.length === 0}
		<EmptyState
			icon="lucide:users"
			title={controls.search ? 'No matching customers' : 'No customers yet'}
			description={controls.search
				? 'Try a different search.'
				: 'Add customers to attach them to orders and track loyalty.'}
		>
			{#snippet actions()}
				{#if !controls.search}
					<Button color="primary" size="sm" icon="lucide:user-plus" onclick={openCreate}
						>Add customer</Button
					>
				{/if}
			{/snippet}
		</EmptyState>
	{:else if controls.viewMode === 'grid'}
		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
			{#each controls.pagedList as c (c.id)}
				<div class="metric-card flex items-center gap-3 p-4">
					<div
						class="grid size-11 shrink-0 place-items-center rounded-full text-[13px] font-bold text-white"
						style="background: linear-gradient(135deg, var(--ui-color-primary-400), var(--color-cyan-accent))"
					>
						{initialsFrom(c.data.name ?? null, c.data.email ?? null)}
					</div>
					<div class="min-w-0 flex-1">
						<div class="truncate font-semibold">{c.data.name ?? 'Unnamed'}</div>
						<div class="truncate text-[12px] text-[var(--ui-text-muted)]">
							{c.data.phone ?? c.data.email ?? '—'}
						</div>
					</div>
					<RowActions actions={rowActions(c)} />
				</div>
			{/each}
		</div>
		<Pagination {controls} />
	{:else}
		<div class="data-panel">
			<div class="overflow-x-auto">
				<table class="table-surface w-full text-left">
					<thead>
						<tr>
							<SortableTh
								column="name"
								active={controls.sortKey === 'name'}
								direction={controls.sortDir}
								applySort={controls.applySort}>Name</SortableTh
							>
							<SortableTh
								column="phone"
								active={controls.sortKey === 'phone'}
								direction={controls.sortDir}
								applySort={controls.applySort}>Phone</SortableTh
							>
							<SortableTh
								column="email"
								active={controls.sortKey === 'email'}
								direction={controls.sortDir}
								applySort={controls.applySort}>Email</SortableTh
							>
							<SortableTh
								column="status"
								active={controls.sortKey === 'status'}
								direction={controls.sortDir}
								applySort={controls.applySort}>Status</SortableTh
							>
							<th class="w-10 px-5 py-2.5"></th>
						</tr>
					</thead>
					<tbody class="divide-y divide-[var(--ui-border-muted)] text-[13px]">
						{#each controls.pagedList as c (c.id)}
							<tr>
								<td class="px-5 py-3">
									<div class="flex items-center gap-3">
										<div
											class="grid size-8 shrink-0 place-items-center rounded-full bg-primary-500/10 text-[11px] font-bold text-primary-600 dark:text-primary-400"
										>
											{initialsFrom(c.data.name ?? null, c.data.email ?? null)}
										</div>
										<span class="font-semibold">{c.data.name ?? 'Unnamed'}</span>
									</div>
								</td>
								<td class="px-5 py-3 text-[var(--ui-text-muted)]">{c.data.phone ?? '—'}</td>
								<td class="px-5 py-3 text-[var(--ui-text-muted)]">{c.data.email ?? '—'}</td>
								<td class="px-5 py-3"
									><Badge color={c.data.status === 'active' ? 'success' : 'neutral'}
										>{c.data.status ?? 'active'}</Badge
									></td
								>
								<td class="px-5 py-3 text-right"><RowActions actions={rowActions(c)} /></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<Pagination {controls} />
		</div>
	{/if}
</div>

<Dialog bind:open title="Add customer">
	<div class="space-y-3">
		<label class="block">
			<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Name</span>
			<Input bind:value={name} icon="lucide:user" placeholder="Jane Doe" class="w-full" />
		</label>
		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Phone</span
				>
				<Input bind:value={phone} icon="lucide:phone" placeholder="+856 …" class="w-full" />
			</label>
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Email</span
				>
				<Input
					bind:value={email}
					icon="lucide:at-sign"
					placeholder="jane@example.com"
					class="w-full"
				/>
			</label>
		</div>
	</div>
	{#snippet footer()}
		<Button color="neutral" variant="ghost" onclick={() => (open = false)}>Cancel</Button>
		<Button color="primary" icon="lucide:check" onclick={save}>Save</Button>
	{/snippet}
</Dialog>
