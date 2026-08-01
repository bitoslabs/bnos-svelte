<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { ModeWatcher } from 'mode-watcher';
	import { registerIcons } from '$lib/icons';
	import { preferences } from '$lib/theme/preferences.svelte';
	import { session } from '$nostr/session.svelte';
	import { relays } from '$nostr/relay.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { warmRelays } from '$nostr/client';
	import AppSidebar from '$lib/components/AppSidebar.svelte';
	import AppTopbar from '$lib/components/AppTopbar.svelte';
	import BottomTabBar from '$lib/components/mobile/BottomTabBar.svelte';
	import Toaster from '$lib/components/ui/Toaster.svelte';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
	let drawerOpen = $state(false);

	const isPublicRoute = $derived(
		page.url.pathname === '/login' || page.url.pathname.startsWith('/setup')
	);
	const isPosRoute = $derived(page.url.pathname === '/pos');

	registerIcons();

	onMount(() => {
		preferences.load();
		preferences.apply();
		relays.load();
		session.load();
		tenant.load();
		if (session.isAuthenticated) void warmRelays();
	});

	$effect(() => {
		if (isPublicRoute || !session.hydrated || !tenant.hydrated) return;
		if (!session.isAuthenticated) {
			void goto(resolve('/login'), { replaceState: true });
		} else if (!tenant.state.setupComplete) {
			void goto(resolve('/setup'), { replaceState: true });
		}
	});
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

{#if isPublicRoute}
	{@render children()}
{:else}
	<div class="app-shell flex min-h-screen">
		{#if !isPosRoute}
			<aside
				class="app-sidebar-shell app-chrome sticky top-0 hidden h-screen w-64 shrink-0 border-r border-[var(--glass-border)] lg:flex lg:flex-col"
			>
				<AppSidebar />
			</aside>
		{/if}

		{#if drawerOpen && !isPosRoute}
			<button
				type="button"
				aria-label="Close menu"
				class="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] lg:hidden"
				onclick={() => (drawerOpen = false)}
			></button>
			<aside
				class="app-sidebar-shell app-chrome animate-fade fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-[var(--glass-border)] lg:hidden"
			>
				<AppSidebar onnavigate={() => (drawerOpen = false)} />
			</aside>
		{/if}

		<div class="flex min-w-0 flex-1 flex-col">
			{#if !isPosRoute}
				<AppTopbar onmenutoggle={() => (drawerOpen = true)} />
			{/if}
			<main
				class={isPosRoute
					? 'app-main min-w-0 flex-1 p-0'
					: 'app-main min-w-0 flex-1 px-5 pt-3 pb-24 lg:pb-8'}
			>
				<div class="w-full">
					{@render children()}
				</div>
			</main>
		</div>
	</div>

	{#if !isPosRoute}
		<BottomTabBar />
	{/if}
{/if}

<ModeWatcher />
<Toaster />
