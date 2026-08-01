<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import { session } from '$nostr/session.svelte';
	import { truncateNpub } from '$lib/utils/format';
</script>

<svelte:head><title>About · Settings</title></svelte:head>

<div class="space-y-5">
	<div class="surface-card flex flex-col items-center gap-3 p-8 text-center">
		<div class="grid size-16 place-items-center rounded-2xl bg-gradient-to-br from-primary-400 to-primary-600 shadow-lg shadow-primary-500/25"><Icon name="lucide:zap" class="size-8 text-white" /></div>
		<div><h2 class="font-display text-xl font-bold tracking-tight">bdGo OS</h2><p class="text-[12.5px] text-[var(--ui-text-muted)]">Bitcoin Network Operations System · v0.1.0</p></div>
		<div class="flex items-center gap-1.5 text-[11.5px] text-[var(--ui-text-dimmed)]"><span class="live-dot"></span>Signed in as {truncateNpub(session.npub ?? '', 10, 6)}</div>
	</div>
	<div class="surface-card divide-y divide-[var(--ui-border-muted)] text-[13px]">
		<div class="flex items-center justify-between px-4 py-3"><span class="text-[var(--ui-text-muted)]">Data layer</span><Badge color="primary">@bitos/bnos-core · GLO v1</Badge></div>
		<div class="flex items-center justify-between px-4 py-3"><span class="text-[var(--ui-text-muted)]">Framework</span><span class="font-semibold">SvelteKit · Svelte 5 · Tailwind v4</span></div>
		<div class="flex items-center justify-between px-4 py-3"><span class="text-[var(--ui-text-muted)]">Identity</span><span class="font-semibold">Nostr · NIP-07 / nsec</span></div>
		<div class="flex items-center justify-between px-4 py-3"><span class="text-[var(--ui-text-muted)]">License</span><span class="font-semibold">MIT</span></div>
	</div>
	<p class="px-1 text-center text-[11px] text-[var(--ui-text-dimmed)]">Built on the Bitcoin Network Operations System. Thanks to BitDigo.</p>
</div>
