<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Popover from '$lib/components/ui/Popover.svelte';
	import AppearanceControls from '$lib/components/AppearanceControls.svelte';
	import { command } from '$lib/stores/command.svelte';
	import { findNavItem, navSections } from '$lib/nav';
	import { relays } from '$nostr/relay.svelte';
	import { session } from '$nostr/session.svelte';
	import { profile } from '$nostr/profile.svelte';
	import { dataSync } from '$nostr/sync.svelte';

	let { onmenutoggle }: { onmenutoggle?: () => void } = $props();

	const current = $derived(findNavItem(page.url.pathname));
	// Clean section label for the breadcrumb subtitle (replaces the raw URL).
	const sectionLabel = $derived.by(() => {
		const item = current;
		if (!item) return '';
		const section = navSections.find((s) =>
			s.items.some((i) => i.to === item.to || i.children?.some((c) => c.to === item.to))
		);
		return section?.label ?? '';
	});

	// Popovers
	let quickOpen = $state(false);
	let relayOpen = $state(false);
	const statusTriggerClass = $derived(
		relays.online
			? 'inline-flex h-9 items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 text-[12px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-500/15 dark:text-emerald-300'
			: 'inline-flex h-9 items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 text-[12px] font-semibold text-amber-700 transition-colors hover:bg-amber-500/15 dark:text-amber-300'
	);

	const syncState = $derived(dataSync.status);
	const syncLabel = $derived.by(() => {
		if (syncState === 'syncing') return 'Syncing all data...';
		if (syncState === 'done') return 'All data synced';
		if (syncState === 'failed') return 'Sync failed';
		return 'Sync all data';
	});
	const syncIcon = $derived.by(() => {
		if (syncState === 'syncing') return 'lucide:loader-circle';
		if (syncState === 'done') return 'lucide:check';
		if (syncState === 'failed') return 'lucide:x';
		return 'lucide:refresh-cw';
	});
	const syncIconClass = $derived.by(() => {
		if (syncState === 'syncing') return 'size-3.5 animate-spin';
		if (syncState === 'done') return 'size-3.5 text-emerald-500';
		if (syncState === 'failed') return 'size-3.5 text-[var(--tone-error-text)]';
		return 'size-3.5';
	});

	async function syncAllData() {
		await dataSync.manualSync();
	}
</script>

<header
	class="app-topbar app-chrome sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-[var(--glass-border)] px-4 sm:px-6"
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
			class="truncate font-display text-[16px] font-semibold tracking-tight text-[var(--ui-text-highlighted)]"
		>
			{current?.label ?? 'BNOS'}
		</h1>
		{#if sectionLabel && sectionLabel !== (current?.label ?? '')}
			<p class="hidden truncate text-[11.5px] text-[var(--ui-text-dimmed)] sm:block">
				{sectionLabel}
			</p>
		{/if}
	</div>

	<!-- Command palette trigger (⌘K) -->
	<button
		type="button"
		onclick={() => command.show()}
		class="hidden h-9 items-center gap-2 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-2.5 text-[var(--ui-text-dimmed)] transition-colors hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)] sm:flex"
		aria-label="Search"
		title="Search & commands (⌘K)"
	>
		<Icon name="lucide:search" class="size-4" />
		<span class="text-[12.5px] font-medium">Search…</span>
		<kbd
			class="ml-1 rounded border border-[var(--ui-border-muted)] bg-[var(--ui-bg)] px-1.5 py-0.5 text-[10px] font-bold"
			>⌘K</kbd
		>
	</button>
	<button
		type="button"
		onclick={() => command.show()}
		class="grid size-9 place-items-center rounded-lg text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)] sm:hidden"
		aria-label="Search"
		title="Search & commands"
	>
		<Icon name="lucide:search" class="size-[18px]" />
	</button>

	<!-- Notifications -->
	<a
		href={resolve('/notifications')}
		class="relative grid size-9 place-items-center rounded-lg text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]"
		aria-label="Notifications"
		title="Notifications"
	>
		<Icon name="lucide:bell" class="size-[18px]" />
	</a>

	<!-- System status (relay + sync) popover -->
	<Popover
		bind:open={relayOpen}
		align="end"
		side="bottom"
		triggerClass={statusTriggerClass}
		triggerActiveClass="ring-2 ring-primary-500/20"
	>
		{#snippet trigger()}
			<span class="relative flex size-2">
				{#if relays.online}
					<span
						class="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75"
					></span>
					<span class="relative inline-flex size-2 rounded-full bg-emerald-500"></span>
				{:else}
					<span class="relative inline-flex size-2 rounded-full bg-amber-500"></span>
				{/if}
			</span>
			<span class="hidden md:inline">{relays.online ? 'Online' : 'Offline'}</span>
		{/snippet}
		{#snippet content()}
			<div class="w-72 space-y-3 p-1">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-2">
						<span class="relative flex size-2.5">
							{#if relays.online}
								<span
									class="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75"
								></span>
								<span class="relative inline-flex size-2.5 rounded-full bg-emerald-500"></span>
							{:else}
								<span class="relative inline-flex size-2.5 rounded-full bg-amber-500"></span>
							{/if}
						</span>
						<span class="text-[13px] font-semibold">{relays.online ? 'Connected' : 'Offline'}</span>
					</div>
					<a
						href={resolve('/settings/relays')}
						class="text-[11.5px] font-semibold text-primary-600 hover:underline dark:text-primary-400"
						>Manage</a
					>
				</div>

				<div class="space-y-1.5">
					{#each relays.relays as url (url)}
						{@const perm = relays.permissions[url] ?? { read: true, write: true }}
						{@const active = relays.activeRelays.includes(url)}
						<div
							class="flex items-center gap-2.5 rounded-lg border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-3 py-2"
						>
							<span
								class="size-2 shrink-0 rounded-full {active
									? 'bg-emerald-500'
									: 'bg-[var(--ui-text-dimmed)]'}"
							></span>
							<div class="min-w-0 flex-1">
								<p class="truncate font-mono text-[11.5px] font-medium">
									{url.replace('wss://', '')}
								</p>
								<div class="mt-0.5 flex items-center gap-1.5">
									{#if perm.read}
										<span
											class="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold text-emerald-600 dark:text-emerald-400"
											>R</span
										>
									{/if}
									{#if perm.write}
										<span
											class="rounded bg-blue-500/10 px-1.5 py-0.5 text-[9px] font-bold text-blue-600 dark:text-blue-400"
											>W</span
										>
									{/if}
								</div>
							</div>
							<span
								class="text-[10px] font-semibold {active
									? 'text-emerald-600 dark:text-emerald-400'
									: 'text-[var(--ui-text-dimmed)]'}"
							>
								{active ? 'Live' : 'Idle'}
							</span>
						</div>
					{/each}
				</div>

				<p class="text-center text-[10.5px] text-[var(--ui-text-dimmed)]">
					{relays.activeRelays.length} of {relays.relays.length} relays active
				</p>

				<button
					type="button"
					onclick={syncAllData}
					disabled={syncState === 'syncing'}
					class="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-3 py-2 text-[12px] font-semibold transition-colors hover:bg-[var(--ui-bg-accented)] disabled:cursor-not-allowed disabled:opacity-60"
				>
					<Icon name={syncIcon} class={syncIconClass} />
					<span>{syncLabel}</span>
				</button>
			</div>
		{/snippet}
	</Popover>

	<!-- Quick settings popover -->
	<Popover bind:open={quickOpen} align="end" side="bottom" class="w-80 p-0">
		{#snippet trigger()}
			<Icon name="lucide:sliders-horizontal" class="size-[18px]" />
		{/snippet}
		{#snippet content()}
			<div class="w-80 space-y-1 p-0">
				<!-- Account chip -->
				<a
					href={resolve('/profile')}
					onclick={() => (quickOpen = false)}
					class="flex items-center gap-3 rounded-t-xl border-b border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-3.5 py-3 transition-colors hover:bg-[var(--ui-bg-accented)]"
				>
					<div
						class="grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-primary-400 to-primary-600 text-[13px] font-bold text-white shadow-sm"
					>
						{#if profile.hasAvatar}
							<img
								src={profile.picture}
								alt={profile.displayLabel}
								class="size-9 rounded-full object-cover"
							/>
						{:else}
							{profile.avatarLetter}
						{/if}
					</div>
					<div class="min-w-0 flex-1">
						<p class="truncate text-[12.5px] font-semibold text-[var(--ui-text)]">
							{profile.displayLabel}
						</p>
						<p class="truncate text-[10.5px] text-[var(--ui-text-dimmed)]">
							{profile.subtitle}
						</p>
					</div>
					<Icon name="lucide:chevron-right" class="size-4 shrink-0 text-[var(--ui-text-dimmed)]" />
				</a>

				<!-- Appearance controls -->
				<AppearanceControls class="px-3.5 py-3.5" />

				<!-- Quick action widgets -->
				<div class="grid grid-cols-2 gap-1.5 px-3.5 pb-3">
					<button
						type="button"
						onclick={() => {
							void syncAllData();
						}}
						disabled={syncState === 'syncing'}
						class="flex flex-col items-center gap-1 rounded-lg border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] py-2.5 text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)] disabled:opacity-60"
						title="Sync data"
					>
						<Icon name={syncIcon} class={syncIconClass} />
						<span class="text-[10px] font-semibold">Sync</span>
					</button>
					<a
						href={resolve('/settings/relays')}
						onclick={() => (quickOpen = false)}
						class="flex flex-col items-center gap-1 rounded-lg border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] py-2.5 text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]"
						title="Manage relays"
					>
						<span class="relative flex size-4 items-center justify-center">
							{#if relays.online}
								<span class="absolute size-2 animate-ping rounded-full bg-emerald-400 opacity-70"
								></span>
							{/if}
							<Icon name="lucide:radio" class="size-4" />
						</span>
						<span class="text-[10px] font-semibold">Relays</span>
					</a>
				</div>

				<!-- Links -->
				<div class="space-y-0.5 border-t border-[var(--ui-border-muted)] px-1.5 py-1.5">
					<a
						href={resolve('/settings')}
						onclick={() => (quickOpen = false)}
						class="flex items-center gap-2.5 rounded-lg px-2 py-2 text-[12.5px] font-medium text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]"
					>
						<Icon name="lucide:settings" class="size-4" />
						All Settings
						<Icon
							name="lucide:chevron-right"
							class="ml-auto size-3.5 text-[var(--ui-text-dimmed)]"
						/>
					</a>
					<a
						href={resolve('/settings/appearance')}
						onclick={() => (quickOpen = false)}
						class="flex items-center gap-2.5 rounded-lg px-2 py-2 text-[12.5px] font-medium text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]"
					>
						<Icon name="lucide:palette" class="size-4" />
						Appearance
						<Icon
							name="lucide:chevron-right"
							class="ml-auto size-3.5 text-[var(--ui-text-dimmed)]"
						/>
					</a>
					<a
						href={resolve('/settings/about')}
						onclick={() => (quickOpen = false)}
						class="flex items-center gap-2.5 rounded-lg px-2 py-2 text-[12.5px] font-medium text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]"
					>
						<Icon name="lucide:info" class="size-4" />
						About BNOS
						<Icon
							name="lucide:chevron-right"
							class="ml-auto size-3.5 text-[var(--ui-text-dimmed)]"
						/>
					</a>
				</div>
			</div>
		{/snippet}
	</Popover>
</header>
