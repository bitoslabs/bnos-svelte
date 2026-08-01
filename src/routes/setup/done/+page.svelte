<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { glo } from '$nostr/store.svelte';

	// Kick off a background sync of seeded data once relays are reachable.
	onMount(() => {
		void glo.syncAll(['organization', 'catalog.product', 'crm.customer', 'commerce.order']);
	});
</script>

<svelte:head><title>Setup · Done</title></svelte:head>

<div class="flex flex-col items-center justify-center py-8 text-center">
	<div
		class="mb-6 grid size-20 place-items-center rounded-3xl bg-gradient-to-br from-primary-400 to-primary-600 shadow-xl shadow-primary-500/30"
	>
		<Icon name="lucide:party-popper" class="size-10 text-white" />
	</div>
	<h2 class="font-display text-2xl font-bold tracking-tight">You're all set!</h2>
	<p class="mt-2 max-w-sm text-[13.5px] text-[var(--ui-text-muted)]">
		<strong>{tenant.state.organizationName}</strong> is live on Nostr. Start a sale, build your catalog,
		and track every order — all signed by your key.
	</p>

	<div class="mt-8 flex flex-col gap-2 sm:flex-row">
		<Button
			color="primary"
			size="lg"
			icon="lucide:layout-dashboard"
			onclick={() => goto(resolve('/'), { replaceState: true })}
		>
			Enter BNOS
		</Button>
		<Button
			color="neutral"
			variant="subtle"
			size="lg"
			icon="lucide:scan-line"
			onclick={() => goto(resolve('/pos'), { replaceState: true })}
		>
			Go to POS
		</Button>
	</div>
</div>
