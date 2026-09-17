<script lang="ts">
	import { t } from '$lib/i18n/i18n.svelte';
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import { notifications, type AppNotification } from '$lib/stores/notifications.svelte';
	import { relativeTime } from '$lib/utils/format';

	const items = $derived(notifications.items);
	const unread = $derived(notifications.unread);

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

	/** Demo seed — mirrors what a real order event will push. */
	function seed() {
		notifications.push({
			title: `${t('common.new')} ${t('common.order')}`,
			description: 'Order #ORD-1024 received',
			icon: 'lucide:receipt-text',
			tone: 'success',
			href: '/orders'
		});
	}
</script>

<svelte:head><title>{t('common.appName')} · {t('notifications.title')}</title></svelte:head>

<div class="space-y-4">
	<PageHeader
		title={t('notifications.title')}
		description="{items.length} {t('topbar.onThisDevice')}{unread ? ` · ${unread} ${t('topbar.unreadTab').toLowerCase()}` : ''}"
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
				icon="lucide:bell-plus"
				onclick={seed}
			>
				Seed
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
		<div class="surface-card divide-y divide-[var(--ui-border-muted)]">
			{#each items as n (n.id)}
				<div class="group flex items-start gap-3 px-4 py-3.5 {n.read ? '' : 'bg-primary-500/[0.05]'}">
					<div class="grid size-9 shrink-0 place-items-center rounded-lg {tone[n.tone]}">
						<Icon name={n.icon} class="size-4 {toneText[n.tone]}" />
					</div>
					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-1.5">
							{#if !n.read}
								<span class="size-1.5 shrink-0 rounded-full bg-primary-500"></span>
							{/if}
							<div class="text-[13px] font-semibold">{n.title}</div>
						</div>
						{#if n.description}
							<div class="text-[12px] text-[var(--ui-text-muted)]">{n.description}</div>
						{/if}
					</div>
					<span class="shrink-0 text-[11px] text-[var(--ui-text-dimmed)]">
						{relativeTime(n.at)}
					</span>
					<button
						type="button"
						onclick={() => (n.read ? notifications.remove(n.id) : notifications.markRead(n.id))}
						class="grid size-7 shrink-0 place-items-center rounded-md text-[var(--ui-text-dimmed)] opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]"
						aria-label={n.read ? t('topbar.removeNotification') : t('topbar.markAsRead')}
						title={n.read ? t('topbar.removeNotification') : t('topbar.markAsRead')}
					>
						<Icon name={n.read ? 'lucide:x' : 'lucide:check'} class="size-3.5" />
					</button>
				</div>
			{/each}
		</div>
	{/if}
</div>
