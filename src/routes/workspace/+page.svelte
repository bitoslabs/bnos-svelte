<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import { session } from '$nostr/session.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { truncateNpub } from '$lib/utils/format';

	onMount(() => { session.load(); tenant.load(); });
</script>

<svelte:head><title>bdGo OS · Workspace</title></svelte:head>

<div class="mx-auto max-w-2xl space-y-5">
	<div><h1 class="font-display text-xl font-bold tracking-tight">Workspace</h1><p class="text-[12.5px] text-[var(--ui-text-muted)]">The organization this device is operating under</p></div>

	<div class="surface-card accent-bar p-6" style="--accent:var(--ui-color-primary-500);">
		<div class="flex items-start gap-4">
			<div class="grid size-14 shrink-0 place-items-center rounded-2xl bg-primary-500/10 text-lg font-bold text-primary-600 dark:text-primary-400">{(tenant.state.organizationName || 'BD').slice(0, 2).toUpperCase()}</div>
			<div class="min-w-0 flex-1">
				<div class="flex items-center gap-2"><h2 class="font-display text-lg font-bold tracking-tight">{tenant.state.organizationName || 'Unnamed organization'}</h2><Badge color="success">current</Badge></div>
				<div class="mt-0.5 font-mono text-[12px] text-[var(--ui-text-muted)]">{tenant.state.organizationCode || '—'} · {truncateNpub(session.npub ?? '', 12, 6)}</div>
				<div class="mt-2 flex flex-wrap gap-2 text-[11.5px]">
					<span class="inline-flex items-center gap-1 rounded-md bg-[var(--ui-bg-accented)] px-2 py-0.5 capitalize"><Icon name="lucide:store" class="size-3" />{tenant.state.businessType}</span>
					<span class="inline-flex items-center gap-1 rounded-md bg-[var(--ui-bg-accented)] px-2 py-0.5"><Icon name="lucide:map-pin" class="size-3" />{tenant.state.locationName || 'Main'}</span>
					<span class="inline-flex items-center gap-1 rounded-md bg-[var(--ui-bg-accented)] px-2 py-0.5"><Icon name="lucide:coins" class="size-3" />{tenant.state.currency}</span>
				</div>
			</div>
		</div>
	</div>

	<div class="surface-card divide-y divide-[var(--ui-border-muted)] text-[13px]">
		<div class="flex items-center gap-3 px-4 py-3"><Icon name="lucide:fingerprint" class="size-4 text-[var(--ui-text-dimmed)]" /><span class="text-[var(--ui-text-muted)]">Owner identity</span><span class="ml-auto font-mono text-[12px]">{truncateNpub(session.npub ?? '', 14, 8)}</span></div>
		<div class="flex items-center gap-3 px-4 py-3"><Icon name="lucide:network" class="size-4 text-[var(--ui-text-dimmed)]" /><span class="text-[var(--ui-text-muted)]">Business model</span><span class="ml-auto font-semibold capitalize">{tenant.state.businessModel.replace(/_/g, ' ')}</span></div>
		<div class="flex items-center gap-3 px-4 py-3"><Icon name="lucide:percent" class="size-4 text-[var(--ui-text-dimmed)]" /><span class="text-[var(--ui-text-muted)]">Tax</span><span class="ml-auto font-semibold">{tenant.state.defaultTaxRate}% {tenant.state.taxIncludedInPrice ? 'incl.' : 'excl.'}</span></div>
	</div>

	<div class="flex flex-wrap gap-2">
		<Button color="neutral" variant="subtle" icon="lucide:sliders-horizontal" onclick={() => goto('/settings')}>Workspace settings</Button>
		<Button color="neutral" variant="subtle" icon="lucide:plus" onclick={() => goto('/setup')}>Reconfigure</Button>
	</div>
</div>
