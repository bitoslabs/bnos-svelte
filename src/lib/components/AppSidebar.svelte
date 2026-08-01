<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Popover from '$lib/components/ui/Popover.svelte';
	import { navSections, type NavItem } from '$lib/nav';
	import { session } from '$nostr/session.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { truncateNpub, initialsFrom } from '$lib/utils/format';

	let { onnavigate }: { onnavigate?: () => void } = $props();

	function normalizePath(path: string) {
		return path.length > 1 ? path.replace(/\/+$/, '') : path;
	}
	function isActive(item: NavItem) {
		const current = normalizePath(page.url.pathname);
		const target = normalizePath(item.to);
		return item.exact ? current === target : current === target || current.startsWith(target + '/');
	}

	let menuOpen = $state(false);

	async function signOut() {
		menuOpen = false;
		session.logout();
		tenant.reset();
		await goto('/login');
	}
</script>

<div class="flex h-full flex-col">
	<!-- Brand -->
	<a
		href="/"
		aria-label="Go to bdGo OS dashboard"
		class="app-sidebar-brand flex h-16 items-center gap-3 border-b border-[var(--glass-border)] px-5 transition-colors hover:bg-[var(--ui-bg-accented)]"
		onclick={() => onnavigate?.()}
	>
		<div class="relative grid size-10 place-items-center rounded-xl bg-gradient-to-br from-primary-400 to-primary-600">
			<div
				class="absolute inset-0 rounded-xl bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,.45),transparent_60%)]"
			></div>
			<Icon name="lucide:zap" class="relative size-5 text-white" />
		</div>
		<div class="leading-tight">
			<div class="font-display text-[17px] font-bold tracking-tight">bdGo OS</div>
			<div class="text-[10px] font-semibold tracking-[0.18em] text-[var(--ui-text-dimmed)] uppercase">
				Bitcoin POS
			</div>
		</div>
	</a>

	<!-- Navigation -->
	<nav class="app-nav min-h-0 flex-1 overflow-y-auto px-3 py-2">
		{#each navSections as section (section.label)}
			{#if section.feature !== 'restaurant' || tenant.restaurantEnabled}
			<div class="app-nav-section mb-5">
				<div
					class="app-nav-section-label px-3 pb-1.5 text-[10px] font-semibold tracking-[0.16em] text-[var(--ui-text-dimmed)] uppercase"
				>
					{section.label}
				</div>
				{#each section.items as item (item.to)}
					{@const active = isActive(item)}
					<a
						href={item.to}
						class="app-nav-item nav-active group mb-0.5 flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors {active
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
						<span class="truncate">{item.label}</span>
					</a>
				{/each}
			</div>
			{/if}
		{/each}
	</nav>

	<!-- Active tenant pill -->
	{#if tenant.state.organizationName}
		<div
			class="app-tenant-pill mx-3 mb-2 flex items-center gap-2.5 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-3 py-2"
			title={tenant.state.organizationName}
		>
			<span
				class="grid size-7 shrink-0 place-items-center rounded-md bg-primary-500/10 text-[11px] font-bold text-primary-600 dark:text-primary-400"
			>
				{tenant.state.organizationName.slice(0, 2).toUpperCase()}
			</span>
			<span class="min-w-0 flex-1">
				<span class="block truncate text-[12.5px] font-semibold">{tenant.state.organizationName}</span>
				<span class="block truncate text-[11px] text-[var(--ui-text-dimmed)]">
					{tenant.state.currency} · {tenant.state.locationName ?? 'Main'}
				</span>
			</span>
		</div>
	{/if}

	<!-- User menu -->
	<div class="app-user-menu p-3">
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
					<a
						href="/settings"
						onclick={() => (menuOpen = false)}
						class="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12.5px] font-medium text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]"
					>
						<Icon name="lucide:sliders-horizontal" class="size-4 text-[var(--ui-text-dimmed)]" />
						Settings
					</a>
					<a
						href="/profile"
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
	</div>
</div>
