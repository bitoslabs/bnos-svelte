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
	import { toast } from '$lib/stores/toast.svelte';
	import { initialsFrom } from '$lib/utils/format';
	import { TYPE, statusColor, type Staff } from '$lib/domain';

	const ROLES = ['owner', 'manager', 'cashier', 'waiter', 'chef', 'stock'] as const;
	const roleIcon: Record<string, string> = { owner: 'lucide:crown', manager: 'lucide:shield-check', cashier: 'lucide:scan-line', waiter: 'lucide:concierge-bell', chef: 'lucide:chef-hat', stock: 'lucide:warehouse' };

	onMount(() => { glo.hydrate(TYPE.staff); void glo.sync(TYPE.staff); });

	const staff = $derived(glo.all<Staff, typeof TYPE.staff>(TYPE.staff));
	const controls = createListControls<{ id: string; data: Staff }>({
		items: () => staff,
		search: (s, q) => (s.data.name ?? '').toLowerCase().includes(q) || (s.data.role ?? '').toLowerCase().includes(q),
		sortOptions: () => [{ key: 'name', label: 'Name', value: (s) => s.data.name }, { key: 'role', label: 'Role', value: (s) => s.data.role }, { key: 'status', label: 'Status', value: (s) => s.data.status }],
		defaultSortKey: 'name', defaultViewMode: 'grid', storageKey: 'staff'
	});

	let open = $state(false);
	let name = $state(''); let role = $state<typeof ROLES[number]>('cashier'); let email = $state(''); let phone = $state(''); let pin = $state(''); let rate = $state<number | ''>('');

	function openCreate() { name = email = phone = pin = ''; role = 'cashier'; rate = ''; open = true; }
	async function save() {
		if (!name.trim()) return toast.warning('Name required');
		await glo.upsert<Staff>(TYPE.staff, { name: name.trim(), role, email: email.trim() || undefined, phone: phone.trim() || undefined, pin: pin.trim() || undefined, hourlyRate: typeof rate === 'number' ? rate : Number(rate) || undefined, status: 'active' });
		toast.success('Staff added', name.trim()); open = false;
	}
</script>

<svelte:head><title>bdGo OS · Staff</title></svelte:head>

<div class="space-y-4">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h1 class="font-display text-xl font-bold tracking-tight">Staff</h1>
			<p class="text-[12.5px] text-[var(--ui-text-muted)]">{staff.length} member{staff.length === 1 ? '' : 's'} · kind 30500</p>
		</div>
		<Button color="primary" icon="lucide:user-plus" onclick={openCreate}>Add staff</Button>
	</div>

	{#if staff.length || controls.search}
		<ListToolbar bind:search={controls.search} bind:sortKey={controls.sortKey} bind:sortDir={controls.sortDir} bind:viewMode={controls.viewMode} sortItems={controls.sortItems} applySort={controls.applySort} setViewMode={controls.setViewMode} searchPlaceholder="Search name or role…" />
	{/if}

	{#if controls.list.length === 0}
		<EmptyState icon="lucide:users" title="No staff yet" description="Add your team — cashiers, waiters, chefs — and assign roles.">
			{#snippet actions()}<Button color="primary" size="sm" icon="lucide:user-plus" onclick={openCreate}>Add staff</Button>{/snippet}
		</EmptyState>
	{:else if controls.viewMode === 'grid'}
		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
			{#each controls.pagedList as s (s.id)}
				<div class="surface-card flex items-center gap-3 p-4">
					<div class="grid size-11 shrink-0 place-items-center rounded-full text-[13px] font-bold text-white" style="background:linear-gradient(135deg,var(--ui-color-primary-400),var(--color-violet-accent))">{initialsFrom(s.data.name, null)}</div>
					<div class="min-w-0 flex-1">
						<div class="truncate font-semibold">{s.data.name}</div>
						<div class="flex items-center gap-1.5 text-[12px] capitalize text-[var(--ui-text-muted)]"><Icon name={roleIcon[s.data.role] ?? 'lucide:user'} class="size-3.5" />{s.data.role}</div>
					</div>
					<Badge color={statusColor(s.data.status)}>{s.data.status ?? 'active'}</Badge>
					<RowActions actions={[[{ label: 'Delete', icon: 'lucide:trash-2', danger: true, onSelect: () => { glo.remove(TYPE.staff, s.id); toast.info('Removed'); } }]]} />
				</div>
			{/each}
		</div>
		<Pagination {controls} />
	{:else}
		<div class="data-panel">
			<table class="table-surface w-full text-left">
				<thead><tr>
					<SortableTh column="name" active={controls.sortKey === 'name'} direction={controls.sortDir} applySort={controls.applySort}>Name</SortableTh>
					<SortableTh column="role" active={controls.sortKey === 'role'} direction={controls.sortDir} applySort={controls.applySort}>Role</SortableTh>
					<th class="px-5 py-2.5">Contact</th>
					<SortableTh column="status" active={controls.sortKey === 'status'} direction={controls.sortDir} applySort={controls.applySort}>Status</SortableTh>
					<th class="w-10 px-5 py-2.5"></th>
				</tr></thead>
				<tbody class="divide-y divide-[var(--ui-border-muted)] text-[13px]">
					{#each controls.pagedList as s (s.id)}
						<tr>
							<td class="px-5 py-3 font-semibold">{s.data.name}</td>
							<td class="px-5 py-3 capitalize text-[var(--ui-text-muted)]">{s.data.role}</td>
							<td class="px-5 py-3 text-[var(--ui-text-muted)]">{s.data.email ?? s.data.phone ?? '—'}</td>
							<td class="px-5 py-3"><Badge color={statusColor(s.data.status)}>{s.data.status}</Badge></td>
							<td class="px-5 py-3 text-right"><RowActions actions={[[{ label: 'Delete', icon: 'lucide:trash-2', danger: true, onSelect: () => { glo.remove(TYPE.staff, s.id); toast.info('Removed'); } }]]} /></td>
						</tr>
					{/each}
				</tbody>
			</table>
			<Pagination {controls} />
		</div>
	{/if}
</div>

<Dialog bind:open={open} title="Add staff member">
	<div class="space-y-3">
		<label class="block"><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Name</span><Input bind:value={name} icon="lucide:user" class="w-full" /></label>
		<div class="grid grid-cols-2 gap-3">
			<label class="block"><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Role</span>
				<Select bind:value={role} options={ROLES.map((r) => ({ value: r, label: r.charAt(0).toUpperCase() + r.slice(1) }))} class="w-full" />
			</label>
			<label class="block"><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">PIN</span><Input bind:value={pin} icon="lucide:lock" maxlength={6} class="w-full" /></label>
		</div>
		<div class="grid grid-cols-2 gap-3">
			<label class="block"><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Email</span><Input bind:value={email} icon="lucide:at-sign" class="w-full" /></label>
			<label class="block"><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Phone</span><Input bind:value={phone} icon="lucide:phone" class="w-full" /></label>
		</div>
		<label class="block"><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Hourly rate</span><Input bind:value={rate} type="number" min="0" step="0.5" class="w-full" /></label>
	</div>
	{#snippet footer()}<Button color="neutral" variant="ghost" onclick={() => (open = false)}>Cancel</Button><Button color="primary" icon="lucide:check" onclick={save}>Save</Button>{/snippet}
</Dialog>
