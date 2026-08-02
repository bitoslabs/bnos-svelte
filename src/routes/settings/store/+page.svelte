<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { browser } from '$app/environment';

	const KEY = 'bnos-os:settings-store';

	let storeName = $state('');
	let storePhone = $state('');
	let storeAddress = $state('');
	let storeWebsite = $state('');
	let storeLogo = $state('');

	onMount(() => {
		if (!browser) return;
		try {
			const s = JSON.parse(localStorage.getItem(KEY) ?? '{}');
			storeName = s.storeName ?? tenant.state.organizationName ?? '';
			storePhone = s.storePhone ?? '';
			storeAddress = s.storeAddress ?? '';
			storeWebsite = s.storeWebsite ?? '';
			storeLogo = s.storeLogo ?? '';
		} catch { /* */ }
	});

	function save() {
		if (!browser) return;
		localStorage.setItem(KEY, JSON.stringify({ storeName, storePhone, storeAddress, storeWebsite, storeLogo }));
		tenant.configure({ organizationName: storeName });
		toast.success('Store profile saved');
	}

	function handleLogoUpload(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		if (file.size > 2 * 1024 * 1024) { toast.warning('Logo must be under 2MB'); return; }
		const reader = new FileReader();
		reader.onload = (ev) => { storeLogo = ev.target?.result as string; };
		reader.readAsDataURL(file);
	}

	const initials = $derived((storeName || 'BNOS').split(/[\s_-]+/).map((w) => w[0]).join('').toUpperCase().slice(0, 2));
</script>

<svelte:head><title>Store · Settings</title></svelte:head>

<div class="space-y-5">
	<div>
		<h1 class="font-display text-xl font-bold tracking-tight">Store profile</h1>
		<p class="text-[12.5px] text-[var(--ui-text-muted)]">Public-facing store identity</p>
	</div>

	<!-- Store Logo -->
	<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
		<div class="flex items-center gap-2 px-5 py-3">
			<Icon name="lucide:image" class="size-4 text-primary-500" />
			<h2 class="font-display text-[14px] font-semibold">Store logo</h2>
		</div>
		<div class="flex items-start gap-5 px-5 py-5">
			<div class="grid size-24 shrink-0 place-items-center overflow-hidden rounded-2xl border-2 border-dashed border-[var(--ui-border)] bg-[var(--ui-bg-muted)]">
				{#if storeLogo}<img src={storeLogo} alt="Logo" class="h-full w-full object-contain p-1.5" />{:else}<div class="text-center"><Icon name="lucide:shop" class="size-7 text-[var(--ui-text-dimmed)]" /><p class="mt-1 text-[8px] text-[var(--ui-text-dimmed)]">No logo</p></div>{/if}
			</div>
			<div class="flex-1 space-y-3">
				<Input bind:value={storeLogo} placeholder="Logo URL or data URI" icon="lucide:link" class="w-full" />
				<div class="flex gap-2">
					<label class="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-primary-500/30 px-3.5 py-2 text-[12px] font-semibold text-primary-600 dark:text-primary-400 transition-colors hover:bg-primary-500/10">
						<Icon name="lucide:upload" class="size-3.5" />Upload
						<input type="file" accept="image/*" class="hidden" onchange={handleLogoUpload} />
					</label>
					{#if storeLogo}<Button color="error" variant="ghost" size="sm" icon="lucide:trash-2" onclick={() => (storeLogo = '')}>Remove</Button>{/if}
				</div>
				<p class="text-[10px] text-[var(--ui-text-dimmed)]">PNG, JPG or SVG · max 2MB · recommended 256×256</p>
			</div>
		</div>
	</section>

	<!-- Store Identity -->
	<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
		<div class="flex items-center gap-2 px-5 py-3">
			<Icon name="lucide:shop" class="size-4 text-primary-500" />
			<h2 class="font-display text-[14px] font-semibold">Store identity</h2>
		</div>
		<div class="px-5 py-4"><label class="block"><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Store name</span><Input bind:value={storeName} placeholder="My Store" class="w-full" /></label></div>
		<div class="px-5 py-4"><label class="block"><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Phone number</span><Input bind:value={storePhone} placeholder="+856 20 xxxx xxx" icon="lucide:phone" class="w-full" /></label></div>
		<div class="px-5 py-4"><label class="block"><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Address</span><Input bind:value={storeAddress} placeholder="Street, city, country" icon="lucide:map-pin" class="w-full" /></label></div>
		<div class="px-5 py-4"><label class="block"><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Website</span><Input bind:value={storeWebsite} placeholder="https://mystore.com" icon="lucide:globe" class="w-full" /></label></div>
	</section>

	<!-- Preview -->
	<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
		<div class="flex items-center gap-2 px-5 py-3">
			<Icon name="lucide:eye" class="size-4 text-primary-500" />
			<h2 class="font-display text-[14px] font-semibold">Preview</h2>
		</div>
		<div class="px-5 py-4">
			<div class="flex items-center gap-4 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] p-4">
				{#if storeLogo}<img src={storeLogo} alt="Logo" class="size-14 shrink-0 rounded-xl object-contain" />{:else}<div class="grid size-14 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary-400 to-primary-600 font-display text-xl font-black text-white">{initials}</div>{/if}
				<div class="min-w-0">
					<p class="truncate font-display text-[15px] font-bold">{storeName || 'My Store'}</p>
					{#if storeAddress}<p class="truncate text-[11px] text-[var(--ui-text-muted)]">{storeAddress}</p>{/if}
					<div class="mt-1 flex items-center gap-3">
						{#if storePhone}<span class="flex items-center gap-1 text-[10px] text-[var(--ui-text-dimmed)]"><Icon name="lucide:phone" class="size-3" />{storePhone}</span>{/if}
						{#if storeWebsite}<span class="flex items-center gap-1 text-[10px] text-primary-500"><Icon name="lucide:globe" class="size-3" />{storeWebsite}</span>{/if}
					</div>
				</div>
			</div>
		</div>
	</section>

	<div class="flex justify-end"><Button color="primary" icon="lucide:check" onclick={save}>Save changes</Button></div>
</div>
