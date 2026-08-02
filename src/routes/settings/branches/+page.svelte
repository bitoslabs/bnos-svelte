<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { glo } from '$nostr/store.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { TYPE, type GloLocation, type Location } from '$lib/domain';

	onMount(() => {
		glo.hydrate(TYPE.branch);
		void glo.sync(TYPE.branch);
	});

	const branches = $derived(glo.all<Location, typeof TYPE.branch>(TYPE.branch));

	// Branch types
	const BRANCH_TYPES = [
		{ value: 'store', label: 'Store' },
		{ value: 'warehouse', label: 'Warehouse' },
		{ value: 'kiosk', label: 'Kiosk' },
		{ value: 'pop_up', label: 'Pop-up' },
		{ value: 'office', label: 'Office' }
	];

	// Add form state
	let name = $state('');
	let code = $state('');
	let branchType = $state('store');
	let address = $state('');
	let phone = $state('');
	let email = $state('');
	let status = $state('active');

	// Edit state
	let editOpen = $state(false);
	let editId = $state('');
	let editName = $state('');
	let editCode = $state('');
	let editType = $state('store');
	let editAddress = $state('');
	let editPhone = $state('');
	let editEmail = $state('');
	let editStatus = $state('active');

	function resetAddForm() {
		name = code = address = phone = email = '';
		branchType = 'store';
		status = 'active';
	}

	async function add() {
		if (!name.trim()) return toast.warning('Name required');
		await glo.upsert<Location>(TYPE.branch, {
			name: name.trim(),
			code: code.trim() || undefined,
			type: branchType,
			address: address.trim() || undefined,
			phone: phone.trim() || undefined,
			email: email.trim() || undefined,
			status
		});
		toast.success('Branch added');
		resetAddForm();
	}

	function openEdit(b: { id: string; data: Location }) {
		editId = b.id;
		editName = b.data.name ?? '';
		editCode = b.data.code ?? '';
		editType = (b.data.type as string) ?? 'store';
		editAddress = b.data.address ?? '';
		editPhone = b.data.phone ?? '';
		editEmail = (b.data as { email?: string }).email ?? '';
		editStatus = b.data.status ?? 'active';
		editOpen = true;
	}

	async function saveEdit() {
		if (!editName.trim()) return toast.warning('Name required');
		await glo.upsert<Location>(TYPE.branch, {
			name: editName.trim(),
			code: editCode.trim() || undefined,
			type: editType,
			address: editAddress.trim() || undefined,
			phone: editPhone.trim() || undefined,
			email: editEmail.trim() || undefined,
			status: editStatus
		}, { id: editId });
		toast.success('Branch updated');
		editOpen = false;
	}

	function typeIcon(t: string): string {
		switch (t) {
			case 'warehouse': return 'lucide:warehouse';
			case 'kiosk': return 'lucide:store';
			case 'pop_up': return 'lucide:tent';
			case 'office': return 'lucide:building-2';
			default: return 'lucide:store';
		}
	}

	function typeLabel(t: string): string {
		return BRANCH_TYPES.find((bt) => bt.value === t)?.label ?? 'Store';
	}
</script>

<svelte:head><title>Branches · Settings</title></svelte:head>

<div class="space-y-4">
	<div class="flex items-center gap-3">
		<Icon name="lucide:map-pin" class="size-5 text-primary-500" />
		<div>
			<h2 class="font-display text-[15px] font-semibold tracking-tight">Branches</h2>
			<p class="text-[12px] text-[var(--ui-text-muted)]">
				Locations · GLO <code>location</code> (kind 30600) · current:
				<strong>{tenant.state.locationName || 'Main'}</strong>
			</p>
		</div>
	</div>

	<!-- Add form -->
	<div class="surface-card space-y-3 p-4">
		<div class="text-[12px] font-semibold text-[var(--ui-text-muted)] uppercase tracking-wider">Add new branch</div>
		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Name</span>
				<Input bind:value={name} icon="lucide:map-pin" placeholder="Downtown branch" class="w-full" />
			</label>
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Code</span>
				<Input bind:value={code} icon="lucide:hash" placeholder="DT-01" class="w-full" />
			</label>
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Type</span>
				<Select bind:value={branchType} options={BRANCH_TYPES} class="w-full" />
			</label>
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Phone</span>
				<Input bind:value={phone} icon="lucide:phone" placeholder="+856 …" class="w-full" />
			</label>
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Email</span>
				<Input bind:value={email} icon="lucide:at-sign" placeholder="branch@store.com" class="w-full" />
			</label>
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Status</span>
				<Select
					bind:value={status}
					options={[
						{ value: 'active', label: 'Active' },
						{ value: 'inactive', label: 'Inactive' }
					]}
					class="w-full"
				/>
			</label>
		</div>
		<label class="block">
			<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Address</span>
			<Input bind:value={address} icon="lucide:map-pin" placeholder="123 Main St, City" class="w-full" />
		</label>
		<div>
			<Button color="primary" icon="lucide:plus" onclick={add}>Add branch</Button>
		</div>
	</div>

	<!-- Branch list -->
	{#if branches.length === 0}
		<EmptyState
			icon="lucide:map-pin"
			title="No branches"
			description="Add more locations for multi-branch operations."
		/>
	{:else}
		<div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
			{#each branches as b (b.id)}
				<div class="surface-card p-4">
					<div class="flex items-start justify-between gap-3">
						<div class="flex items-start gap-3">
							<div class="grid size-10 shrink-0 place-items-center rounded-lg bg-primary-500/10">
								<Icon name={typeIcon((b.data.type as string) ?? 'store')} class="size-5 text-primary-500" />
							</div>
							<div class="min-w-0">
								<div class="flex items-center gap-2">
									<span class="font-semibold">{b.data.name}</span>
									<Badge color={b.data.status === 'active' ? 'success' : 'neutral'}>{b.data.status ?? 'active'}</Badge>
								</div>
								<div class="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-[var(--ui-text-dimmed)]">
									{#if b.data.code}
										<span class="font-mono">{b.data.code}</span>
									{/if}
									<span>·</span>
									<span>{typeLabel((b.data.type as string) ?? 'store')}</span>
								</div>
							</div>
						</div>
						<div class="flex shrink-0 gap-1">
							<Button
								color="neutral"
								variant="ghost"
								size="icon-sm"
								icon="lucide:pencil"
								onclick={() => openEdit({ id: b.id, data: b.data })}
							/>
							<Button
								color="neutral"
								variant="ghost"
								size="icon-sm"
								icon="lucide:trash-2"
								onclick={() => {
									glo.remove(TYPE.branch, b.id);
									toast.info('Removed');
								}}
							/>
						</div>
					</div>

					<!-- Detail fields -->
					<div class="mt-3 space-y-1 border-t border-[var(--ui-border-muted)] pt-3 text-[12px]">
						{#if b.data.address}
							<div class="flex items-center gap-2 text-[var(--ui-text-muted)]">
								<Icon name="lucide:map-pin" class="size-3.5 shrink-0 text-[var(--ui-text-dimmed)]" />
								<span>{b.data.address}</span>
							</div>
						{/if}
						{#if b.data.phone}
							<div class="flex items-center gap-2 text-[var(--ui-text-muted)]">
								<Icon name="lucide:phone" class="size-3.5 shrink-0 text-[var(--ui-text-dimmed)]" />
								<span>{b.data.phone}</span>
							</div>
						{/if}
						{#if (b.data as { email?: string }).email}
							<div class="flex items-center gap-2 text-[var(--ui-text-muted)]">
								<Icon name="lucide:at-sign" class="size-3.5 shrink-0 text-[var(--ui-text-dimmed)]" />
								<span>{(b.data as { email?: string }).email}</span>
							</div>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<!-- Edit Dialog -->
<Dialog bind:open={editOpen} title="Edit branch" size="lg">
	<div class="space-y-3">
		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Name</span>
				<Input bind:value={editName} icon="lucide:map-pin" class="w-full" />
			</label>
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Code</span>
				<Input bind:value={editCode} icon="lucide:hash" class="w-full" />
			</label>
		</div>
		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Type</span>
				<Select bind:value={editType} options={BRANCH_TYPES} class="w-full" />
			</label>
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
		</div>
		<label class="block">
			<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Address</span>
			<Input bind:value={editAddress} icon="lucide:map-pin" class="w-full" />
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
	</div>
	{#snippet footer()}
		<Button color="neutral" variant="ghost" onclick={() => (editOpen = false)}>Cancel</Button>
		<Button color="primary" icon="lucide:check" onclick={saveEdit}>Save changes</Button>
	{/snippet}
</Dialog>
