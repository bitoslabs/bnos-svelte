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
	import { toast } from '$lib/stores/toast.svelte';
	import { initialsFrom, formatMoney } from '$lib/utils/format';
	import { TYPE, statusColor, type Staff, type UserRole } from '$lib/domain';
	import RawDataDialog from '$lib/components/ui/RawDataDialog.svelte';

	const ROLES: UserRole[] = ['owner', 'manager', 'cashier', 'waiter', 'chef', 'stock'];
	const roleIcon: Record<string, string> = {
		owner: 'lucide:crown',
		manager: 'lucide:shield-check',
		cashier: 'lucide:scan-line',
		waiter: 'lucide:concierge-bell',
		chef: 'lucide:chef-hat',
		stock: 'lucide:warehouse',
		admin: 'lucide:shield-check',
		server: 'lucide:concierge-bell'
	};

	onMount(() => {
		dataSync.pageSync([TYPE.staff], { scope: 'staff' });
	});

	const staff = $derived(glo.all<Staff, typeof TYPE.staff>(TYPE.staff));

	// ── Stats ──
	const stats = $derived.by(() => {
		const total = staff.length;
		const active = staff.filter((s) => (s.data.status ?? 'active') === 'active').length;
		const byRole: Record<string, number> = {};
		for (const s of staff) {
			const r = s.data.role ?? 'unknown';
			byRole[r] = (byRole[r] ?? 0) + 1;
		}
		return { total, active, inactive: total - active, byRole };
	});

	// ── Role filter ──
	// Raw data viewer
	let rawOpen = $state(false);
	let rawItem = $state<any>(null);

	let roleFilter = $state<string>('all');
	const roleFilterOptions = $derived([
		{ value: 'all', label: 'All roles' },
		...ROLES.map((r) => ({ value: r, label: r.charAt(0).toUpperCase() + r.slice(1) }))
	]);

	const filteredStaff = $derived(
		roleFilter === 'all' ? staff : staff.filter((s) => s.data.role === roleFilter)
	);

	const controls = createListControls<{ id: string; data: Staff }>({
		items: () => filteredStaff,
		search: (s, q) =>
			(s.data.name ?? '').toLowerCase().includes(q) ||
			(s.data.role ?? '').toLowerCase().includes(q) ||
			(s.data.email ?? '').toLowerCase().includes(q),
		sortOptions: () => [
			{ key: 'name', label: 'Name', value: (s) => s.data.name },
			{ key: 'role', label: 'Role', value: (s) => s.data.role },
			{ key: 'status', label: 'Status', value: (s) => s.data.status }
		],
		defaultSortKey: 'name',
		defaultViewMode: 'grid',
		storageKey: 'staff'
	});

	// ── Add / Edit dialog ──
	let open = $state(false);
	let editingId = $state<string | null>(null);
	let name = $state('');
	let role = $state<UserRole>('cashier');
	let email = $state('');
	let phone = $state('');
	let pin = $state('');
	let npub = $state('');
	let rate = $state<number | ''>('');

	function openCreate() {
		editingId = null;
		name = email = phone = pin = npub = '';
		role = 'cashier';
		rate = '';
		open = true;
	}

	function openEdit(s: { id: string; data: Staff }) {
		editingId = s.id;
		name = s.data.name ?? '';
		role = s.data.role ?? 'cashier';
		email = s.data.email ?? '';
		phone = s.data.phone ?? '';
		pin = s.data.pin ?? '';
		npub = s.data.npub ?? '';
		rate = s.data.hourlyRate ?? '';
		open = true;
	}

	async function save() {
		if (!name.trim()) return toast.warning('Name required');
		const payload: Staff = {
			name: name.trim(),
			role,
			status: 'active',
			email: email.trim() || undefined,
			phone: phone.trim() || undefined,
			pin: pin.trim() || undefined,
			npub: npub.trim() || undefined,
			hourlyRate: typeof rate === 'number' ? rate : Number(rate) || undefined
		};
		if (editingId) {
			await glo.upsert<Staff>(TYPE.staff, payload, { id: editingId });
			toast.success('Staff updated', name.trim());
		} else {
			await glo.upsert<Staff>(TYPE.staff, payload);
			toast.success('Staff added', name.trim());
		}
		open = false;
	}

	const npubValid = $derived(npub === '' || npub.startsWith('npub1'));
</script>

<svelte:head><title>BNOS · Staff</title></svelte:head>

<div class="space-y-4">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h1 class="font-display text-xl font-bold tracking-tight">Staff</h1>
			<p class="text-[12.5px] text-[var(--ui-text-muted)]">
				{staff.length} member{staff.length === 1 ? '' : 's'} · kind 30500
			</p>
		</div>
		<Button color="primary" icon="lucide:user-plus" onclick={openCreate}>Add staff</Button>
	</div>

	<!-- Stats Cards -->
	<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
		<div class="surface-card flex items-center gap-3 p-3">
			<div class="grid size-9 place-items-center rounded-lg bg-primary-500/10 text-primary-600 dark:text-primary-400">
				<Icon name="lucide:users" class="size-4.5" />
			</div>
			<div>
				<div class="text-[11px] font-semibold uppercase tracking-wide text-[var(--ui-text-dimmed)]">Total</div>
				<div class="font-display text-xl font-bold tabular-nums">{stats.total}</div>
			</div>
		</div>
		<div class="surface-card flex items-center gap-3 p-3">
			<div class="grid size-9 place-items-center rounded-lg bg-[var(--tone-success-bg)] text-[var(--tone-success-text)]">
				<Icon name="lucide:user-check" class="size-4.5" />
			</div>
			<div>
				<div class="text-[11px] font-semibold uppercase tracking-wide text-[var(--ui-text-dimmed)]">Active</div>
				<div class="font-display text-xl font-bold tabular-nums">{stats.active}</div>
			</div>
		</div>
		<div class="surface-card flex items-center gap-3 p-3">
			<div class="grid size-9 place-items-center rounded-lg bg-[var(--tone-neutral-bg)] text-[var(--ui-text-muted)]">
				<Icon name="lucide:user-minus" class="size-4.5" />
			</div>
			<div>
				<div class="text-[11px] font-semibold uppercase tracking-wide text-[var(--ui-text-dimmed)]">Inactive</div>
				<div class="font-display text-xl font-bold tabular-nums">{stats.inactive}</div>
			</div>
		</div>
		<div class="surface-card flex items-center gap-3 p-3">
			<div class="grid size-9 place-items-center rounded-lg bg-[var(--tone-info-bg)] text-[var(--tone-info-text)]">
				<Icon name="lucide:briefcase" class="size-4.5" />
			</div>
			<div class="min-w-0">
				<div class="text-[11px] font-semibold uppercase tracking-wide text-[var(--ui-text-dimmed)]">Roles</div>
				<div class="truncate text-[12.5px] font-semibold">
					{#each Object.entries(stats.byRole).slice(0, 3) as [r, count], i (r)}
						{#if i > 0}, {/if}{count} {r}
					{/each}
				</div>
			</div>
		</div>
	</div>

	<!-- Role Filter + List Controls -->
	<div class="flex flex-wrap items-center gap-3">
		<div class="w-44">
			<Select
				bind:value={roleFilter}
				options={roleFilterOptions}
				class="w-full"
			/>
		</div>
		<div class="flex-1">
			{#if filteredStaff.length || controls.search}
				<ListToolbar
					bind:search={controls.search}
					bind:sortKey={controls.sortKey}
					bind:sortDir={controls.sortDir}
					bind:viewMode={controls.viewMode}
					sortItems={controls.sortItems}
					applySort={controls.applySort}
					setViewMode={controls.setViewMode}
					searchPlaceholder="Search name, role, email…"
				/>
			{/if}
		</div>
	</div>

	{#if controls.list.length === 0}
		<EmptyState
			icon="lucide:users"
			title="No staff yet"
			description="Add your team — cashiers, waiters, chefs — and assign roles."
		>
			{#snippet actions()}
				<Button color="primary" size="sm" icon="lucide:user-plus" onclick={openCreate}
					>Add staff</Button
				>
			{/snippet}
		</EmptyState>
	{:else if controls.viewMode === 'grid'}
		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
			{#each controls.pagedList as s (s.id)}
				<div class="surface-card relative flex flex-col gap-3 p-4">
					<div class="flex items-center gap-3">
						<div
							class="grid size-11 shrink-0 place-items-center rounded-full text-[13px] font-bold text-white"
							style="background:linear-gradient(135deg,var(--ui-color-primary-400),var(--color-violet-accent))"
						>
							{initialsFrom(s.data.name, null)}
						</div>
						<div class="min-w-0 flex-1">
							<div class="truncate font-semibold">{s.data.name}</div>
							<div class="flex items-center gap-1.5 text-[12px] capitalize text-[var(--ui-text-muted)]">
								<Icon name={roleIcon[s.data.role] ?? 'lucide:user'} class="size-3.5" />
								{s.data.role}
							</div>
						</div>
						<!-- Status indicator dot -->
						<span
							class="absolute top-3 right-3 size-2.5 rounded-full {(s.data.status ?? 'active') === 'active' ? 'bg-[var(--tone-success-text)]' : 'bg-[var(--ui-text-dimmed)]'}"
							title={s.data.status ?? 'active'}
						></span>
					</div>

					<div class="flex flex-wrap items-center gap-1.5">
						<Badge color={statusColor(s.data.role === 'owner' ? 'success' : s.data.role === 'manager' ? 'info' : 'neutral')}>
							<Icon name={roleIcon[s.data.role] ?? 'lucide:user'} class="size-3" />
							{s.data.role}
						</Badge>
						<Badge color={statusColor(s.data.status ?? 'active')}>{s.data.status ?? 'active'}</Badge>
					</div>

					{#if s.data.email || s.data.phone || s.data.npub}
						<div class="space-y-0.5 text-[11.5px] text-[var(--ui-text-dimmed)]">
							{#if s.data.email}
								<div class="flex items-center gap-1.5">
									<Icon name="lucide:at-sign" class="size-3" />{s.data.email}
								</div>
							{/if}
							{#if s.data.phone}
								<div class="flex items-center gap-1.5">
									<Icon name="lucide:phone" class="size-3" />{s.data.phone}
								</div>
							{/if}
							{#if s.data.npub}
								<div class="flex items-center gap-1.5 truncate">
									<Icon name="lucide:key-round" class="size-3 shrink-0" />
									<span class="truncate">{s.data.npub.slice(0, 12)}…{s.data.npub.slice(-6)}</span>
								</div>
							{/if}
						</div>
					{/if}

					{#if s.data.hourlyRate}
						<div class="text-[12px] text-[var(--ui-text-muted)]">
							<Icon name="lucide:banknote" class="mr-1 inline size-3.5" />
							{formatMoney(s.data.hourlyRate, 'USD')}/hr
						</div>
					{/if}

					<div class="flex items-center justify-end gap-1 border-t border-[var(--ui-border-muted)] pt-2">
						<Button
							size="sm"
							color="neutral"
							variant="ghost"
							icon="lucide:pencil-line"
							onclick={() => openEdit(s)}
						>
							Edit
						</Button>
						<RowActions
							actions={[[{ label: 'Delete', icon: 'lucide:trash-2', danger: true, onSelect: () => { glo.remove(TYPE.staff, s.id); toast.info('Removed'); } }]]}
						/>
					</div>
				</div>
			{/each}
		</div>
		<Pagination {controls} class="mt-3 rounded-xl border border-[var(--ui-border)] shadow-sm" />
	{:else}
		<div class="data-panel">
			<table class="table-surface w-full text-left">
				<thead>
					<tr>
						<SortableTh column="name" active={controls.sortKey === 'name'} direction={controls.sortDir} applySort={controls.applySort}>Name</SortableTh>
						<SortableTh column="role" active={controls.sortKey === 'role'} direction={controls.sortDir} applySort={controls.applySort}>Role</SortableTh>
						<th class="px-5 py-2.5">Contact</th>
						<th class="px-5 py-2.5">npub</th>
						<SortableTh column="status" active={controls.sortKey === 'status'} direction={controls.sortDir} applySort={controls.applySort}>Status</SortableTh>
						<th class="w-10 px-5 py-2.5"></th>
					</tr>
				</thead>
				<tbody class="divide-y divide-[var(--ui-border-muted)] text-[13px]">
					{#each controls.pagedList as s (s.id)}
						<tr>
							<td class="px-5 py-3 font-semibold">{s.data.name}</td>
							<td class="px-5 py-3">
								<div class="flex items-center gap-1.5 capitalize text-[var(--ui-text-muted)]">
									<Icon name={roleIcon[s.data.role] ?? 'lucide:user'} class="size-3.5" />
									{s.data.role}
								</div>
							</td>
							<td class="px-5 py-3 text-[var(--ui-text-muted)]">{s.data.email ?? s.data.phone ?? '—'}</td>
							<td class="px-5 py-3 text-[var(--ui-text-dimmed)]">
								{#if s.data.npub}
									<span class="font-mono text-[11px]">{s.data.npub.slice(0, 10)}…{s.data.npub.slice(-4)}</span>
								{:else}—{/if}
							</td>
							<td class="px-5 py-3"><Badge color={statusColor(s.data.status)}>{s.data.status}</Badge></td>
							<td class="px-5 py-3 text-right">
								<div class="flex items-center justify-end gap-1">
									<button
										type="button"
										class="grid size-7 place-items-center rounded-md text-[var(--ui-text-dimmed)] transition-colors hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]"
										onclick={() => openEdit(s)}
										aria-label="Edit"
									>
										<Icon name="lucide:pencil-line" class="size-3.5" />
									</button>
									<RowActions
										actions={[[{ label: 'Delete', icon: 'lucide:trash-2', danger: true, onSelect: () => { glo.remove(TYPE.staff, s.id); toast.info('Removed'); } }]]}
									/>
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
			<Pagination {controls} />
		</div>
	{/if}
</div>

<!-- Add / Edit Dialog -->
<Dialog bind:open={open} title={editingId ? 'Edit staff member' : 'Add staff member'}>
	<div class="space-y-3">
		<label class="block">
			<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Name</span>
			<Input bind:value={name} icon="lucide:user" class="w-full" />
		</label>
		<div class="grid grid-cols-2 gap-3">
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Role</span>
				<Select
					bind:value={role}
					options={ROLES.map((r) => ({ value: r, label: r.charAt(0).toUpperCase() + r.slice(1) }))}
					class="w-full"
				/>
			</label>
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">PIN</span>
				<Input bind:value={pin} icon="lucide:lock" maxlength={6} class="w-full" />
			</label>
		</div>
		<div class="grid grid-cols-2 gap-3">
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Email</span>
				<Input bind:value={email} icon="lucide:at-sign" class="w-full" />
			</label>
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Phone</span>
				<Input bind:value={phone} icon="lucide:phone" class="w-full" />
			</label>
		</div>
		<label class="block">
			<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">
				Nostr pubkey (npub)
				{#if npub && !npubValid}<span class="text-[var(--tone-error-text)]"> · must start with npub1</span>{/if}
			</span>
			<Input
				bind:value={npub}
				icon="lucide:key-round"
				placeholder="npub1…"
				class="w-full"
			/>
			{#if !npub}
				<span class="mt-1 block text-[11px] text-[var(--ui-text-dimmed)]">
					Optional — links this staff member to a Nostr identity for permissions and payments.
				</span>
			{/if}
		</label>
		<label class="block">
			<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Hourly rate</span>
			<Input bind:value={rate} type="number" min="0" step="0.5" class="w-full" />
		</label>
	</div>
	{#snippet footer()}
		<Button color="neutral" variant="ghost" onclick={() => (open = false)}>Cancel</Button>
		<Button color="primary" icon="lucide:check" onclick={save}>
			{editingId ? 'Update' : 'Save'}
		</Button>
	{/snippet}
</Dialog>

<RawDataDialog bind:open={rawOpen} data={rawItem} title="Staff Raw Data" />
