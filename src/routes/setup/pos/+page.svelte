<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import Switch from '$lib/components/ui/Switch.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { browser } from '$app/environment';

	const STORAGE_KEY = 'bnos-os:setup-pos';

	let receiptStoreName = $state('');
	let receiptHeader = $state('');
	let receiptFooter = $state('');
	let cashEnabled = $state(true);
	let cardEnabled = $state(true);
	let qrEnabled = $state(true);
	let lightningEnabled = $state(false);
	let paperSize = $state<'58mm' | '80mm'>('80mm');
	let printerType = $state<'browser' | 'usb' | 'network' | 'none'>('browser');

	onMount(() => {
		if (!browser) return;
		try {
			const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
			if (saved.receiptStoreName !== undefined) receiptStoreName = saved.receiptStoreName;
			if (saved.receiptHeader !== undefined) receiptHeader = saved.receiptHeader;
			if (saved.receiptFooter !== undefined) receiptFooter = saved.receiptFooter;
			if (saved.cashEnabled !== undefined) cashEnabled = saved.cashEnabled;
			if (saved.cardEnabled !== undefined) cardEnabled = saved.cardEnabled;
			if (saved.qrEnabled !== undefined) qrEnabled = saved.qrEnabled;
			if (saved.lightningEnabled !== undefined) lightningEnabled = saved.lightningEnabled;
			if (saved.paperSize) paperSize = saved.paperSize;
			if (saved.printerType) printerType = saved.printerType;
			receiptStoreName = receiptStoreName || tenant.state.organizationName || '';
		} catch { /* */ }
	});

	function save() {
		if (browser) {
			localStorage.setItem(STORAGE_KEY, JSON.stringify({
				receiptStoreName, receiptHeader, receiptFooter,
				cashEnabled, cardEnabled, qrEnabled, lightningEnabled,
				paperSize, printerType
			}));
		}
	}

	function handleContinue() {
		save();
		goto('/setup/catalog');
	}
	function handleBack() { goto('/setup/branch'); }
</script>

<svelte:head><title>Setup · POS</title></svelte:head>

<div class="space-y-6">
	<div>
		<h2 class="font-display text-xl font-bold tracking-tight">POS & receipt setup</h2>
		<p class="mt-1 text-[13.5px] text-[var(--ui-text-muted)]">
			Configure payment methods, receipt text, and printer hardware.
		</p>
	</div>

	<!-- Receipt Settings -->
	<div class="space-y-4">
		<h3 class="text-[12px] font-bold uppercase tracking-wider text-[var(--ui-text-dimmed)]">Receipt</h3>
		<label class="block">
			<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Store name on receipt</span>
			<Input bind:value={receiptStoreName} icon="lucide:store" placeholder="My Store" class="w-full" />
		</label>
		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Header text</span>
				<Input bind:value={receiptHeader} placeholder="Welcome!" class="w-full" />
			</label>
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Footer text</span>
				<Input bind:value={receiptFooter} placeholder="Thank you!" class="w-full" />
			</label>
		</div>
	</div>

	<!-- Receipt Preview -->
	<div class="mx-auto max-w-xs rounded-xl border border-dashed border-[var(--ui-border)] p-6">
		<div class="space-y-1 text-center font-mono text-[11px]">
			{#if receiptHeader}<p class="text-[var(--ui-text-dimmed)]">{receiptHeader}</p>{/if}
			<p class="text-sm font-bold">{receiptStoreName || 'Store Name'}</p>
			<hr class="my-2 border-dashed border-[var(--ui-border)]" />
			<div class="space-y-1 text-left">
				<div class="flex justify-between"><span>Item 1</span><span>$0.00</span></div>
				<div class="flex justify-between"><span>Item 2</span><span>$0.00</span></div>
			</div>
			<hr class="my-2 border-dashed border-[var(--ui-border)]" />
			<div class="flex justify-between font-bold"><span>Total</span><span>$0.00</span></div>
			<hr class="my-2 border-dashed border-[var(--ui-border)]" />
			{#if receiptFooter}<p class="text-[var(--ui-text-dimmed)]">{receiptFooter}</p>{/if}
		</div>
	</div>

	<!-- Payment Methods -->
	<div class="space-y-4">
		<h3 class="text-[12px] font-bold uppercase tracking-wider text-[var(--ui-text-dimmed)]">Payment Methods</h3>
		<div class="grid grid-cols-2 gap-3">
			<label class="flex cursor-pointer items-center gap-3 rounded-xl border-2 p-3 transition-all {cashEnabled ? 'border-primary-500 bg-primary-500/5' : 'border-[var(--ui-border)]'}">
				<Switch bind:checked={cashEnabled} />
				<div><Icon name="lucide:banknote" class="mb-0.5 size-5" /><p class="text-[13px] font-medium">Cash</p></div>
			</label>
			<label class="flex cursor-pointer items-center gap-3 rounded-xl border-2 p-3 transition-all {cardEnabled ? 'border-primary-500 bg-primary-500/5' : 'border-[var(--ui-border)]'}">
				<Switch bind:checked={cardEnabled} />
				<div><Icon name="lucide:credit-card" class="mb-0.5 size-5" /><p class="text-[13px] font-medium">Card</p></div>
			</label>
			<label class="flex cursor-pointer items-center gap-3 rounded-xl border-2 p-3 transition-all {qrEnabled ? 'border-primary-500 bg-primary-500/5' : 'border-[var(--ui-border)]'}">
				<Switch bind:checked={qrEnabled} />
				<div><Icon name="lucide:qr-code" class="mb-0.5 size-5" /><p class="text-[13px] font-medium">QR Pay</p></div>
			</label>
			<label class="flex cursor-pointer items-center gap-3 rounded-xl border-2 p-3 transition-all {lightningEnabled ? 'border-primary-500 bg-primary-500/5' : 'border-[var(--ui-border)]'}">
				<Switch bind:checked={lightningEnabled} />
				<div><Icon name="lucide:zap" class="mb-0.5 size-5" /><p class="text-[13px] font-medium">Lightning</p></div>
			</label>
		</div>
	</div>

	<!-- Hardware -->
	<div class="space-y-4">
		<h3 class="text-[12px] font-bold uppercase tracking-wider text-[var(--ui-text-dimmed)]">Hardware</h3>
		<div class="grid grid-cols-2 gap-4">
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Paper size</span>
				<Select bind:value={paperSize} options={[{ value: '58mm', label: '58mm' }, { value: '80mm', label: '80mm' }]} class="w-full" />
			</label>
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Printer</span>
				<Select bind:value={printerType} options={[{ value: 'browser', label: 'Browser' }, { value: 'usb', label: 'USB' }, { value: 'network', label: 'Network' }, { value: 'none', label: 'None' }]} class="w-full" />
			</label>
		</div>
	</div>

	<div class="flex justify-between">
		<Button color="neutral" variant="ghost" icon="lucide:arrow-left" onclick={handleBack}>Back</Button>
		<Button color="primary" icon="lucide:arrow-right" onclick={handleContinue}>Continue</Button>
	</div>
</div>
