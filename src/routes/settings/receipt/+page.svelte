<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import Switch from '$lib/components/ui/Switch.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { loadReceiptSettings, saveReceiptSettings } from '$lib/settings/local';

	// Core fields
	let storeName = $state('');
	let header = $state('');
	let footer = $state('Thank you for your purchase!');
	let paperSize = $state<'58mm' | '80mm'>('80mm');

	// Logo
	let logoUrl = $state('');
	let showLogo = $state(false);

	// Tax ID
	let taxId = $state('');
	let showTaxId = $state(false);

	// QR code
	let showQr = $state(false);
	let qrData = $state('');

	// Show/hide toggles
	let showStoreName = $state(true);
	let showPhone = $state(false);
	let showAddress = $state(false);
	let showDate = $state(true);
	let showOrderNumber = $state(true);
	let showBarcode = $state(false);
	let showCashierName = $state(false);

	// Extra info for preview
	let phone = $state('');
	let address = $state('');

	onMount(() => {
		if (!browser) return;
		const p = loadReceiptSettings(tenant.state.organizationName);
		storeName = p.storeName;
		header = p.header;
		footer = p.footer;
		paperSize = p.paperSize;
		logoUrl = p.logoUrl;
		showLogo = p.showLogo;
		taxId = p.taxId;
		showTaxId = p.showTaxId;
		showQr = p.showQr;
		qrData = p.qrData;
		showStoreName = p.showStoreName;
		showPhone = p.showPhone;
		showAddress = p.showAddress;
		showDate = p.showDate;
		showOrderNumber = p.showOrderNumber;
		showBarcode = p.showBarcode;
		showCashierName = p.showCashierName;
		phone = p.phone;
		address = p.address;
	});

	function save() {
		saveReceiptSettings({
			storeName,
			header,
			footer,
			paperSize,
			logoUrl,
			showLogo,
			taxId,
			showTaxId,
			showQr,
			qrData,
			showStoreName,
			showPhone,
			showAddress,
			showDate,
			showOrderNumber,
			showBarcode,
			showCashierName,
			phone,
			address
		});
		toast.success('Receipt saved');
	}
</script>

<svelte:head><title>Receipt · Settings</title></svelte:head>

<div class="grid grid-cols-1 gap-5 lg:grid-cols-2">
	<div class="space-y-5">
		<!-- Header -->
		<div class="flex items-center gap-3">
			<Icon name="lucide:receipt-text" class="size-5 text-primary-500" />
			<h2 class="font-display text-[15px] font-semibold tracking-tight">Receipt</h2>
		</div>

		<!-- Basic info -->
		<section class="surface-card space-y-4 p-5">
			<h3 class="text-[13px] font-semibold text-[var(--ui-text-muted)] uppercase tracking-wider">Basic</h3>
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Store name on receipt</span>
				<Input bind:value={storeName} class="w-full" />
			</label>
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Header</span>
				<Input bind:value={header} class="w-full" />
			</label>
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Footer</span>
				<Input bind:value={footer} textarea class="w-full" />
			</label>
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Paper size</span>
				<Select
					bind:value={paperSize}
					options={[
						{ value: '58mm', label: '58mm' },
						{ value: '80mm', label: '80mm' }
					]}
					class="w-40"
				/>
			</label>
		</section>

		<!-- Logo & Tax ID -->
		<section class="surface-card space-y-4 p-5">
			<h3 class="text-[13px] font-semibold text-[var(--ui-text-muted)] uppercase tracking-wider">Branding</h3>
			<div>
				<div class="mb-1.5 flex items-center justify-between">
					<span class="text-[12px] font-semibold text-[var(--ui-text-muted)]">Receipt logo URL</span>
					<Switch checked={showLogo} onCheckedChange={(v) => (showLogo = v)} />
				</div>
				<Input bind:value={logoUrl} icon="lucide:image" placeholder="https://…" class="w-full" />
			</div>
			<div>
				<div class="mb-1.5 flex items-center justify-between">
					<span class="text-[12px] font-semibold text-[var(--ui-text-muted)]">Tax ID</span>
					<Switch checked={showTaxId} onCheckedChange={(v) => (showTaxId = v)} />
				</div>
				<Input bind:value={taxId} icon="lucide:badge-check" placeholder="TIN / VAT number" class="w-full" />
			</div>
		</section>

		<!-- QR Code -->
		<section class="surface-card space-y-4 p-5">
			<h3 class="text-[13px] font-semibold text-[var(--ui-text-muted)] uppercase tracking-wider">QR Code</h3>
			<div class="flex items-center justify-between">
				<span class="text-[13px] font-semibold">Show QR code on receipt</span>
				<Switch checked={showQr} onCheckedChange={(v) => (showQr = v)} />
			</div>
			{#if showQr}
				<label class="block">
					<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">QR data (URL, payment address, etc.)</span>
					<Input bind:value={qrData} icon="lucide:qr-code" placeholder="e.g. bitcoin:… or https://…" class="w-full" />
				</label>
			{/if}
		</section>

		<!-- Show/hide fields -->
		<section class="surface-card space-y-3 p-5">
			<h3 class="text-[13px] font-semibold text-[var(--ui-text-muted)] uppercase tracking-wider">Visible fields</h3>
			<div class="flex items-center justify-between py-1">
				<span class="text-[13px]">Store name</span>
				<Switch bind:checked={showStoreName} />
			</div>
			<div class="flex items-center justify-between py-1">
				<div>
					<span class="text-[13px]">Phone number</span>
					{#if showPhone}
						<Input bind:value={phone} icon="lucide:phone" placeholder="+856 …" class="mt-1.5 w-full" />
					{/if}
				</div>
				<Switch bind:checked={showPhone} />
			</div>
			<div class="flex items-center justify-between py-1">
				<div>
					<span class="text-[13px]">Address</span>
					{#if showAddress}
						<Input bind:value={address} icon="lucide:map-pin" placeholder="123 Main St" class="mt-1.5 w-full" />
					{/if}
				</div>
				<Switch bind:checked={showAddress} />
			</div>
			<div class="flex items-center justify-between py-1">
				<span class="text-[13px]">Date</span>
				<Switch bind:checked={showDate} />
			</div>
			<div class="flex items-center justify-between py-1">
				<span class="text-[13px]">Order number</span>
				<Switch bind:checked={showOrderNumber} />
			</div>
			<div class="flex items-center justify-between py-1">
				<span class="text-[13px]">Barcode</span>
				<Switch bind:checked={showBarcode} />
			</div>
			<div class="flex items-center justify-between py-1">
				<span class="text-[13px]">Cashier name</span>
				<Switch bind:checked={showCashierName} />
			</div>
		</section>

		<Button color="primary" icon="lucide:save" onclick={save}>Save</Button>
	</div>

	<!-- Preview -->
	<div class="surface-card p-5">
		<div class="mb-3 text-[11px] font-semibold tracking-wider text-[var(--ui-text-dimmed)] uppercase">Preview</div>
		<div class="mx-auto max-w-[14rem] rounded-lg border border-dashed border-[var(--ui-border-accented)] bg-white p-4 font-mono text-[11px] text-neutral-900">
			{#if showLogo && logoUrl}
				<div class="mb-2 flex justify-center">
					<img src={logoUrl} alt="Logo" class="h-12 object-contain" />
				</div>
			{/if}
			{#if header}<div class="text-center text-[10px] text-neutral-500">{header}</div>{/if}
			{#if showStoreName}<div class="text-center text-[13px] font-bold">{storeName || 'My Store'}</div>{/if}
			{#if showPhone && phone}<div class="text-center text-[10px] text-neutral-600">Tel: {phone}</div>{/if}
			{#if showAddress && address}<div class="text-center text-[10px] text-neutral-600">{address}</div>{/if}
			{#if showTaxId && taxId}<div class="text-center text-[10px] text-neutral-600">Tax ID: {taxId}</div>{/if}
			<div class="my-2 border-t border-dashed border-neutral-300"></div>
			{#if showDate}<div class="flex justify-between"><span>Date</span><span>{new Date().toLocaleDateString()}</span></div>{/if}
			{#if showOrderNumber}<div class="flex justify-between"><span>Order</span><span>#0001</span></div>{/if}
			{#if showCashierName}<div class="flex justify-between"><span>Cashier</span><span>Staff</span></div>{/if}
			<div class="my-2 border-t border-dashed border-neutral-300"></div>
			<div class="flex justify-between"><span>Item x1</span><span>0.00</span></div>
			<div class="my-2 border-t border-dashed border-neutral-300"></div>
			<div class="flex justify-between font-bold"><span>TOTAL</span><span>0.00</span></div>
			{#if showBarcode}
				<div class="my-2 flex justify-center"><span class="font-mono text-[20px] tracking-widest">||||||||</span></div>
			{/if}
			{#if showQr && qrData}
				<div class="my-2 flex justify-center">
					<div class="grid size-16 place-items-center rounded border border-neutral-300">
						<Icon name="lucide:qr-code" class="size-10 text-neutral-700" />
					</div>
				</div>
			{/if}
			<div class="my-2 border-t border-dashed border-neutral-300"></div>
			<div class="text-center text-[10px]">{footer}</div>
		</div>
	</div>
</div>
