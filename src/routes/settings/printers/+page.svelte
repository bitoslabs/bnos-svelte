<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Switch from '$lib/components/ui/Switch.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { browser } from '$app/environment';

	const KEY = 'bnos-os:printers';

	type ConnectionType = 'browser' | 'usb' | 'network' | 'bluetooth' | 'websocket' | 'webhook';

	interface Printer {
		id: string;
		name: string;
		enabled: boolean;
		isDefault: boolean;
		connectionType: ConnectionType;
		ip: string;
		port: string;
		macAddress: string;
		url: string;
		authToken: string;
		payloadFormat: 'raw' | 'json';
		charsPerLine: number;
		autoPrint: boolean;
		autoCut: boolean;
		cutMode: 'full' | 'partial';
		paperSize: '58mm' | '80mm';
		copies: number;
		printDensity: number;
		cashDrawerEnabled: boolean;
	}

	function defaultPrinter(): Printer {
		return {
			id: '',
			name: '',
			enabled: true,
			isDefault: false,
			connectionType: 'browser',
			ip: '',
			port: '9100',
			macAddress: '',
			url: '',
			authToken: '',
			payloadFormat: 'raw',
			charsPerLine: 48,
			autoPrint: false,
			autoCut: false,
			cutMode: 'full',
			paperSize: '80mm',
			copies: 1,
			printDensity: 8,
			cashDrawerEnabled: false
		};
	}

	let printers = $state<Printer[]>([]);
	let showForm = $state(false);
	let showDelete = $state(false);
	let isEditing = $state(false);
	let editingId = $state('');
	let deletingIdx = $state(-1);
	let deletingName = $state('');
	let form = $state<Printer>(defaultPrinter());

	onMount(() => {
		if (!browser) return;
		try {
			const raw = localStorage.getItem(KEY);
			if (raw) printers = JSON.parse(raw);
		} catch { /* */ }
	});

	function persist() {
		if (!browser) return;
		localStorage.setItem(KEY, JSON.stringify(printers));
	}

	function slugify(s: string) {
		return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
	}

	// ── Color / icon helpers ──
	const printerColors = [
		'bg-blue-500/10 text-blue-500',
		'bg-amber-500/10 text-amber-500',
		'bg-red-500/10 text-red-500',
		'bg-purple-500/10 text-purple-500',
		'bg-cyan-500/10 text-cyan-500',
		'bg-pink-500/10 text-pink-500'
	];

	const printerIcons = [
		'lucide:printer',
		'lucide:printer',
		'lucide:file-text',
		'lucide:receipt',
		'lucide:clipboard-list',
		'lucide:tag'
	];

	function hashIdx(id: string, mod: number) {
		return Math.abs(id.split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % mod;
	}

	const connectionOptions: { id: ConnectionType; label: string; icon: string }[] = [
		{ id: 'browser', label: 'Browser', icon: 'lucide:globe' },
		{ id: 'network', label: 'Network / IP', icon: 'lucide:server' },
		{ id: 'usb', label: 'USB', icon: 'lucide:usb' },
		{ id: 'bluetooth', label: 'Bluetooth', icon: 'lucide:bluetooth' },
		{ id: 'websocket', label: 'WebSocket', icon: 'lucide:cloud' },
		{ id: 'webhook', label: 'Webhook', icon: 'lucide:webhook' }
	];

	function connLabel(ct: string) {
		return connectionOptions.find((c) => c.id === ct)?.label ?? ct;
	}

	function connIcon(ct: string) {
		return connectionOptions.find((c) => c.id === ct)?.icon ?? 'lucide:printer';
	}

	// ── CRUD ──
	function openAdd() {
		form = { ...defaultPrinter() };
		isEditing = false;
		editingId = '';
		showForm = true;
	}

	function openEdit(p: Printer) {
		form = { ...p };
		isEditing = true;
		editingId = p.id;
		showForm = true;
	}

	function onNameInput() {
		if (!isEditing) {
			form.id = slugify(form.name);
		}
	}

	function savePrinter() {
		if (!form.name.trim()) return;
		if (!isEditing && !form.id.trim()) return;

		if (isEditing) {
			const idx = printers.findIndex((p) => p.id === editingId);
			if (idx >= 0) {
				printers[idx] = { ...form };
			}
		} else {
			const slug = slugify(form.id);
			if (printers.some((p) => p.id === slug)) {
				toast.error('A printer with that ID already exists');
				return;
			}
			// First printer becomes default automatically
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
		printers.splice(idx, 1);
		// Reassign default if needed
		if (wasDefault && printers.length > 0) {
			printers[0].isDefault = true;
		}
		printers = [...printers];
		persist();
		showDelete = false;
		deletingIdx = -1;
		deletingName = '';
		toast.success('Printer deleted');
	}

	function toggleEnabled(idx: number) {
		printers[idx].enabled = !printers[idx].enabled;
		printers = [...printers];
		persist();
	}

	function setDefault(idx: number) {
		printers = printers.map((p, i) => ({ ...p, isDefault: i === idx }));
		persist();
		toast.success(`"${printers[idx].name}" set as default`);
	}

	function testPrint(p?: Printer) {
		const target = p ?? printers.find((p) => p.enabled);
		if (!target) {
			toast.warning('No printer available');
			return;
		}
		toast.info(`Sending test print to "${target.name}"…`);
		// Browser print fallback
		if (target.connectionType === 'browser') {
			window.print();
		}
	}

	// Auto-save when toggling default from the card
	function toggleDefault(idx: number) {
		if (printers[idx].isDefault) {
			printers[idx].isDefault = false;
		} else {
			printers = printers.map((p, i) => ({ ...p, isDefault: i === idx }));
		}
		printers = [...printers];
		persist();
	}

	const paperSizes = [
		{ id: '58mm' as const, label: '58mm' },
		{ id: '80mm' as const, label: '80mm' }
	];

	const cutModes = [
		{ id: 'full' as const, label: 'Full' },
		{ id: 'partial' as const, label: 'Partial' }
	];
</script>

<svelte:head><title>Printers · Settings</title></svelte:head>

<div class="space-y-5">
	<!-- Page header -->
	<div class="flex items-center justify-between">
		<div>
			<h1 class="font-display text-xl font-bold tracking-tight">Printers</h1>
			<p class="text-[12.5px] text-[var(--ui-text-muted)]">Receipt printer profiles and print options</p>
		</div>
		<Button color="primary" icon="lucide:plus" onclick={openAdd}>Add printer</Button>
	</div>

	<!-- Empty state -->
	{#if printers.length === 0}
		<EmptyState icon="lucide:printer" title="No printers configured" description="Add a printer profile to start printing receipts, kitchen tickets, and reports.">
			{#snippet actions()}
				<Button color="primary" icon="lucide:plus" onclick={openAdd}>Add printer</Button>
			{/snippet}
		</EmptyState>
	{:else}
		<!-- Printer list -->
		<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
			<div class="flex items-center gap-2 px-5 py-3">
				<Icon name="lucide:printer" class="size-4 text-primary-500" />
				<h2 class="font-display text-[14px] font-semibold">Printer profiles</h2>
				<span class="ml-auto text-[11px] text-[var(--ui-text-dimmed)]">{printers.length} {printers.length === 1 ? 'printer' : 'printers'}</span>
			</div>

			{#each printers as printer, i (printer.id)}
				<div class="flex items-center gap-3 px-5 py-3.5">
					<!-- Icon -->
					<div class="grid size-9 shrink-0 place-items-center rounded-lg text-[16px] {printerColors[hashIdx(printer.id, printerColors.length)]}">
						<Icon name={printerIcons[hashIdx(printer.id, printerIcons.length)]} class="size-4" />
					</div>

					<!-- Name + meta -->
					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-2">
							<p class="truncate text-[13px] font-semibold">{printer.name}</p>
							{#if printer.isDefault}
								<Badge color="primary">Default</Badge>
							{/if}
							{#if printer.enabled}
								<Badge color="success"><span class="size-1.5 rounded-full bg-emerald-500" />Active</Badge>
							{:else}
								<Badge color="neutral"><span class="size-1.5 rounded-full bg-[var(--ui-text-dimmed)]" />Inactive</Badge>
							{/if}
						</div>
						<div class="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-[var(--ui-text-dimmed)]">
							<Icon name={connIcon(printer.connectionType)} class="size-3" />
							{connLabel(printer.connectionType)}
							<span>·</span>
							<span>{printer.paperSize}</span>
							<span>·</span>
							<span>{printer.copies}× copies</span>
							{#if printer.connectionType === 'network' && printer.ip}
								<span>·</span>
								<span class="font-mono">{printer.ip}:{printer.port || '9100'}</span>
							{/if}
							{#if printer.cashDrawerEnabled}
								<span>·</span>
								<span class="text-amber-500">💵 Cash drawer</span>
							{/if}
						</div>
					</div>

					<!-- Actions -->
					<div class="flex shrink-0 items-center gap-1">
						{#if !printer.isDefault}
							<Button size="icon-sm" variant="ghost" color="neutral" icon="lucide:star" onclick={() => setDefault(i)} title="Set as default" />
						{:else}
							<Button size="icon-sm" variant="ghost" color="neutral" icon="lucide:star" class="text-amber-400" onclick={() => toggleDefault(i)} title="Unset default" />
						{/if}
						<Button size="icon-sm" variant="ghost" color="neutral" icon="lucide:printer" onclick={() => testPrint(printer)} title="Test print" />
						<Button size="icon-sm" variant="ghost" color="neutral" icon="lucide:pencil" onclick={() => openEdit(printer)} title="Edit" />
						<Button size="icon-sm" variant="ghost" color="error" icon="lucide:trash-2" onclick={() => confirmDelete(i)} title="Delete" />
						<div class="ml-1">
							<Switch checked={printer.enabled} onCheckedChange={() => toggleEnabled(i)} />
						</div>
					</div>
				</div>
			{/each}

			<!-- Footer -->
			<div class="flex items-center justify-between px-5 py-3">
				<p class="text-[10.5px] text-[var(--ui-text-dimmed)]">
					{printers.filter((p) => p.enabled).length} active · {printers.filter((p) => p.isDefault).length} default
				</p>
				<Button size="sm" variant="ghost" color="neutral" icon="lucide:printer" onclick={() => testPrint()}>Test all</Button>
			</div>
		</section>
	{/if}

	<!-- Add / Edit Dialog -->
	<Dialog bind:open={showForm} title={isEditing ? 'Edit printer' : 'Add printer'} size="lg">
		<div class="space-y-5">
			<!-- Identity -->
			<div class="space-y-3">
				<p class="text-[11px] font-bold uppercase tracking-wider text-[var(--ui-text-dimmed)]">Identity</p>
				<label class="block">
					<span class="mb-1 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Name *</span>
					<Input bind:value={form.name} placeholder="Kitchen printer" class="w-full" oninput={onNameInput} />
				</label>
				<label class="block">
					<span class="mb-1 block text-[12px] font-semibold text-[var(--ui-text-muted)]">ID {#if !isEditing}*{/if}</span>
					<Input bind:value={form.id} placeholder="kitchen-printer" disabled={isEditing} class="w-full" />
					<p class="mt-1 text-[10px] text-[var(--ui-text-dimmed)]">Unique slug used internally to reference this printer</p>
				</label>
			</div>

			<div class="border-t border-[var(--ui-border-muted)]"></div>

			<!-- Connection -->
			<div class="space-y-3">
				<p class="text-[11px] font-bold uppercase tracking-wider text-[var(--ui-text-dimmed)]">Connection</p>
				<div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
					{#each connectionOptions as ct (ct.id)}
						<button
							type="button"
							onclick={() => (form.connectionType = ct.id)}
							class="rounded-xl border-2 p-3 text-center transition-all {form.connectionType === ct.id ? 'border-primary-500 bg-primary-500/10' : 'border-[var(--ui-border)] hover:border-[var(--ui-text-dimmed)]'}"
						>
							<Icon name={ct.icon} class="mx-auto mb-1 size-4 {form.connectionType === ct.id ? 'text-primary-500' : 'text-[var(--ui-text-dimmed)]'}" />
							<p class="text-[10.5px] font-bold {form.connectionType === ct.id ? 'text-primary-600 dark:text-primary-400' : 'text-[var(--ui-text-muted)]'}">{ct.label}</p>
						</button>
					{/each}
				</div>

				{#if form.connectionType === 'network'}
					<div class="grid grid-cols-2 gap-3">
						<label class="block">
							<span class="mb-1 block text-[12px] font-semibold text-[var(--ui-text-muted)]">IP address</span>
							<Input bind:value={form.ip} placeholder="192.168.1.100" class="w-full" />
						</label>
						<label class="block">
							<span class="mb-1 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Port</span>
							<Input bind:value={form.port} placeholder="9100" class="w-full" />
						</label>
					</div>
				{/if}

				{#if form.connectionType === 'websocket' || form.connectionType === 'webhook'}
					<div class="space-y-3">
						<label class="block">
							<span class="mb-1 block text-[12px] font-semibold text-[var(--ui-text-muted)]">URL ({form.connectionType === 'websocket' ? 'ws:// or wss://' : 'http:// or https://'})</span>
							<Input bind:value={form.url} placeholder={form.connectionType === 'websocket' ? 'wss://localhost:8080' : 'https://my-api.com/print'} class="w-full" />
						</label>
						{#if form.connectionType === 'webhook'}
							<label class="block">
								<span class="mb-1 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Authorization token (optional)</span>
								<Input bind:value={form.authToken} type="password" placeholder="Bearer token or secret" class="w-full" />
							</label>
						{/if}
						<div>
							<span class="mb-1 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Payload format</span>
							<div class="flex gap-2">
								{#each ['raw', 'json'] as fmt (fmt)}
									<button
										type="button"
										onclick={() => (form.payloadFormat = fmt as 'raw' | 'json')}
										class="flex-1 rounded-lg border px-3 py-2 text-[11px] font-bold transition-all {form.payloadFormat === fmt ? 'border-primary-500 bg-primary-500 text-white' : 'border-[var(--ui-border)] bg-[var(--ui-bg-muted)] text-[var(--ui-text-muted)]'}"
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
						<span class="mb-1 block text-[12px] font-semibold text-[var(--ui-text-muted)]">MAC address</span>
						<Input bind:value={form.macAddress} placeholder="00:1A:7D:DA:71:13" class="w-full" />
					</label>
				{/if}

				{#if form.connectionType === 'usb'}
					<div class="flex items-center gap-2 rounded-lg border border-blue-500/20 bg-blue-500/10 p-3">
						<Icon name="lucide:info" class="size-4 shrink-0 text-blue-500" />
						<p class="text-[11px] text-blue-600 dark:text-blue-400">USB printers require WebUSB support and will prompt for device permission when printing.</p>
					</div>
				{/if}

				{#if form.connectionType === 'browser'}
					<div class="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3">
						<Icon name="lucide:info" class="size-4 shrink-0 text-emerald-500" />
						<p class="text-[11px] text-emerald-600 dark:text-emerald-400">Browser printing uses the system print dialog. No additional drivers required.</p>
					</div>
				{/if}
			</div>

			<div class="border-t border-[var(--ui-border-muted)]"></div>

			<!-- Print options -->
			<div class="space-y-3">
				<p class="text-[11px] font-bold uppercase tracking-wider text-[var(--ui-text-dimmed)]">Print options</p>

				<div class="grid grid-cols-2 gap-3">
					<!-- Paper size -->
					<div>
						<span class="mb-1 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Paper size</span>
						<div class="flex gap-2">
							{#each paperSizes as ps (ps.id)}
								<button
									type="button"
									onclick={() => (form.paperSize = ps.id)}
									class="flex-1 rounded-lg border px-3 py-2 text-[11px] font-bold transition-all {form.paperSize === ps.id ? 'border-primary-500 bg-primary-500 text-white' : 'border-[var(--ui-border)] bg-[var(--ui-bg-muted)] text-[var(--ui-text-muted)]'}"
								>
									{ps.label}
								</button>
							{/each}
						</div>
					</div>

					<!-- Copies -->
					<label class="block">
						<span class="mb-1 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Copies</span>
						<Input bind:value={form.copies} type="number" min="1" max="5" placeholder="1" class="w-full" />
					</label>
				</div>

				<!-- Chars per line -->
				<label class="block">
					<span class="mb-1 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Characters per line</span>
					<Input bind:value={form.charsPerLine} type="number" placeholder="48" class="w-full" />
				</label>

				<!-- Print density -->
				<div>
					<span class="mb-1 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Print density</span>
					<div class="flex items-center gap-3">
						<input
							bind:value={form.printDensity}
							type="range"
							min="1"
							max="15"
							step="1"
							class="h-2 flex-1 cursor-pointer appearance-none rounded-lg bg-[var(--ui-bg-accented)] accent-[var(--ui-color-primary-500)]"
						/>
						<span class="min-w-[24px] text-center text-[11px] font-bold">{form.printDensity || 8}</span>
					</div>
				</div>

				<!-- Auto cut -->
				<div class="flex items-center justify-between py-1">
					<div>
						<label class="block text-[12px] font-semibold text-[var(--ui-text-muted)]">Auto cut</label>
						<p class="text-[10px] text-[var(--ui-text-dimmed)]">Automatically cut paper after printing</p>
					</div>
					<Switch bind:checked={form.autoCut} />
				</div>

				{#if form.autoCut}
					<div>
						<span class="mb-1 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Cut mode</span>
						<div class="flex gap-2">
							{#each cutModes as cm (cm.id)}
								<button
									type="button"
									onclick={() => (form.cutMode = cm.id)}
									class="flex-1 rounded-lg border px-3 py-2 text-[11px] font-bold transition-all {form.cutMode === cm.id ? 'border-primary-500 bg-primary-500 text-white' : 'border-[var(--ui-border)] bg-[var(--ui-bg-muted)] text-[var(--ui-text-muted)]'}"
								>
									{cm.label}
								</button>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Auto print -->
				<div class="flex items-center justify-between py-1">
					<div>
						<label class="block text-[12px] font-semibold text-[var(--ui-text-muted)]">Auto print</label>
						<p class="text-[10px] text-[var(--ui-text-dimmed)]">Print automatically when a transaction completes</p>
					</div>
					<Switch bind:checked={form.autoPrint} />
				</div>

				<!-- Cash drawer -->
				<div class="flex items-center justify-between py-1">
					<div>
						<label class="block text-[12px] font-semibold text-[var(--ui-text-muted)]">Cash drawer</label>
						<p class="text-[10px] text-[var(--ui-text-dimmed)]">Send kick signal to open cash drawer</p>
					</div>
					<Switch bind:checked={form.cashDrawerEnabled} />
				</div>

				<!-- Enabled -->
				<div class="flex items-center justify-between py-1">
					<div>
						<label class="block text-[12px] font-semibold text-[var(--ui-text-muted)]">Enabled</label>
						<p class="text-[10px] text-[var(--ui-text-dimmed)]">Disable to temporarily take this printer offline</p>
					</div>
					<Switch bind:checked={form.enabled} />
				</div>
			</div>
		</div>

		{#snippet footer()}
			<Button color="neutral" variant="subtle" size="lg" block onclick={() => (showForm = false)}>Cancel</Button>
			<Button color="primary" size="lg" block disabled={!form.name.trim() || (!isEditing && !form.id.trim())} onclick={savePrinter}>
				{isEditing ? 'Update' : 'Add printer'}
			</Button>
		{/snippet}
	</Dialog>

	<!-- Delete Confirmation -->
	<Dialog bind:open={showDelete} title="Delete printer" size="sm">
		<p class="text-[13px] text-[var(--ui-text-muted)]">
			Delete <span class="font-bold text-[var(--ui-text)]">"{deletingName}"</span>? This cannot be undone.
		</p>
		{#snippet footer()}
			<Button color="neutral" variant="subtle" block onclick={() => (showDelete = false)}>Cancel</Button>
			<Button color="error" block onclick={deletePrinter}>Delete</Button>
		{/snippet}
	</Dialog>
</div>
