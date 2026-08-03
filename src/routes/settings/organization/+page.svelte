<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import Switch from '$lib/components/ui/Switch.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { tenant, type BusinessModel, type BusinessType } from '$nostr/tenant.svelte';
	import {
		readOrganizationSettings,
		writeOrganizationSettings,
		upsertOrganizationSettingsFromTenant,
		syncOrganizationSettingsToWorkspace,
		type CompanySettings as Company,
		type BranchSettings as Branch,
		type OrganizationSettingsSnapshot as OrgSettings
	} from '$nostr/organization-settings';
	import { toast } from '$lib/stores/toast.svelte';
	import { browser } from '$app/environment';

	// ── State ──
	let companies = $state<Company[]>([]);
	let branches = $state<Branch[]>([]);
	let activeCompanyId = $state('');
	let activeBranchId = $state('');

	// Quick-switch selectors
	let switchCompanyId = $state('');
	let switchBranchId = $state('');

	// ── Company Modal State ──
	let companyModalOpen = $state(false);
	let editingCompanyCode = $state<string | null>(null);

	let companyForm = $state({
		name: '',
		code: '',
		businessModel: 'single' as BusinessModel,
		businessType: 'retail' as BusinessType,
		currency: 'USD',
		enableTax: true,
		taxRate: 8
	});

	// ── Branch Modal State ──
	let branchModalOpen = $state(false);
	let editingBranchId = $state<string | null>(null);
	let branchFormCompanyId = $state('');

	let branchForm = $state({
		name: '',
		code: '',
		address: '',
		phone: '',
		email: '',
		status: 'active' as 'active' | 'inactive'
	});

	// ── Constants ──
	const businessModels: { value: BusinessModel; label: string }[] = [
		{ value: 'single', label: 'Single Store' },
		{ value: 'multi_branch', label: 'Multi-Branch' },
		{ value: 'chain', label: 'Chain' },
		{ value: 'franchise_hq', label: 'Franchise HQ' },
		{ value: 'franchise_branch', label: 'Franchise Branch' }
	];

	const businessTypes: { value: BusinessType; label: string }[] = [
		{ value: 'retail', label: 'Retail' },
		{ value: 'restaurant', label: 'Restaurant' },
		{ value: 'cafe', label: 'Café' },
		{ value: 'service', label: 'Service' },
		{ value: 'wholesale', label: 'Wholesale' },
		{ value: 'other', label: 'Other' }
	];

	const currencyOptions = [
		'USD', 'EUR', 'GBP', 'JPY', 'THB', 'LAK', 'VND', 'CNY', 'BTC', 'SATS'
	].map((c) => ({ value: c, label: c }));

	// ── Derived ──
	const activeCompanyName = $derived(
		companies.find((c) => c.id === activeCompanyId)?.name ?? ''
	);
	const activeBranchName = $derived(
		branches.find((b) => b.id === activeBranchId)?.name ?? ''
	);
	const companyCount = $derived(companies.length);
	const filteredSwitchBranches = $derived(
		switchCompanyId ? branches.filter((b) => b.storeId === switchCompanyId) : []
	);

	function getBranchesForCompany(storeId: string): Branch[] {
		return branches.filter((b) => b.storeId === storeId);
	}

	// ── Persistence ──
	function loadSettings() {
		if (!browser) return;
		try {
			const s = readOrganizationSettings();
			if (s) {
				companies = s.companies ?? [];
				branches = s.branches ?? [];
				activeCompanyId = s.activeCompanyId ?? (tenant.state.organizationId || '');
				activeBranchId = s.activeBranchId ?? (tenant.state.locationId || '');
			} else {
				// Seed from tenant if available
				upsertOrganizationSettingsFromTenant(tenant.state);
				activeCompanyId = tenant.state.organizationId || '';
				activeBranchId = tenant.state.locationId || '';
				if (tenant.state.organizationId && tenant.state.organizationName) {
					companies = [{
						id: tenant.state.organizationId,
						code: tenant.state.organizationCode || tenant.state.organizationId,
						name: tenant.state.organizationName,
						businessModel: tenant.state.businessModel,
						businessType: tenant.state.businessType,
						currency: tenant.state.currency,
						enableTax: tenant.state.defaultTaxRate > 0,
						taxRate: tenant.state.defaultTaxRate
					}];
				}
				if (tenant.state.locationId && tenant.state.organizationId) {
					branches = [{
						id: tenant.state.locationId,
						code: tenant.state.locationId,
						storeId: tenant.state.organizationId,
						name: tenant.state.locationName || 'Main Branch',
						address: '',
						phone: '',
						email: '',
						status: 'active'
					}];
				}
			}
			switchCompanyId = activeCompanyId;
			switchBranchId = activeBranchId;
		} catch { /* */ }
	}

	async function persist() {
		if (!browser) return;
		const s: OrgSettings = { companies, branches, activeCompanyId, activeBranchId };
		writeOrganizationSettings(s);
		await syncOrganizationSettingsToWorkspace(s);
	}

	// ── Lifecycle ──
	onMount(() => loadSettings());

	// ── Helpers ──
	function normalizeSlug(input: string, fallback = 'company'): string {
		const slug = input
			.toLowerCase()
			.trim()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '');
		return slug || fallback;
	}

	function branchCodeFromName(name: string): string {
		return name
			.toUpperCase()
			.replace(/[^A-Z0-9]+/g, '-')
			.replace(/^-|-$/g, '');
	}

	// ── Quick Switch ──
	async function handleSwitchCompany() {
		if (!switchCompanyId) return;
		activeCompanyId = switchCompanyId;
		activeBranchId = '';
		switchBranchId = '';
		await persist();
		syncTenant();
		toast.success('Company switched');
	}

	async function handleSwitchBranch() {
		if (!switchBranchId) return;
		activeBranchId = switchBranchId;
		await persist();
		syncTenant();
		toast.success('Branch switched');
	}

	function syncTenant() {
		const company = companies.find((c) => c.id === activeCompanyId);
		const branch = branches.find((b) => b.id === activeBranchId);
		tenant.configure({
			organizationId: company?.id ?? '',
			organizationCode: company?.code ?? '',
			organizationName: company?.name ?? '',
			businessModel: company?.businessModel ?? 'single',
			businessType: company?.businessType ?? 'retail',
			currency: company?.currency ?? 'USD',
			defaultTaxRate: company?.enableTax ? company.taxRate : 0,
			locationId: branch?.id ?? null,
			locationName: branch?.name ?? ''
		});
		upsertOrganizationSettingsFromTenant({
			...tenant.state,
			organizationId: company?.id ?? '',
			organizationCode: company?.code ?? '',
			organizationName: company?.name ?? '',
			businessModel: company?.businessModel ?? 'single',
			businessType: company?.businessType ?? 'retail',
			currency: company?.currency ?? 'USD',
			defaultTaxRate: company?.enableTax ? company.taxRate : 0,
			locationId: branch?.id ?? null,
			locationName: branch?.name ?? ''
		});
	}

	// ── Company Modal ──
	function openCompanyModal(company?: Company) {
		if (company) {
			editingCompanyCode = company.code;
			companyForm = {
				name: company.name,
				code: company.code,
				businessModel: company.businessModel,
				businessType: company.businessType,
				currency: company.currency,
				enableTax: company.enableTax,
				taxRate: company.taxRate
			};
		} else {
			editingCompanyCode = null;
			companyForm = {
				name: '',
				code: '',
				businessModel: 'single',
				businessType: 'retail',
				currency: 'USD',
				enableTax: true,
				taxRate: 8
			};
		}
		companyModalOpen = true;
	}

	async function handleSaveCompany() {
		if (!companyForm.name.trim()) return;
		companyForm.code = normalizeSlug(companyForm.code || companyForm.name, 'company');

		if (editingCompanyCode) {
			// Update existing
			const idx = companies.findIndex((c) => c.code === editingCompanyCode);
			if (idx >= 0) {
				companies[idx] = { ...companies[idx], ...companyForm };
			}
			toast.success('Company updated');
		} else {
			// Check duplicate
			if (companies.some((c) => c.code === companyForm.code)) {
				toast.error('Code already used');
				return;
			}
			companies = [...companies, { id: crypto.randomUUID(), ...companyForm }];
			toast.success('Company created');
		}

		// Auto-activate first company
		if (!activeCompanyId && companies.length === 1) {
			activeCompanyId = companies[0].id;
		}

		companyModalOpen = false;
		await persist();
		syncTenant();
	}

	async function handleDeleteCompany(id: string) {
		if (!browser) return;
		if (!confirm(`Delete company? This will also remove all associated branches.`))
			return;
		companies = companies.filter((c) => c.id !== id);
		branches = branches.filter((b) => b.storeId !== id);
		if (activeCompanyId === id) {
			activeCompanyId = '';
			activeBranchId = '';
		}
		await persist();
		syncTenant();
		toast.success('Company deleted');
	}

	// Auto-generate code from name for new companies
	$effect(() => {
		if (companyForm.name && !editingCompanyCode) {
			companyForm.code = normalizeSlug(companyForm.name, 'company');
		}
	});

	// ── Branch Modal ──
	function openBranchModal(companyId: string, branch?: Branch) {
		branchFormCompanyId = companyId;
		if (branch) {
			editingBranchId = branch.id;
			branchForm = {
				name: branch.name,
				code: branch.code,
				address: branch.address,
				phone: branch.phone,
				email: branch.email,
				status: branch.status
			};
		} else {
			editingBranchId = null;
			branchForm = {
				name: '',
				code: '',
				address: '',
				phone: '',
				email: '',
				status: 'active'
			};
		}
		branchModalOpen = true;
	}

	async function handleSaveBranch() {
		if (!branchForm.name.trim()) return;

		if (editingBranchId) {
			const idx = branches.findIndex((b) => b.id === editingBranchId);
			if (idx >= 0) {
				branches[idx] = {
					...branches[idx],
					name: branchForm.name,
					address: branchForm.address,
					phone: branchForm.phone,
					email: branchForm.email,
					status: branchForm.status
				};
			}
			toast.success('Branch updated');
		} else {
			const code = branchForm.code || branchCodeFromName(branchForm.name);
			if (branches.some((b) => b.code === code && b.storeId === branchFormCompanyId)) {
				toast.error('Branch code already used in this company');
				return;
			}
			branches = [...branches, {
				id: `${branchFormCompanyId}-${code}-${Date.now()}`,
				code,
				storeId: branchFormCompanyId,
				name: branchForm.name,
				address: branchForm.address,
				phone: branchForm.phone,
				email: branchForm.email,
				status: branchForm.status
			}];
			toast.success('Branch created');
		}

		branchModalOpen = false;
		await persist();
	}

	// Auto-generate branch code from name for new branches
	$effect(() => {
		if (branchForm.name && !editingBranchId) {
			branchForm.code = branchCodeFromName(branchForm.name);
		}
	});

	async function handleDeleteBranch(id: string, label = id) {
		if (!browser) return;
		if (!confirm(`Delete branch "${label}"?`)) return;
		branches = branches.filter((b) => b.id !== id);
		const removed = branches.find((b) => b.id === id);
		if (removed && activeBranchId === removed.id) {
			activeBranchId = '';
		}
		await persist();
		syncTenant();
		toast.success('Branch deleted');
	}

	function resetAll() {
		if (!browser) return;
		if (!confirm('Reset organization settings? This removes all companies and branches.')) return;
		writeOrganizationSettings({ companies: [], branches: [], activeCompanyId: '', activeBranchId: '' });
		companies = [];
		branches = [];
		activeCompanyId = '';
		activeBranchId = '';
		switchCompanyId = '';
		switchBranchId = '';
		toast.info('Organization settings reset');
	}
</script>

<svelte:head><title>Workspace · Settings</title></svelte:head>

<div class="space-y-5">
	<div>
		<h1 class="font-display text-xl font-bold tracking-tight">Workspace</h1>
		<p class="text-[12.5px] text-[var(--ui-text-muted)]">
			Manage workspace structure, active branch, and business configuration in one place
		</p>
	</div>

	<!-- Active Context Card -->
	<section id="workspace-context" class="surface-card divide-y divide-[var(--ui-border-muted)]">
		<div class="flex items-center gap-2 px-5 py-3">
			<Icon name="lucide:badge-check" class="size-4 text-primary-500" />
			<h2 class="font-display text-[14px] font-semibold">Active context</h2>
		</div>
		<div class="grid grid-cols-1 gap-4 px-5 py-4 sm:grid-cols-3">
			<!-- Active Company -->
			<div class="space-y-1">
				<p class="text-[11px] font-semibold tracking-wider text-[var(--ui-text-dimmed)] uppercase">
					Company
				</p>
				{#if activeCompanyId}
					<div class="flex items-center gap-2">
						<div
							class="grid size-7 shrink-0 place-items-center rounded-lg bg-primary-500/10 text-[10px] font-bold text-primary-600 dark:text-primary-400"
						>
							{activeCompanyName?.charAt(0)?.toUpperCase() || '?'}
						</div>
						<div class="min-w-0">
							<p class="truncate text-[13px] font-bold">{activeCompanyName || activeCompanyId}</p>
							<p class="font-mono text-[10px] text-[var(--ui-text-dimmed)]">{activeCompanyId}</p>
						</div>
					</div>
				{:else}
					<p class="text-[12px] text-[var(--ui-text-dimmed)] italic">None selected</p>
				{/if}
			</div>

			<!-- Active Branch -->
			<div class="space-y-1">
				<p class="text-[11px] font-semibold tracking-wider text-[var(--ui-text-dimmed)] uppercase">
					Branch
				</p>
				{#if activeBranchId}
					<div class="flex items-center gap-2">
						<div
							class="grid size-7 shrink-0 place-items-center rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400"
						>
							<Icon name="lucide:map-pin" class="size-[13px]" />
						</div>
						<div class="min-w-0">
							<p class="truncate text-[13px] font-bold">{activeBranchName || activeBranchId}</p>
							<p class="font-mono text-[10px] text-[var(--ui-text-dimmed)]">{activeBranchId}</p>
						</div>
					</div>
				{:else}
					<p class="text-[12px] text-[var(--ui-text-dimmed)] italic">None selected</p>
				{/if}
			</div>

			<!-- Quick Switch -->
			<div class="space-y-1">
				<p class="text-[11px] font-semibold tracking-wider text-[var(--ui-text-dimmed)] uppercase">
					Quick switch
				</p>
				<Select
					bind:value={switchCompanyId}
					options={[{ value: '', label: 'Select company…' }, ...companies.map((c) => ({ value: c.id, label: c.name }))]}
					size="sm"
					class="w-full"
					onchange={handleSwitchCompany}
				/>
				{#if switchCompanyId}
					<Select
						bind:value={switchBranchId}
						options={[{ value: '', label: 'Select branch…' }, ...filteredSwitchBranches.map((b) => ({ value: b.id, label: `${b.name} (${b.code})` }))]}
						size="sm"
						class="w-full"
						onchange={handleSwitchBranch}
					/>
				{/if}
			</div>
		</div>
	</section>

	<!-- Companies List -->
	<section id="branches" class="surface-card divide-y divide-[var(--ui-border-muted)]">
		<div class="flex items-center justify-between gap-2 px-5 py-3">
			<div class="flex items-center gap-2">
				<Icon name="lucide:building-2" class="size-4 text-primary-500" />
				<h2 class="font-display text-[14px] font-semibold">
					Companies <span class="text-[10px] font-normal text-[var(--ui-text-dimmed)]">({companyCount})</span>
				</h2>
			</div>
			<Button variant="subtle" size="sm" icon="lucide:plus" onclick={() => openCompanyModal()}>
				Add company
			</Button>
		</div>

		{#if companies.length === 0}
			<div class="p-6">
				<EmptyState icon="lucide:building-2" title="No companies yet">
					{#snippet actions()}
						<Button variant="subtle" size="sm" icon="lucide:plus" onclick={() => openCompanyModal()}>
							Add first company
						</Button>
					{/snippet}
				</EmptyState>
			</div>
		{:else}
			{#each companies as company (company.id)}
				<div class="px-5 py-4">
					<div class="flex items-start justify-between gap-3">
						<div class="flex items-start gap-3 min-w-0">
							<div
								class="grid size-9 shrink-0 place-items-center rounded-xl text-[12px] font-bold text-white {activeCompanyId === company.id ? 'bg-primary-500' : 'bg-[var(--ui-text-dimmed)]'}"
							>
								{company.name?.charAt(0)?.toUpperCase() || '?'}
							</div>
							<div class="min-w-0">
								<p class="truncate text-[13px] font-bold">{company.name}</p>
								<div class="mt-0.5 flex flex-wrap items-center gap-2">
									<span class="font-mono text-[10px] text-[var(--ui-text-dimmed)]">{company.code}</span>
									<span class="text-[10px] text-[var(--ui-text-dimmed)]">•</span>
									<span class="text-[10px] text-[var(--ui-text-muted)]">{company.businessModel}</span>
									<span class="text-[10px] text-[var(--ui-text-dimmed)]">•</span>
									<span class="text-[10px] text-[var(--ui-text-muted)]">{company.currency}</span>
									{#if activeCompanyId === company.id}
										<Badge color="success">Active</Badge>
									{/if}
								</div>
							</div>
						</div>
						<div class="flex shrink-0 items-center gap-1">
							<Button
								variant="ghost"
								size="icon-sm"
								icon="lucide:pencil"
								onclick={() => openCompanyModal(company)}
							/>
							<Button
								color="error"
								variant="ghost"
								size="icon-sm"
								icon="lucide:trash-2"
								onclick={() => handleDeleteCompany(company.id)}
							/>
						</div>
					</div>

					<!-- Branches for this company -->
					<div class="mt-3 ml-12">
						<div class="mb-1.5 flex items-center justify-between">
							<p class="text-[10px] font-semibold tracking-wider text-[var(--ui-text-dimmed)] uppercase">
								Branches <span class="font-normal">({getBranchesForCompany(company.id).length})</span>
							</p>
							<button
								type="button"
								class="flex items-center gap-0.5 text-[10px] font-semibold text-primary-600 hover:text-primary-500 dark:text-primary-400"
								onclick={() => openBranchModal(company.id)}
							>
								<Icon name="lucide:plus" class="size-[10px]" />
								Add branch
							</button>
						</div>
						{#each getBranchesForCompany(company.id) as branch (branch.id)}
							<div
								class="group flex items-center justify-between rounded-lg px-2.5 py-1.5 transition-colors hover:bg-[var(--ui-bg-accented)]"
							>
								<div class="flex items-center gap-2 min-w-0">
									<Icon name="lucide:map-pin" class="size-[11px] shrink-0 text-[var(--ui-text-dimmed)]" />
									<span class="truncate text-[12px] text-[var(--ui-text-muted)]">{branch.name}</span>
									<span class="font-mono text-[10px] text-[var(--ui-text-dimmed)]">{branch.code}</span>
									<Badge color={branch.status === 'active' ? 'success' : 'neutral'}>{branch.status}</Badge>
									{#if activeBranchId === branch.id}
										<Badge color="info">Active</Badge>
									{/if}
								</div>
								<div class="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
									<button
										type="button"
										class="grid size-5 place-items-center rounded text-[var(--ui-text-dimmed)] transition-colors hover:text-sky-500"
										onclick={() => openBranchModal(company.id, branch)}
									>
										<Icon name="lucide:pencil" class="size-[10px]" />
									</button>
									<button
										type="button"
										class="grid size-5 place-items-center rounded text-[var(--ui-text-dimmed)] transition-colors hover:text-[var(--tone-error-text)]"
										onclick={() => handleDeleteBranch(branch.id, branch.code)}
									>
										<Icon name="lucide:trash-2" class="size-[10px]" />
									</button>
								</div>
							</div>
						{/each}
						{#if getBranchesForCompany(company.id).length === 0}
							<p class="px-2.5 py-1.5 text-[11px] text-[var(--ui-text-dimmed)] italic">No branches</p>
						{/if}
					</div>
				</div>
			{/each}
		{/if}
	</section>

	<!-- Danger Zone -->
	<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
		<div class="flex items-center gap-2 px-5 py-3">
			<Icon name="lucide:triangle-alert" class="size-4 text-[var(--tone-error-text)]" />
			<h2 class="font-display text-[14px] font-semibold text-[var(--tone-error-text)]">Danger zone</h2>
		</div>
		<div class="flex items-center justify-between gap-4 px-5 py-4">
			<div>
				<label class="text-[13px] font-semibold">Reset organization</label>
				<p class="text-[11px] text-[var(--ui-text-dimmed)]">Remove all companies and branches</p>
			</div>
			<Button color="error" variant="subtle" size="sm" icon="lucide:rotate-ccw" onclick={resetAll}>
				Reset
			</Button>
		</div>
	</section>
</div>

<!-- Company Add/Edit Dialog -->
<Dialog bind:open={companyModalOpen} title={editingCompanyCode ? 'Edit company' : 'Add company'} size="md">
	<div class="space-y-4">
		<div>
			<label class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">
				Company name <span class="text-[var(--tone-error-text)]">*</span>
			</label>
			<Input bind:value={companyForm.name} placeholder="e.g. My Coffee Shop" class="w-full" />
		</div>

		<div>
			<label class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">
				Company code
			</label>
			<Input
				bind:value={companyForm.code}
				placeholder="e.g. my-coffee-shop"
				class="w-full"
				disabled={!!editingCompanyCode}
			/>
			<p class="mt-1 text-[10px] text-[var(--ui-text-dimmed)]">
				{editingCompanyCode ? 'Read-only' : 'Auto-generated from name · lowercase letters, numbers, hyphens'}
			</p>
		</div>

		<div>
			<label class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Business model</label>
			<div class="flex flex-wrap gap-2">
				{#each businessModels as model (model.value)}
					<button
						type="button"
						class="rounded-lg border-2 px-3 py-1.5 text-[12px] font-medium transition-all {companyForm.businessModel === model.value
							? 'border-primary-500 bg-primary-500/10 text-primary-600 dark:text-primary-400'
							: 'border-[var(--ui-border)] text-[var(--ui-text-muted)] hover:border-[var(--ui-text-dimmed)]'}"
						onclick={() => (companyForm.businessModel = model.value)}
					>
						{model.label}
					</button>
				{/each}
			</div>
		</div>

		<div>
			<label class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Business type</label>
			<div class="flex flex-wrap gap-2">
				{#each businessTypes as type (type.value)}
					<button
						type="button"
						class="rounded-lg border-2 px-3 py-1.5 text-[12px] font-medium transition-all {companyForm.businessType === type.value
							? 'border-primary-500 bg-primary-500/10 text-primary-600 dark:text-primary-400'
							: 'border-[var(--ui-border)] text-[var(--ui-text-muted)] hover:border-[var(--ui-text-dimmed)]'}"
						onclick={() => (companyForm.businessType = type.value)}
					>
						{type.label}
					</button>
				{/each}
			</div>
		</div>

		<div class="grid grid-cols-2 gap-4">
			<div>
				<label class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Currency</label>
				<Select bind:value={companyForm.currency} options={currencyOptions} class="w-full" />
			</div>
			<div>
				<label class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Tax rate</label>
				<div class="flex flex-col gap-2">
					<label class="flex items-center gap-2">
						<Switch bind:checked={companyForm.enableTax} />
						<span class="text-[13px]">Enable</span>
					</label>
					<div
						class="flex items-center gap-2"
						class:!opacity-50={!companyForm.enableTax}
						class:!pointer-events-none={!companyForm.enableTax}
					>
						<Input
							bind:value={companyForm.taxRate}
							type="number"
							min="0"
							max="100"
							step="0.5"
							placeholder="8"
							class="w-full"
						/>
						<span class="text-[13px] font-bold text-[var(--ui-text-dimmed)]">%</span>
					</div>
				</div>
			</div>
		</div>
	</div>
	{#snippet footer()}
		<Button variant="ghost" color="neutral" onclick={() => (companyModalOpen = false)}>Cancel</Button>
		<Button
			color="primary"
			icon="lucide:check"
			disabled={!companyForm.name.trim()}
			onclick={handleSaveCompany}
		>
			{editingCompanyCode ? 'Update' : 'Create'}
		</Button>
	{/snippet}
</Dialog>

<!-- Branch Add/Edit Dialog -->
<Dialog bind:open={branchModalOpen} title={editingBranchId ? 'Edit branch' : 'Add branch'} size="md">
	<div class="space-y-4">
		<div>
			<label class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">
				Branch name <span class="text-[var(--tone-error-text)]">*</span>
			</label>
			<Input bind:value={branchForm.name} placeholder="e.g. Downtown Branch" class="w-full" />
		</div>

		<div>
			<label class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Branch code</label>
			<Input
				bind:value={branchForm.code}
				placeholder="e.g. DOWNTOWN"
				class="w-full"
				disabled={!!editingBranchId}
			/>
			<p class="mt-1 text-[10px] text-[var(--ui-text-dimmed)]">
				{editingBranchId ? 'Read-only' : 'Auto-generated from name'}
			</p>
		</div>

		<div>
			<label class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Address</label>
			<Input bind:value={branchForm.address} placeholder="123 Main St…" class="w-full" />
		</div>

		<div class="grid grid-cols-2 gap-4">
			<div>
				<label class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Phone</label>
				<Input bind:value={branchForm.phone} placeholder="(555) 123-4567" class="w-full" />
			</div>
			<div>
				<label class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Email</label>
				<Input bind:value={branchForm.email} placeholder="branch@store.com" class="w-full" />
			</div>
		</div>

		<div>
			<label class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Status</label>
			<div class="flex gap-2">
				<button
					type="button"
					class="rounded-lg border-2 px-3 py-1.5 text-[12px] font-medium transition-all {branchForm.status === 'active'
						? 'border-primary-500 bg-primary-500/10 text-primary-600 dark:text-primary-400'
						: 'border-[var(--ui-border)] text-[var(--ui-text-muted)]'}"
					onclick={() => (branchForm.status = 'active')}
				>
					Active
				</button>
				<button
					type="button"
					class="rounded-lg border-2 px-3 py-1.5 text-[12px] font-medium transition-all {branchForm.status === 'inactive'
						? 'border-[var(--ui-text-dimmed)] bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)]'
						: 'border-[var(--ui-border)] text-[var(--ui-text-muted)]'}"
					onclick={() => (branchForm.status = 'inactive')}
				>
					Inactive
				</button>
			</div>
		</div>
	</div>
	{#snippet footer()}
		<Button variant="ghost" color="neutral" onclick={() => (branchModalOpen = false)}>Cancel</Button>
		<Button
			color="primary"
			icon="lucide:check"
			disabled={!branchForm.name.trim()}
			onclick={handleSaveBranch}
		>
			{editingBranchId ? 'Update' : 'Create'}
		</Button>
	{/snippet}
</Dialog>
