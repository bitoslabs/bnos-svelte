<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import {
		readOrganizationSettings,
		writeOrganizationSettings,
		syncOrganizationSettingsToWorkspace,
		type OrganizationSettingsSnapshot as OrgSettings
	} from '$nostr/organization-settings';
	import { toast } from '$lib/stores/toast.svelte';
	import { browser } from '$app/environment';

	/**
	 * Ownership model (no more conflicts):
	 *  - Store name      → active company (tenant.organizationName + org snapshot)
	 *  - Phone/addr/email → active branch (org snapshot + GLO location record)
	 *  - Logo & website  → local branding only (this page's own localStorage key)
	 */
	const BRANDING_KEY = 'bnos-os:settings-store';

	// Branding (page-owned)
	let storeLogo = $state('');
	let storeWebsite = $state('');

	// Mirrors of the active company / branch (edited here, persisted to org snapshot)
	let storeName = $state('');
	let storePhone = $state('');
	let storeAddress = $state('');
	let storeEmail = $state('');

	// Context
	let hasActiveCompany = $state(false);
	let hasActiveBranch = $state(false);
	let activeCompanyName = $state('');
	let activeBranchName = $state('');

	onMount(() => {
		if (!browser) return;
		hydrate();
	});

	function hydrate() {
		if (!browser) return;
		// Branding
		try {
			const b = JSON.parse(localStorage.getItem(BRANDING_KEY) ?? '{}');
			storeLogo = b.storeLogo ?? '';
			storeWebsite = b.storeWebsite ?? '';
		} catch {
			/* */
		}

		// Active company + branch from the org snapshot (single source of truth)
		const snap = readOrganizationSettings();
		const company = snap?.companies.find((c) => c.id === snap?.activeCompanyId);
		const branch = snap?.branches.find((br) => br.id === snap?.activeBranchId);

		hasActiveCompany = !!company;
		hasActiveBranch = !!branch;
		activeCompanyName = company?.name ?? '';
		activeBranchName = branch?.name ?? '';

		storeName = company?.name ?? tenant.state.organizationName ?? '';
		storePhone = branch?.phone ?? '';
		storeAddress = branch?.address ?? '';
		storeEmail = branch?.email ?? '';
	}

	async function save() {
		if (!browser) return;

		// 1) Branding (page-owned)
		localStorage.setItem(BRANDING_KEY, JSON.stringify({ storeLogo, storeWebsite }));

		// 2) Company name + branch contact → org snapshot (the single source of truth)
		const snap = readOrganizationSettings();
		if (snap) {
			let mutated = false;
			if (hasActiveCompany) {
				const idx = snap.companies.findIndex((c) => c.id === snap.activeCompanyId);
				if (idx >= 0 && snap.companies[idx].name !== storeName) {
					snap.companies[idx] = { ...snap.companies[idx], name: storeName };
					mutated = true;
				}
			}
			if (hasActiveBranch) {
				const idx = snap.branches.findIndex((b) => b.id === snap.activeBranchId);
				if (idx >= 0) {
					snap.branches[idx] = {
						...snap.branches[idx],
						phone: storePhone,
						address: storeAddress,
						email: storeEmail
					};
					mutated = true;
				}
			}
			if (mutated) writeOrganizationSettings(snap);
		}

		// 3) Keep the runtime tenant in sync (name drives sidebar, customer display, receipts)
		if (hasActiveCompany) {
			tenant.configure({ organizationName: storeName });
		}

		// 4) Push company + branch updates to the workspace/GLO layer
		try {
			await syncOrganizationSettingsToWorkspace();
		} catch {
			/* non-fatal */
		}

		activeCompanyName = storeName;
		toast.success('Store profile saved');
	}

	function handleLogoUpload(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		if (file.size > 2 * 1024 * 1024) {
			toast.warning('Logo must be under 2MB');
			return;
		}
		const reader = new FileReader();
		reader.onload = (ev) => {
			storeLogo = ev.target?.result as string;
		};
		reader.readAsDataURL(file);
	}

	const initials = $derived(
		(storeName || 'BNOS')
			.split(/[\s_-]+/)
			.map((w) => w[0])
			.join('')
			.toUpperCase()
			.slice(0, 2)
	);
</script>

<svelte:head><title>Store profile · Settings</title></svelte:head>

<div class="space-y-5">
	<PageHeader
		icon="lucide:store"
		title="Store profile"
		description="Public-facing identity, branding & contact for the active location"
	/>

	<!-- Active context -->
	<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
		<div class="flex items-center gap-2 px-5 py-3">
			<Icon name="lucide:navigation" class="size-4 text-primary-500" />
			<h2 class="font-display text-[14px] font-semibold">Editing</h2>
		</div>
		<div class="grid grid-cols-1 gap-4 px-5 py-4 sm:grid-cols-2">
			<div class="space-y-1">
				<p class="text-[11px] font-semibold tracking-wider text-[var(--ui-text-dimmed)] uppercase">
					Company
				</p>
				{#if hasActiveCompany}
					<div class="flex items-center gap-2">
						<div
							class="grid size-7 shrink-0 place-items-center rounded-lg bg-primary-500/10 text-[10px] font-bold text-primary-600 dark:text-primary-400"
						>
							{activeCompanyName?.charAt(0)?.toUpperCase() || '?'}
						</div>
						<p class="truncate text-[13px] font-bold">{activeCompanyName || 'Unnamed'}</p>
					</div>
				{:else}
					<p class="text-[12px] text-[var(--ui-text-dimmed)] italic">No active company</p>
				{/if}
			</div>
			<div class="space-y-1">
				<p class="text-[11px] font-semibold tracking-wider text-[var(--ui-text-dimmed)] uppercase">
					Branch
				</p>
				{#if hasActiveBranch}
					<div class="flex items-center gap-2">
						<Icon name="lucide:map-pin" class="size-[13px] text-sky-500" />
						<p class="truncate text-[13px] font-bold">{activeBranchName}</p>
					</div>
				{:else}
					<p class="text-[12px] text-[var(--ui-text-dimmed)] italic">No active branch</p>
				{/if}
			</div>
		</div>
		{#if !hasActiveCompany}
			<div class="flex items-center justify-between gap-4 px-5 py-3">
				<p class="text-[11px] text-[var(--ui-text-dimmed)]">Set up a company and branch first.</p>
				<Button
					href="/settings/organization"
					variant="subtle"
					size="sm"
					icon="lucide:arrow-up-right">Open Workspace</Button
				>
			</div>
		{/if}
	</section>

	<!-- Store Logo -->
	<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
		<div class="flex items-center gap-2 px-5 py-3">
			<Icon name="lucide:image" class="size-4 text-primary-500" />
			<h2 class="font-display text-[14px] font-semibold">Store logo</h2>
		</div>
		<div class="flex items-start gap-5 px-5 py-5">
			<div
				class="grid size-24 shrink-0 place-items-center overflow-hidden rounded-2xl border-2 border-dashed border-[var(--ui-border)] bg-[var(--ui-bg-muted)]"
			>
				{#if storeLogo}<img
						src={storeLogo}
						alt="Logo"
						class="h-full w-full object-contain p-1.5"
					/>{:else}<div class="text-center">
						<Icon name="lucide:shop" class="size-7 text-[var(--ui-text-dimmed)]" />
						<p class="mt-1 text-[8px] text-[var(--ui-text-dimmed)]">No logo</p>
					</div>{/if}
			</div>
			<div class="flex-1 space-y-3">
				<Input
					bind:value={storeLogo}
					placeholder="Logo URL or data URI"
					icon="lucide:link"
					class="w-full"
				/>
				<div class="flex gap-2">
					<label
						class="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-primary-500/30 px-3.5 py-2 text-[12px] font-semibold text-primary-600 transition-colors hover:bg-primary-500/10 dark:text-primary-400"
					>
						<Icon name="lucide:upload" class="size-3.5" />Upload
						<input type="file" accept="image/*" class="hidden" onchange={handleLogoUpload} />
					</label>
					{#if storeLogo}<Button
							color="error"
							variant="ghost"
							size="sm"
							icon="lucide:trash-2"
							onclick={() => (storeLogo = '')}>Remove</Button
						>{/if}
				</div>
				<p class="text-[10px] text-[var(--ui-text-dimmed)]">
					PNG, JPG or SVG · max 2MB · recommended 256×256
				</p>
			</div>
		</div>
	</section>

	<!-- Identity -->
	<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
		<div class="flex items-center gap-2 px-5 py-3">
			<Icon name="lucide:shop" class="size-4 text-primary-500" />
			<h2 class="font-display text-[14px] font-semibold">Identity</h2>
		</div>
		<div class="px-5 py-4">
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">
					Store name {#if hasActiveCompany}<span class="font-normal text-[var(--ui-text-dimmed)]"
							>· active company</span
						>{/if}
				</span>
				<Input
					bind:value={storeName}
					placeholder="My Store"
					class="w-full"
					disabled={!hasActiveCompany}
				/>
			</label>
			{#if !hasActiveCompany}
				<p class="mt-1.5 text-[10px] text-[var(--ui-text-dimmed)]">
					Name comes from the active company — create one in Workspace.
				</p>
			{/if}
		</div>
		<div class="px-5 py-4">
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
					>Website</span
				>
				<Input
					bind:value={storeWebsite}
					placeholder="https://mystore.com"
					icon="lucide:globe"
					class="w-full"
				/>
			</label>
		</div>
	</section>

	<!-- Branch contact -->
	<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
		<div class="flex items-center gap-2 px-5 py-3">
			<Icon name="lucide:map-pin" class="size-4 text-primary-500" />
			<h2 class="font-display text-[14px] font-semibold">Location contact</h2>
			{#if hasActiveBranch}<Badge color="info">{activeBranchName}</Badge>{/if}
		</div>
		<div class="px-5 py-4">
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
					>Address</span
				>
				<Input
					bind:value={storeAddress}
					placeholder="Street, city, country"
					icon="lucide:map-pin"
					class="w-full"
					disabled={!hasActiveBranch}
				/>
			</label>
		</div>
		<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
			<div class="px-5 py-4">
				<label class="block">
					<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>Phone</span
					>
					<Input
						bind:value={storePhone}
						placeholder="+856 20 xxxx xxx"
						icon="lucide:phone"
						class="w-full"
						disabled={!hasActiveBranch}
					/>
				</label>
			</div>
			<div class="px-5 py-4">
				<label class="block">
					<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>Email</span
					>
					<Input
						bind:value={storeEmail}
						placeholder="branch@store.com"
						icon="lucide:mail"
						class="w-full"
						disabled={!hasActiveBranch}
					/>
				</label>
			</div>
		</div>
		{#if !hasActiveBranch}
			<p class="px-5 pb-4 text-[10px] text-[var(--ui-text-dimmed)]">
				Contact belongs to the active branch — select one in Workspace.
			</p>
		{/if}
	</section>

	<!-- Preview -->
	<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
		<div class="flex items-center gap-2 px-5 py-3">
			<Icon name="lucide:eye" class="size-4 text-primary-500" />
			<h2 class="font-display text-[14px] font-semibold">Preview</h2>
		</div>
		<div class="px-5 py-4">
			<div
				class="flex items-center gap-4 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] p-4"
			>
				{#if storeLogo}<img
						src={storeLogo}
						alt="Logo"
						class="size-14 shrink-0 rounded-xl object-contain"
					/>{:else}<div
						class="grid size-14 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary-400 to-primary-600 font-display text-xl font-black text-white"
					>
						{initials}
					</div>{/if}
				<div class="min-w-0">
					<p class="truncate font-display text-[15px] font-bold">{storeName || 'My Store'}</p>
					{#if storeAddress}<p class="truncate text-[11px] text-[var(--ui-text-muted)]">
							{storeAddress}
						</p>{/if}
					<div class="mt-1 flex items-center gap-3">
						{#if storePhone}<span
								class="flex items-center gap-1 text-[10px] text-[var(--ui-text-dimmed)]"
								><Icon name="lucide:phone" class="size-3" />{storePhone}</span
							>{/if}
						{#if storeWebsite}<span class="flex items-center gap-1 text-[10px] text-primary-500"
								><Icon name="lucide:globe" class="size-3" />{storeWebsite}</span
							>{/if}
					</div>
				</div>
			</div>
		</div>
	</section>

	<div class="flex justify-end">
		<Button color="primary" icon="lucide:check" onclick={save}>Save changes</Button>
	</div>
</div>
