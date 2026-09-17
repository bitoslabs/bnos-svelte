<script lang="ts">
	import { onMount } from 'svelte';
	import { t } from '$lib/i18n/i18n.svelte';
	import RelayManager from '$lib/components/relay/RelayManager.svelte';
	import { relays } from '$nostr/relay.svelte';

	onMount(() => relays.load());
</script>

<svelte:head><title>{t('setup.title')} · {t('setup.relays')}</title></svelte:head>

<div class="space-y-5">
	<!-- Header -->
	<div>
		<h2 class="font-display text-xl font-bold tracking-tight">Nostr relays</h2>
		<p class="mt-1 text-[13.5px] text-[var(--ui-text-muted)]">
			Relays carry your signed records between devices. Set which relays can read sync data and which can receive writes.
		</p>
	</div>

	<RelayManager variant="full" />
</div>
