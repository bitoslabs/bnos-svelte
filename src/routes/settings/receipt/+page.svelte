<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { toast } from '$lib/stores/toast.svelte';

	const KEY = 'bnos-os:receipt';
	let storeName = $state(''); let header = $state(''); let footer = $state('Thank you for your purchase!'); let paperSize = $state<'58mm' | '80mm'>('80mm');

	onMount(() => { if (browser) { try { const r = localStorage.getItem(KEY); if (r) { const p = JSON.parse(r); storeName = p.storeName ?? ''; header = p.header ?? ''; footer = p.footer ?? 'Thank you!'; paperSize = p.paperSize ?? '80mm'; } else { storeName = tenant.state.organizationName; } } catch { /* */ } } });
	function save() { if (browser) localStorage.setItem(KEY, JSON.stringify({ storeName, header, footer, paperSize })); toast.success('Receipt saved'); }
</script>

<svelte:head><title>Receipt · Settings</title></svelte:head>

<div class="grid grid-cols-1 gap-5 lg:grid-cols-2">
	<div class="space-y-4">
		<div class="flex items-center gap-3"><Icon name="lucide:receipt-text" class="size-5 text-primary-500" /><h2 class="font-display text-[15px] font-semibold tracking-tight">Receipt</h2></div>
		<label class="block"><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Store name on receipt</span><Input bind:value={storeName} class="w-full" /></label>
		<label class="block"><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Header</span><Input bind:value={header} class="w-full" /></label>
		<label class="block"><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Footer</span><Input bind:value={footer} textarea class="w-full" /></label>
		<label class="block"><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Paper size</span><Select bind:value={paperSize} options={[{ value: '58mm', label: '58mm' }, { value: '80mm', label: '80mm' }]} class="w-40" /></label>
		<Button color="primary" icon="lucide:save" onclick={save}>Save</Button>
	</div>
	<!-- preview -->
	<div class="surface-card p-5">
		<div class="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--ui-text-dimmed)]">Preview</div>
		<div class="mx-auto max-w-[14rem] rounded-lg border border-dashed border-[var(--ui-border-accented)] bg-white p-4 font-mono text-[11px] text-neutral-900">
			{#if header}<div class="text-center text-[10px] text-neutral-500">{header}</div>{/if}
			<div class="text-center text-[13px] font-bold">{storeName || 'My Store'}</div>
			<div class="my-2 border-t border-dashed border-neutral-300"></div>
			<div class="flex justify-between"><span>Item x1</span><span>0.00</span></div>
			<div class="my-2 border-t border-dashed border-neutral-300"></div>
			<div class="flex justify-between font-bold"><span>TOTAL</span><span>0.00</span></div>
			<div class="my-2 border-t border-dashed border-neutral-300"></div>
			<div class="text-center text-[10px]">{footer}</div>
		</div>
	</div>
</div>
