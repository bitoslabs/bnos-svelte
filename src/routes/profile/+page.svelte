<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import { session } from '$nostr/session.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { relays } from '$nostr/relay.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { truncateNpub } from '$lib/utils/format';

	onMount(() => { session.load(); tenant.load(); relays.load(); });

	async function signOut() {
		session.logout();
		tenant.reset();
		toast.info('Signed out');
		await goto('/login', { replaceState: true });
	}
</script>

<svelte:head><title>bdGo OS · Profile</title></svelte:head>

<div class="mx-auto max-w-2xl space-y-5">
	<div class="surface-card flex flex-col items-center gap-3 p-8 text-center">
		<div class="grid size-20 place-items-center rounded-3xl bg-gradient-to-br from-primary-400 to-primary-600 text-2xl font-bold text-white shadow-lg shadow-primary-500/25">BD</div>
		<div><h1 class="font-display text-xl font-bold tracking-tight">{tenant.state.organizationName || 'bdGo OS'}</h1><p class="font-mono text-[12px] text-[var(--ui-text-muted)]">{truncateNpub(session.npub ?? '', 16, 8)}</p></div>
		<div class="flex items-center gap-2"><Badge color="success"><span class="live-dot"></span> {session.loginMethod === 'extension' ? 'NIP-07' : 'nsec'}</Badge><Badge color="primary">{tenant.state.currency}</Badge></div>
	</div>

	<div class="surface-card divide-y divide-[var(--ui-border-muted)] text-[13px]">
		<div class="flex items-center gap-3 px-4 py-3"><Icon name="lucide:building-2" class="size-4 text-[var(--ui-text-dimmed)]" /><span class="text-[var(--ui-text-muted)]">Organization</span><span class="ml-auto font-semibold">{tenant.state.organizationName || '—'}</span></div>
		<div class="flex items-center gap-3 px-4 py-3"><Icon name="lucide:map-pin" class="size-4 text-[var(--ui-text-dimmed)]" /><span class="text-[var(--ui-text-muted)]">Branch</span><span class="ml-auto font-semibold">{tenant.state.locationName || 'Main'}</span></div>
		<div class="flex items-center gap-3 px-4 py-3"><Icon name="lucide:store" class="size-4 text-[var(--ui-text-dimmed)]" /><span class="text-[var(--ui-text-muted)]">Business</span><span class="ml-auto font-semibold capitalize">{tenant.state.businessType}</span></div>
		<div class="flex items-center gap-3 px-4 py-3"><Icon name="lucide:radio" class="size-4 text-[var(--ui-text-dimmed)]" /><span class="text-[var(--ui-text-muted)]">Relays</span><span class="ml-auto font-semibold">{relays.activeRelays.length} active / {relays.relays.length} configured</span></div>
	</div>

	<div class="grid grid-cols-2 gap-3">
		<Button color="neutral" variant="subtle" icon="lucide:sliders-horizontal" href="/settings">Settings</Button>
		<Button color="error" variant="subtle" icon="lucide:log-out" onclick={signOut}>Sign out</Button>
	</div>
</div>
