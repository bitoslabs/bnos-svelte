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
	import { i18n, t } from '$lib/i18n/i18n.svelte';
	import { media } from '$lib/media/media.svelte';
	import { session } from '$nostr/session.svelte';
	import { relays } from '$nostr/relay.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { warmRelays } from '$nostr/client';
	import { bootstrapAuth } from '$nostr/auth-bootstrap';
	import { hasActiveWorkspaceContext } from '$nostr/workspace.svelte';
	import { workspacePicker } from '$nostr/workspace-picker.svelte';
	import { pwaInfo } from 'virtual:pwa-info';
	import { profile } from '$nostr/profile.svelte';
	import { organizationKey } from '$lib/crypto/organization-key.svelte';
	import { dataSync } from '$nostr/sync.svelte';
	import AppSidebar from '$lib/components/AppSidebar.svelte';
	import { sidebarState, loadCollapsed as loadSidebarCollapsed } from '$lib/sidebar-state.svelte';
	import AppTopbar from '$lib/components/AppTopbar.svelte';
	import BottomTabBar from '$lib/components/mobile/BottomTabBar.svelte';
	import Toaster from '$lib/components/ui/Toaster.svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import CommandPalette from '$lib/components/CommandPalette.svelte';
	import WorkspacePicker from '$lib/components/WorkspacePicker.svelte';
	import RemoteSignerBanner from '$lib/components/RemoteSignerBanner.svelte';
	import PwaPrompt from '$lib/components/PwaPrompt.svelte';
	import OfflineBadge from '$lib/components/OfflineBadge.svelte';
	import BootSplash from '$lib/components/ui/BootSplash.svelte';
	import { popovers } from '$lib/stores/popovers.svelte';
	import { startSystemNotifications } from '$lib/stores/notifications.svelte';
	import { startOwnerFeed } from '$nostr/owner-feed.svelte';
	import { clearIdentityStores } from '$nostr/sign-out';
	import { permissionForPath } from '$lib/nav';
	import { permissions } from '$lib/permissions.svelte';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
	let drawerOpen = $state(false);
	let workspaceResolutionPending = false;
	let workspaceResolutionPubkey = '';
	let tenantStoragePubkey = '';
	/** True once the post-login workspace resolution has finished. */
	let workspaceResolved = $state(false);

	const isPublicRoute = $derived(
		page.url.pathname === '/about' ||
			page.url.pathname === '/login' ||
			page.url.pathname === '/resolve' ||
			page.url.pathname.startsWith('/setup') ||
			page.url.pathname.startsWith('/legal')
	);
	const isPosRoute = $derived(
		page.url.pathname === '/pos' || page.url.pathname.startsWith('/pos/')
	);

	registerIcons();
	loadSidebarCollapsed();

	onMount(() => {
		// Dismiss the static splash from app.html once the app has mounted.
		const splash = document.getElementById('boot-splash');
		if (splash) {
			splash.classList.add('bs-out');
			setTimeout(() => splash.remove(), 400);
		}
		preferences.load();
		preferences.apply();
		features.load();
		media.load();
		relays.load();
		// Wire relay/sync system events into the notification center (idempotent;
		// the topbar + /notifications page hydrate the persisted feed themselves).
		startSystemNotifications();
		// Owner/system notices from allow-listed npubs (PUBLIC_OWNER_NPUBS + local
		// trusted keys). Idempotent and a no-op when no allow-list is configured.
		startOwnerFeed();

		const onRemoteClear = () => clearIdentityStores();
		window.addEventListener('bnos:clear-all', onRemoteClear);
		// Mobile browsers can evict storage while the app is backgrounded. When the
		// app resumes, re-write the auth snapshot if it disappeared so a reload
		// does not silently sign the user out.
		let hiddenAt = 0;
		const onVisibility = () => {
			if (document.visibilityState === 'hidden') {
				hiddenAt = Date.now();
				return;
			}
			session.reassertPersistence();
			// NIP-46: the owner may have removed this app's connection while the
			// app was in the background. Only ping after a real absence — not on
			// every tab switch — to avoid needless relay traffic.
			if (Date.now() - hiddenAt > 15 * 60_000) void session.verifyRemoteSigner();
		};
		document.addEventListener('visibilitychange', onVisibility);
		// No timer: revocation is also detected for free when a signing request
		// fails. Re-check only when connectivity returns (checks are skipped offline).
		const onOnline = () => void session.verifyRemoteSigner();
		window.addEventListener('online', onOnline);
		session.load();
		tenant.load();
		profile.load();
		i18n.init();
		if (session.isAuthenticated) void warmRelays();

		return () => {
			window.removeEventListener('bnos:clear-all', onRemoteClear);
			document.removeEventListener('visibilitychange', onVisibility);
			window.removeEventListener('online', onOnline);
		};
	});

	// Hydrate the kind-0 profile cache from relays whenever the active pubkey
	// changes (boot / login / identity switch) so the app chrome shows the
	// freshest display name + avatar. Best-effort and runs once per pubkey.
	let profilePubkey = '';
	$effect(() => {
		const me = session.pubkey;
		if (!me) {
			// Signed out: drop any stale in-memory profile cache.
			if (profilePubkey) {
				profile.reset();
				profilePubkey = '';
			}
			return;
		}
		if (!session.hydrated || !relays.hydrated) return;
		if (profilePubkey === me) return;
		// Identity changed (login / key switch): reset stale cache first.
		if (profilePubkey && profilePubkey !== me) profile.reset();
		profilePubkey = me;
		void profile.fetchFromRelays();
	});

	$effect(() => {
		if (!session.hydrated) return;
		const me = session.pubkey ?? '';
		if (tenantStoragePubkey === me) return;
		tenantStoragePubkey = me;
		// Tenant state is identity-scoped. Reload it when the active Nostr key
		// changes so one account cannot inherit another account's setup flag.
		tenant.load();
	});

	$effect(() => {
		if (isPublicRoute || !session.hydrated || !tenant.hydrated) return;
		if (workspaceResolutionPubkey !== (session.pubkey ?? '')) {
			workspaceResolutionPubkey = session.pubkey ?? '';
			workspaceResolutionPending = false;
			workspaceResolved = false;
			// A new identity must run its own post-login background sync.
			postLoginSyncDone = false;
		}
		if (!session.isAuthenticated) {
			void goto(resolve('/login'), { replaceState: true });
		} else if (!workspaceResolutionPending) {
			workspaceResolutionPending = true;
			// A locally complete workspace (including one just created by the
			// setup wizard) needs no relay resolution, so do not block the UI on it.
			if (!hasActiveWorkspaceContext()) postLoginSyncState = 'checking-workspace';
			queueMicrotask(async () => {
				const bootPubkey = session.pubkey ?? '';
				const result = await bootstrapAuth();
				// A newer identity switch owns the current resolution.
				if (session.pubkey !== bootPubkey) return;
				workspaceResolutionPending = false;
				postLoginSyncState = result.source === 'relay' ? 'done' : 'idle';
				// The user may have moved to onboarding / resolve while this ran
				// (e.g. right after creating an account). Those routes own their
				// own flow — never bounce them through /resolve again.
				if (isPublicRoute) {
					workspaceResolved = true;
					return;
				}
				if (result.access === 'setup' || result.access === 'waiting-workspace') {
					void goto(resolve('/resolve'), { replaceState: true });
				} else if (result.access === 'blocked') {
					void goto(resolve('/blocked'), { replaceState: true });
				}
				workspaceResolved = true;
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
		if (!workspaceResolved) return;
		if (postLoginSyncDone) return;
		if (!hasActiveWorkspaceContext()) return;
		// Wait for the multi-company picker so operational data is synced for the
		// workspace the user actually chose, not the one resolved first.
		if (workspacePicker.open) return;
		postLoginSyncDone = true;

		void (async () => {
			// The key must be ready before encrypted records are fetched.
			await organizationKey.autoEnsureActiveKey();
			await warmRelays();
			dataSync.backgroundOperationalSync();
			postLoginSyncState = 'idle';
		})();
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

<svelte:head>
	<link rel="icon" href={favicon} />
	{#if pwaInfo}
		<link
			rel="manifest"
			href={pwaInfo.webManifest.href}
			crossorigin={pwaInfo.webManifest.useCredentials ? 'use-credentials' : undefined}
		/>
	{/if}
</svelte:head>

<svelte:window onpointerdown={onGlobalPointerDown} onkeydown={onGlobalKey} />

{#if !session.hydrated}
	<!-- Brief boot state while local session state hydrates
	     (static twin lives in app.html for the pre-JS window). -->
	<BootSplash />
{:else if isPublicRoute}
	{@render children()}
{:else}
	<div class="app-shell flex min-h-screen">
		{#if !isPosRoute}
			<aside
				data-collapsed={sidebarState.collapsed || undefined}
				class="app-sidebar-shell app-chrome sticky top-0 hidden h-screen {sidebarState.collapsed
					? 'w-16'
					: 'w-64'} shrink-0 border-r border-(--glass-border) transition-[width] duration-200 ease-in-out lg:flex lg:flex-col"
			>
				<AppSidebar />
			</aside>
		{/if}

		{#if drawerOpen && !isPosRoute}
			<button
				type="button"
				aria-label={t('topbar.closeMenu')}
				class="animate-fade fixed inset-0 z-40 bg-black/50 backdrop-blur-[3px] transition-opacity lg:hidden"
				onclick={() => (drawerOpen = false)}
			></button>
			<aside
				class="app-sidebar-shell app-chrome animate-slide-in-left fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-(--glass-border) lg:hidden"
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
	<div
		class="fixed inset-0 z-[100] flex items-center justify-center bg-(--ui-bg)/80 backdrop-blur-sm"
	>
		<div
			class="flex flex-col items-center gap-4 rounded-2xl border border-(--ui-border) bg-(--surface-bg) p-8 shadow-2xl"
		>
			<div class="relative">
				<div
					class="size-12 animate-spin rounded-full border-[3px] border-(--ui-border) border-t-primary-500"
				></div>
				<div class="absolute inset-0 grid place-items-center">
					<Icon name="lucide:zap" class="size-5 text-primary-500" />
				</div>
			</div>
			<div class="text-center">
				<p class="font-display text-[15px] font-bold">{t('layout.checkingWorkspace')}</p>
				<p class="mt-1 text-[12px] text-(--ui-text-muted)">
					{t('layout.checkingWorkspaceDesc')}
				</p>
			</div>
		</div>
	</div>
{/if}

<ModeWatcher themeColors={{ light: '#f5f6f7', dark: '#0a0a0c' }} />
<Toaster />
<PwaPrompt />
<OfflineBadge />
<ConfirmDialog />
<CommandPalette />
{#if !isPublicRoute}
	<WorkspacePicker />
	<RemoteSignerBanner />
{/if}
