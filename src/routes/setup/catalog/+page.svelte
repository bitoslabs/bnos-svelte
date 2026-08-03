<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { glo } from '$nostr/store.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { seedForType } from '$lib/business';
	import { newRecordId } from '$lib/utils/record-id';
	import { formatInt, formatMoney } from '$lib/utils/format';
	import type { GloProduct } from '@bitos/bnos-core/glo';

	let count = $state(0);

	onMount(() => {
		count = glo.all<GloProduct, 'catalog.product'>('catalog.product').length;
	});

	const SAMPLE = $derived(
		seedForType(tenant.state.businessType).map((p) => ({
			...p,
			currency: tenant.state.currency,
			status: 'active' as const
		}))
	);

	async function seedSamples() {
		for (const data of SAMPLE)
			await glo.upsert<GloProduct>('catalog.product', data, { id: newRecordId('product') });
		count = glo.all<GloProduct, 'catalog.product'>('catalog.product').length;
	}
	function clear() {
		for (const p of glo.all('catalog.product')) glo.remove('catalog.product', p.id);
		count = 0;
	}
</script>

<svelte:head><title>Setup · Catalog</title></svelte:head>

<div class="space-y-5">
	<div>
		<h2 class="font-display text-xl font-bold tracking-tight">Seed your catalog</h2>
		<p class="mt-1 text-[13.5px] text-[var(--ui-text-muted)]">
			Products are GLO <code>catalog.product</code> objects (kind 30100). Add a few samples to start,
			then manage everything from Catalog.
		</p>
	</div>

	<div class="surface-card flex items-center justify-between p-4">
		<div class="flex items-center gap-3">
			<div
				class="grid size-10 place-items-center rounded-lg bg-primary-500/10 text-primary-600 dark:text-primary-400"
			>
				<Icon name="lucide:package" class="size-5" />
			</div>
			<div>
				<div class="text-[13px] font-semibold">{formatInt(count)} product{count === 1 ? '' : 's'}</div>
				<div class="text-[12px] text-[var(--ui-text-muted)]">in your local catalog</div>
			</div>
		</div>
		<div class="flex gap-2">
			<Button color="neutral" variant="ghost" size="sm" onclick={clear} disabled={count === 0}
				>Clear</Button
			>
			<Button color="primary" size="sm" icon="lucide:sparkles" onclick={seedSamples}
				>Add samples</Button
			>
		</div>
	</div>

	{#if count > 0}
		<ul
			class="divide-y divide-[var(--ui-border-muted)] overflow-hidden rounded-xl border border-[var(--ui-border)]"
		>
			{#each glo.all<GloProduct, 'catalog.product'>('catalog.product') as p (p.id)}
				<li class="flex items-center justify-between px-4 py-3">
					<span class="font-medium text-[var(--ui-text)]">{p.data.name}</span>
					<span class="font-mono text-[12.5px] text-[var(--ui-text-muted)]">
						{formatMoney(p.data.price ?? 0, p.data.currency ?? tenant.state.currency)}
					</span>
				</li>
			{/each}
		</ul>
	{/if}
</div>
