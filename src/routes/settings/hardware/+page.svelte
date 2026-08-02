<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import Switch from '$lib/components/ui/Switch.svelte';
	import { browser } from '$app/environment';
	import { toast } from '$lib/stores/toast.svelte';

	const KEY = 'bnos-os:settings-hardware';

	let printerType = $state<'browser' | 'usb' | 'network' | 'none'>('browser');
	let paperSize = $state<'58mm' | '80mm'>('80mm');
	let cashDrawer = $state(false);
	let barcodeScanner = $state(false);
	let customerDisplay = $state(false);
	let scaleConnected = $state(false);

	onMount(() => {
		if (!browser) return;
		try {
			const s = JSON.parse(localStorage.getItem(KEY) ?? '{}');
			if (s.printerType) printerType = s.printerType;
			if (s.paperSize) paperSize = s.paperSize;
			if (s.cashDrawer !== undefined) cashDrawer = s.cashDrawer;
			if (s.barcodeScanner !== undefined) barcodeScanner = s.barcodeScanner;
			if (s.customerDisplay !== undefined) customerDisplay = s.customerDisplay;
			if (s.scaleConnected !== undefined) scaleConnected = s.scaleConnected;
		} catch { /* */ }
	});

	function save() {
		if (!browser) return;
		localStorage.setItem(KEY, JSON.stringify({ printerType, paperSize, cashDrawer, barcodeScanner, customerDisplay, scaleConnected }));
		toast.success('Hardware settings saved');
	}

	function testPrint() { toast.info('Sending test print…'); window.print(); }
</script>

<svelte:head><title>Hardware · Settings</title></svelte:head>

<div class="space-y-5">
	<div>
		<h1 class="font-display text-xl font-bold tracking-tight">Hardware</h1>
		<p class="text-[12.5px] text-[var(--ui-text-muted)]">Printers, cash drawer, scanners, and peripherals</p>
	</div>

	<!-- Printer -->
	<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
		<div class="flex items-center gap-2 px-5 py-3">
			<Icon name="lucide:printer" class="size-4 text-primary-500" />
			<h2 class="font-display text-[14px] font-semibold">Receipt printer</h2>
		</div>
		<div class="grid grid-cols-1 gap-4 px-5 py-4 sm:grid-cols-2">
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Printer connection</span>
				<Select bind:value={printerType} options={[{ value: 'browser', label: 'Browser / WebUSB' }, { value: 'usb', label: 'USB (raw)' }, { value: 'network', label: 'Network / IP' }, { value: 'none', label: 'None' }]} class="w-full" />
			</label>
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Paper size</span>
				<Select bind:value={paperSize} options={[{ value: '58mm', label: '58mm' }, { value: '80mm', label: '80mm' }]} class="w-full" />
			</label>
		</div>
		<div class="flex items-center justify-between px-5 py-4">
			<span class="text-[12px] text-[var(--ui-text-muted)]">Test your printer setup</span>
			<Button color="neutral" variant="subtle" size="sm" icon="lucide:printer" onclick={testPrint}>Test print</Button>
		</div>
	</section>

	<!-- Peripherals -->
	<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
		<div class="flex items-center gap-2 px-5 py-3">
			<Icon name="lucide:cpu" class="size-4 text-primary-500" />
			<h2 class="font-display text-[14px] font-semibold">Peripherals</h2>
		</div>
		<div class="flex items-center justify-between gap-4 px-5 py-4">
			<div class="flex items-start gap-3"><div class="grid size-9 shrink-0 place-items-center rounded-xl bg-amber-500/10 text-amber-500"><Icon name="lucide:archive" class="size-4" /></div><div><label class="text-[13px] font-semibold">Cash drawer</label><p class="text-[11px] text-[var(--ui-text-dimmed)]">Auto-open on cash payment</p></div></div>
			<Switch bind:checked={cashDrawer} onCheckedChange={save} />
		</div>
		<div class="flex items-center justify-between gap-4 px-5 py-4">
			<div class="flex items-start gap-3"><div class="grid size-9 shrink-0 place-items-center rounded-xl bg-blue-500/10 text-blue-500"><Icon name="lucide:scan-barcode" class="size-4" /></div><div><label class="text-[13px] font-semibold">Barcode scanner</label><p class="text-[11px] text-[var(--ui-text-dimmed)]">USB or Bluetooth HID scanner</p></div></div>
			<Switch bind:checked={barcodeScanner} onCheckedChange={save} />
		</div>
		<div class="flex items-center justify-between gap-4 px-5 py-4">
			<div class="flex items-start gap-3"><div class="grid size-9 shrink-0 place-items-center rounded-xl bg-purple-500/10 text-purple-500"><Icon name="lucide:monitor" class="size-4" /></div><div><label class="text-[13px] font-semibold">Customer display</label><p class="text-[11px] text-[var(--ui-text-dimmed)]">Second screen for customer view</p></div></div>
			<Switch bind:checked={customerDisplay} onCheckedChange={save} />
		</div>
		<div class="flex items-center justify-between gap-4 px-5 py-4">
			<div class="flex items-start gap-3"><div class="grid size-9 shrink-0 place-items-center rounded-xl bg-emerald-500/10 text-emerald-500"><Icon name="lucide:scale" class="size-4" /></div><div><label class="text-[13px] font-semibold">Weighing scale</label><p class="text-[11px] text-[var(--ui-text-dimmed)]">Connect to a compatible scale</p></div></div>
			<Switch bind:checked={scaleConnected} onCheckedChange={save} />
		</div>
	</section>

	<div class="flex justify-end">
		<Button color="primary" icon="lucide:check" onclick={save}>Save changes</Button>
	</div>
</div>
