<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Popover from '$lib/components/ui/Popover.svelte';
	import Switch from '$lib/components/ui/Switch.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import AppearanceControls from '$lib/components/AppearanceControls.svelte';
	import LanguageSwitcher from '$lib/components/LanguageSwitcher.svelte';
	import { command } from '$lib/stores/command.svelte';
	import { notifications, type AppNotification } from '$lib/stores/notifications.svelte';
	import { findNavItem, navSections, navSectionLabel } from '$lib/nav';
	import { relays } from '$nostr/relay.svelte';
	import { session } from '$nostr/session.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { glo } from '$nostr/store.svelte';
	import { profile } from '$nostr/profile.svelte';
	import { dataSync } from '$nostr/sync.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { confirm } from '$lib/stores/confirm.svelte';
	import { t } from '$lib/i18n/i18n.svelte';
	import { relativeTime } from '$lib/utils/format';

	let { onmenutoggle }: { onmenutoggle?: () => void } = $props();

	const current = $derived(findNavItem(page.url.pathname));
	// Clean section label for the breadcrumb subtitle (replaces the raw URL).
	const sectionLabel = $derived.by(() => {
		const item = current;
		if (!item) return '';
		const section = navSections.find((s) =>
			s.items.some((i) => i.to === item.to || i.children?.some((c) => c.to === item.to))
		);
		return section ? navSectionLabel(section) : '';
	});

	// ── Notification center ────────────────────────────────────────────────
	// Hydrate the persisted feed (system-event wiring lives in the root layout).
	onMount(() => {
		notifications.load();
	});

	let notifOpen = $state(false);
	let notifTab = $state<'all' | 'unread'>('all');

	const unreadCount = $derived(notifications.unread);
	const unreadBadge = $derived(unreadCount > 9 ? '9+' : String(unreadCount));
	const notifItems = $derived(
		notifTab === 'unread'
			? notifications.items.filter((n) => !n.read)
			: notifications.items
	);

	const notifToneBg: Record<AppNotification['tone'], string> = {
		info: 'tone-info',
		success: 'tone-success',
		warning: 'tone-warning',
		error: 'tone-error'
	};
	const notifToneText: Record<AppNotification['tone'], string> = {
		info: 'tone-text-info',
		success: 'tone-text-success',
		warning: 'tone-text-warning',
		error: 'tone-text-error'
	};

	function openNotification(n: AppNotification) {
		notifications.markRead(n.id);
		if (n.href) {
			notifOpen = false;
			void goto(resolve(n.href as '/'));
		}
	}

	// ── Sync engine ────────────────────────────────────────────────────────
	// Labeled status chip (twin of the relay chip below): icon + short state
	// label on ≥sm, icon-only on xs. Clicking always triggers a manual sync.
	const syncState = $derived(dataSync.status);
	const syncShortLabel = $derived.by(() => {
		if (syncState === 'syncing') return t('topbar.syncing');
		if (syncState === 'done') return t('topbar.synced');
		if (syncState === 'failed') return t('topbar.syncFailedShort');
		return t('common.sync');
	});
	const syncFullLabel = $derived.by(() => {
		if (syncState === 'syncing') return t('topbar.syncingAllData');
		if (syncState === 'done') return t('common.allDataSynced');
		if (syncState === 'failed') return t('common.syncFailed');
		return t('common.syncAll');
	});
	const syncTitle = $derived.by(() => {
		if (dataSync.lastSyncedAt > 0) {
			return `${syncFullLabel} · ${t('topbar.lastSynced', { time: relativeTime(dataSync.lastSyncedAt) })}`;
		}
		return syncFullLabel;
	});
	const syncIcon = $derived.by(() => {
		if (syncState === 'syncing') return 'lucide:loader-circle';
		if (syncState === 'done') return 'lucide:check';
		if (syncState === 'failed') return 'lucide:x';
		return 'lucide:refresh-cw';
	});
	const syncIconClass = $derived.by(() => {
		if (syncState === 'syncing') return 'animate-spin';
		return '';
	});
	const syncChipClass = $derived.by(() => {
		const base =
			'relative inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60';
		if (syncState === 'done') {
			return `${base} border-emerald-500/30 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/15 dark:text-emerald-400`;
		}
		if (syncState === 'failed') {
			return `${base} border-red-500/30 bg-[var(--tone-error-bg)] text-[var(--tone-error-text)] hover:border-red-500/50`;
		}
		return `${base} border-[var(--ui-border)] bg-[var(--ui-bg-muted)] text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]`;
	});

	async function syncAllData() {
		await dataSync.manualSync();
		if (dataSync.status === 'failed') {
			toast.error(t('common.syncFailed'), dataSync.error || t('topbar.syncErrorDesc'));
		}
	}

	// ── Relay status ───────────────────────────────────────────────────────
	let relayOpen = $state(false);

	// Labeled status chip: live dot + wifi glyph + "n/m" count (icon-only on xs).
	const relayTriggerClass = $derived(
		relays.online
			? 'relative inline-flex h-9 items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 text-[12.5px] font-semibold text-emerald-600 transition-colors hover:bg-emerald-500/15 dark:text-emerald-400'
			: 'relative inline-flex h-9 items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 text-[12.5px] font-semibold text-amber-600 transition-colors hover:bg-amber-500/15 dark:text-amber-400'
	);
	const relayStatusTitle = $derived(
		`${relays.online ? t('common.online') : t('common.offline')} · ${t('topbar.relaysActive', { active: relays.activeRelays.length, total: relays.relays.length })}`
	);

	// Quick add-relay field for the status popover.
	let newRelay = $state('');

	function addRelay() {
		const value = newRelay.trim();
		if (!value) return;
		relays.add(value);
		newRelay = '';
	}

	// ── Popovers ───────────────────────────────────────────────────────────
	let quickOpen = $state(false);
	let accountOpen = $state(false);

	async function signOut() {
		const usesLocalKey = session.loginMethod === 'nsec';
		const ok = await confirm({
			title: 'Sign out and clear this device?',
			message: usesLocalKey
				? 'This removes cached workspace data and the private key stored on this device. Make sure your nsec is backed up before continuing.'
				: 'This removes cached workspace data from this device. Your private key remains safely inside your NIP-07 extension.',
			detail: 'Relay data is not deleted. It can be synced again after you sign in.',
			tone: 'danger',
			icon: 'lucide:log-out',
			confirmText: 'Sign out & clear'
		});
		if (!ok) return;
		accountOpen = false;
		await session.logout();
		tenant.reset();
		glo.clearAll();
		await goto(resolve('/login'));
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
		aria-label={t('topbar.openMenu')}
	>
		<Icon name="lucide:menu" class="size-5" />
	</button>

	<!-- Breadcrumb / title -->
	<div class="min-w-0 flex-1">
		<h1
			class="truncate font-display text-[16px] font-semibold tracking-tight text-[var(--ui-text-highlighted)]"
		>
			{current ? (current.labelKey ? t(current.labelKey) : current.label) : t('common.appName')}
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
		aria-label={t('common.search')}
		title={t('topbar.searchCommands')}
	>
		<Icon name="lucide:search" class="size-4" />
		<span class="text-[12.5px] font-medium">{t('topbar.searchPlaceholder')}</span>
		<kbd
			class="ml-1 rounded border border-[var(--ui-border-muted)] bg-[var(--ui-bg)] px-1.5 py-0.5 text-[10px] font-bold"
			>⌘K</kbd
		>
	</button>
	<button
		type="button"
		onclick={() => command.show()}
		class="grid size-9 place-items-center rounded-lg text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)] sm:hidden"
		aria-label={t('common.search')}
		title={t('topbar.searchCommands')}
	>
		<Icon name="lucide:search" class="size-[18px]" />
	</button>

	<!-- Divider: tasks ↔ system cluster -->
	<div class="mx-1 hidden h-5 w-px bg-[var(--ui-border-muted)] sm:block"></div>

	<!-- Sync status chip (system control — twin of the relay chip) -->
	<button
		type="button"
		onclick={syncAllData}
		disabled={syncState === 'syncing'}
		class={syncChipClass}
		aria-label={syncTitle}
		title={syncTitle}
		aria-live="polite"
	>
		<Icon name={syncIcon} class="size-4 {syncIconClass}" />
		<span class="hidden sm:inline">{syncShortLabel}</span>
	</button>

	<!-- 🔔 Notification center -->
	<Popover
		bind:open={notifOpen}
		align="end"
		side="bottom"
		title={t('notifications.title')}
		triggerClass="relative grid size-9 place-items-center rounded-lg text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]"
	>
		{#snippet trigger()}
			<Icon name={unreadCount > 0 ? 'lucide:bell-ring' : 'lucide:bell'} class="size-[18px]" />
			{#if unreadCount > 0}
				<span
					class="absolute -top-0.5 -right-0.5 grid min-w-4 place-items-center rounded-full bg-primary-500 px-1 text-[9.5px] leading-4 font-bold text-white ring-2 ring-[var(--surface-bg)]"
					aria-label="{unreadCount} {t('topbar.unreadTab')}"
				>
					{unreadBadge}
				</span>
			{/if}
		{/snippet}
		{#snippet content()}
			<div class="flex w-[min(380px,calc(100vw-2.5rem))] flex-col p-1">
				<!-- Header: title + mark-all-read -->
				<div class="flex items-center justify-between px-1 pb-2">
					<div class="flex items-center gap-2">
						<span class="text-[13px] font-semibold">{t('notifications.title')}</span>
						{#if unreadCount > 0}
							<span
								class="rounded-full bg-primary-500/15 px-1.5 py-px text-[10px] font-bold text-primary-600 dark:text-primary-400"
							>
								{unreadBadge}
							</span>
						{/if}
					</div>
					{#if unreadCount > 0}
						<button
							type="button"
							onclick={() => notifications.markAllRead()}
							class="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-primary-600 hover:bg-primary-500/10 dark:text-primary-400"
						>
							<Icon name="lucide:check-check" class="size-3.5" />
							{t('topbar.markAllRead')}
						</button>
					{/if}
				</div>

				<!-- Tabs: All / Unread -->
				<div class="mb-2 flex gap-1 rounded-lg bg-[var(--ui-bg-muted)] p-1">
					<button
						type="button"
						onclick={() => (notifTab = 'all')}
						class="flex-1 rounded-md px-2 py-1 text-[11.5px] font-semibold transition-colors {notifTab ===
						'all'
							? 'bg-[var(--ui-bg-elevated)] text-[var(--ui-text)] shadow-sm'
							: 'text-[var(--ui-text-dimmed)] hover:text-[var(--ui-text)]'}"
					>
						{t('common.all')}
					</button>
					<button
						type="button"
						onclick={() => (notifTab = 'unread')}
						class="flex-1 rounded-md px-2 py-1 text-[11.5px] font-semibold transition-colors {notifTab ===
						'unread'
							? 'bg-[var(--ui-bg-elevated)] text-[var(--ui-text)] shadow-sm'
							: 'text-[var(--ui-text-dimmed)] hover:text-[var(--ui-text)]'}"
					>
						{t('topbar.unreadTab')}{#if unreadCount > 0} · {unreadCount}{/if}
					</button>
				</div>

				<!-- Feed -->
				{#if notifItems.length === 0}
					<div
						class="flex flex-col items-center justify-center rounded-lg border border-dashed border-[var(--ui-border-muted)] px-3 py-7"
					>
						<Icon
							name="lucide:bell-off"
							class="mb-1.5 size-5 text-[var(--ui-text-dimmed)]"
						/>
						<p class="text-[12px] font-semibold text-[var(--ui-text-muted)]">
							{t('topbar.youAreAllCaughtUp')}
						</p>
						<p class="mt-0.5 text-center text-[11px] text-[var(--ui-text-dimmed)]">
							{t('topbar.caughtUpDesc')}
						</p>
					</div>
				{:else}
					<ul class="max-h-72 space-y-1 overflow-y-auto pr-0.5">
						{#each notifItems as n (n.id)}
							<li class="group relative">
								<button
									type="button"
									onclick={() => openNotification(n)}
									class="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[var(--ui-bg-accented)] {n.read
										? ''
										: 'bg-primary-500/[0.06]'}"
									title={n.href ? t('common.view') : t('topbar.markAsRead')}
								>
									<span
										class="grid size-8 shrink-0 place-items-center rounded-lg {notifToneBg[n.tone]}"
									>
										<Icon name={n.icon} class="size-4 {notifToneText[n.tone]}" />
									</span>
									<span class="min-w-0 flex-1">
										<span class="flex items-center gap-1.5">
											{#if !n.read}
												<span class="size-1.5 shrink-0 rounded-full bg-primary-500"></span>
											{/if}
											<span class="truncate text-[12.5px] font-semibold text-[var(--ui-text)]"
												>{n.title}</span
											>
										</span>
										{#if n.description}
											<span class="block truncate text-[11.5px] text-[var(--ui-text-dimmed)]"
												>{n.description}</span
											>
										{/if}
										<span class="mt-0.5 block text-[10px] text-[var(--ui-text-dimmed)]">
											{relativeTime(n.at)}
										</span>
									</span>
									{#if n.href}
										<Icon
											name="lucide:chevron-right"
											class="mt-1.5 size-3.5 shrink-0 text-[var(--ui-text-dimmed)] opacity-0 transition-opacity group-hover:opacity-100"
										/>
									{/if}
								</button>
								<button
									type="button"
									onclick={() => notifications.remove(n.id)}
									class="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-md text-[var(--ui-text-dimmed)] opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-[var(--tone-error-bg)] hover:text-[var(--tone-error-text)]"
									aria-label={t('topbar.removeNotification')}
									title={t('topbar.removeNotification')}
								>
									<Icon name="lucide:x" class="size-3" />
								</button>
							</li>
						{/each}
					</ul>
				{/if}

				<!-- Footer: view all + clear -->
				<div class="mt-2 flex items-center gap-1.5 border-t border-[var(--ui-border-muted)] px-1 pt-2">
					<a
						href={resolve('/notifications')}
						onclick={() => (notifOpen = false)}
						class="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11.5px] font-semibold text-primary-600 transition-colors hover:bg-primary-500/10 dark:text-primary-400"
					>
						<Icon name="lucide:list" class="size-3.5" />
						{t('common.viewAll')}
					</a>
					{#if notifications.items.length > 0}
						<span class="h-4 w-px bg-[var(--ui-border-muted)]"></span>
						<button
							type="button"
							onclick={() => notifications.clear()}
							class="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11.5px] font-semibold text-[var(--ui-text-dimmed)] transition-colors hover:bg-[var(--tone-error-bg)] hover:text-[var(--tone-error-text)]"
							title={t('topbar.clearAllNotifications')}
						>
							<Icon name="lucide:trash-2" class="size-3.5" />
							{t('common.clear')}
						</button>
					{/if}
				</div>
			</div>
		{/snippet}
	</Popover>

	<!-- System status (relay) popover — labeled chip, icon-only on mobile -->
	<Popover
		bind:open={relayOpen}
		align="end"
		side="bottom"
		title={relayStatusTitle}
		triggerClass={relayTriggerClass}
		triggerActiveClass="ring-2 ring-emerald-500/20"
	>
		{#snippet trigger()}
			<span class="relative flex size-4 items-center justify-center">
				<Icon name={relays.online ? 'lucide:wifi' : 'lucide:wifi-off'} class="size-4" />
				{#if relays.online}
					<span
						class="absolute -right-1 -bottom-0.5 flex size-2.5"
					>
						<span
							class="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75"
						></span>
						<span
							class="relative inline-flex size-2.5 rounded-full bg-emerald-500 ring-2 ring-[var(--surface-bg)]"
						></span>
					</span>
				{/if}
			</span>
			<span class="hidden tabular-nums sm:inline">
				{relays.activeRelays.length}/{relays.relays.length}
			</span>
		{/snippet}
		{#snippet content()}
			<div class="w-80 space-y-2.5 p-1">
				<!-- Header: status + manage -->
				<div class="flex items-center justify-between px-1">
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
						<span class="text-[13px] font-semibold"
							>{relays.online ? t('common.connected') : t('common.offline')}</span
						>
						<span class="text-[11px] text-[var(--ui-text-dimmed)]">
							{t('topbar.relaysActive', { active: relays.activeRelays.length, total: relays.relays.length })}
						</span>
					</div>
					<a
						href={resolve('/settings/relays')}
						class="text-[11.5px] font-semibold text-primary-600 hover:underline dark:text-primary-400"
						>{t('common.manage')}</a
					>
				</div>

				<!-- Quick add relay -->
				<form class="flex gap-1.5 px-1" onsubmit={(e) => (e.preventDefault(), addRelay())}>
					<Input
						bind:value={newRelay}
						size="sm"
						icon="lucide:plus"
						placeholder={t('topbar.relayPlaceholder')}
						class="flex-1"
					/>
					<button
						type="submit"
						class="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-primary-500 px-2.5 text-[12px] font-semibold text-white transition-colors hover:bg-primary-400"
					>
						{t('common.add')}
					</button>
				</form>

				<!-- Relay list: activate / remove -->
				{#if relays.relays.length === 0}
					<div
						class="rounded-lg border border-dashed border-[var(--ui-border-muted)] px-3 py-6 text-center"
					>
						<Icon name="lucide:radio-off" class="mx-auto mb-1.5 size-5 text-[var(--ui-text-dimmed)]" />
						<p class="text-[12px] font-semibold text-[var(--ui-text-muted)]">{t('topbar.noRelays')}</p>
						<p class="mt-0.5 text-[11px] text-[var(--ui-text-dimmed)]">{t('topbar.noRelaysDesc')}</p>
					</div>
				{:else}
					<ul class="max-h-64 space-y-1 overflow-y-auto px-0.5">
						{#each relays.relays as url (url)}
							{@const active = relays.isActive(url)}
							{@const isPrimary = relays.primaryRelay === url}
							<li
								class="flex items-center gap-2.5 rounded-lg border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-2.5 py-2"
							>
								<span
									class="size-2 shrink-0 rounded-full {active
										? 'bg-emerald-500'
										: 'bg-[var(--ui-text-dimmed)]'}"
								></span>
								<div class="min-w-0 flex-1">
									<div class="flex items-center gap-1">
										<p class="truncate font-mono text-[11.5px] font-medium">
											{url.replace('wss://', '')}
										</p>
										{#if isPrimary}
											<Icon
												name="lucide:star"
												class="size-3 shrink-0 fill-amber-400 text-amber-500"
											/>
										{/if}
									</div>
									<span
										class="text-[10px] font-semibold {active
											? 'text-emerald-600 dark:text-emerald-400'
											: 'text-[var(--ui-text-dimmed)]'}"
									>
										{active ? t('common.active') : t('common.inactive')}
									</span>
								</div>
								<Switch
									checked={active}
									label={active ? t('topbar.deactivateRelay') : t('topbar.activateRelay')}
									onCheckedChange={(v) => relays.setActive(url, v)}
								/>
								<button
									type="button"
									onclick={() => relays.remove(url)}
									class="grid size-7 shrink-0 place-items-center rounded-md text-[var(--ui-text-dimmed)] transition-colors hover:bg-[var(--tone-error-bg)] hover:text-[var(--tone-error-text)]"
									aria-label={t('common.removeRelay')}
									title={t('common.removeRelay')}
								>
									<Icon name="lucide:x" class="size-3.5" />
								</button>
							</li>
						{/each}
					</ul>
				{/if}

				<!-- Sync all data -->
				<button
					type="button"
					onclick={syncAllData}
					disabled={syncState === 'syncing'}
					class="mt-1 flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-3 py-2 text-[12px] font-semibold transition-colors hover:bg-[var(--ui-bg-accented)] disabled:cursor-not-allowed disabled:opacity-60"
				>
					<Icon name={syncIcon} class="size-3.5 {syncIconClass}" />
					<span>{syncFullLabel}</span>
				</button>
				{#if dataSync.lastSyncedAt > 0}
					<p class="px-1 text-center text-[10.5px] text-[var(--ui-text-dimmed)]">
						{t('topbar.lastSynced', { time: relativeTime(dataSync.lastSyncedAt) })}
					</p>
				{/if}

				<!-- View all relays (full page) -->
				<a
					href={resolve('/settings/relays')}
					onclick={() => (relayOpen = false)}
					class="flex w-full items-center justify-center gap-2 rounded-lg bg-primary-500/10 px-3 py-2 text-[12px] font-semibold text-primary-600 transition-colors hover:bg-primary-500/15 dark:text-primary-400"
				>
					<Icon name="lucide:radio" class="size-3.5" />
					{t('topbar.viewAllRelays')}
				</a>
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

				<!-- Language -->
				<div class="px-3.5 pb-3">
					<div class="mb-2 flex items-center gap-2 text-[11px] font-semibold tracking-wider text-[var(--ui-text-dimmed)] uppercase">
						<Icon name="lucide:languages" class="size-3.5" />
						{t('settings.language')}
					</div>
					<LanguageSwitcher />
				</div>

				<!-- Links -->
				<div class="space-y-0.5 border-t border-[var(--ui-border-muted)] px-1.5 py-1.5">
					<a
						href={resolve('/settings')}
						onclick={() => (quickOpen = false)}
						class="flex items-center gap-2.5 rounded-lg px-2 py-2 text-[12.5px] font-medium text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]"
					>
						<Icon name="lucide:settings" class="size-4" />
						{t('topbar.allSettings')}
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
						{t('settings.appearance')}
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
						{t('topbar.aboutBnos')}
						<Icon
							name="lucide:chevron-right"
							class="ml-auto size-3.5 text-[var(--ui-text-dimmed)]"
						/>
					</a>
				</div>
			</div>
		{/snippet}
	</Popover>

	<!-- Account menu (moved from sidebar bottom) -->
	<Popover bind:open={accountOpen} align="end" side="bottom" class="w-64 p-0">
		{#snippet trigger()}
			<div
				class="grid size-9 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-primary-400 to-primary-600 text-[12px] font-bold text-white shadow-sm ring-[var(--surface-bg)] transition-shadow hover:ring-2 hover:ring-primary-500/30"
				title={profile.displayLabel}
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
		{/snippet}
		{#snippet content()}
			<div class="w-64 p-1">
				<!-- Account summary -->
				<div class="mb-2 flex items-center gap-2.5 rounded-lg px-2.5 py-2">
					<div
						class="grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-primary-400 to-primary-600 text-[12px] font-bold text-white shadow-sm"
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
						<div class="truncate text-[13px] font-semibold">{profile.displayLabel}</div>
						<div class="truncate font-mono text-[11px] text-[var(--ui-text-dimmed)]">
							{profile.subtitle}
						</div>
						<div class="mt-1 flex items-center gap-1.5">
							<span class="live-dot"></span>
							<span
								class="text-[10px] font-semibold tracking-wider text-[var(--ui-text-muted)] uppercase"
							>
								{session.loginMethod === 'extension'
									? t('sidebar.nip07Extension')
									: t('sidebar.privateKey')}
							</span>
						</div>
					</div>
				</div>

				<a
					href={resolve('/settings')}
					onclick={() => (accountOpen = false)}
					class="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12.5px] font-medium text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]"
				>
					<Icon name="lucide:sliders-horizontal" class="size-4 text-[var(--ui-text-dimmed)]" />
					{t('common.settings')}
				</a>
				<a
					href={resolve('/profile')}
					onclick={() => (accountOpen = false)}
					class="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12.5px] font-medium text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]"
				>
					<Icon name="lucide:user-circle" class="size-4 text-[var(--ui-text-dimmed)]" />
					{t('common.profile')}
				</a>
				<button
					type="button"
					onclick={signOut}
					class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12.5px] font-medium text-[var(--tone-error-text)] transition-colors hover:bg-[var(--tone-error-bg)]"
				>
					<Icon name="lucide:log-out" class="size-4" />
					{t('common.signOut')}
				</button>
			</div>
		{/snippet}
	</Popover>
</header>
