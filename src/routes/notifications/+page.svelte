<script lang="ts">
	import { t } from '$lib/i18n/i18n.svelte';
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import NotificationDetail from '$lib/components/NotificationDetail.svelte';
	import { notifications, type AppNotification } from '$lib/stores/notifications.svelte';
	import { categoryMeta } from '$nostr/owner-feed.svelte';
	import { summarizeNote } from '$lib/utils/note-markdown';
	import { relativeTime } from '$lib/utils/format';

	const items = $derived(notifications.items);
	const unread = $derived(notifications.unread);

	// Stacked detail: selecting a row pushes a panel over the list; the list keeps
	// its scroll position, so closing the panel returns exactly where you were.
	let selectedId = $state<number | null>(null);
	const selected = $derived(notifications.items.find((n) => n.id === selectedId) ?? null);

	onMount(() => notifications.load());

	const tone: Record<AppNotification['tone'], string> = {
		info: 'tone-info',
		success: 'tone-success',
		warning: 'tone-warning',
		error: 'tone-error'
	};
	const toneText: Record<AppNotification['tone'], string> = {
		info: 'tone-text-info',
		success: 'tone-text-success',
		warning: 'tone-text-warning',
		error: 'tone-text-error'
	};

	function openDetail(n: AppNotification) {
		notifications.markRead(n.id);
		selectedId = n.id;
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape' && selectedId !== null) selectedId = null;
	}
</script>

<svelte:window onkeydown={onKey} />

<svelte:head><title>{t('common.appName')} · {t('notifications.title')}</title></svelte:head>

<div class="space-y-4">
	<PageHeader
		icon="lucide:bell"
		title={t('notifications.title')}
		description="{items.length} {t('topbar.onThisDevice')}{unread
			? ` · ${unread} ${t('topbar.unreadTab').toLowerCase()}`
			: ''}"
	>
		{#snippet actions()}
			<Button
				color="primary"
				variant="soft"
				size="sm"
				icon="lucide:check-check"
				onclick={() => notifications.markAllRead()}
				disabled={!unread}
			>
				{t('topbar.markAllRead')}
			</Button>
			<Button
				color="neutral"
				variant="ghost"
				size="sm"
				icon="lucide:trash-2"
				onclick={() => notifications.clear()}
				disabled={!items.length}
			>
				{t('common.clear')}
			</Button>
		{/snippet}
	</PageHeader>

	{#if items.length === 0}
		<EmptyState
			icon="lucide:bell"
			title={t('topbar.youAreAllCaughtUp')}
			description={t('topbar.caughtUpDesc')}
		/>
	{:else}
		<ul class="surface-card divide-y divide-(--ui-border-muted)">
			{#each items as n (n.id)}
				{@const meta = n.category ? categoryMeta(n.category) : null}
				{@const summary = n.description ? summarizeNote(n.description) : null}
				<li
					class="group flex items-stretch gap-1 {n.read ? '' : 'bg-primary-500/[0.05]'}"
					aria-current={selectedId === n.id ? 'true' : undefined}
				>
					<button
						type="button"
						onclick={() => openDetail(n)}
						class="flex min-w-0 flex-1 items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-(--ui-bg-accented)"
						title={t('common.view')}
					>
						<span class="grid size-9 shrink-0 place-items-center rounded-lg {tone[n.tone]}">
							<Icon name={n.icon} class="size-4 {toneText[n.tone]}" />
						</span>
						<span class="min-w-0 flex-1">
							<span class="flex min-w-0 items-center gap-1.5">
								{#if !n.read}
									<span class="size-1.5 shrink-0 rounded-full bg-primary-500"></span>
								{/if}
								<span class="min-w-0 truncate text-[13px] font-semibold">{n.title}</span>
								{#if meta}
									<Badge color={meta.tone} class="shrink-0">{t(meta.labelKey)}</Badge>
								{/if}
							</span>
							{#if summary?.media.length}
								<span class="mt-1.5 flex flex-wrap items-center gap-1">
									{#each summary.media.slice(0, 4) as m, k (m.url + k)}
										{#if m.kind === 'video'}
											<span
												class="grid size-10 shrink-0 place-items-center rounded-md border border-(--ui-border) bg-black/70"
											>
												<Icon name="lucide:play" class="size-3.5 text-white" />
											</span>
										{:else}
											<img
												src={m.url}
												alt=""
												loading="lazy"
												decoding="async"
												referrerpolicy="no-referrer"
												class="size-10 shrink-0 rounded-md border border-(--ui-border) object-cover"
											/>
										{/if}
									{/each}
									{#if summary.media.length > 4}
										<span
											class="grid size-10 shrink-0 place-items-center rounded-md border border-(--ui-border) bg-(--ui-bg-muted) text-[11px] font-medium text-(--ui-text-dimmed)"
											>+{summary.media.length - 4}</span
										>
									{/if}
								</span>
							{/if}
							{#if summary?.text}
								<span class="mt-0.5 line-clamp-2 text-[12px] text-(--ui-text-muted)"
									>{summary.text}</span
								>
							{:else if summary?.media.length}
								<span class="mt-0.5 text-[12px] text-(--ui-text-muted)"
									>{t('notifications.mediaCount', { n: summary.media.length })}</span
								>
							{/if}
							<span class="mt-1 block text-[11px] text-(--ui-text-dimmed)"
								>{relativeTime(n.at)}</span
							>
						</span>
						<Icon
							name="lucide:chevron-right"
							class="mt-2 size-4 shrink-0 text-(--ui-text-dimmed) opacity-0 transition-opacity group-hover:opacity-100"
						/>
					</button>
					<div class="flex shrink-0 items-start gap-0.5 pt-3 pr-2">
						<button
							type="button"
							onclick={() =>
								n.read ? notifications.markUnread(n.id) : notifications.markRead(n.id)}
							class="grid size-8 place-items-center rounded-lg text-(--ui-text-dimmed) transition-colors hover:bg-(--ui-bg-accented) hover:text-(--ui-text)"
							aria-label={n.read ? t('notifications.markUnread') : t('topbar.markAsRead')}
							title={n.read ? t('notifications.markUnread') : t('topbar.markAsRead')}
						>
							<Icon name={n.read ? 'lucide:mail' : 'lucide:check'} class="size-4" />
						</button>
						<button
							type="button"
							onclick={() => notifications.remove(n.id)}
							class="grid size-8 place-items-center rounded-lg text-(--ui-text-dimmed) transition-colors hover:bg-(--tone-error-bg) hover:text-(--tone-error-text)"
							aria-label={t('topbar.removeNotification')}
							title={t('topbar.removeNotification')}
						>
							<Icon name="lucide:x" class="size-4" />
						</button>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<!-- Detail modal -->
{#if selected}
	{@const n = selected}
	<button
		type="button"
		tabindex="-1"
		aria-label={t('common.close')}
		class="animate-fade fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]"
		onclick={() => (selectedId = null)}
	></button>
	<div class="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4">
		<div
			class="animate-fade pointer-events-auto relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-(--ui-border) bg-(--ui-bg-elevated) shadow-2xl shadow-black/30"
			role="dialog"
			aria-modal="true"
			aria-label={n.title}
		>
			<div
				class="flex shrink-0 items-center justify-end border-b border-(--ui-border-muted) px-3 py-2"
			>
				<button
					type="button"
					onclick={() => (selectedId = null)}
					class="grid size-9 place-items-center rounded-lg text-(--ui-text-muted) transition-colors hover:bg-(--ui-bg-accented) hover:text-(--ui-text)"
					aria-label={t('common.close')}
					title={t('common.close')}
				>
					<Icon name="lucide:x" class="size-4.5" />
				</button>
			</div>
			<div class="min-h-0 flex-1 overflow-y-auto">
				<NotificationDetail notification={n} onremove={() => (selectedId = null)} />
			</div>
		</div>
	</div>
{/if}
