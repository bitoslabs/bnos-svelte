<script lang="ts">
	import { goto } from '$app/navigation';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { session } from '$nostr/session.svelte';
	import { tenant, makeOrganizationObject } from '$nostr/tenant.svelte';
	import { relays } from '$nostr/relay.svelte';
	import { glo } from '$nostr/store.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { truncateNpub, titleCase } from '$lib/utils/format';

	let creating = $state(false);

	const orgId = $derived(tenant.state.organizationId || 'org-' + (session.pubkey?.slice(0, 8) ?? 'seed'));
	const productCount = $derived(glo.all('catalog.product').length);

	const rows = $derived([
		{ label: 'Nostr identity', value: truncateNpub(session.npub ?? '', 14, 8), icon: 'lucide:fingerprint' },
		{ label: 'Company', value: tenant.state.organizationName || '—', icon: 'lucide:building-2' },
		{ label: 'Company code', value: tenant.state.organizationCode || '—', icon: 'lucide:hash' },
		{ label: 'Business model', value: titleCase(tenant.state.businessModel.replace(/_/g, ' ')), icon: 'lucide:network' },
		{ label: 'Business type', value: titleCase(tenant.state.businessType), icon: 'lucide:store' },
		{ label: 'Branch', value: tenant.state.locationName || '—', icon: 'lucide:map-pin' },
		{ label: 'Currency', value: tenant.state.currency, icon: 'lucide:coins' },
		{ label: 'Tax', value: `${tenant.state.defaultTaxRate}%${tenant.state.taxIncludedInPrice ? ' (incl.)' : ''}`, icon: 'lucide:percent' },
		{ label: 'Relays', value: `${relays.activeRelays.length} active / ${relays.relays.length} configured`, icon: 'lucide:radio' },
		{ label: 'Catalog', value: `${productCount} product${productCount === 1 ? '' : 's'}`, icon: 'lucide:package' }
	]);

	async function create() {
		if (!tenant.state.organizationName.trim()) {
			toast.warning('Company name required', 'Go back to the Company step.');
			return;
		}
		creating = true;
		try {
			// Persist the organization as a GLO object on Nostr kind 30078.
			const org = makeOrganizationObject({
				id: orgId,
				name: tenant.state.organizationName,
				currency: tenant.state.currency,
				code: tenant.state.organizationCode || tenant.state.organizationName.slice(0, 3).toUpperCase(),
				status: 'active'
			});
			await glo.upsert('organization', org.data, { id: org.id });
			tenant.configure({ organizationId: orgId });
			tenant.completeSetup();
			await goto('/setup/done');
		} catch (e) {
			toast.error('Could not create workspace', e instanceof Error ? e.message : undefined);
		} finally {
			creating = false;
		}
	}
</script>

<svelte:head><title>Setup · Review</title></svelte:head>

<div class="space-y-5">
	<div>
		<h2 class="font-display text-xl font-bold tracking-tight">Review & create</h2>
		<p class="mt-1 text-[13.5px] text-[var(--ui-text-muted)]">
			Confirm the details below. We'll publish your organization to Nostr and open the dashboard.
		</p>
	</div>

	<dl class="divide-y divide-[var(--ui-border-muted)] overflow-hidden rounded-xl border border-[var(--ui-border)]">
		{#each rows as row (row.label)}
			<div class="flex items-center gap-3 px-4 py-3">
				<div class="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)]">
					<Icon name={row.icon} class="size-4" />
				</div>
				<dt class="text-[12.5px] text-[var(--ui-text-muted)]">{row.label}</dt>
				<dd class="ml-auto truncate text-[13px] font-semibold">{row.value}</dd>
			</div>
		{/each}
	</dl>

	<Button color="primary" block size="lg" disabled={creating} onclick={create}>
		{#if creating}
			<Icon name="lucide:loader-circle" class="size-4 animate-spin" /> Creating…
		{:else}
			<Icon name="lucide:rocket" class="size-4" /> Create workspace
		{/if}
	</Button>
</div>
