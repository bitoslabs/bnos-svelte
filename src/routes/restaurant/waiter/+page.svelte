<script lang="ts">
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { glo } from '$nostr/store.svelte';
	import { relativeTime } from '$lib/utils/format';
	import type { GloOrder } from '@bitos/bnos-core/glo';

	import { onMount } from 'svelte';
	onMount(() => glo.hydrate('commerce.order'));

	const open = $derived(
		glo
			.all<GloOrder, 'commerce.order'>('commerce.order')
			.filter((o) => !['paid', 'completed', 'cancelled'].includes((o.data.status ?? '').toLowerCase()))
	);
</script>

<svelte:head><title>bdGo OS · Waiter</title></svelte:head>

<div class="space-y-4">
	<div>
		<h1 class="font-display text-xl font-bold tracking-tight">Waiter station</h1>
		<p class="text-[12.5px] text-[var(--ui-text-muted)]">Open tabs & table service</p>
	</div>
	{#if open.length === 0}
		<EmptyState icon="lucide:concierge-bell" title="No open tabs" description="Orders started from the POS that aren't yet paid show up here." />
	{:else}
		<ul class="space-y-2">
			{#each open as o (o.id)}
				<li class="surface-card flex items-center gap-3 p-4">
					<Icon name="lucide:receipt-text" class="size-5 text-primary-500" />
					<div class="flex-1">
						<div class="font-semibold">{o.data.number ?? o.id.slice(0, 8)}</div>
						<div class="text-[12px] text-[var(--ui-text-muted)]">{o.data.lines?.length ?? 0} items · {relativeTime(o.data.occurredAt)}</div>
					</div>
					<span class="rounded-md bg-[var(--ui-bg-accented)] px-2 py-0.5 text-[11px] font-semibold">{o.data.status}</span>
				</li>
			{/each}
		</ul>
	{/if}
</div>
