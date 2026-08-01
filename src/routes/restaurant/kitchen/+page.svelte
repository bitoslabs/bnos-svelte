<script lang="ts">
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import { glo } from '$nostr/store.svelte';
	import { relativeTime } from '$lib/utils/format';
	import type { GloOrder, GloOrderLine } from '@bitos/bnos-core/glo';

	import { onMount } from 'svelte';
	onMount(() => glo.hydrate('commerce.order'));

	type Ticket = { orderId: string; line: GloOrderLine; at: string };
	const tickets = $derived(
		glo
			.all<GloOrder, 'commerce.order'>('commerce.order')
			.flatMap((o) =>
				(o.data.lines ?? []).map<Ticket>((line) => ({
					orderId: o.data.number ?? o.id.slice(0, 8),
					line,
					at: o.data.occurredAt
				}))
			)
			.sort((a, b) => new Date(b.at || 0).getTime() - new Date(a.at || 0).getTime())
			.slice(0, 12)
	);
</script>

<svelte:head><title>bdGo OS · Kitchen</title></svelte:head>

<div class="space-y-4">
	<div>
		<h1 class="font-display text-xl font-bold tracking-tight">Kitchen display</h1>
		<p class="text-[12.5px] text-[var(--ui-text-muted)]">Prep tickets from active orders · kind 30211</p>
	</div>
	{#if tickets.length === 0}
		<EmptyState icon="lucide:chef-hat" title="No tickets" description="Order line items appear here for prep as they come in from the POS." />
	{:else}
		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
			{#each tickets as tk (tk.orderId + tk.line.id)}
				<div class="accent-bar surface-card p-4">
					<div class="mb-2 flex items-center justify-between">
						<Badge color="warning">Queued</Badge>
						<span class="text-[11px] text-[var(--ui-text-dimmed)]">{relativeTime(tk.at)}</span>
					</div>
					<div class="font-display text-[15px] font-bold">×{tk.line.quantity} {tk.line.name}</div>
					<div class="font-mono text-[11.5px] text-[var(--ui-text-muted)]">order {tk.orderId}</div>
					{#if tk.line.notes}
						<div class="mt-1 text-[12px] text-[var(--ui-text-muted)]">“{tk.line.notes}”</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>
