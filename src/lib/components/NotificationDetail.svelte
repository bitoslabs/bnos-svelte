<script lang="ts">
	import { t } from '$lib/i18n/i18n.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Icon from './ui/Icon.svelte';
	import Button from './ui/Button.svelte';
	import Badge from './ui/Badge.svelte';
	import NoteContent from './NoteContent.svelte';
	import {
		notifications,
		type AppNotification,
		type NotificationTone
	} from '$lib/stores/notifications.svelte';
	import { categoryMeta } from '$nostr/owner-feed.svelte';
	import { relativeTime } from '$lib/utils/format';

	let {
		notification,
		onremove
	}: {
		notification: AppNotification;
		/** Called after the item is removed so a host (stack/page) can dismiss itself. */
		onremove?: () => void;
	} = $props();

	const meta = $derived(notification.category ? categoryMeta(notification.category) : null);
	const tags = $derived(notification.tags ?? []);

	const tone: Record<NotificationTone, string> = {
		info: 'tone-info',
		success: 'tone-success',
		warning: 'tone-warning',
		error: 'tone-error'
	};
	const toneText: Record<NotificationTone, string> = {
		info: 'tone-text-info',
		success: 'tone-text-success',
		warning: 'tone-text-warning',
		error: 'tone-text-error'
	};

	function openLink() {
		if (!notification.href) return;
		void goto(resolve(notification.href as '/'));
	}

	function remove() {
		notifications.remove(notification.id);
		onremove?.();
	}
</script>

<header class="flex items-start gap-3.5 px-5 py-4">
	<div class="grid size-11 shrink-0 place-items-center rounded-xl {tone[notification.tone]}">
		<Icon name={notification.icon} class="size-5 {toneText[notification.tone]}" />
	</div>
	<div class="min-w-0 flex-1">
		<h2 class="font-display text-[16px] leading-snug font-semibold text-(--ui-text)">
			{notification.title}
		</h2>
		<div class="mt-1.5 flex flex-wrap items-center gap-1.5">
			{#if meta}
				<Badge color={meta.tone}>
					<Icon name={meta.icon} class="size-3" />
					{t(meta.labelKey)}
				</Badge>
			{/if}
			<span
				class="text-[11px] text-(--ui-text-dimmed)"
				title={new Date(notification.at).toLocaleString()}
			>
				{relativeTime(notification.at)}
			</span>
		</div>
	</div>
</header>

<div class="px-5 pb-4">
	{#if notification.description}
		<NoteContent content={notification.description} />
	{/if}

	{#if tags.length || notification.sourceId}
		<dl class="mt-5 space-y-3">
			{#if tags.length}
				<div class="flex flex-wrap items-center gap-1.5">
					<dt class="mr-1 text-[11px] font-semibold text-(--ui-text-dimmed)">
						{t('notifications.tagsLabel')}
					</dt>
					{#each tags as tag (tag)}
						<Badge variant="outline">#{tag}</Badge>
					{/each}
				</div>
			{/if}
			{#if notification.sourceId}
				<div class="flex flex-wrap items-center gap-1.5">
					<dt class="mr-1 text-[11px] font-semibold text-(--ui-text-dimmed)">
						{t('notifications.sourceLabel')}
					</dt>
					<dd class="truncate font-mono text-[11px] text-(--ui-text-muted)">
						{notification.sourceId}
					</dd>
				</div>
			{/if}
		</dl>
	{/if}
</div>

<footer class="flex flex-wrap items-center gap-2 border-t border-(--ui-border-muted) px-5 py-3">
	{#if notification.href}
		<Button color="primary" variant="soft" size="sm" icon="lucide:external-link" onclick={openLink}>
			{t('common.open')}
		</Button>
	{/if}
	<Button
		color="neutral"
		variant="ghost"
		size="sm"
		icon={notification.read ? 'lucide:mail' : 'lucide:check'}
		onclick={() =>
			notification.read
				? notifications.markUnread(notification.id)
				: notifications.markRead(notification.id)}
	>
		{notification.read ? t('notifications.markUnread') : t('topbar.markAsRead')}
	</Button>
	<Button
		class="ml-auto"
		color="error"
		variant="ghost"
		size="sm"
		icon="lucide:trash-2"
		onclick={remove}
	>
		{t('common.remove')}
	</Button>
</footer>
