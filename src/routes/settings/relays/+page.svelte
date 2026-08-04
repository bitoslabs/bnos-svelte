<script lang="ts">
	import { onMount } from 'svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import RelayManager from '$lib/components/relay/RelayManager.svelte';
	import { relays } from '$nostr/relay.svelte';

	onMount(() => relays.load());

	const relaySummary = $derived(
		`${relays.relays.length} configured · ${relays.readableRelays.length} read · ${relays.writableRelays.length} write · ${relays.online ? 'online' : 'offline'}`
	);
</script>

<svelte:head><title>Relays · Settings</title></svelte:head>

<div class="space-y-4">
	<PageHeader icon="lucide:radio" title="Relays" description={relaySummary} />

	<RelayManager variant="full" />
</div>
