<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Popover from '$lib/components/ui/Popover.svelte';
	import { findNavItem, navSections, permissionForNavItem, permissionForPath, type NavItem } from '$lib/nav';
	import { session } from '$nostr/session.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { glo } from '$nostr/store.svelte';
	import { permissions } from '$lib/permissions.svelte';
	import { sidebarState, loadCollapsed, toggleCollapsed } from '$lib/sidebar-state.svelte';

	let { onnavigate }: { onnavigate?: () => void } = $props();

	// Load persisted sidebarState.collapsed preference
	loadCollapsed();

	function isActive(item: NavItem) {
		return findNavItem(page.url.pathname)?.to === item.to;
	}

	function resolvedHref(to: string) {
		return resolve(to as '/');
	}

	/** Show a nav item unless the active role explicitly denies it. During
	 *  first-run (no resolved role) everything stays visible. */
	function canSeeNav(item: NavItem): boolean {
		return canUseRoute(item.to, permissionForNavItem(item));
	}

	function canUseRoute(to: string, gate = permissionForPath(to)): boolean {
		if (tenant.state.activeRole === null) return true;
		if (!gate) return true;
		return permissions.can(gate.resource, gate.action);
	}

	const visibleSections = $derived(
		navSections
			.map((section) => ({ ...section, items: section.items.filter(canSeeNav) }))
			.filter((section) => section.items.length > 0)
	);

	let menuOpen = $state(false);

	async function signOut() {
		menuOpen = false;
		await session.logout();
		tenant.reset();
		glo.clearAll();
		await goto(resolve('/login'));
	}
</script>

<div class="flex h-full flex-col">
	<!-- Brand -->
	<a
		href={resolve('/')}
		aria-label="Go to BNOS dashboard"
		title={sidebarState.collapsed ? 'BNOS Dashboard' : undefined}
		class="app-sidebar-brand flex h-16 items-center {sidebarState.collapsed ? 'justify-center px-0' : 'gap-3 px-5'} border-b border-[var(--glass-border)] transition-all hover:bg-[var(--ui-bg-accented)]"
		onclick={() => onnavigate?.()}
	>
		<div class="relative grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary-400 to-primary-600">
			<div
				class="absolute inset-0 rounded-xl bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,.45),transparent_60%)]"
			></div>
			<Icon name="lucide:zap" class="relative size-5 text-white" />
		</div>
		{#if !sidebarState.collapsed}
			<div class="leading-tight">
				<div class="font-display text-[17px] font-bold tracking-tight">BNOS</div>
				<div class="text-[10px] font-semibold tracking-[0.18em] text-[var(--ui-text-dimmed)] uppercase">
					Open-source POS
				</div>
			</div>
		{/if}
	</a>

	<!-- Navigation -->
	<nav class="app-nav min-h-0 flex-1 overflow-y-auto {sidebarState.collapsed ? 'px-2' : 'px-3'} py-2">
		{#each visibleSections as section (section.label)}
			{#if section.feature !== 'restaurant' || tenant.restaurantEnabled}
			<div class="app-nav-section mb-5">
				{#if !sidebarState.collapsed}
					<div
						class="app-nav-section-label px-3 pb-1.5 text-[10px] font-semibold tracking-[0.16em] text-[var(--ui-text-dimmed)] uppercase"
					>
						{section.label}
					</div>
				{/if}
				{#each section.items as item (item.to)}
					{@const active = isActive(item)}
					<a
						href={resolvedHref(item.to)}
						title={sidebarState.collapsed ? item.label : undefined}
						class="app-nav-item nav-active group mb-0.5 flex items-center {sidebarState.collapsed ? 'justify-center px-0' : 'gap-3 px-3'} rounded-lg py-2 text-[13.5px] font-medium transition-colors {active
							? 'nav-active-on is-active-surface'
							: 'soft-hover text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'}"
						onclick={() => onnavigate?.()}
					>
						<Icon
							name={item.icon}
							class="size-[18px] shrink-0 {active
								? 'text-primary-500'
								: 'text-[var(--ui-text-dimmed)] group-hover:text-[var(--ui-text-muted)]'}"
						/>
						{#if !sidebarState.collapsed}
							<span class="truncate">{item.label}</span>
						{/if}
					</a>
				{/each}
			</div>
			{/if}
		{/each}
	</nav>

	<!-- Active tenant pill -->
	{#if tenant.state.organizationName}
		<div
			class="app-tenant-pill mx-3 mb-2 flex items-center {sidebarState.collapsed ? 'justify-center' : 'gap-2.5'} rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] {sidebarState.collapsed ? 'px-0' : 'px-3'} py-2"
			title={sidebarState.collapsed ? tenant.state.organizationName : undefined}
		>
			<span
				class="grid size-7 shrink-0 place-items-center rounded-md bg-primary-500/10 text-[11px] font-bold text-primary-600 dark:text-primary-400"
			>
				{tenant.state.organizationName.slice(0, 2).toUpperCase()}
			</span>
			{#if !sidebarState.collapsed}
				<span class="min-w-0 flex-1">
					<span class="block truncate text-[12.5px] font-semibold">{tenant.state.organizationName}</span>
					<span class="block truncate text-[11px] text-[var(--ui-text-dimmed)]">
						{tenant.state.currency} · {tenant.state.locationName ?? 'Main'}
					</span>
				</span>
			{/if}
		</div>
	{/if}

	<!-- Collapse toggle + User menu -->
	<div class="app-user-menu flex items-center {sidebarState.collapsed ? 'flex-col gap-2' : 'gap-1'} p-3">
		<button
			type="button"
			onclick={toggleCollapsed}
			title={sidebarState.collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
			aria-label={sidebarState.collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
			class="grid size-8 shrink-0 place-items-center rounded-lg text-[var(--ui-text-dimmed)] transition-colors hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]"
		>
			<Icon name={sidebarState.collapsed ? 'lucide:chevrons-right' : 'lucide:chevrons-left'} class="size-4" />
		</button>
		{#if !sidebarState.collapsed}
			<Popover bind:open={menuOpen} side="top" align="start">
				{#snippet trigger()}
					<Icon name="lucide:user-circle" class="size-5" />
				{/snippet}
				{#snippet content()}
					<div class="w-64 p-1.5">
						<div class="mb-2 rounded-lg px-2.5 py-2">
							<div class="truncate text-[13px] font-semibold">
								{session.shortNpub ?? 'Account'}
							</div>
							<div class="truncate text-[11.5px] text-[var(--ui-text-dimmed)]">
								{session.npub ?? 'Nostr identity'}
							</div>
							<div class="mt-1.5 flex items-center gap-1.5">
								<span class="live-dot"></span>
								<span class="text-[10px] font-semibold uppercase tracking-wider text-[var(--ui-text-muted)]">
									{session.loginMethod === 'extension' ? 'NIP-07 extension' : 'Private key'}
								</span>
							</div>
						</div>
						{#if canUseRoute('/settings')}
							<a
								href={resolve('/settings')}
								onclick={() => (menuOpen = false)}
								class="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12.5px] font-medium text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]"
							>
								<Icon name="lucide:sliders-horizontal" class="size-4 text-[var(--ui-text-dimmed)]" />
								Settings
							</a>
						{/if}
						<a
							href={resolve('/profile')}
							onclick={() => (menuOpen = false)}
							class="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12.5px] font-medium text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]"
						>
							<Icon name="lucide:user-circle" class="size-4 text-[var(--ui-text-dimmed)]" />
							Profile
						</a>
						<button
							type="button"
							onclick={signOut}
							class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12.5px] font-medium text-[var(--tone-error-text)] transition-colors hover:bg-[var(--tone-error-bg)]"
						>
							<Icon name="lucide:log-out" class="size-4" />
							Sign out
						</button>
					</div>
				{/snippet}
			</Popover>
		{:else}
			<Popover bind:open={menuOpen} side="top" align="center">
				{#snippet trigger()}
					<Icon name="lucide:user-circle" class="size-5" />
				{/snippet}
				{#snippet content()}
					<div class="w-64 p-1.5">
						<div class="mb-2 rounded-lg px-2.5 py-2">
							<div class="truncate text-[13px] font-semibold">
								{session.shortNpub ?? 'Account'}
							</div>
							<div class="truncate text-[11.5px] text-[var(--ui-text-dimmed)]">
								{session.npub ?? 'Nostr identity'}
							</div>
							<div class="mt-1.5 flex items-center gap-1.5">
								<span class="live-dot"></span>
								<span class="text-[10px] font-semibold uppercase tracking-wider text-[var(--ui-text-muted)]">
									{session.loginMethod === 'extension' ? 'NIP-07 extension' : 'Private key'}
								</span>
							</div>
						</div>
						{#if canUseRoute('/settings')}
							<a
								href={resolve('/settings')}
								onclick={() => (menuOpen = false)}
								class="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12.5px] font-medium text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]"
							>
								<Icon name="lucide:sliders-horizontal" class="size-4 text-[var(--ui-text-dimmed)]" />
								Settings
							</a>
						{/if}
						<a
							href={resolve('/profile')}
							onclick={() => (menuOpen = false)}
							class="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12.5px] font-medium text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]"
						>
							<Icon name="lucide:user-circle" class="size-4 text-[var(--ui-text-dimmed)]" />
							Profile
						</a>
						<button
							type="button"
							onclick={signOut}
							class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12.5px] font-medium text-[var(--tone-error-text)] transition-colors hover:bg-[var(--tone-error-bg)]"
						>
							<Icon name="lucide:log-out" class="size-4" />
							Sign out
						</button>
					</div>
				{/snippet}
			</Popover>
		{/if}
	</div>
</div>
