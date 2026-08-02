<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { ModeWatcher } from 'mode-watcher';
	import { registerIcons } from '$lib/icons';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { preferences } from '$lib/theme/preferences.svelte';
	import { session } from '$nostr/session.svelte';
	import { relays } from '$nostr/relay.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { warmRelays } from '$nostr/client';
	import { glo } from '$nostr/store.svelte';
	import AppSidebar from '$lib/components/AppSidebar.svelte';
	import { sidebarState, loadCollapsed as loadSidebarCollapsed } from '$lib/sidebar-state.svelte';
	import AppTopbar from '$lib/components/AppTopbar.svelte';
	import BottomTabBar from '$lib/components/mobile/BottomTabBar.svelte';
	import Toaster from '$lib/components/ui/Toaster.svelte';
	import PwaPrompt from '$lib/components/PwaPrompt.svelte';
	import OfflineBadge from '$lib/components/OfflineBadge.svelte';
	import { popovers } from '$lib/stores/popovers.svelte';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
	let drawerOpen = $state(false);

	const isPublicRoute = $derived(
		page.url.pathname === '/login' || page.url.pathname.startsWith('/setup')
	);
	const isPosRoute = $derived(page.url.pathname === '/pos' || page.url.pathname.startsWith('/pos/'));

	registerIcons();
	loadSidebarCollapsed();

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
			// New device: localStorage empty, check IndexedDB + relays before redirecting to setup
			glo.hydrate('organization');
			glo.hydrate('location');
			queueMicrotask(async () => {
				// Step 1: Wait for IndexedDB hydration (local cache, fast)
				let attempts = 0;
				while (!glo.isHydrated('organization') && attempts < 20) {
					await new Promise(r => setTimeout(r, 100));
					attempts++;
				}
				let orgs = glo.all('organization');
				// Step 2: If not in IndexedDB, sync from relays (new device)
				if (orgs.length === 0 && session.pubkey) {
					// Show sync overlay while pulling from relays
					postLoginSyncState = 'syncing';
					// Wait for relays to be ready (max 5s)
					let relayWait = 0;
					while (!relays.hydrated && relayWait < 50) {
						await new Promise(r => setTimeout(r, 100));
						relayWait++;
					}
					// Warm relay connections
					try { await warmRelays(); } catch {}
					// Small delay for connections to establish
					await new Promise(r => setTimeout(r, 500));
					// Try syncing org + all key types
					try {
						await glo.sync('organization');
						await glo.sync('location');
						// Also sync key business data
						await glo.sync('catalog.product');
						await glo.sync('commerce.order');
						await glo.sync('crm.customer');
						await glo.sync('commerce.payment');
						// Re-hydrate after sync
						glo.hydrate('organization');
						glo.hydrate('location');
						await new Promise(r => setTimeout(r, 500));
						orgs = glo.all('organization');
					} catch { /* network error */ }
					postLoginSyncState = 'idle';
				}
				// Step 3: Check again after relay sync
				if (orgs.length > 0) {
					// Workspace found — restore tenant context
					const org = orgs[0];
					const d = org.data as Record<string, unknown>;
					tenant.configure({
						organizationId: org.id,
						organizationName: (d.name as string) ?? '',
						organizationCode: (d.code as string) ?? '',
						currency: (d.currency as string) ?? 'USD'
					});
					tenant.completeSetup();
					const locations = glo.all('location');
					if (locations.length > 0) {
						const loc = locations[0];
						tenant.configure({
							locationId: loc.id,
							locationName: ((loc.data as Record<string, unknown>).name as string) ?? 'Main'
						});
					}
					// Trigger full data sync in background
					postLoginSyncDone = false; // reset so post-login sync effect fires
				} else {
					// No workspace found locally or on relays → genuine new user → go to setup
					void goto(resolve('/setup'), { replaceState: true });
				}
			});
		}
	});

	// Sync all data from relays once after login (new device / fresh session)
	let postLoginSyncDone = false;
	let postLoginSyncState = $state<'idle' | 'syncing' | 'done'>('idle');
	const ALL_DATA_TYPES = [
		'organization',
		'catalog.product',
		'catalog.category',
		'catalog.unit',
		'catalog.modifier-group',
		'catalog.bundle',
		'commerce.order',
		'commerce.payment',
		'crm.customer',
		'commerce.expense',
		'inventory.adjustment',
		'inventory.supplier',
		'inventory.purchase-order',
		'staff.member',
		'commerce.shift',
		'promotion',
		'membership.plan',
		'membership.subscription',
		'restaurant.table',
		'restaurant.order',
		'blocked.entry',
		'settings.payment-method',
		'location',
	];

	$effect(() => {
		if (!session.isAuthenticated || !tenant.hydrated || !relays.hydrated) return;
		if (postLoginSyncDone) return;
		postLoginSyncDone = true;
		postLoginSyncState = 'syncing';

		void warmRelays();

		for (const type of ALL_DATA_TYPES) {
			glo.hydrate(type);
		}

		if (relays.online && session.pubkey) {
			void glo.syncAll(ALL_DATA_TYPES).then(() => {
				for (const type of ALL_DATA_TYPES) {
					glo.hydrate(type);
				}
				// Restore tenant context from synced org data
				const orgs = glo.all('organization');
				if (orgs.length > 0 && !tenant.state.setupComplete) {
					const org = orgs[0];
					const d = org.data as Record<string, unknown>;
					tenant.configure({
						organizationId: org.id,
						organizationName: (d.name as string) ?? '',
						organizationCode: (d.code as string) ?? '',
						currency: (d.currency as string) ?? 'USD'
					});
					tenant.completeSetup();
				}
				// Restore location/branch
				const locations = glo.all('location');
				if (locations.length > 0 && !tenant.state.locationId) {
					const loc = locations[0];
					tenant.configure({
						locationId: loc.id,
						locationName: ((loc.data as Record<string, unknown>).name as string) ?? 'Main'
					});
				}
				postLoginSyncState = 'done';
				setTimeout(() => (postLoginSyncState = 'idle'), 3000);
			}).catch(() => {
				postLoginSyncState = 'done';
				setTimeout(() => (postLoginSyncState = 'idle'), 3000);
			});
		} else {
			postLoginSyncState = 'done';
			setTimeout(() => (postLoginSyncState = 'idle'), 2000);
		}
	});

	// Global dropdown-menu handling: one menu open at a time, close on outside
	// pointerdown or Escape. Individual `Menu` triggers stopPropagation on open.
	function onGlobalPointerDown(e: PointerEvent) {
		const t = e.target as Element | null;
		if (t && t.closest('[role="menu"]')) return;
		if (t && t.closest('[aria-haspopup="menu"]')) return;
		popovers.close();
	}
	function onGlobalKey(e: KeyboardEvent) {
		if (e.key === 'Escape') popovers.close();
	}
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<svelte:window onpointerdown={onGlobalPointerDown} onkeydown={onGlobalKey} />

{#if isPublicRoute}
	{@render children()}
{:else}
	<div class="app-shell flex min-h-screen">
		{#if !isPosRoute}
			<aside
				class="app-sidebar-shell app-chrome sticky top-0 hidden h-screen {sidebarState.collapsed ? 'w-16' : 'w-64'} shrink-0 border-r border-[var(--glass-border)] transition-[width] duration-200 ease-in-out lg:flex lg:flex-col"
			>
				<AppSidebar />
			</aside>
		{/if}

		{#if drawerOpen && !isPosRoute}
			<button
				type="button"
				aria-label="Close menu"
				class="fixed inset-0 z-40 bg-black/50 backdrop-blur-[3px] transition-opacity lg:hidden animate-fade"
				onclick={() => (drawerOpen = false)}
			></button>
			<aside
				class="app-sidebar-shell app-chrome animate-slide-in-left fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-[var(--glass-border)] lg:hidden"
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

{#if !isPublicRoute && postLoginSyncState === 'syncing'}
	<div class="fixed inset-0 z-[100] flex items-center justify-center bg-[var(--ui-bg)]/80 backdrop-blur-sm">
		<div class="flex flex-col items-center gap-4 rounded-2xl border border-[var(--ui-border)] bg-[var(--surface-bg)] p-8 shadow-2xl">
			<div class="relative">
				<div class="size-12 animate-spin rounded-full border-[3px] border-[var(--ui-border)] border-t-primary-500"></div>
				<div class="absolute inset-0 grid place-items-center">
					<Icon name="lucide:zap" class="size-5 text-primary-500" />
				</div>
			</div>
			<div class="text-center">
				<p class="font-display text-[15px] font-bold">Syncing workspace</p>
				<p class="mt-1 text-[12px] text-[var(--ui-text-muted)]">Pulling your data from Nostr relays…</p>
			</div>
		</div>
	</div>
{/if}

{#if !isPublicRoute && postLoginSyncState === 'done'}
	<div class="fixed bottom-20 right-4 z-50 flex items-center gap-2 rounded-xl border border-[var(--tone-success-bg)] bg-[var(--surface-bg)] px-4 py-2.5 shadow-lg animate-rise lg:bottom-4">
		<Icon name="lucide:check-circle-2" class="size-5 text-[var(--tone-success-text)]" />
		<span class="text-[13px] font-semibold">Workspace synced</span>
	</div>
{/if}

<ModeWatcher />
<Toaster />
<PwaPrompt />
<OfflineBadge />
