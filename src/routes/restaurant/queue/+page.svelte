<script lang="ts">
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import { glo } from '$nostr/store.svelte';
	import { relativeTime } from '$lib/utils/format';
	import type { GloOrder } from '@bitos/bnos-core/glo';

	import { onMount } from 'svelte';
	onMount(() => glo.hydrate('commerce.order'));

	const queue = $derived(
		[...glo.all<GloOrder, 'commerce.order'>('commerce.order')]
			.sort((a, b) => new Date(b.data.occurredAt || 0).getTime() - new Date(a.data.occurredAt || 0).getTime())
			.slice(0, 10)
	);
</script>

<svelte:head><title>bdGo OS · Order Queue</title></svelte:head>

<div class="space-y-4">
	<div>
		<h1 class="font-display text-xl font-bold tracking-tight">Order queue</h1>
		<p class="text-[12.5px] text-[var(--ui-text-muted)]">Latest orders in flight</p>
	</div>
	{#if queue.length === 0}
		<EmptyState icon="lucide:clipboard-list" title="Queue is empty" description="New orders from the POS will queue here in real time." />
	{:else}
		<ol class="space-y-2">
			{#each queue as o, i (o.id)}
				<li class="surface-card flex items-center gap-3 p-4">
					<span class="grid size-8 place-items-center rounded-full bg-primary-500/10 text-[12px] font-bold text-primary-600 dark:text-primary-400">
						{i + 1}
					</span>
					<div class="flex-1">
						<div class="font-semibold">{o.data.number ?? o.id.slice(0, 8)}</div>
						<div class="text-[12px] text-[var(--ui-text-muted)]">{o.data.lines?.length ?? 0} items · {relativeTime(o.data.occurredAt)}</div>
					</div>
					<Badge color={o.data.status.includes('paid') ? 'success' : 'warning'}>{o.data.status}</Badge>
				</li>
			{/each}
		</ol>
	{/if}
</div>
