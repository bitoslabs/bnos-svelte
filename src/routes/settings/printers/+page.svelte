<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Switch from '$lib/components/ui/Switch.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { browser } from '$app/environment';
	import { resolve } from '$app/paths';
	import {
		CONNECTION_OPTIONS,
		defaultPrinter,
		isPrinterComplete,
		loadPrinters,
		savePrinters,
		testPrinter,
		validatePrinter,
		type ConnectionType,
		type FieldErrors,
		type Printer
	} from '$lib/settings/printers';

	let printers = $state<Printer[]>([]);
	let showForm = $state(false);
	let showDelete = $state(false);
	let isEditing = $state(false);
	let editingId = $state('');
	let deletingIdx = $state(-1);
	let deletingName = $state('');
	let form = $state<Printer>(defaultPrinter());
	let errors = $state<FieldErrors>({});
	/** id → "idle" | "testing" | "ok" | "fail" + message. */
	let status = $state<
		Record<string, { state: 'idle' | 'testing' | 'ok' | 'fail'; message?: string }>
	>({});

	onMount(() => {
		if (!browser) return;
		printers = loadPrinters();
	});

	function persist() {
		savePrinters(printers);
	}

	function slugify(s: string) {
		return s
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '');
	}

	// ── Color swatch (stable per printer id) ──
	const swatches = [
		'bg-blue-500/10 text-blue-500',
		'bg-amber-500/10 text-amber-500',
		'bg-purple-500/10 text-purple-500',
		'bg-cyan-500/10 text-cyan-500',
		'bg-pink-500/10 text-pink-500',
		'bg-emerald-500/10 text-emerald-500'
	];
	const swatchIcons = [
		'lucide:printer',
		'lucide:receipt',
		'lucide:file-text',
		'lucide:clipboard-list',
		'lucide:tag',
		'lucide:utensils'
	];
	function hashIdx(id: string, mod: number) {
		return Math.abs(id.split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % mod;
	}
	function swatch(id: string) {
		return swatches[hashIdx(id, swatches.length)];
	}
	function swatchIcon(id: string) {
		return swatchIcons[hashIdx(id, swatchIcons.length)];
	}

	// ── CRUD ──
	function openAdd() {
		form = { ...defaultPrinter() };
		errors = {};
		isEditing = false;
		editingId = '';
		showForm = true;
	}

	function openEdit(p: Printer) {
		form = { ...p };
		errors = {};
		isEditing = true;
		editingId = p.id;
		showForm = true;
	}

	function onNameInput() {
		if (!isEditing) form.id = slugify(form.name);
	}

	function validate(): boolean {
		errors = validatePrinter(form);
		return Object.keys(errors).length === 0;
	}

	function savePrinter() {
		if (!form.name.trim()) {
			errors = { name: 'Name is required' };
			return;
		}
		if (!isEditing && !form.id.trim()) {
			errors = { id: 'ID is required' };
			return;
		}
		if (!validate()) return;

		if (isEditing) {
			const idx = printers.findIndex((p) => p.id === editingId);
			if (idx >= 0) printers[idx] = { ...form };
		} else {
			const slug = slugify(form.id);
			if (printers.some((p) => p.id === slug)) {
				errors = { id: 'A printer with that ID already exists' };
				return;
			}
			// First printer becomes default automatically.
			if (printers.length === 0) form.isDefault = true;
			printers = [...printers, { ...form, id: slug }];
		}
		persist();
		showForm = false;
		toast.success(isEditing ? 'Printer updated' : 'Printer added');
	}

	function confirmDelete(idx: number) {
		const p = printers[idx];
		if (!p) return;
		deletingIdx = idx;
		deletingName = p.name;
		showDelete = true;
	}

	function deletePrinter() {
		const idx = deletingIdx;
		if (idx < 0) return;
		const wasDefault = printers[idx].isDefault;
		const removedId = printers[idx].id;
		printers.splice(idx, 1);
		if (wasDefault && printers.length > 0) printers[0].isDefault = true;
		printers = [...printers];
		delete status[removedId];
		status = { ...status };
		persist();
		showDelete = false;
		deletingIdx = -1;
		deletingName = '';
		toast.success('Printer deleted');
	}

	function toggleEnabled(idx: number) {
		const p = printers[idx];
		const nextEnabled = !p.enabled;
		printers = printers.map((o, i) => (i === idx ? { ...o, enabled: nextEnabled } : o));
		// If we just disabled the default printer, promote another enabled one.
		if (p.isDefault && !nextEnabled) {
			const heir = printers.find((o) => o.enabled);
			printers = printers.map((o) => ({
				...o,
				isDefault: heir ? o.id === heir.id : o.isDefault
			}));
		}
		persist();
	}

	function setDefault(idx: number) {
		printers = printers.map((p, i) => ({
			...p,
			isDefault: i === idx,
			enabled: i === idx ? true : p.enabled
		}));
		persist();
		toast.success(`"${printers[idx].name}" set as default`);
	}

	async function runTest(p: Printer) {
		status = { ...status, [p.id]: { state: 'testing' } };
		const res = await testPrinter(p);
		status = { ...status, [p.id]: { state: res.ok ? 'ok' : 'fail', message: res.message } };
		if (res.ok) toast.success('Printer test', res.message);
		else toast.warning('Printer test failed', res.message);
	}

	async function testAll() {
		const enabled = printers.filter((p) => p.enabled);
		if (enabled.length === 0) {
			toast.warning('No enabled printers to test');
			return;
		}
		toast.info(`Testing ${enabled.length} printer${enabled.length === 1 ? '' : 's'}…`);
		await Promise.all(enabled.map(runTest));
	}

	const paperSizes = [
		{ id: '58mm' as const, label: '58mm' },
		{ id: '80mm' as const, label: '80mm' }
	];
	const cutModes = [
		{ id: 'full' as const, label: 'Full' },
		{ id: 'partial' as const, label: 'Partial' }
	];

	const activeCount = $derived(printers.filter((p) => p.enabled).length);
</script>

<svelte:head><title>Printers · Settings</title></svelte:head>

<div class="space-y-5">
	<PageHeader
		icon="lucide:printer"
		title="Printers"
		description="Receipt & kitchen printer profiles — the single source of truth"
	>
		{#snippet actions()}
			<Button
				color="neutral"
				variant="subtle"
				icon="lucide:plug-zap"
				onclick={testAll}
				disabled={printers.length === 0}>Test all</Button
			>
			<Button color="primary" icon="lucide:plus" onclick={openAdd}>Add printer</Button>
		{/snippet}
	</PageHeader>

	{#if printers.length === 0}
		<EmptyState
			icon="lucide:printer"
			title="No printers configured"
			description="Add a printer profile to start printing receipts, kitchen tickets, and reports. Printers configured here are used everywhere — the POS, orders, and the Hardware page."
		>
			{#snippet actions()}
				<Button color="primary" icon="lucide:plus" onclick={openAdd}>Add printer</Button>
			{/snippet}
		</EmptyState>
	{:else}
		<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
			<div class="flex items-center gap-2 px-5 py-3">
				<Icon name="lucide:printer" class="size-4 text-primary-500" />
				<h2 class="font-display text-[14px] font-semibold">Printer profiles</h2>
				<span class="ml-auto text-[11px] text-[var(--ui-text-dimmed)]"
					>{activeCount} active · {printers.length} total</span
				>
			</div>

			{#each printers as printer, i (printer.id)}
				{@const meta =
					CONNECTION_OPTIONS.find((c) => c.id === printer.connectionType) ?? CONNECTION_OPTIONS[0]}
				{@const st = status[printer.id]}
				{@const complete = isPrinterComplete(printer)}
				<div class="flex items-center gap-3 px-5 py-3.5">
					<div class="grid size-9 shrink-0 place-items-center rounded-lg {swatch(printer.id)}">
						<Icon name={swatchIcon(printer.id)} class="size-4" />
					</div>

					<div class="min-w-0 flex-1">
						<div class="flex flex-wrap items-center gap-2">
							<p class="truncate text-[13px] font-semibold">{printer.name}</p>
							{#if printer.isDefault}
								<Badge color="primary">Default</Badge>
							{/if}
							{#if printer.enabled}
								<Badge color="success"
									><span class="size-1.5 rounded-full bg-emerald-500" />Active</Badge
								>
							{:else}
								<Badge color="neutral"
									><span class="size-1.5 rounded-full bg-[var(--ui-text-dimmed)]" />Off</Badge
								>
							{/if}
							{#if !complete}
								<Badge color="warning">Incomplete</Badge>
							{/if}
						</div>
						<div
							class="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10.5px] text-[var(--ui-text-dimmed)]"
						>
							<Icon name={meta.icon} class="size-3" />
							{meta.label}
							<span>·</span>
							<span>{printer.paperSize}</span>
							<span>·</span>
							<span>{printer.copies}× cop{printer.copies === 1 ? 'y' : 'ies'}</span>
							{#if printer.connectionType === 'network' && printer.ip}
								<span>·</span>
								<span class="font-mono">{printer.ip}:{printer.port || '9100'}</span>
							{/if}
							{#if printer.cashDrawerEnabled}
								<span>·</span>
								<span
									><Icon name="lucide:archive" class="mb-0.5 inline size-3 text-amber-500" /> Drawer</span
								>
							{/if}
							{#if st?.state === 'testing'}
								<span>·</span>
								<span class="text-primary-500"
									><Icon name="lucide:loader-circle" class="mb-0.5 inline size-3 animate-spin" /> Testing…</span
								>
							{:else if st?.state === 'ok'}
								<span>·</span>
								<span class="text-emerald-500"
									><Icon name="lucide:check-circle-2" class="mb-0.5 inline size-3" />
									{st.message}</span
								>
							{:else if st?.state === 'fail'}
								<span>·</span>
								<span class="text-red-500"
									><Icon name="lucide:alert-triangle" class="mb-0.5 inline size-3" />
									{st.message}</span
								>
							{/if}
						</div>
					</div>

					<div class="flex shrink-0 items-center gap-1">
						<Button
							size="icon-sm"
							variant="ghost"
							color="neutral"
							icon={printer.isDefault ? 'lucide:star' : 'lucide:star'}
							class={printer.isDefault ? 'text-amber-400' : ''}
							onclick={() => setDefault(i)}
							disabled={printer.isDefault}
							title={printer.isDefault ? 'Default printer' : 'Set as default'}
						/>
						<Button
							size="icon-sm"
							variant="ghost"
							color="neutral"
							icon="lucide:plug-zap"
							onclick={() => runTest(printer)}
							disabled={!printer.enabled || st?.state === 'testing'}
							title="Test connection"
						/>
						<Button
							size="icon-sm"
							variant="ghost"
							color="neutral"
							icon="lucide:pencil"
							onclick={() => openEdit(printer)}
							title="Edit"
						/>
						<Button
							size="icon-sm"
							variant="ghost"
							color="error"
							icon="lucide:trash-2"
							onclick={() => confirmDelete(i)}
							title="Delete"
						/>
						<div class="ml-1">
							<Switch checked={printer.enabled} onCheckedChange={() => toggleEnabled(i)} />
						</div>
					</div>
				</div>
			{/each}
		</section>
	{/if}

	<!-- Add / Edit Dialog -->
	<Dialog bind:open={showForm} title={isEditing ? 'Edit printer' : 'Add printer'} size="lg">
		<div class="space-y-5">
			<!-- Identity -->
			<div class="space-y-3">
				<p class="text-[11px] font-bold tracking-wider text-[var(--ui-text-dimmed)] uppercase">
					Identity
				</p>
				<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
					<label class="block">
						<span class="mb-1 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
							>Name *</span
						>
						<Input
							bind:value={form.name}
							placeholder="Kitchen printer"
							class="w-full"
							oninput={onNameInput}
						/>
						{#if errors.name}
							<p class="mt-1 text-[10.5px] font-medium text-red-500">{errors.name}</p>
						{/if}
					</label>
					<label class="block">
						<span class="mb-1 block text-[12px] font-semibold text-[var(--ui-text-muted)]">
							ID {#if !isEditing}*{/if}
						</span>
						<Input
							bind:value={form.id}
							placeholder="kitchen-printer"
							disabled={isEditing}
							class="w-full"
						/>
						{#if errors.id}
							<p class="mt-1 text-[10.5px] font-medium text-red-500">{errors.id}</p>
						{:else}
							<p class="mt-1 text-[10px] text-[var(--ui-text-dimmed)]">
								Unique slug used internally to reference this printer
							</p>
						{/if}
					</label>
				</div>
			</div>

			<div class="border-t border-[var(--ui-border-muted)]"></div>

			<!-- Connection -->
			<div class="space-y-3">
				<p class="text-[11px] font-bold tracking-wider text-[var(--ui-text-dimmed)] uppercase">
					Connection
				</p>
				<div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
					{#each CONNECTION_OPTIONS as ct (ct.id)}
						<button
							type="button"
							onclick={() => {
								form.connectionType = ct.id as ConnectionType;
								errors = {};
							}}
							class="rounded-xl border-2 p-3 text-center transition-all {form.connectionType ===
							ct.id
								? 'border-primary-500 bg-primary-500/10'
								: 'border-[var(--ui-border)] hover:border-[var(--ui-text-dimmed)]'}"
						>
							<Icon
								name={ct.icon}
								class="mx-auto mb-1 size-4 {form.connectionType === ct.id
									? 'text-primary-500'
									: 'text-[var(--ui-text-dimmed)]'}"
							/>
							<p
								class="text-[10.5px] font-bold {form.connectionType === ct.id
									? 'text-primary-600 dark:text-primary-400'
									: 'text-[var(--ui-text-muted)]'}"
							>
								{ct.label}
							</p>
						</button>
					{/each}
				</div>
				<p class="text-[10.5px] text-[var(--ui-text-dimmed)]">
					{CONNECTION_OPTIONS.find((c) => c.id === form.connectionType)?.hint}
				</p>

				{#if form.connectionType === 'network'}
					<div class="grid grid-cols-2 gap-3">
						<label class="block">
							<span class="mb-1 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
								>IP address</span
							>
							<Input bind:value={form.ip} placeholder="192.168.1.100" class="w-full" />
							{#if errors.ip}<p class="mt-1 text-[10.5px] font-medium text-red-500">
									{errors.ip}
								</p>{/if}
						</label>
						<label class="block">
							<span class="mb-1 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
								>Port</span
							>
							<Input bind:value={form.port} placeholder="9100" class="w-full" inputmode="numeric" />
							{#if errors.port}<p class="mt-1 text-[10.5px] font-medium text-red-500">
									{errors.port}
								</p>{/if}
						</label>
					</div>
				{/if}

				{#if form.connectionType === 'websocket' || form.connectionType === 'webhook'}
					<div class="space-y-3">
						<label class="block">
							<span class="mb-1 block text-[12px] font-semibold text-[var(--ui-text-muted)]">
								URL ({form.connectionType === 'websocket'
									? 'ws:// or wss://'
									: 'http:// or https://'})
							</span>
							<Input
								bind:value={form.url}
								placeholder={form.connectionType === 'websocket'
									? 'wss://localhost:8080'
									: 'https://my-api.com/print'}
								class="w-full"
							/>
							{#if errors.url}<p class="mt-1 text-[10.5px] font-medium text-red-500">
									{errors.url}
								</p>{/if}
						</label>
						{#if form.connectionType === 'webhook'}
							<label class="block">
								<span class="mb-1 block text-[12px] font-semibold text-[var(--ui-text-muted)]">
									Authorization token (optional)
								</span>
								<Input
									bind:value={form.authToken}
									type="password"
									placeholder="Bearer token or secret"
									class="w-full"
								/>
							</label>
						{/if}
						<div>
							<span class="mb-1 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
								>Payload format</span
							>
							<div class="flex gap-2">
								{#each ['raw', 'json'] as fmt (fmt)}
									<button
										type="button"
										onclick={() => (form.payloadFormat = fmt as 'raw' | 'json')}
										class="flex-1 rounded-lg border px-3 py-2 text-[11px] font-bold transition-all {form.payloadFormat ===
										fmt
											? 'border-primary-500 bg-primary-500 text-white'
											: 'border-[var(--ui-border)] bg-[var(--ui-bg-muted)] text-[var(--ui-text-muted)]'}"
									>
										{fmt === 'raw' ? 'Raw ESC/POS' : 'JSON Object'}
									</button>
								{/each}
							</div>
						</div>
					</div>
				{/if}

				{#if form.connectionType === 'bluetooth'}
					<label class="block">
						<span class="mb-1 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
							>MAC address</span
						>
						<Input bind:value={form.macAddress} placeholder="00:1A:7D:DA:71:13" class="w-full" />
						{#if errors.macAddress}
							<p class="mt-1 text-[10.5px] font-medium text-red-500">{errors.macAddress}</p>
						{/if}
					</label>
				{/if}

				{#if form.connectionType === 'usb'}
					<div
						class="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3"
					>
						<Icon name="lucide:info" class="mt-0.5 size-4 shrink-0 text-amber-500" />
						<p class="text-[11px] text-amber-600 dark:text-amber-400">
							USB printers require WebUSB support and will prompt for device permission when
							printing. Chrome/Edge only.
						</p>
					</div>
				{/if}

				{#if form.connectionType === 'browser'}
					<div
						class="flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3"
					>
						<Icon name="lucide:info" class="mt-0.5 size-4 shrink-0 text-emerald-500" />
						<p class="text-[11px] text-emerald-600 dark:text-emerald-400">
							Browser printing uses the system print dialog. No additional drivers required.
						</p>
					</div>
				{/if}
			</div>

			<div class="border-t border-[var(--ui-border-muted)]"></div>

			<!-- Print options -->
			<div class="space-y-3">
				<p class="text-[11px] font-bold tracking-wider text-[var(--ui-text-dimmed)] uppercase">
					Print options
				</p>

				<div class="grid grid-cols-2 gap-3">
					<div>
						<span class="mb-1 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
							>Paper size</span
						>
						<div class="flex gap-2">
							{#each paperSizes as ps (ps.id)}
								<button
									type="button"
									onclick={() => (form.paperSize = ps.id)}
									class="flex-1 rounded-lg border px-3 py-2 text-[11px] font-bold transition-all {form.paperSize ===
									ps.id
										? 'border-primary-500 bg-primary-500 text-white'
										: 'border-[var(--ui-border)] bg-[var(--ui-bg-muted)] text-[var(--ui-text-muted)]'}"
								>
									{ps.label}
								</button>
							{/each}
						</div>
					</div>

					<label class="block">
						<span class="mb-1 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
							>Copies</span
						>
						<Input
							bind:value={form.copies}
							type="number"
							min="1"
							max="5"
							placeholder="1"
							class="w-full"
						/>
					</label>
				</div>

				<div class="grid grid-cols-2 gap-3">
					<label class="block">
						<span class="mb-1 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
							>Characters per line</span
						>
						<Input
							bind:value={form.charsPerLine}
							type="number"
							min="16"
							max="96"
							placeholder="48"
							class="w-full"
						/>
					</label>
					<div>
						<span class="mb-1 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
							>Print density</span
						>
						<div class="flex items-center gap-3">
							<input
								bind:value={form.printDensity}
								type="range"
								min="1"
								max="15"
								step="1"
								class="h-2 flex-1 cursor-pointer appearance-none rounded-lg bg-[var(--ui-bg-accented)] accent-[var(--ui-color-primary-500)]"
							/>
							<span class="min-w-[24px] text-center text-[11px] font-bold"
								>{form.printDensity || 8}</span
							>
						</div>
					</div>
				</div>

				<div class="flex items-center justify-between py-1">
					<div>
						<label class="block text-[12px] font-semibold text-[var(--ui-text-muted)]"
							>Auto cut</label
						>
						<p class="text-[10px] text-[var(--ui-text-dimmed)]">Cut paper after printing</p>
					</div>
					<Switch bind:checked={form.autoCut} />
				</div>

				{#if form.autoCut}
					<div>
						<span class="mb-1 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
							>Cut mode</span
						>
						<div class="flex gap-2">
							{#each cutModes as cm (cm.id)}
								<button
									type="button"
									onclick={() => (form.cutMode = cm.id)}
									class="flex-1 rounded-lg border px-3 py-2 text-[11px] font-bold transition-all {form.cutMode ===
									cm.id
										? 'border-primary-500 bg-primary-500 text-white'
										: 'border-[var(--ui-border)] bg-[var(--ui-bg-muted)] text-[var(--ui-text-muted)]'}"
								>
									{cm.label}
								</button>
							{/each}
						</div>
					</div>
				{/if}

				<div class="flex items-center justify-between py-1">
					<div>
						<label class="block text-[12px] font-semibold text-[var(--ui-text-muted)]"
							>Auto print</label
						>
						<p class="text-[10px] text-[var(--ui-text-dimmed)]">
							Print when a transaction completes
						</p>
					</div>
					<Switch bind:checked={form.autoPrint} />
				</div>

				<div class="flex items-center justify-between py-1">
					<div>
						<label class="block text-[12px] font-semibold text-[var(--ui-text-muted)]"
							>Cash drawer</label
						>
						<p class="text-[10px] text-[var(--ui-text-dimmed)]">
							Send kick signal to open the drawer
						</p>
					</div>
					<Switch bind:checked={form.cashDrawerEnabled} />
				</div>

				<label class="block py-1">
					<span class="mb-1 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>Note (optional)</span
					>
					<Input bind:value={form.note} placeholder="e.g. next to register 2" class="w-full" />
				</label>

				<div class="flex items-center justify-between py-1">
					<div>
						<label class="block text-[12px] font-semibold text-[var(--ui-text-muted)]"
							>Enabled</label
						>
						<p class="text-[10px] text-[var(--ui-text-dimmed)]">
							Take this printer offline temporarily
						</p>
					</div>
					<Switch bind:checked={form.enabled} />
				</div>
			</div>
		</div>

		{#snippet footer()}
			<Button color="neutral" variant="subtle" size="lg" block onclick={() => (showForm = false)}
				>Cancel</Button
			>
			<Button
				color="primary"
				size="lg"
				block
				disabled={!form.name.trim() || (!isEditing && !form.id.trim())}
				onclick={savePrinter}
			>
				{isEditing ? 'Update' : 'Add printer'}
			</Button>
		{/snippet}
	</Dialog>

	<!-- Delete Confirmation -->
	<Dialog bind:open={showDelete} title="Delete printer" size="sm">
		<p class="text-[13px] text-[var(--ui-text-muted)]">
			Delete <span class="font-bold text-[var(--ui-text)]">"{deletingName}"</span>? This cannot be
			undone.
		</p>
		{#snippet footer()}
			<Button color="neutral" variant="subtle" block onclick={() => (showDelete = false)}
				>Cancel</Button
			>
			<Button color="error" block onclick={deletePrinter}>Delete</Button>
		{/snippet}
	</Dialog>

	<!-- Help link to hardware -->
	<p class="px-1 text-center text-[11px] text-[var(--ui-text-dimmed)]">
		Need to wire a barcode scanner, scale, or cash drawer?
		<a class="font-semibold text-primary-500 hover:underline" href={resolve('/settings/hardware')}
			>Configure hardware</a
		>.
	</p>
</div>
