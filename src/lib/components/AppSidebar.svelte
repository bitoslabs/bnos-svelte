<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import Icon from '$lib/components/ui/Icon.svelte';
	import BnosMark from '$lib/components/BnosMark.svelte';
	import {
		findNavItem,
		navSections,
		navSectionLabel,
		navLabel,
		permissionForNavItem,
		permissionForPath,
		type NavItem
	} from '$lib/nav';
	import { SvelteSet } from 'svelte/reactivity';
	import { tenant } from '$nostr/tenant.svelte';
	import { permissions } from '$lib/permissions.svelte';
	import { sidebarState, loadCollapsed, toggleCollapsed } from '$lib/sidebar-state.svelte';
	import { features } from '$lib/features.svelte';
	import { t } from '$lib/i18n/i18n.svelte';
	import { resolveWorkspace } from '$nostr/workspace.svelte';
	import { memberships } from '$nostr/memberships.svelte';
	import { toast } from '$lib/stores/toast.svelte';

	let { onnavigate }: { onnavigate?: () => void } = $props();

	let syncing = $state(false);

	/**
	 * Pull the active workspace (company + branch + data) back from relays.
	 * This is a recovery action: it is always available so a user can fix an
	 * empty/missing sidebar without going through the full onboarding wizard.
	 */
	async function syncWorkspace() {
		if (syncing) return;
		syncing = true;
		try {
			const workspace = await resolveWorkspace({ allowRelaySync: true });
			const staffWorkspace = workspace.found ? false : await memberships.resolveStaffWorkspace();
			await memberships.resolve();
			memberships.autoResolve();

			if (workspace.found || staffWorkspace || tenant.state.setupComplete) {
				toast.success(t('sidebar.syncWorkspaceDone'), t('sidebar.syncWorkspaceDoneDesc'));
			} else {
				toast.warning(t('sidebar.syncWorkspaceEmpty'), t('sidebar.syncWorkspaceEmptyDesc'));
			}
		} catch (e) {
			toast.error(t('sidebar.syncWorkspaceFailed'), e instanceof Error ? e.message : undefined);
		} finally {
			syncing = false;
		}
	}

	function configureOrganization() {
		onnavigate?.();
		void goto(resolve('/settings/organization'));
	}

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
		return isActive(item) || (item.children?.some((c) => isActive(c)) ?? false);
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
						item.children ? { ...item, children: item.children.filter(canSeeNav) } : item
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
		class="app-sidebar-brand flex h-16 items-center {sidebarState.collapsed
			? 'justify-center px-0'
			: 'gap-3 px-5'} border-b border-(--glass-border) transition-all hover:bg-(--ui-bg-accented)"
		onclick={() => onnavigate?.()}
	>
		<div class="relative grid size-10 shrink-0 place-items-center">
			<BnosMark class="size-9" />
		</div>
		{#if !sidebarState.collapsed}
			<div class="leading-tight">
				<div class="font-display text-[17px] font-bold tracking-tight">BNOS</div>
				<div class="text-[10px] font-semibold tracking-[0.18em] text-(--ui-text-dimmed) uppercase">
					{t('common.tagline')}
				</div>
			</div>
		{/if}
	</a>

	<!-- Navigation -->
	<nav
		class="app-nav min-h-0 flex-1 overflow-y-auto {sidebarState.collapsed ? 'px-2' : 'px-3'} py-2"
	>
		{#each visibleSections as section (section.label)}
			{#if !section.feature || (section.feature === 'restaurant' ? tenant.restaurantEnabled : features.isEnabled(section.feature))}
				<div class="app-nav-section mb-5">
					{#if !sidebarState.collapsed && sectionHasOwnLabel(section.items)}
						<div
							class="app-nav-section-label px-3 pb-1.5 text-[10px] font-semibold tracking-[0.16em] text-(--ui-text-dimmed) uppercase"
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
										class="focus-ring sidebar-nav-parent-link flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors {groupActive
											? 'text-(--ui-text)'
											: 'text-(--ui-text-muted) hover:text-(--ui-text)'}"
										onclick={() => onnavigate?.()}
									>
										<Icon
											name={item.icon}
											class="size-[18px] shrink-0 {groupActive
												? 'text-primary-500'
												: 'text-(--ui-text-dimmed) group-hover:text-(--ui-text-muted)'}"
										/>
										<span class="truncate">{navLabel(item)}</span>
									</a>
									<button
										type="button"
										onclick={() => toggleGroup(item.to)}
										aria-label={groupExpanded ? t('sidebar.collapse') : t('sidebar.expand')}
										class="focus-ring grid size-7 shrink-0 place-items-center rounded-md text-(--ui-text-dimmed) transition-colors hover:bg-(--ui-bg-accented) hover:text-(--ui-text)"
									>
										<Icon
											name="lucide:chevron-down"
											class="size-3.5 transition-transform duration-200 {groupExpanded
												? 'rotate-180'
												: ''}"
										/>
									</button>
								</div>
								{#if groupExpanded}
									<div
										class="sidebar-nav-group mt-0.5 ml-[1.35rem] flex flex-col gap-0.5 border-l border-(--ui-border-muted) pl-2"
									>
										{#each item.children as child (child.to)}
											{@const childActive = isActive(child)}
											<a
												href={resolvedHref(child.to)}
												title={navLabel(child)}
												class="focus-ring sidebar-nav-child nav-active group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors {childActive
													? 'is-active-surface text-(--ui-text)'
													: 'text-(--ui-text-muted) hover:bg-(--ui-bg-accented) hover:text-(--ui-text)'}"
												onclick={() => onnavigate?.()}
											>
												<Icon
													name={child.icon}
													class="size-4 shrink-0 {childActive
														? 'text-primary-500'
														: 'text-(--ui-text-dimmed) group-hover:text-(--ui-text-muted)'}"
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
								class="focus-ring app-nav-item nav-active group mb-0.5 flex items-center {sidebarState.collapsed
									? 'justify-center px-0'
									: 'gap-3 px-3'} rounded-lg py-2 text-[13.5px] font-medium transition-colors {active
									? 'nav-active-on is-active-surface'
									: 'soft-hover text-(--ui-text-muted) hover:text-(--ui-text)'}"
								onclick={() => onnavigate?.()}
							>
								<Icon
									name={item.icon}
									class="size-[18px] shrink-0 {active
										? 'text-primary-500'
										: 'text-(--ui-text-dimmed) group-hover:text-(--ui-text-muted)'}"
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

	<!-- Workspace recovery actions — always available so a user can sync or
	     reconfigure even when the nav above is empty. -->
	<div class="app-sidebar-workspace flex flex-col gap-1 border-t border-(--glass-border) p-2">
		<button
			type="button"
			onclick={syncWorkspace}
			disabled={syncing}
			title={t('sidebar.syncWorkspaceHint')}
			aria-label={t('sidebar.syncWorkspace')}
			class="group flex items-center {sidebarState.collapsed
				? 'justify-center px-0'
				: 'gap-3 px-3'} rounded-lg py-2 text-[13px] font-medium text-(--ui-text-muted) transition-colors hover:bg-(--ui-bg-accented) hover:text-(--ui-text) disabled:opacity-50"
		>
			<Icon
				name={syncing ? 'lucide:loader-circle' : 'lucide:refresh-cw'}
				class="size-[18px] shrink-0 text-(--ui-text-dimmed) group-hover:text-(--ui-text-muted) {syncing
					? 'animate-spin'
					: ''}"
			/>
			{#if !sidebarState.collapsed}<span class="truncate">{t('sidebar.syncWorkspace')}</span>{/if}
		</button>

		<button
			type="button"
			onclick={configureOrganization}
			title={t('sidebar.configureOrganizationHint')}
			aria-label={t('sidebar.configureOrganization')}
			class="group flex items-center {sidebarState.collapsed
				? 'justify-center px-0'
				: 'gap-3 px-3'} rounded-lg py-2 text-[13px] font-medium text-(--ui-text-muted) transition-colors hover:bg-(--ui-bg-accented) hover:text-(--ui-text)"
		>
			<Icon
				name="lucide:building-2"
				class="size-[18px] shrink-0 text-(--ui-text-dimmed) group-hover:text-(--ui-text-muted)"
			/>
			{#if !sidebarState.collapsed}<span class="truncate">{t('sidebar.configureOrganization')}</span
				>{/if}
		</button>
	</div>

	<!-- Collapse toggle -->
	<div
		class="app-sidebar-footer flex items-center {sidebarState.collapsed
			? 'justify-center'
			: ''} p-3"
	>
		<button
			type="button"
			onclick={toggleCollapsed}
			title={sidebarState.collapsed ? t('sidebar.expandSidebar') : t('sidebar.collapseSidebar')}
			aria-label={sidebarState.collapsed
				? t('sidebar.expandSidebar')
				: t('sidebar.collapseSidebar')}
			class="grid size-8 shrink-0 place-items-center rounded-lg text-(--ui-text-dimmed) transition-colors hover:bg-(--ui-bg-accented) hover:text-(--ui-text)"
		>
			<Icon
				name={sidebarState.collapsed ? 'lucide:chevrons-right' : 'lucide:chevrons-left'}
				class="size-4"
			/>
		</button>
	</div>
</div>
