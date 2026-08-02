<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import ListToolbar from '$lib/components/list/ListToolbar.svelte';
	import SortableTh from '$lib/components/list/SortableTh.svelte';
	import Pagination from '$lib/components/list/Pagination.svelte';
	import RowActions, { type RowAction } from '$lib/components/list/RowActions.svelte';
	import { createListControls } from '$lib/utils/list.svelte';
	import { glo } from '$nostr/store.svelte';
	import { dataSync } from '$nostr/sync.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatInt, formatMoney, initialsFrom } from '$lib/utils/format';
	import { tenant } from '$nostr/tenant.svelte';
	import type { GloCustomer, GloObject } from '@bitos/bnos-core/glo';
	import { TYPE, type CustomerSegment } from '$lib/domain';
	import RawDataDialog from '$lib/components/ui/RawDataDialog.svelte';

	type CustomerRow = GloObject<GloCustomer, 'crm.customer'>;

	const SEGMENTS: { value: string; label: string }[] = [
		{ value: 'none', label: 'No segment' },
		{ value: 'new', label: 'New' },
		{ value: 'regular', label: 'Regular' },
		{ value: 'vip', label: 'VIP' },
		{ value: 'wholesale', label: 'Wholesale' },
		{ value: 'corporate', label: 'Corporate' }
	];

	onMount(() => {
		dataSync.pageSync([TYPE.customer], { scope: 'customers' });
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
			(c.data.email ?? '').toLowerCase().includes(q) ||
			((c.data as { npub?: string }).npub ?? '').toLowerCase().includes(q),
		sortOptions: () => [
			{ key: 'name', label: 'Name', value: (c) => c.data.name ?? '~' },
			{ key: 'phone', label: 'Phone', value: (c) => c.data.phone ?? '~' },
			{ key: 'email', label: 'Email', value: (c) => c.data.email ?? '~' },
			{ key: 'segment', label: 'Segment', value: (c) => (c.data.segment as string) ?? 'none' },
			{ key: 'totalSpend', label: 'Total spend', value: (c) => (c.data.totalSpend as number) ?? 0 },
			{ key: 'status', label: 'Status', value: (c) => c.data.status ?? 'active' }
		],
		defaultSortKey: 'name',
		defaultViewMode: 'table',
		storageKey: 'customers'
	});

	// Create dialog
	// Raw data viewer
	let rawOpen = $state(false);
	let rawItem = $state<any>(null);

	let open = $state(false);
	let name = $state('');
	let phone = $state('');
	let email = $state('');
	let address = $state('');
	let notes = $state('');
	let npub = $state('');
	let segment = $state<string>('none');

	// Edit dialog
	let editOpen = $state(false);
	let editId = $state('');
	let editName = $state('');
	let editPhone = $state('');
	let editEmail = $state('');
	let editAddress = $state('');
	let editNotes = $state('');
	let editNpub = $state('');
	let editSegment = $state<string>('none');
	let editStatus = $state('active');

	function openCreate() {
		name = phone = email = address = notes = npub = '';
		segment = 'none';
		open = true;
	}

	async function save() {
		if (!name.trim()) {
			toast.warning('Name required');
			return;
		}
		const data = {
			name: name.trim(),
			phone: phone.trim() || undefined,
			email: email.trim() || undefined,
			address: address.trim() || undefined,
			npub: npub.trim() || undefined,
			status: 'active' as const,
			...(notes.trim() ? { notes: notes.trim() } : {}),
			...(segment !== 'none' ? { segment } : {})
		};
		await glo.upsert<GloCustomer>('crm.customer', data);
		toast.success('Customer added', name.trim());
		open = false;
	}

	function openEdit(c: CustomerRow) {
		editId = c.id;
		editName = c.data.name ?? '';
		editPhone = c.data.phone ?? '';
		editEmail = c.data.email ?? '';
		editAddress = c.data.address ?? '';
		editNotes = typeof c.data.notes === 'string' ? c.data.notes : '';
		editNpub = (c.data as { npub?: string }).npub ?? '';
		editSegment = (c.data.segment as string) ?? 'none';
		editStatus = c.data.status ?? 'active';
		editOpen = true;
	}

	async function saveEdit() {
		if (!editName.trim()) return toast.warning('Name required');
		const data = {
			name: editName.trim(),
			phone: editPhone.trim() || undefined,
			email: editEmail.trim() || undefined,
			address: editAddress.trim() || undefined,
			npub: editNpub.trim() || undefined,
			status: editStatus as 'active' | 'inactive',
			...(editNotes.trim() ? { notes: editNotes.trim() } : {}),
			...(editSegment !== 'none' ? { segment: editSegment } : {})
		};
		await glo.upsert<GloCustomer>('crm.customer', data, { id: editId });
		toast.success('Customer updated');
		editOpen = false;
	}

	function segmentBadge(seg?: string): { label: string; color: 'neutral' | 'primary' | 'success' | 'warning' | 'info' } {
		switch (seg) {
			case 'vip': return { label: 'VIP', color: 'warning' };
			case 'wholesale': return { label: 'Wholesale', color: 'info' };
			case 'corporate': return { label: 'Corporate', color: 'primary' };
			case 'regular': return { label: 'Regular', color: 'success' };
			case 'new': return { label: 'New', color: 'primary' };
			default: return { label: '—', color: 'neutral' };
		}
	}

	function rowActions(c: CustomerRow): RowAction[][] {
		return [
			[
				{
					label: 'Edit',
					icon: 'lucide:pencil',
					onSelect: () => openEdit(c)
				},
				{
					label: 'View raw',
					icon: 'lucide:code',
					onSelect: () => { rawItem = glo.get('crm.customer', c.id); rawOpen = true; }
				},
				{
					label: 'View',
					icon: 'lucide:eye',
					onSelect: () => toast.info(c.data.name ?? 'Customer')
				}
			],
			[
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

	const currency = $derived(tenant.state.currency);
</script>

<svelte:head><title>BNOS · Customers</title></svelte:head>

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
			searchPlaceholder="Search name, phone, email, npub…"
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
					<Button color="primary" size="sm" icon="lucide:user-plus" onclick={openCreate}>Add customer</Button>
				{/if}
			{/snippet}
		</EmptyState>
	{:else if controls.viewMode === 'grid'}
		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
			{#each controls.pagedList as c (c.id)}
				<div class="metric-card flex items-start gap-3 p-4">
					<div
						class="grid size-11 shrink-0 place-items-center rounded-full text-[13px] font-bold text-white"
						style="background: linear-gradient(135deg, var(--ui-color-primary-400), var(--color-cyan-accent))"
					>
						{initialsFrom(c.data.name ?? null, c.data.email ?? null)}
					</div>
					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-2">
							<span class="truncate font-semibold">{c.data.name ?? 'Unnamed'}</span>
							{#if segmentBadge(c.data.segment as string | undefined).label !== '—'}
								<Badge color={segmentBadge(c.data.segment as string | undefined).color}>{segmentBadge(c.data.segment as string | undefined).label}</Badge>
							{/if}
						</div>
						<div class="truncate text-[12px] text-[var(--ui-text-muted)]">
							{c.data.phone ?? c.data.email ?? '—'}
						</div>
						{#if (c.data as { totalOrders?: number }).totalOrders || c.data.totalSpend}
							<div class="mt-1 flex items-center gap-3 text-[11px] text-[var(--ui-text-dimmed)]">
								{#if (c.data as { totalOrders?: number }).totalOrders}
									<span>{formatInt((c.data as { totalOrders?: number }).totalOrders ?? 0)} orders</span>
								{/if}
								{#if c.data.totalSpend}
									<span>{formatMoney(c.data.totalSpend as number, currency)}</span>
								{/if}
							</div>
						{/if}
					</div>
					<RowActions actions={rowActions(c)} />
				</div>
			{/each}
		</div>
		<Pagination {controls} class="mt-3 rounded-xl border border-[var(--ui-border)] shadow-sm" />
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
								column="segment"
								active={controls.sortKey === 'segment'}
								direction={controls.sortDir}
								applySort={controls.applySort}>Segment</SortableTh
							>
							<SortableTh
								column="totalSpend"
								active={controls.sortKey === 'totalSpend'}
								direction={controls.sortDir}
								applySort={controls.applySort}
								align="right">Spend</SortableTh
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
										<div>
											<span class="font-semibold">{c.data.name ?? 'Unnamed'}</span>
											{#if (c.data as { npub?: string }).npub}
												<div class="font-mono text-[10px] text-[var(--ui-text-dimmed)]">{(c.data as { npub?: string }).npub!.slice(0, 16)}…</div>
											{/if}
										</div>
									</div>
								</td>
								<td class="px-5 py-3 text-[var(--ui-text-muted)]">{c.data.phone ?? '—'}</td>
								<td class="px-5 py-3 text-[var(--ui-text-muted)]">{c.data.email ?? '—'}</td>
								<td class="px-5 py-3">
									{#if segmentBadge(c.data.segment as string | undefined).label !== '—'}
										<Badge color={segmentBadge(c.data.segment as string | undefined).color}>{segmentBadge(c.data.segment as string | undefined).label}</Badge>
									{:else}
										<span class="text-[var(--ui-text-dimmed)]">—</span>
									{/if}
								</td>
								<td class="px-5 py-3 text-right tabular-nums text-[var(--ui-text-muted)]">
									{#if c.data.totalSpend}
										{formatMoney(c.data.totalSpend as number, currency)}
									{:else}
										—
									{/if}
								</td>
								<td class="px-5 py-3">
									<Badge color={c.data.status === 'active' ? 'success' : 'neutral'}>{c.data.status ?? 'active'}</Badge>
								</td>
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

<!-- Create Dialog -->
<Dialog bind:open title="Add customer" size="lg">
	<div class="space-y-3">
		<label class="block">
			<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Name</span>
			<Input bind:value={name} icon="lucide:user" placeholder="Jane Doe" class="w-full" />
		</label>
		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Phone</span>
				<Input bind:value={phone} icon="lucide:phone" placeholder="+856 …" class="w-full" />
			</label>
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Email</span>
				<Input bind:value={email} icon="lucide:at-sign" placeholder="jane@example.com" class="w-full" />
			</label>
		</div>
		<label class="block">
			<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Address</span>
			<Input bind:value={address} icon="lucide:map-pin" placeholder="123 Main St, City" class="w-full" />
		</label>
		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">npub (Nostr pubkey)</span>
				<Input bind:value={npub} icon="lucide:key-round" placeholder="npub1…" class="w-full" />
			</label>
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Segment</span>
				<Select bind:value={segment} options={SEGMENTS} class="w-full" />
			</label>
		</div>
		<label class="block">
			<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Notes</span>
			<Input bind:value={notes} textarea placeholder="Preferences, allergies, VIP notes…" class="w-full" />
		</label>
	</div>
	{#snippet footer()}
		<Button color="neutral" variant="ghost" onclick={() => (open = false)}>Cancel</Button>
		<Button color="primary" icon="lucide:check" onclick={save}>Save</Button>
	{/snippet}
</Dialog>

<!-- Edit Dialog -->
<Dialog bind:open={editOpen} title="Edit customer" size="lg">
	<div class="space-y-3">
		<label class="block">
			<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Name</span>
			<Input bind:value={editName} icon="lucide:user" class="w-full" />
		</label>
		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Phone</span>
				<Input bind:value={editPhone} icon="lucide:phone" class="w-full" />
			</label>
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Email</span>
				<Input bind:value={editEmail} icon="lucide:at-sign" class="w-full" />
			</label>
		</div>
		<label class="block">
			<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Address</span>
			<Input bind:value={editAddress} icon="lucide:map-pin" class="w-full" />
		</label>
		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">npub (Nostr pubkey)</span>
				<Input bind:value={editNpub} icon="lucide:key-round" class="w-full" />
			</label>
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Segment</span>
				<Select bind:value={editSegment} options={SEGMENTS} class="w-full" />
			</label>
		</div>
		<label class="block">
			<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Status</span>
			<Select
				bind:value={editStatus}
				options={[
					{ value: 'active', label: 'Active' },
					{ value: 'inactive', label: 'Inactive' }
				]}
				class="w-full"
			/>
		</label>
		<label class="block">
			<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Notes</span>
			<Input bind:value={editNotes} textarea class="w-full" />
		</label>
	</div>
	{#snippet footer()}
		<Button color="neutral" variant="ghost" onclick={() => (editOpen = false)}>Cancel</Button>
		<Button color="primary" icon="lucide:check" onclick={saveEdit}>Save changes</Button>
	{/snippet}
</Dialog>

<RawDataDialog bind:open={rawOpen} data={rawItem} title="Customer Raw Data" />
