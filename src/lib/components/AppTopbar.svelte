<script lang="ts">
	import { page } from '$app/state';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { findNavItem } from '$lib/nav';
	import { relays } from '$nostr/relay.svelte';

	let { onmenutoggle }: { onmenutoggle?: () => void } = $props();

	const current = $derived(findNavItem(page.url.pathname));
</script>

<header
	class="app-topbar app-chrome sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-[var(--glass-border)] px-4 sm:px-6"
>
	<!-- Mobile menu toggle -->
	<button
		type="button"
		class="grid size-9 place-items-center rounded-lg text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)] lg:hidden"
		onclick={() => onmenutoggle?.()}
		aria-label="Open menu"
	>
		<Icon name="lucide:menu" class="size-5" />
	</button>

	<!-- Breadcrumb / title -->
	<div class="min-w-0 flex-1">
		<h1
			class="font-display text-[16px] font-semibold tracking-tight text-[var(--ui-text-highlighted)]"
		>
			{current?.label ?? 'BNOS'}
		</h1>
		<p class="truncate text-[11.5px] text-[var(--ui-text-dimmed)]">
			{page.url.pathname}
		</p>
	</div>

	<!-- Notifications -->
	<a href="/notifications" class="relative grid size-9 place-items-center rounded-lg text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]" aria-label="Notifications"><Icon name="lucide:bell" class="size-[18px]" /></a>

	<!-- Online / sync status -->
	<div
		class="hidden items-center gap-1.5 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-2.5 py-1.5 sm:flex"
	>
		{#if relays.online}
			<span class="live-dot"></span>
			<span class="text-[11px] font-semibold text-[var(--ui-text-muted)]">
				{relays.activeRelays.length} active relays
			</span>
		{:else}
			<Icon name="lucide:cloud-off" class="size-3.5 text-[var(--tone-warning-text)]" />
			<span class="text-[11px] font-semibold text-[var(--tone-warning-text)]">Offline</span>
		{/if}
	</div>
</header>
