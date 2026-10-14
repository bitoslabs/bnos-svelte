<script lang="ts">
	import { t } from '$lib/i18n/i18n.svelte';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Button from '$lib/components/ui/Button.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import NotificationDetail from '$lib/components/NotificationDetail.svelte';
	import { notifications } from '$lib/stores/notifications.svelte';

	const id = $derived(Number(page.params.id));
	const item = $derived(notifications.items.find((n) => n.id === id) ?? null);

	onMount(() => {
		notifications.load();
		const found = notifications.items.find((n) => n.id === id);
		if (found && !found.read) notifications.markRead(found.id);
	});

	function back() {
		void goto(resolve('/notifications'));
	}
</script>

<svelte:head
	><title>{item ? item.title : t('notifications.title')} · {t('common.appName')}</title
	></svelte:head
>

<div class="mx-auto w-full max-w-2xl space-y-4">
	<Button color="neutral" variant="ghost" size="sm" icon="lucide:arrow-left" onclick={back}>
		{t('notifications.backToList')}
	</Button>

	{#if !item}
		<EmptyState
			icon="lucide:bell-off"
			title={t('notifications.notFoundTitle')}
			description={t('notifications.notFoundDesc')}
		>
			{#snippet actions()}
				<Button color="primary" variant="soft" size="sm" icon="lucide:list" onclick={back}>
					{t('notifications.backToList')}
				</Button>
			{/snippet}
		</EmptyState>
	{:else}
		{@const n = item}
		<article class="surface-card overflow-hidden">
			<NotificationDetail notification={n} onremove={back} />
		</article>
	{/if}
</div>
