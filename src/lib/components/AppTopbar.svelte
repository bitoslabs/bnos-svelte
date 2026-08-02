<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Popover from '$lib/components/ui/Popover.svelte';
	import { findNavItem } from '$lib/nav';
	import { relays } from '$nostr/relay.svelte';
	import { dataSync } from '$nostr/sync.svelte';
	import {
		preferences,
		accentOptions,
		densityOptions
	} from '$lib/theme/preferences.svelte';
	import { setMode, userPrefersMode } from 'mode-watcher';

	let { onmenutoggle }: { onmenutoggle?: () => void } = $props();

	const current = $derived(findNavItem(page.url.pathname));

	// Quick search
	let showSearch = $state(false);
	let searchQuery = $state('');

	function handleSearch(e: KeyboardEvent) {
		if (e.key === 'Enter' && searchQuery.trim()) {
			goto(resolve(`/orders?q=${encodeURIComponent(searchQuery.trim())}`));
			showSearch = false;
			searchQuery = '';
		}
		if (e.key === 'Escape') {
			showSearch = false;
			searchQuery = '';
		}
	}

	// Popovers
	let quickOpen = $state(false);
	let relayOpen = $state(false);

	// Sync state for quick-settings sync button
	const syncState = $derived(dataSync.status);

	async function syncWorkspace() {
		await dataSync.manualSync();
	}
</script>

<svelte:window
	onkeydown={(e) => {
		if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
			e.preventDefault();
			showSearch = true;
		}
	}}
/>

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
			class="font-display text-[16px] font-semibold tracking-tight text-[var(--ui-text-highlighted)]"
		>
			{current?.label ?? 'BNOS'}
		</h1>
		<p class="truncate text-[11.5px] text-[var(--ui-text-dimmed)] hidden sm:block">
			{page.url.pathname}
		</p>
	</div>

	<!-- Quick search -->
	{#if showSearch}
		<div class="relative flex items-center">
				<Icon name="lucide:search" class="absolute left-2.5 size-4 text-[var(--ui-text-dimmed)]" />
				<input
					bind:value={searchQuery}
					onkeydown={handleSearch}
				type="text"
				placeholder="Search orders..."
				class="w-44 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] py-1.5 pr-3 pl-8 text-[13px] focus:w-56 focus:outline-none focus:ring-1 focus:ring-primary-500 transition-all"
			/>
		</div>
	{:else}
		<button
			type="button"
			class="grid size-9 place-items-center rounded-lg text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]"
			onclick={() => (showSearch = true)}
			aria-label="Search"
			title="Search (Ctrl+K)"
		>
			<Icon name="lucide:search" class="size-[18px]" />
		</button>
	{/if}

	<!-- Notifications -->
	<a
		href={resolve('/notifications')}
		class="relative grid size-9 place-items-center rounded-lg text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]"
		aria-label="Notifications"
		title="Notifications"
	>
		<Icon name="lucide:bell" class="size-[18px]" />
	</a>

	<!-- Relay status popover -->
	<Popover bind:open={relayOpen} align="end" side="bottom">
		{#snippet trigger()}
			{#if relays.online}
				<span class="live-dot"></span>
			{:else}
				<Icon name="lucide:cloud-off" class="size-[18px] text-[var(--tone-warning-text)]" />
			{/if}
		{/snippet}
		{#snippet content()}
			<div class="w-72 space-y-3 p-1">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-2">
						<span class="relative flex size-2.5">
							{#if relays.online}
								<span class="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
								<span class="relative inline-flex size-2.5 rounded-full bg-emerald-500"></span>
							{:else}
								<span class="relative inline-flex size-2.5 rounded-full bg-amber-500"></span>
							{/if}
						</span>
						<span class="text-[13px] font-semibold">{relays.online ? 'Connected' : 'Offline'}</span>
					</div>
					<a href={resolve('/settings/relays')} class="text-[11.5px] font-semibold text-primary-600 hover:underline dark:text-primary-400">Manage</a>
				</div>

				<div class="space-y-1.5">
					{#each relays.relays as url (url)}
						{@const perm = relays.permissions[url] ?? { read: true, write: true }}
						{@const active = relays.activeRelays.includes(url)}
						<div class="flex items-center gap-2.5 rounded-lg border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-3 py-2">
							<span class="size-2 shrink-0 rounded-full {active ? 'bg-emerald-500' : 'bg-[var(--ui-text-dimmed)]'}"></span>
							<div class="min-w-0 flex-1">
								<p class="truncate text-[11.5px] font-mono font-medium">{url.replace('wss://', '')}</p>
								<div class="mt-0.5 flex items-center gap-1.5">
									{#if perm.read}
										<span class="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold text-emerald-600 dark:text-emerald-400">R</span>
									{/if}
									{#if perm.write}
										<span class="rounded bg-blue-500/10 px-1.5 py-0.5 text-[9px] font-bold text-blue-600 dark:text-blue-400">W</span>
									{/if}
								</div>
							</div>
							<span class="text-[10px] font-semibold {active ? 'text-emerald-600 dark:text-emerald-400' : 'text-[var(--ui-text-dimmed)]'}">
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
					onclick={async () => {
						const btn = document.getElementById('sync-btn-text');
						if (btn) btn.textContent = 'Syncing…';
						try {
							await dataSync.manualSync();
							if (btn) {
								btn.textContent = '✓ Synced';
								setTimeout(() => { if (btn) btn.textContent = 'Sync all data'; }, 2000);
							}
						} catch {
							if (btn) btn.textContent = 'Sync failed';
							setTimeout(() => { if (btn) btn.textContent = 'Sync all data'; }, 2000);
						}
					}}
					class="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-3 py-2 text-[12px] font-semibold transition-colors hover:bg-[var(--ui-bg-accented)]"
				>
					<Icon name="lucide:refresh-cw" class="size-3.5" />
					<span id="sync-btn-text">Sync all data</span>
				</button>
			</div>
		{/snippet}
	</Popover>

	<!-- Quick settings popover -->
	<Popover bind:open={quickOpen} align="end" side="bottom">
		{#snippet trigger()}
			<Icon name="lucide:sliders-horizontal" class="size-[18px]" />
		{/snippet}
		{#snippet content()}
			<div class="w-72 space-y-4 p-1">
				<!-- Color mode (reused from appearance) -->
				<div>
					<p class="mb-2 text-[10px] font-bold uppercase tracking-wider text-[var(--ui-text-dimmed)]">Color mode</p>
					<div class="segmented inline-flex w-full gap-1 rounded-lg bg-[var(--ui-bg-muted)] p-1">
						{#each ['light', 'dark', 'system'] as m (m)}
							<button
								type="button"
								onclick={() => setMode(m as 'light' | 'dark' | 'system')}
								class="flex-1 rounded-md px-3 py-1.5 text-[12px] font-semibold capitalize transition-colors {userPrefersMode.current === m ? 'bg-[var(--ui-bg-elevated)] text-[var(--ui-text)] shadow-sm' : 'text-[var(--ui-text-muted)]'}"
							>{m}</button>
						{/each}
					</div>
				</div>

				<!-- Accent color -->
				<div>
					<p class="mb-2 text-[10px] font-bold uppercase tracking-wider text-[var(--ui-text-dimmed)]">Accent</p>
					<div class="flex flex-wrap gap-2">
						{#each accentOptions as opt (opt.key)}
							<button
								type="button"
								onclick={() => preferences.setAccent(opt.key)}
								class="size-7 rounded-full ring-2 ring-offset-2 ring-offset-[var(--surface-bg)] transition-transform hover:scale-110 {preferences.state.accent === opt.key ? 'ring-primary-500' : 'ring-transparent'}"
								style="background: {opt.hex}"
								title={opt.label}
							></button>
						{/each}
					</div>
				</div>

				<!-- Density -->
				<div>
					<p class="mb-2 text-[10px] font-bold uppercase tracking-wider text-[var(--ui-text-dimmed)]">Density</p>
					<div class="segmented inline-flex w-full gap-1 rounded-lg bg-[var(--ui-bg-muted)] p-1">
						{#each densityOptions as opt (opt.key)}
							<button
								type="button"
								onclick={() => preferences.setDensity(opt.key)}
								class="flex-1 rounded-md px-3 py-1.5 text-[12px] font-semibold capitalize transition-colors {preferences.state.density === opt.key ? 'bg-[var(--ui-bg-elevated)] text-[var(--ui-text)] shadow-sm' : 'text-[var(--ui-text-muted)]'}"
							>{opt.label}</button>
						{/each}
					</div>
				</div>

				<!-- Sync workspace -->
				<div class="border-t border-[var(--ui-border-muted)] pt-3">
					<button
						type="button"
						onclick={syncWorkspace}
						disabled={syncState === 'syncing'}
						class="flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-3 py-2 text-[12px] font-semibold transition-colors hover:bg-[var(--ui-bg-accented)] disabled:opacity-60"
					>
						{#if syncState === 'syncing'}
							<Icon name="lucide:loader-circle" class="size-3.5 animate-spin" /> Syncing…
						{:else if syncState === 'done'}
							<Icon name="lucide:check" class="size-3.5 text-emerald-500" /> ✓ Synced
						{:else if syncState === 'failed'}
							<Icon name="lucide:x" class="size-3.5 text-[var(--tone-error-text)]" /> Sync failed
						{:else}
							<Icon name="lucide:refresh-cw" class="size-3.5" /> Sync workspace
						{/if}
					</button>
				</div>

				<!-- Links -->
				<div class="border-t border-[var(--ui-border-muted)] pt-3">
					<a href={resolve('/settings')} class="flex items-center gap-2.5 rounded-lg px-2 py-2 text-[12.5px] font-medium text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]">
						<Icon name="lucide:settings" class="size-4" />
						All Settings
					</a>
					<a href={resolve('/settings/appearance')} class="flex items-center gap-2.5 rounded-lg px-2 py-2 text-[12.5px] font-medium text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]">
						<Icon name="lucide:palette" class="size-4" />
						Appearance Settings
					</a>
					<a href={resolve('/settings/about')} class="flex items-center gap-2.5 rounded-lg px-2 py-2 text-[12.5px] font-medium text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]">
						<Icon name="lucide:info" class="size-4" />
						About BNOS
					</a>
				</div>
			</div>
		{/snippet}
	</Popover>
</header>
