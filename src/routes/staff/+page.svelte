<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Switch from '$lib/components/ui/Switch.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import RawDataDialog from '$lib/components/ui/RawDataDialog.svelte';
	import ListToolbar from '$lib/components/list/ListToolbar.svelte';
	import SortableTh from '$lib/components/list/SortableTh.svelte';
	import Pagination from '$lib/components/list/Pagination.svelte';
	import RowActions, { type RowAction } from '$lib/components/list/RowActions.svelte';
	import { createListControls } from '$lib/utils/list.svelte';
	import { glo } from '$nostr/store.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { dataSync } from '$nostr/sync.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { initialsFrom, truncateNpub } from '$lib/utils/format';
	import { hashPin } from '$lib/utils/pin';
	import {
		generateKeyPair,
		normalizePubkey,
		hexToNpub,
		isValidPubkeyInput,
		hasStoredKey,
		saveStaffKey,
		removeStaffKey,
		exportStaffKeysTxt
	} from '$lib/utils/nostr-keys';
	import { permissions, getRoleDefaultPermissions, getRolePermissionStrings } from '$lib/permissions.svelte';
	import {
		ROLE_LABELS,
		roleBadgeColor,
		STAFF_ROLES,
		PERMISSION_RESOURCES
	} from '$lib/domain/permissions';
	import {
		TYPE,
		createGloEventTemplate,
		statusColor,
		type Staff,
		type StaffStatus,
		type UserRole
	} from '$lib/domain';

	onMount(() => {
		dataSync.pageSync([TYPE.staff], { scope: 'staff' });
	});

	// ── Permission gating ────────────────────────────────────────────
	const canWrite = $derived(permissions.can('staff', 'write') || tenant.state.activeRole === null);
	const canDelete = $derived(permissions.can('staff', 'delete') || tenant.state.activeRole === null);
	const canExport = $derived(permissions.can('settings', 'write'));

	// Redirect away once we *know* the user is denied (not during first-run).
	$effect(() => {
		if (tenant.state.activeRole !== null && !permissions.can('staff', 'read')) {
			void goto(resolve('/'), { replaceState: true });
		}
	});

	const staff = $derived(glo.all<Staff, typeof TYPE.staff>(TYPE.staff));
	const locations = $derived(glo.all<Record<string, unknown>, typeof TYPE.location>(TYPE.location));

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
	let roleFilter = $state<string>('all');
	const roleFilterOptions = $derived([
		{ value: 'all', label: 'All roles' },
		...STAFF_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))
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

	const roleIcon: Record<string, string> = {
		owner: 'lucide:crown',
		admin: 'lucide:shield-check',
		manager: 'lucide:users',
		cashier: 'lucide:scan-line',
		waiter: 'lucide:concierge-bell',
		chef: 'lucide:chef-hat',
		stock: 'lucide:warehouse',
		warehouse: 'lucide:warehouse',
		viewer: 'lucide:eye'
	};

	const STATUSES: StaffStatus[] = ['active', 'inactive', 'suspended', 'on_leave', 'terminated'];

	// ── Add / Edit dialog ──
	let open = $state(false);
	let editingId = $state<string | null>(null);
	let generatedNsec = $state<string | null>(null);
	let showNsec = $state(false);
	let rawOpen = $state(false);
	let rawTitle = $state('Staff Raw Data');
	let rawItem = $state<unknown>(null);

	interface StaffForm {
		pubkeyInput: string;
		name: string;
		displayName: string;
		email: string;
		phone: string;
		role: UserRole;
		employeeCode: string;
		department: string;
		status: StaffStatus;
		branchIds: string[];
		useCustomPermissions: boolean;
		customPermissions: string[];
		pin: string;
		hourlyRate: number | '';
	}

	function blankForm(): StaffForm {
		return {
			pubkeyInput: '',
			name: '',
			displayName: '',
			email: '',
			phone: '',
			role: 'cashier',
			employeeCode: '',
			department: '',
			status: 'active',
			branchIds: [],
			useCustomPermissions: false,
			customPermissions: [],
			pin: '',
			hourlyRate: ''
		};
	}
	let form = $state<StaffForm>(blankForm());

	const pubkeyState = $derived<'empty' | 'valid' | 'invalid'>(
		!form.pubkeyInput.trim() ? 'empty' : isValidPubkeyInput(form.pubkeyInput) ? 'valid' : 'invalid'
	);

	const canSave = $derived(
		!!form.name.trim() &&
			pubkeyState !== 'invalid' &&
			(!!editingId || pubkeyState === 'valid')
	);

	const permissionPreview = $derived(
		form.useCustomPermissions
			? form.customPermissions.length > 0
				? form.customPermissions
				: ['No custom permissions']
			: getRoleDefaultPermissions(form.role).some((p) => p.resource === 'all')
				? ['All resources (full access)']
				: getRolePermissionStrings(form.role)
	);

	function openCreate() {
		editingId = null;
		form = blankForm();
		generatedNsec = null;
		showNsec = false;
		open = true;
	}

	function openEdit(s: { id: string; data: Staff }) {
		editingId = s.id;
		form = {
			pubkeyInput: s.data.npub ?? s.data.pubkey ?? '',
			name: s.data.name ?? '',
			displayName: s.data.displayName ?? '',
			email: s.data.email ?? '',
			phone: s.data.phone ?? '',
			role: s.data.role ?? 'cashier',
			employeeCode: s.data.employeeCode ?? '',
			department: s.data.department ?? '',
			status: s.data.status ?? 'active',
			branchIds: [...(s.data.branchIds ?? [])],
			useCustomPermissions: s.data.customPermissions !== undefined,
			customPermissions: s.data.customPermissions ? [...s.data.customPermissions] : [],
			pin: '',
			hourlyRate: s.data.hourlyRate ?? ''
		};
		generatedNsec = null;
		showNsec = false;
		open = true;
	}

	function toggleBranch(id: string) {
		form.branchIds = form.branchIds.includes(id)
			? form.branchIds.filter((b) => b !== id)
			: [...form.branchIds, id];
	}

	function togglePermission(value: string) {
		form.customPermissions = form.customPermissions.includes(value)
			? form.customPermissions.filter((p) => p !== value)
			: [...form.customPermissions, value];
	}

	function onCustomToggle(v: boolean) {
		form.useCustomPermissions = v;
		form.customPermissions = v ? getRolePermissionStrings(form.role) : [];
	}

	function onGenerateKey() {
		const kp = generateKeyPair();
		form.pubkeyInput = kp.npub;
		generatedNsec = kp.nsec;
		showNsec = true;
		toast.success('New keypair generated — back up the nsec!');
	}

	function sanitizedStaffObject(s: { id: string; data: Staff }) {
		const copy = JSON.parse(JSON.stringify(s)) as { id: string; data: Staff };
		if (copy.data.pinHash) copy.data.pinHash = '[redacted]';
		if (copy.data.pin) copy.data.pin = undefined;
		return copy;
	}

	function openRawData(s: { id: string; data: Staff }) {
		rawItem = sanitizedStaffObject(s);
		rawTitle = 'Staff Raw Data';
		rawOpen = true;
	}

	function openEventPreview(s: { id: string; data: Staff }) {
		const object = sanitizedStaffObject(s);
		const template = createGloEventTemplate(object as never, {
			client: 'bdgo-os',
			summary: `${TYPE.staff} ${object.id}`
		});
		const staffPubkey = object.data.pubkey;
		if (staffPubkey && !template.tags.some((tag) => tag[0] === 'p' && tag[1] === staffPubkey)) {
			template.tags = [...template.tags, ['p', staffPubkey]];
		}
		rawItem = {
			note: 'Unsigned event preview. id, pubkey, and sig are added when the owner signs and publishes.',
			...template,
			content: JSON.parse(template.content)
		};
		rawTitle = 'Staff Event Preview';
		rawOpen = true;
	}

	function staffActions(s: { id: string; data: Staff }): RowAction[][] {
		const primary: RowAction[] = [
			{ label: 'View event', icon: 'lucide:radio', onSelect: () => openEventPreview(s) },
			{ label: 'Raw data', icon: 'lucide:code', onSelect: () => openRawData(s) }
		];
		const danger: RowAction[] = canDelete
			? [{ label: 'Delete', icon: 'lucide:trash-2', danger: true, onSelect: () => remove(s.id, s.data.name) }]
			: [];
		return danger.length ? [primary, danger] : [primary];
	}

	async function setPin() {
		if (!editingId || form.pin.length < 4) return;
		const existing = staff.find((s) => s.id === editingId);
		await glo.upsert<Staff>(TYPE.staff, { ...existing!.data, pinHash: await hashPin(form.pin), pin: undefined }, { id: editingId });
		form.pin = '';
		toast.success('PIN saved');
	}
	async function removePin() {
		if (!editingId) return;
		const existing = staff.find((s) => s.id === editingId);
		await glo.upsert<Staff>(TYPE.staff, { ...existing!.data, pinHash: undefined, pin: undefined }, { id: editingId });
		toast.success('PIN removed');
	}

	async function save() {
		if (!canSave) return;
		let hexPk = '';
		let npubDisplay = '';
		if (form.pubkeyInput.trim()) {
			try {
				hexPk = normalizePubkey(form.pubkeyInput);
				npubDisplay = hexToNpub(hexPk);
			} catch {
				toast.error('Invalid pubkey or npub');
				return;
			}
		}
		if (!editingId && !hexPk) {
			toast.warning('Pubkey or npub is required for new staff');
			return;
		}

		const payload: Staff = {
			name: form.name.trim(),
			displayName: form.displayName.trim() || undefined,
			role: form.role,
			status: form.status,
			email: form.email.trim() || undefined,
			phone: form.phone.trim() || undefined,
			pubkey: hexPk || undefined,
			npub: npubDisplay || undefined,
			companyId: tenant.state.organizationId,
			companyName: tenant.state.organizationName,
			companyCode: tenant.state.organizationCode,
			employeeCode: form.employeeCode.trim() || undefined,
			department: form.department.trim() || undefined,
			branchIds: form.branchIds,
			customPermissions: form.useCustomPermissions ? form.customPermissions : undefined,
			hourlyRate: typeof form.hourlyRate === 'number' ? form.hourlyRate : Number(form.hourlyRate) || undefined,
			pin: undefined,
			pinHash: form.pin.length >= 4 && !editingId ? await hashPin(form.pin) : undefined
		};

		try {
			if (editingId) {
				const existing = staff.find((s) => s.id === editingId);
				await glo.upsert<Staff>(TYPE.staff, { ...existing!.data, ...payload }, { id: editingId });
				if (generatedNsec && hexPk) {
					saveStaffKey({ staffId: editingId, staffName: form.name, pubkey: hexPk, npub: npubDisplay, nsec: generatedNsec, generatedAt: Date.now() });
				}
				toast.success('Staff updated', form.name.trim());
			} else {
				const obj = await glo.upsert<Staff>(TYPE.staff, payload);
				if (generatedNsec && hexPk) {
					saveStaffKey({ staffId: obj.id, staffName: form.name, pubkey: hexPk, npub: npubDisplay, nsec: generatedNsec, generatedAt: Date.now() });
				}
				toast.success('Staff added', form.name.trim());
			}
			open = false;
		} catch (e) {
			toast.error((e as Error).message ?? 'Failed to save staff');
		}
	}

	function remove(id: string, name: string) {
		if (!confirm(`Delete staff member "${name}"?`)) return;
		glo.remove(TYPE.staff, id);
		removeStaffKey(id);
		toast.info('Staff removed');
	}

	function exportStaff() {
		try {
			const blob = new Blob([exportStaffKeysTxt(staff)], { type: 'text/plain' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `staff-backup-${new Date().toISOString().slice(0, 10)}.txt`;
			document.body.appendChild(a);
			a.click();
			a.remove();
			URL.revokeObjectURL(url);
			toast.success('Staff backup exported');
		} catch (e) {
			toast.error((e as Error).message);
		}
	}
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
		<div class="flex items-center gap-2">
			{#if canExport}
				<Button
					color="neutral"
					variant="subtle"
					size="sm"
					icon="lucide:download"
					disabled={staff.length === 0}
					onclick={exportStaff}>Export</Button
				>
			{/if}
			{#if canWrite}
				<Button color="primary" icon="lucide:user-plus" onclick={openCreate}>Add staff</Button>
			{/if}
		</div>
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
			<Select bind:value={roleFilter} options={roleFilterOptions} class="w-full" />
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
				{#if canWrite}
					<Button color="primary" size="sm" icon="lucide:user-plus" onclick={openCreate}
						>Add staff</Button
					>
				{/if}
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
							<div class="flex items-center gap-1.5 text-[12px] text-[var(--ui-text-muted)]">
								<Icon name={roleIcon[s.data.role] ?? 'lucide:user'} class="size-3.5" />
								{ROLE_LABELS[s.data.role] ?? s.data.role}
							</div>
						</div>
						<span
							class="absolute top-3 right-3 size-2.5 rounded-full {(s.data.status ?? 'active') === 'active' ? 'bg-[var(--tone-success-text)]' : 'bg-[var(--ui-text-dimmed)]'}"
							title={s.data.status ?? 'active'}
						></span>
					</div>

					<div class="flex flex-wrap items-center gap-1.5">
						<Badge color={roleBadgeColor(s.data.role)}>
							<Icon name={roleIcon[s.data.role] ?? 'lucide:user'} class="size-3" />
							{ROLE_LABELS[s.data.role] ?? s.data.role}
						</Badge>
						<Badge color={statusColor(s.data.status ?? 'active')}>{(s.data.status ?? 'active').replace('_', ' ')}</Badge>
						{#if s.data.pubkey && hasStoredKey(s.data.pubkey)}
							<Badge color="neutral"><Icon name="lucide:key-round" class="size-3" />backed up</Badge>
						{/if}
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
									<span class="truncate">{truncateNpub(s.data.npub, 10, 6)}</span>
								</div>
							{/if}
						</div>
					{/if}

					<div class="flex items-center justify-end gap-1 border-t border-[var(--ui-border-muted)] pt-2">
						{#if canWrite}
							<Button size="sm" color="neutral" variant="ghost" icon="lucide:pencil-line" onclick={() => openEdit(s)}>
								Edit
							</Button>
						{/if}
						<RowActions actions={staffActions(s)} />
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
								<div class="flex items-center gap-1.5 text-[var(--ui-text-muted)]">
									<Icon name={roleIcon[s.data.role] ?? 'lucide:user'} class="size-3.5" />
									{ROLE_LABELS[s.data.role] ?? s.data.role}
								</div>
							</td>
							<td class="px-5 py-3 text-[var(--ui-text-muted)]">{s.data.email ?? s.data.phone ?? '—'}</td>
							<td class="px-5 py-3 text-[var(--ui-text-dimmed)]">
								{#if s.data.npub}
									<span class="font-mono text-[11px]">{truncateNpub(s.data.npub, 10, 4)}</span>
								{:else}—{/if}
							</td>
							<td class="px-5 py-3"><Badge color={statusColor(s.data.status ?? 'active')}>{(s.data.status ?? 'active').replace('_', ' ')}</Badge></td>
							<td class="px-5 py-3 text-right">
								<div class="flex items-center justify-end gap-1">
									{#if canWrite}
										<button
											type="button"
											class="grid size-7 place-items-center rounded-md text-[var(--ui-text-dimmed)] transition-colors hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]"
											onclick={() => openEdit(s)}
											aria-label="Edit"
										>
											<Icon name="lucide:pencil-line" class="size-3.5" />
										</button>
									{/if}
									<RowActions actions={staffActions(s)} />
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
		<!-- Identity / pubkey -->
		<label class="block">
			<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">
				Nostr pubkey (npub){#if !editingId} <span class="text-[var(--tone-error-text)]">*</span>{/if}
			</span>
			<div class="flex items-center gap-2">
				<Input
					bind:value={form.pubkeyInput}
					icon="lucide:key-round"
					placeholder="npub1… or 64-char hex"
					class="w-full"
				/>
				{#if generatedNsec}
					<Button color="neutral" variant="subtle" size="icon" icon={showNsec ? 'lucide:eye-off' : 'lucide:eye'} aria-label="Toggle nsec" onclick={() => (showNsec = !showNsec)} />
				{/if}
				<Button color="neutral" variant="subtle" size="icon" icon="lucide:wand-sparkles" aria-label="Generate key" onclick={onGenerateKey} />
			</div>
			{#if pubkeyState === 'invalid'}
				<span class="mt-1 block text-[11px] text-[var(--tone-error-text)]">Invalid pubkey</span>
			{:else if pubkeyState === 'valid'}
				<span class="mt-1 block text-[11px] text-[var(--tone-success-text)]">Valid</span>
			{:else}
				<span class="mt-1 block text-[11px] text-[var(--ui-text-dimmed)]">
					Links this staff member to a Nostr identity for login & permissions.
				</span>
			{/if}
			{#if generatedNsec && showNsec}
				<span class="mt-2 block break-all rounded-lg border border-[var(--tone-warning-text)]/40 bg-[var(--tone-warning-bg)] p-2 font-mono text-[10.5px]">
					⚠ Back up this nsec — it won't be shown again:<br />{generatedNsec}
				</span>
			{/if}
		</label>

		<div class="grid grid-cols-2 gap-3">
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Name <span class="text-[var(--tone-error-text)]">*</span></span>
				<Input bind:value={form.name} icon="lucide:user" class="w-full" />
			</label>
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Display name</span>
				<Input bind:value={form.displayName} class="w-full" />
			</label>
		</div>

		<div class="grid grid-cols-2 gap-3">
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Role</span>
				<Select
					bind:value={form.role}
					options={STAFF_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
					class="w-full"
				/>
			</label>
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Company</span>
				<Input value={tenant.state.organizationName || '—'} disabled class="w-full" />
			</label>
		</div>

		<div class="grid grid-cols-2 gap-3">
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Email</span>
				<Input bind:value={form.email} icon="lucide:at-sign" class="w-full" />
			</label>
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Phone</span>
				<Input bind:value={form.phone} icon="lucide:phone" class="w-full" />
			</label>
		</div>

		<div class="grid grid-cols-2 gap-3">
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Employee code</span>
				<Input bind:value={form.employeeCode} placeholder="EMP-001" class="w-full" />
			</label>
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Department</span>
				<Input bind:value={form.department} placeholder="Front of house" class="w-full" />
			</label>
		</div>

		<!-- PIN -->
		<label class="block">
			<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">POS PIN</span>
			<div class="flex items-center gap-2">
				<Input
					bind:value={form.pin}
					type="password"
					inputmode="numeric"
					maxlength={6}
					placeholder="••••"
					class="w-36"
				/>
				{#if editingId && form.pin.length >= 4}
					<Button color="neutral" variant="subtle" size="sm" onclick={setPin}>Set PIN</Button>
				{/if}
				{#if editingId && staff.find((s) => s.id === editingId)?.data.pinHash}
					<Button color="neutral" variant="subtle" size="sm" icon="lucide:x" onclick={removePin}>Remove</Button>
				{/if}
			</div>
			<span class="mt-1 block text-[11px] text-[var(--ui-text-dimmed)]">
				{editingId && staff.find((s) => s.id === editingId)?.data.pinHash && !form.pin
					? '✓ PIN set (hashed)'
					: 'Stored as a SHA-256 hash, never plaintext.'}
			</span>
		</label>

		<!-- Hourly rate -->
		<label class="block">
			<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Hourly rate</span>
			<Input bind:value={form.hourlyRate} type="number" min="0" step="0.5" class="w-full" />
		</label>

		<!-- Status -->
		<div>
			<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Status</span>
			<div class="flex flex-wrap gap-2">
				{#each STATUSES as status (status)}
					<button
						type="button"
						onclick={() => (form.status = status)}
						class="rounded-lg border-2 px-3 py-1.5 text-[12px] font-medium capitalize transition-all {form.status === status
							? 'border-primary-500 bg-primary-500/10 text-primary-600 dark:text-primary-300'
							: 'border-[var(--ui-border)] text-[var(--ui-text-muted)] hover:border-[var(--ui-text-dimmed)]'}"
					>
						{status.replace('_', ' ')}
					</button>
				{/each}
			</div>
		</div>

		<!-- Branch assignment -->
		<div>
			<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Branches</span>
			<span class="mb-2 block text-[11px] text-[var(--ui-text-dimmed)]">
				Empty selection grants company-wide access.
			</span>
			<div class="space-y-1.5">
				{#each locations as branch (branch.id)}
					<label class="flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--ui-border)] px-3 py-2 text-[12.5px] hover:bg-[var(--ui-bg-accented)]">
						<input
							type="checkbox"
							checked={form.branchIds.includes(branch.id)}
							onchange={() => toggleBranch(branch.id)}
							class="accent-[var(--ui-color-primary-500)]"
						/>
						<span>{(branch.data as { name?: string }).name ?? branch.id}</span>
					</label>
				{:else}
					<span class="text-[11px] text-[var(--ui-text-dimmed)]">No branches configured.</span>
				{/each}
			</div>
		</div>

		<!-- Custom permissions -->
		<div class="rounded-xl border border-[var(--ui-border)] p-3">
			<div class="flex items-center justify-between">
				<span class="text-[12.5px] font-bold">Customize permissions</span>
				<Switch checked={form.useCustomPermissions} onCheckedChange={onCustomToggle} />
			</div>
			{#if form.useCustomPermissions}
				<div class="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
					{#each PERMISSION_RESOURCES as res (res.id)}
						<div>
							<p class="mb-1 text-[10.5px] font-bold text-[var(--ui-text-dimmed)] uppercase">{res.name}</p>
							<div class="flex flex-wrap gap-x-2 gap-y-0.5">
								{#each res.actions as action (action)}
									<label class="flex cursor-pointer items-center gap-1 text-[11px] capitalize">
										<input
											type="checkbox"
											checked={form.customPermissions.includes(`${res.id}:${action}`)}
											onchange={() => togglePermission(`${res.id}:${action}`)}
											class="accent-[var(--ui-color-primary-500)]"
										/>
										{action}
									</label>
								{/each}
							</div>
						</div>
					{/each}
				</div>
			{:else}
				<div class="mt-2 flex flex-wrap gap-1">
					{#each permissionPreview as perm (perm)}
						<Badge color="info">{perm}</Badge>
					{/each}
				</div>
			{/if}
		</div>
	</div>
	{#snippet footer()}
		<Button color="neutral" variant="ghost" onclick={() => (open = false)}>Cancel</Button>
		<Button color="primary" icon="lucide:check" disabled={!canSave} onclick={save}>
			{editingId ? 'Update' : 'Save'}
		</Button>
	{/snippet}
</Dialog>

<RawDataDialog bind:open={rawOpen} data={rawItem} title={rawTitle} />
