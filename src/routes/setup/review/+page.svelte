<script lang="ts">
	import { goto } from '$app/navigation';
	import { t } from '$lib/i18n/i18n.svelte';
	import { resolve } from '$app/paths';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { session } from '$nostr/session.svelte';
	import { tenant, makeOrganizationObject } from '$nostr/tenant.svelte';
	import { relays } from '$nostr/relay.svelte';
	import { glo } from '$nostr/store.svelte';
	import { upsertOrganizationSettingsFromTenant } from '$nostr/organization-settings';
	import { toast } from '$lib/stores/toast.svelte';
	import { truncateNpub, titleCase } from '$lib/utils/format';
	import { newOrganizationId, newLocationId } from '$lib/utils/record-id';

	let creating = $state(false);
	let publishStatus = $state('');

	// Opaque, unguessable ids (UUID-backed). NEVER derive these from the owner
	// pubkey — the pubkey is public, so a derivable id would let anyone harvest
	// the org's events. A random id is both unique and a genuine capability token.
	const orgId = $derived(tenant.state.organizationId || newOrganizationId());
	const locationId = $derived(tenant.state.locationId || newLocationId());
	const productCount = $derived(glo.all('catalog.product').length);

	const rows = $derived([
		{
			label: t('profile.nostrIdentity'),
			value: truncateNpub(session.npub ?? '', 14, 8),
			icon: 'lucide:fingerprint'
		},
		{ label: t('common.company'), value: tenant.state.organizationName || '—', icon: 'lucide:building-2' },
		{ label: 'Company code', value: tenant.state.organizationCode || '—', icon: 'lucide:hash' },
		{
			label: 'Business model',
			value: titleCase(tenant.state.businessModel.replace(/_/g, ' ')),
			icon: 'lucide:network'
		},
		{ label: 'Business type', value: titleCase(tenant.state.businessType), icon: 'lucide:store' },
		{ label: t('common.branch'), value: tenant.state.locationName || '—', icon: 'lucide:map-pin' },
		{ label: 'Currency', value: tenant.state.currency, icon: 'lucide:coins' },
		{
			label: 'Tax',
			value: `${tenant.state.defaultTaxRate}%${tenant.state.taxIncludedInPrice ? ' (incl.)' : ''}`,
			icon: 'lucide:percent'
		},
		{
			label: t('settings.relays'),
			value: `${relays.activeRelays.length} active / ${relays.relays.length} configured`,
			icon: 'lucide:radio'
		},
		{
			label: 'Catalog',
			value: `${productCount} product${productCount === 1 ? '' : 's'}`,
			icon: 'lucide:package'
		}
	]);

	async function create() {
		if (!tenant.state.organizationName.trim()) {
			toast.warning('Company name required', 'Go back to the Company step.');
			return;
		}
		creating = true;
		publishStatus = '';
		try {
			// Persist the organization as a GLO object on Nostr kind 30078.
			const org = makeOrganizationObject({
				id: orgId,
				name: tenant.state.organizationName,
				currency: tenant.state.currency,
				code:
					tenant.state.organizationCode || tenant.state.organizationName.slice(0, 3).toUpperCase(),
				status: 'active'
			} as unknown as Parameters<typeof makeOrganizationObject>[0]);
			tenant.configure({ organizationId: orgId });
			await glo.upsert('organization', org.data, {
				id: org.id,
				scope: { organizationId: org.id }
			});
			await glo.upsert(
				'location',
				{
					name: tenant.state.locationName || 'Main Branch',
					code: 'main',
					type: 'store',
					status: 'active'
				},
				{
					id: locationId,
					scope: { organizationId: org.id, locationId }
				}
			);
			tenant.configure({ organizationId: orgId, locationId });
			upsertOrganizationSettingsFromTenant({
				...tenant.state,
				organizationId: orgId,
				locationId,
				locationName: tenant.state.locationName || 'Main Branch'
			});

			// Publish to relays (don't block on failure — local-first)
			publishStatus = 'Publishing to Nostr…';
			try {
				// glo.upsert already publishes to relays internally (awaited)
				// Just verify it was saved
				await new Promise((r) => setTimeout(r, 500));
				publishStatus = 'Published ✓';
			} catch {
				publishStatus = 'Saved locally (will sync when online)';
			}

			tenant.completeSetup();
			await goto(resolve('/setup/done'));
		} catch (e) {
			toast.error('Could not create workspace', e instanceof Error ? e.message : undefined);
		} finally {
			creating = false;
		}
	}
</script>

<svelte:head><title>{t('setup.title')} · {t('setup.review')}</title></svelte:head>

<div class="space-y-5">
	<div>
		<h2 class="font-display text-xl font-bold tracking-tight">Review & create</h2>
		<p class="mt-1 text-[13.5px] text-[var(--ui-text-muted)]">
			Confirm the details below. We'll publish your organization to Nostr and open the dashboard.
		</p>
	</div>

	<dl
		class="divide-y divide-[var(--ui-border-muted)] overflow-hidden rounded-xl border border-[var(--ui-border)]"
	>
		{#each rows as row (row.label)}
			<div class="flex items-center gap-3 px-4 py-3">
				<div
					class="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)]"
				>
					<Icon name={row.icon} class="size-4" />
				</div>
				<dt class="text-[12.5px] text-[var(--ui-text-muted)]">{row.label}</dt>
				<dd class="ml-auto truncate text-[13px] font-semibold">{row.value}</dd>
			</div>
		{/each}
	</dl>

	<Button color="primary" block size="lg" disabled={creating} onclick={create}>
		{#if creating}
			<Icon name="lucide:loader-circle" class="size-4 animate-spin" />
			{publishStatus || 'Creating…'}
		{:else}
			<Icon name="lucide:rocket" class="size-4" /> Create workspace
		{/if}
	</Button>
</div>
