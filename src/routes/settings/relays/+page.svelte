<script lang="ts">
	import { onMount } from 'svelte';
	import { t } from '$lib/i18n/i18n.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import RelayManager from '$lib/components/relay/RelayManager.svelte';
	import RelayDirectory from '$lib/components/relay/RelayDirectory.svelte';
	import { relays } from '$nostr/relay.svelte';

	onMount(() => relays.load());

	const relaySummary = $derived(
		`${relays.relays.length} configured · ${relays.readableRelays.length} read · ${relays.writableRelays.length} write · ${relays.online ? 'online' : 'offline'}`
	);
</script>

<svelte:head><title>{t('settings.relays')} · {t('common.settings')}</title></svelte:head>

<div class="space-y-4">
	<PageHeader icon="lucide:radio" title={t('settings.relays')} description={relaySummary} />

	<RelayManager variant="full" />

	<RelayDirectory autoTest />
</div>
