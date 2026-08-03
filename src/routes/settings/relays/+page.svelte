<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import RelayManager from '$lib/components/relay/RelayManager.svelte';
	import { relays } from '$nostr/relay.svelte';

	onMount(() => relays.load());
</script>

<svelte:head><title>Relays · Settings</title></svelte:head>

<div class="space-y-4">
	<!-- Header -->
	<div class="flex items-center gap-3">
		<div class="grid size-10 place-items-center rounded-xl bg-primary-500/10 text-primary-600 dark:text-primary-400">
			<Icon name="lucide:radio" class="size-5" />
		</div>
		<div class="flex-1">
			<h2 class="font-display text-[16px] font-semibold tracking-tight">Relays</h2>
			<p class="text-[12px] text-[var(--ui-text-muted)]">
				{relays.relays.length} configured · {relays.readableRelays.length} read · {relays.writableRelays.length} write
				· {relays.online ? 'online' : 'offline'}
			</p>
		</div>
	</div>

	<RelayManager variant="full" />
</div>
