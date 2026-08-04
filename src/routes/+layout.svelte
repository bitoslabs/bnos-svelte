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
	import { features } from '$lib/features.svelte';
	import { media } from '$lib/media/media.svelte';
	import { session } from '$nostr/session.svelte';
	import { relays } from '$nostr/relay.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { warmRelays } from '$nostr/client';
	import {
		hasActiveWorkspaceContext,
		resolveWorkspace,
	} from '$nostr/workspace.svelte';
	import { memberships } from '$nostr/memberships.svelte';
	import { organizationKey } from '$lib/crypto/organization-key.svelte';
	import { dataSync } from '$nostr/sync.svelte';
	import AppSidebar from '$lib/components/AppSidebar.svelte';
	import { sidebarState, loadCollapsed as loadSidebarCollapsed } from '$lib/sidebar-state.svelte';
	import AppTopbar from '$lib/components/AppTopbar.svelte';
	import BottomTabBar from '$lib/components/mobile/BottomTabBar.svelte';
	import Toaster from '$lib/components/ui/Toaster.svelte';
	import PwaPrompt from '$lib/components/PwaPrompt.svelte';
	import OfflineBadge from '$lib/components/OfflineBadge.svelte';
	import { popovers } from '$lib/stores/popovers.svelte';
	import { permissionForPath } from '$lib/nav';
	import { permissions } from '$lib/permissions.svelte';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
	let drawerOpen = $state(false);
	let workspaceResolutionPending = false;
	let workspaceResolutionPubkey = '';

	const isPublicRoute = $derived(
		page.url.pathname === '/login' ||
		page.url.pathname === '/resolve' ||
		page.url.pathname.startsWith('/setup')
	);
	const isPosRoute = $derived(page.url.pathname === '/pos' || page.url.pathname.startsWith('/pos/'));

	registerIcons();
	loadSidebarCollapsed();

	onMount(() => {
		preferences.load();
		preferences.apply();
		features.load();
		media.load();
		relays.load();
		session.load();
		tenant.load();
		if (session.isAuthenticated) void warmRelays();
	});

	$effect(() => {
		if (isPublicRoute || !session.hydrated || !tenant.hydrated) return;
		if (workspaceResolutionPubkey !== (session.pubkey ?? '')) {
			workspaceResolutionPubkey = session.pubkey ?? '';
			workspaceResolutionPending = false;
		}
		if (!session.isAuthenticated) {
			void goto(resolve('/login'), { replaceState: true });
		} else if (!tenant.state.setupComplete && !workspaceResolutionPending) {
			workspaceResolutionPending = true;
			postLoginSyncState = 'checking-workspace';
			queueMicrotask(async () => {
				const workspace = await resolveWorkspace();
				if (workspace.found) {
					workspaceResolutionPending = false;
					postLoginSyncDone = false;
					postLoginSyncState = workspace.source === 'relay' ? 'done' : 'idle';
					if (workspace.source === 'relay') {
						setTimeout(() => (postLoginSyncState = 'idle'), 2000);
					}
				} else {
					// Owner path found nothing — a staff member didn't author the
					// org/location records, so discover the workspace THROUGH their
					// staff record (kind 30500, #p = me) before giving up.
					const staffWorkspace = await memberships.resolveStaffWorkspace();
					workspaceResolutionPending = false;
					postLoginSyncState = 'idle';
					if (!staffWorkspace) {
						void goto(resolve('/resolve'), { replaceState: true });
					}
				}
			});
		}
	});

	$effect(() => {
		if (isPublicRoute || !session.hydrated || !tenant.hydrated || !session.isAuthenticated) return;
		if (tenant.state.activeRole === null) return;
		const gate = permissionForPath(page.url.pathname);
		if (gate && !permissions.can(gate.resource, gate.action)) {
			void goto(resolve('/'), { replaceState: true });
		}
	});

	// Hydrate immediately, then sync operational data quietly in the background.
	let postLoginSyncDone = false;
	let postLoginSyncState = $state<'idle' | 'checking-workspace' | 'done'>('idle');

	$effect(() => {
		if (!session.isAuthenticated || !tenant.hydrated || !relays.hydrated) return;
		if (postLoginSyncDone) return;
		if (!hasActiveWorkspaceContext()) return;
		postLoginSyncDone = true;

		void warmRelays();
		dataSync.backgroundOperationalSync();
		postLoginSyncState = 'idle';

		// Login → staff matching: resolve this user's staff memberships, then
		// auto-set the active role. First-run owners get an Owner record created
		// so the permission system has a role to evaluate. Suspended staff are
		// routed to /blocked. Skips on public/POS-lightweight routes.
		const path = page.url.pathname;
		if (path !== '/login' && !path.startsWith('/setup')) {
			void (async () => {
				await memberships.resolve();
				// Ensure the active org has a local AES key (owner/admin mints it;
				// staff already imported theirs via the grant sync in memberships.resolve).
				await organizationKey.autoEnsureActiveKey();
				if (memberships.autoResolve()) return;
				await memberships.bootstrapOwnerIfMissing();
				if (tenant.state.activeStaffId) return;
				const dest = memberships.resolveLoginDestination();
				if (dest === '/blocked') void goto(resolve('/blocked'), { replaceState: true });
			})();
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

{#if !isPublicRoute && postLoginSyncState === 'checking-workspace'}
	<div class="fixed inset-0 z-[100] flex items-center justify-center bg-[var(--ui-bg)]/80 backdrop-blur-sm">
		<div class="flex flex-col items-center gap-4 rounded-2xl border border-[var(--ui-border)] bg-[var(--surface-bg)] p-8 shadow-2xl">
			<div class="relative">
				<div class="size-12 animate-spin rounded-full border-[3px] border-[var(--ui-border)] border-t-primary-500"></div>
				<div class="absolute inset-0 grid place-items-center">
					<Icon name="lucide:zap" class="size-5 text-primary-500" />
				</div>
			</div>
			<div class="text-center">
				<p class="font-display text-[15px] font-bold">Checking workspace</p>
				<p class="mt-1 text-[12px] text-[var(--ui-text-muted)]">Restoring your active workspace and branch…</p>
			</div>
		</div>
	</div>
{/if}

<ModeWatcher />
<Toaster />
<PwaPrompt />
<OfflineBadge />
