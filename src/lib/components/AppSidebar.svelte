<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import Icon from '$lib/components/ui/Icon.svelte';
	import BnosMark from '$lib/components/BnosMark.svelte';
	import { findNavItem, navSections, navSectionLabel, navLabel, permissionForNavItem, permissionForPath, type NavItem } from '$lib/nav';
	import { SvelteSet } from 'svelte/reactivity';
	import { tenant } from '$nostr/tenant.svelte';
	import { permissions } from '$lib/permissions.svelte';
	import { sidebarState, loadCollapsed, toggleCollapsed } from '$lib/sidebar-state.svelte';
	import { features } from '$lib/features.svelte';
	import { t } from '$lib/i18n/i18n.svelte';

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

	// ── Collapsible sub-groups (e.g. Marketplace) ────────────────────────
	// Manual expand overrides. A group also auto-expands when the active route
	// is one of its children, so the user never loses their place.
	const expandedGroups = new SvelteSet<string>();

	function hasChildren(item: NavItem): boolean {
		return !!item.children && item.children.length > 0;
	}

	function isGroupActive(item: NavItem): boolean {
		return (
			isActive(item) ||
			(item.children?.some((c) => isActive(c)) ?? false)
		);
	}

	function isGroupExpanded(item: NavItem): boolean {
		if (expandedGroups.has(item.to)) return true;
		return isGroupActive(item);
	}

	function toggleGroup(to: string) {
		if (expandedGroups.has(to)) expandedGroups.delete(to);
		else expandedGroups.add(to);
	}

	/** A section whose top-level items are all collapsible parents renders
	 *  without its own label (the parent item takes the label role). */
	function sectionHasOwnLabel(sectionItems: NavItem[]): boolean {
		return !sectionItems.every((i) => hasChildren(i));
	}

	function canUseRoute(to: string, gate = permissionForPath(to)): boolean {
		if (tenant.state.activeRole === null) return true;
		if (!gate) return true;
		return permissions.can(gate.resource, gate.action);
	}

	const visibleSections = $derived(
		navSections
			.map((section) => ({
				...section,
				items: section.items
					.filter(canSeeNav)
					.map((item) =>
						item.children
							? { ...item, children: item.children.filter(canSeeNav) }
							: item
					)
			}))
			.filter((section) => section.items.length > 0)
	);
</script>

<div class="flex h-full flex-col">
	<!-- Brand -->
	<a
		href={resolve('/')}
		aria-label={t('sidebar.goDashboard')}
		title={sidebarState.collapsed ? t('sidebar.bnosDashboard') : undefined}
		class="app-sidebar-brand flex h-16 items-center {sidebarState.collapsed ? 'justify-center px-0' : 'gap-3 px-5'} border-b border-[var(--glass-border)] transition-all hover:bg-[var(--ui-bg-accented)]"
		onclick={() => onnavigate?.()}
	>
		<div class="relative grid size-10 shrink-0 place-items-center ">
			<BnosMark class="size-9 text-primary-500" />
		</div>
		{#if !sidebarState.collapsed}
			<div class="leading-tight">
				<div class="font-display text-[17px] font-bold tracking-tight">BNOS</div>
				<div class="text-[10px] font-semibold tracking-[0.18em] text-[var(--ui-text-dimmed)] uppercase">
					{t('common.tagline')}
				</div>
			</div>
		{/if}
	</a>

	<!-- Navigation -->
	<nav class="app-nav min-h-0 flex-1 overflow-y-auto {sidebarState.collapsed ? 'px-2' : 'px-3'} py-2">
		{#each visibleSections as section (section.label)}
			{#if !section.feature || (section.feature === 'restaurant' ? tenant.restaurantEnabled : features.isEnabled(section.feature))}
			<div class="app-nav-section mb-5">
				{#if !sidebarState.collapsed && sectionHasOwnLabel(section.items)}
					<div
						class="app-nav-section-label px-3 pb-1.5 text-[10px] font-semibold tracking-[0.16em] text-[var(--ui-text-dimmed)] uppercase"
					>
						{navSectionLabel(section)}
					</div>
				{/if}
				{#each section.items as item (item.to)}
					{@const active = isActive(item)}

					{#if hasChildren(item) && !sidebarState.collapsed}
						{@const groupActive = isGroupActive(item)}
						{@const groupExpanded = isGroupExpanded(item)}
						<div class="sidebar-nav-group-wrap mb-0.5">
							<div
								class="sidebar-nav-parent nav-active group flex items-center rounded-lg pr-1 {groupActive
									? 'is-active-surface'
									: 'soft-hover'}"
							>
							<a
								href={resolvedHref(item.to)}
								title={navLabel(item)}
								class="sidebar-nav-parent-link flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors {groupActive
									? 'text-[var(--ui-text)]'
									: 'text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'}"
								onclick={() => onnavigate?.()}
							>
								<Icon
									name={item.icon}
									class="size-[18px] shrink-0 {groupActive
										? 'text-primary-500'
										: 'text-[var(--ui-text-dimmed)] group-hover:text-[var(--ui-text-muted)]'}"
								/>
								<span class="truncate">{navLabel(item)}</span>
							</a>
							<button
								type="button"
								onclick={() => toggleGroup(item.to)}
								aria-label={groupExpanded ? t('sidebar.collapse') : t('sidebar.expand')}
								class="grid size-7 shrink-0 place-items-center rounded-md text-[var(--ui-text-dimmed)] transition-colors hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]"
							>
								<Icon
									name="lucide:chevron-down"
									class="size-3.5 transition-transform duration-200 {groupExpanded ? 'rotate-180' : ''}"
								/>
							</button>
						</div>
							{#if groupExpanded}
								<div
									class="sidebar-nav-group ml-[1.35rem] mt-0.5 flex flex-col gap-0.5 border-l border-[var(--ui-border-muted)] pl-2"
								>
									{#each item.children as child (child.to)}
										{@const childActive = isActive(child)}
										<a
											href={resolvedHref(child.to)}
											title={navLabel(child)}
											class="sidebar-nav-child nav-active group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors {childActive
												? 'is-active-surface text-[var(--ui-text)]'
												: 'text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]'}"
											onclick={() => onnavigate?.()}
										>
											<Icon
												name={child.icon}
												class="size-4 shrink-0 {childActive
													? 'text-primary-500'
													: 'text-[var(--ui-text-dimmed)] group-hover:text-[var(--ui-text-muted)]'}"
											/>
											<span class="truncate">{navLabel(child)}</span>
										</a>
									{/each}
								</div>
							{/if}
						</div>
					{:else}
						<a
							href={resolvedHref(item.to)}
							title={sidebarState.collapsed ? navLabel(item) : undefined}
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
								<span class="truncate">{navLabel(item)}</span>
							{/if}
						</a>
					{/if}
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
						{tenant.state.currency} · {tenant.state.locationName ?? t('sidebar.main')}
					</span>
				</span>
			{/if}
		</div>
	{/if}

	<!-- Collapse toggle -->
	<div class="app-user-menu flex items-center {sidebarState.collapsed ? 'justify-center' : ''} p-3">
		<button
			type="button"
			onclick={toggleCollapsed}
			title={sidebarState.collapsed ? t('sidebar.expandSidebar') : t('sidebar.collapseSidebar')}
			aria-label={sidebarState.collapsed ? t('sidebar.expandSidebar') : t('sidebar.collapseSidebar')}
			class="grid size-8 shrink-0 place-items-center rounded-lg text-[var(--ui-text-dimmed)] transition-colors hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]"
		>
			<Icon name={sidebarState.collapsed ? 'lucide:chevrons-right' : 'lucide:chevrons-left'} class="size-4" />
		</button>
	</div>
</div>
