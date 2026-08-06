<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Switch from '$lib/components/ui/Switch.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { browser } from '$app/environment';
	import { resolve } from '$app/paths';
	import { toast } from '$lib/stores/toast.svelte';
	import { loadHardwareSettings, saveHardwareSettings } from '$lib/settings/local';
	import {
		getActivePaperSize,
		getActivePrinter,
		hasActiveCashDrawer,
		loadPrinters,
		savePrinters,
		syncHardwareFromPrinters,
		testPrinter,
		toLegacyPrinterType,
		connectionMeta,
		type Printer
	} from '$lib/settings/printers';
	import { getDeviceCode } from '$lib/utils/record-id';
	import { syncWorkspaceSettingsToOrganization } from '$nostr/workspace-settings';

	let deviceCode = $state('');
	let barcodeScanner = $state(false);
	let customerDisplay = $state(false);
	let scaleConnected = $state(false);
	let printers = $state<Printer[]>([]);

	onMount(() => {
		if (!browser) return;
		const s = loadHardwareSettings();
		deviceCode = s.deviceCode;
		barcodeScanner = s.barcodeScanner;
		customerDisplay = s.customerDisplay;
		scaleConnected = s.scaleConnected;
		printers = loadPrinters();
		// Reconcile the derived printer fields onto the hardware blob so the POS
		// gate & workspace-settings sync reflect the printers configured below.
		syncHardwareFromPrinters(printers);
	});

	function normalizeDeviceCode(value: string) {
		return value
			.replace(/[^a-z0-9]/gi, '')
			.toUpperCase()
			.slice(0, 4);
	}

	function save() {
		if (!browser) return;
		deviceCode = normalizeDeviceCode(deviceCode);
		const list = loadPrinters();
		saveHardwareSettings({
			printerType: toLegacyPrinterType(getActivePrinter(list)),
			paperSize: getActivePaperSize(list),
			deviceCode,
			cashDrawer: hasActiveCashDrawer(list),
			barcodeScanner,
			customerDisplay,
			scaleConnected
		});
		syncWorkspaceSettingsToOrganization();
		toast.success('Hardware settings saved');
	}

	// ── Printer summary (read-only here; managed in Printers) ──
	const activePrinter = $derived(getActivePrinter(printers));

	async function testDefaultPrinter() {
		const dp = activePrinter;
		if (!dp) {
			toast.warning('No printer configured', 'Add one in the Printers page.');
			return;
		}
		toast.info(`Testing "${dp.name}"…`);
		const res = await testPrinter(dp);
		if (res.ok) toast.success('Printer test', res.message);
		else toast.warning('Printer test failed', res.message);
	}

	// ── Cash drawer follows the default printer (single source of truth) ──
	const cashDrawerOn = $derived(activePrinter?.cashDrawerEnabled ?? false);

	function toggleCashDrawer(on: boolean) {
		const dp = activePrinter;
		if (!dp) {
			toast.warning(
				'Add a printer first',
				'Cash drawer is configured per printer in the Printers page.'
			);
			return;
		}
		printers = printers.map((p) => (p.id === dp.id ? { ...p, cashDrawerEnabled: on } : p));
		savePrinters(printers); // re-derives hardware.cashDrawer
	}

	const activeDeviceCode = $derived(getDeviceCode());
	const activePaper = $derived(getActivePaperSize(printers));
	const activeType = $derived(toLegacyPrinterType(activePrinter));
</script>

<svelte:head><title>Hardware · Settings</title></svelte:head>

<div class="space-y-5">
	<PageHeader
		icon="lucide:cpu"
		title="Hardware"
		description="Printers, cash drawer, scanners, and peripherals"
	/>

	<!-- Printer summary (single source of truth lives in /settings/printers) -->
	<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
		<div class="flex items-center gap-2 px-5 py-3">
			<Icon name="lucide:printer" class="size-4 text-primary-500" />
			<h2 class="font-display text-[14px] font-semibold">Receipt printers</h2>
			<span class="ml-auto text-[11px] text-[var(--ui-text-dimmed)]"
				>{printers.filter((p) => p.enabled).length}/{printers.length} active</span
			>
		</div>

		{#if activePrinter}
			{@const meta = connectionMeta(activePrinter.connectionType)}
			<div class="flex items-center gap-3 px-5 py-4">
				<div class="grid size-9 shrink-0 place-items-center rounded-lg {meta.color}">
					<Icon name={meta.icon} class="size-4" />
				</div>
				<div class="min-w-0 flex-1">
					<div class="flex items-center gap-2">
						<p class="truncate text-[13px] font-semibold">{activePrinter.name}</p>
						<Badge color="primary">Default</Badge>
					</div>
					<p class="mt-0.5 text-[10.5px] text-[var(--ui-text-dimmed)]">
						{meta.label} · {activePrinter.paperSize}
						{#if activePrinter.connectionType === 'network' && activePrinter.ip}
							· <span class="font-mono">{activePrinter.ip}:{activePrinter.port || '9100'}</span>
						{/if}
					</p>
				</div>
				<Button
					color="neutral"
					variant="subtle"
					size="sm"
					icon="lucide:plug-zap"
					onclick={testDefaultPrinter}>Test</Button
				>
			</div>
		{:else}
			<div class="px-5 py-3">
				<EmptyState
					icon="lucide:printer"
					title="No default printer"
					description="Printer connection, paper size and cut options are managed in the Printers page — one place, no conflicts."
				/>
			</div>
		{/if}

		<div class="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
			<div class="flex flex-wrap items-center gap-2 text-[10.5px]">
				<span
					class="inline-flex items-center gap-1 rounded-md bg-[var(--ui-bg-accented)] px-2 py-1 font-semibold text-[var(--ui-text-dimmed)]"
				>
					<Icon name="lucide:route" class="size-3" />Routing:
					{activeType === 'none' ? 'off' : activeType}</span
				>
				<span
					class="inline-flex items-center gap-1 rounded-md bg-[var(--ui-bg-accented)] px-2 py-1 font-semibold text-[var(--ui-text-dimmed)]"
				>
					<Icon name="lucide:ruler" class="size-3" />{activePaper}</span
				>
			</div>
			<Button
				href={resolve('/settings/printers')}
				variant="ghost"
				color="neutral"
				size="sm"
				icon="lucide:arrow-up-right">Manage printers</Button
			>
		</div>
	</section>

	<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
		<div class="flex items-center gap-2 px-5 py-3">
			<Icon name="lucide:laptop-minimal" class="size-4 text-primary-500" />
			<h2 class="font-display text-[14px] font-semibold">Terminal identity</h2>
		</div>
		<div class="grid grid-cols-1 gap-4 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
					>Device code (optional)</span
				>
				<Input
					bind:value={deviceCode}
					maxlength={4}
					placeholder="POS1"
					class="w-full"
					oninput={() => {
						deviceCode = normalizeDeviceCode(deviceCode);
					}}
				/>
				<p class="mt-1.5 text-[11px] text-[var(--ui-text-dimmed)]">
					Used in order/shift/expense numbers. Leave empty to use the auto-generated device code.
				</p>
			</label>
			<div
				class="rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-4 py-3 text-[12px]"
			>
				<div class="font-semibold text-[var(--ui-text-muted)]">Active code</div>
				<div class="mt-1 font-mono text-[14px] font-bold">{activeDeviceCode}</div>
			</div>
		</div>
		<div class="flex items-center justify-between px-5 py-4">
			<span class="text-[12px] text-[var(--ui-text-muted)]"
				>Example number: `ORD-260803-MAIN-{activeDeviceCode}-0001`</span
			>
			<Button
				color="neutral"
				variant="ghost"
				size="sm"
				icon="lucide:rotate-ccw"
				onclick={() => {
					deviceCode = '';
					save();
				}}
			>
				Use auto code
			</Button>
		</div>
	</section>

	<!-- Peripherals -->
	<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
		<div class="flex items-center gap-2 px-5 py-3">
			<Icon name="lucide:cpu" class="size-4 text-primary-500" />
			<h2 class="font-display text-[14px] font-semibold">Peripherals</h2>
		</div>

		<!-- Cash drawer now follows the default printer to avoid a second source of truth -->
		<div class="flex items-center justify-between gap-4 px-5 py-4">
			<div class="flex items-start gap-3">
				<div
					class="grid size-9 shrink-0 place-items-center rounded-xl bg-amber-500/10 text-amber-500"
				>
					<Icon name="lucide:archive" class="size-4" />
				</div>
				<div>
					<label class="text-[13px] font-semibold">Cash drawer</label>
					<p class="text-[11px] text-[var(--ui-text-dimmed)]">
						{#if activePrinter}
							Auto-open on cash payment · tied to "{activePrinter.name}"
						{:else}
							Configured per printer in the Printers page
						{/if}
					</p>
				</div>
			</div>
			<Switch checked={cashDrawerOn} onCheckedChange={toggleCashDrawer} />
		</div>

		<div class="flex items-center justify-between gap-4 px-5 py-4">
			<div class="flex items-start gap-3">
				<div
					class="grid size-9 shrink-0 place-items-center rounded-xl bg-blue-500/10 text-blue-500"
				>
					<Icon name="lucide:scan-barcode" class="size-4" />
				</div>
				<div>
					<label class="text-[13px] font-semibold">Barcode scanner</label>
					<p class="text-[11px] text-[var(--ui-text-dimmed)]">USB or Bluetooth HID scanner</p>
				</div>
			</div>
			<Switch bind:checked={barcodeScanner} onCheckedChange={save} />
		</div>
		<div class="flex items-center justify-between gap-4 px-5 py-4">
			<div class="flex items-start gap-3">
				<div
					class="grid size-9 shrink-0 place-items-center rounded-xl bg-purple-500/10 text-purple-500"
				>
					<Icon name="lucide:monitor" class="size-4" />
				</div>
				<div>
					<label class="text-[13px] font-semibold">Customer display</label>
					<p class="text-[11px] text-[var(--ui-text-dimmed)]">Second screen for customer view</p>
				</div>
			</div>
			<Switch bind:checked={customerDisplay} onCheckedChange={save} />
		</div>
		<div class="flex items-center justify-between gap-4 px-5 py-4">
			<div class="flex items-start gap-3">
				<div
					class="grid size-9 shrink-0 place-items-center rounded-xl bg-emerald-500/10 text-emerald-500"
				>
					<Icon name="lucide:scale" class="size-4" />
				</div>
				<div>
					<label class="text-[13px] font-semibold">Weighing scale</label>
					<p class="text-[11px] text-[var(--ui-text-dimmed)]">Connect to a compatible scale</p>
				</div>
			</div>
			<Switch bind:checked={scaleConnected} onCheckedChange={save} />
		</div>
	</section>

	<div class="flex justify-end">
		<Button color="primary" icon="lucide:check" onclick={save}>Save changes</Button>
	</div>
</div>
