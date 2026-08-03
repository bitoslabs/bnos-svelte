<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { relativeTime } from '$lib/utils/format';

	type Notif = { id: number; title: string; description?: string; icon: string; color: 'info' | 'success' | 'warning' | 'error'; at: string };
	let items = $state<Notif[]>([]);
	const KEY = 'bnos-os:notifications';

	onMount(() => { if (browser) { try { items = JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { /* */ } } });
	function push(n: Omit<Notif, 'id' | 'at'>) { const id = Date.now(); items = [{ ...n, id, at: new Date().toISOString() }, ...items]; if (browser) localStorage.setItem(KEY, JSON.stringify(items)); }
	function clearAll() { items = []; if (browser) localStorage.removeItem(KEY); }
	const tone: Record<string, string> = { info: 'tone-info', success: 'tone-success', warning: 'tone-warning', error: 'tone-error' };
	const toneText: Record<string, string> = { info: 'tone-text-info', success: 'tone-text-success', warning: 'tone-text-warning', error: 'tone-text-error' };
</script>

<svelte:head><title>BNOS · Notifications</title></svelte:head>

<div class="space-y-4">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div><h1 class="font-display text-xl font-bold tracking-tight">Notifications</h1><p class="text-[12.5px] text-[var(--ui-text-muted)]">{items.length} on this device</p></div>
		<div class="flex gap-2">
			<Button color="neutral" variant="ghost" size="sm" icon="lucide:bell-plus" onclick={() => push({ title: 'New order', description: 'Order #ORD-1024 received', icon: 'lucide:receipt-text', color: 'success' })}>Seed</Button>
			<Button color="neutral" variant="ghost" size="sm" icon="lucide:trash-2" onclick={clearAll} disabled={!items.length}>Clear</Button>
		</div>
	</div>

	{#if items.length === 0}
		<EmptyState icon="lucide:bell" title="No notifications" description="Order events, low-stock alerts and sync notices show up here." />
	{:else}
		<div class="surface-card divide-y divide-[var(--ui-border-muted)]">
			{#each items as n (n.id)}
				<div class="flex items-start gap-3 px-4 py-3.5">
					<div class="grid size-9 shrink-0 place-items-center rounded-lg {tone[n.color]}"><Icon name={n.icon} class="size-4 {toneText[n.color]}" /></div>
					<div class="min-w-0 flex-1"><div class="text-[13px] font-semibold">{n.title}</div>{#if n.description}<div class="text-[12px] text-[var(--ui-text-muted)]">{n.description}</div>{/if}</div>
					<span class="shrink-0 text-[11px] text-[var(--ui-text-dimmed)]">{relativeTime(n.at)}</span>
				</div>
			{/each}
		</div>
	{/if}
</div>
