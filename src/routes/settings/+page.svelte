<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { session } from '$nostr/session.svelte';
	import { preferences } from '$lib/theme/preferences.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { truncateNpub, titleCase } from '$lib/utils/format';
	import { businessModels, businessTypes, currencies } from '$lib/business';

	onMount(() => preferences.load());

	function saveOrg() { tenant.persist(); toast.success('Organization saved'); }
</script>

<svelte:head><title>bdGo OS · Settings · Organization</title></svelte:head>

<div class="space-y-5">
	<!-- Organization -->
	<section class="surface-card p-5">
		<div class="mb-4 flex items-center gap-3">
			<Icon name="lucide:building-2" class="size-5 text-primary-500" />
			<div><h2 class="font-display text-[15px] font-semibold tracking-tight">Organization</h2><p class="text-[12px] text-[var(--ui-text-muted)]">GLO <code>organization</code> · kind 30078</p></div>
		</div>
		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
			<label class="block"><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Name</span><Input bind:value={tenant.state.organizationName} icon="lucide:building-2" class="w-full" /></label>
			<label class="block"><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Code</span><Input bind:value={tenant.state.organizationCode} icon="lucide:hash" class="w-full" /></label>
			<label class="block"><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Branch</span><Input bind:value={tenant.state.locationName} icon="lucide:map-pin" class="w-full" /></label>
			<label class="block"><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Currency</span><Select bind:value={tenant.state.currency} options={currencies} class="w-full" /></label>
			<label class="block"><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Business model</span><Select bind:value={tenant.state.businessModel} options={businessModels.map((m) => ({ value: m.value, label: m.label }))} class="w-full capitalize" /></label>
			<label class="block"><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Business type</span><Select bind:value={tenant.state.businessType} options={businessTypes.map((t) => ({ value: t.value, label: t.label }))} class="w-full capitalize" /></label>
		</div>
		<div class="mt-3 flex items-center gap-2 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-4 py-2.5 text-[12.5px]">
			<Icon name="lucide:info" class="size-4 text-[var(--ui-text-dimmed)]" />
			{titleCase(tenant.state.businessModel.replace(/_/g, ' '))} · {titleCase(tenant.state.businessType)} {#if tenant.restaurantEnabled}<span class="text-primary-600 dark:text-primary-400">· Restaurant module on</span>{/if}
		</div>
		<div class="mt-4 flex justify-end"><Button color="primary" icon="lucide:save" onclick={saveOrg}>Save</Button></div>
	</section>

	<!-- Identity -->
	<section class="surface-card p-5">
		<div class="mb-4 flex items-center gap-3">
			<Icon name="lucide:fingerprint" class="size-5 text-primary-500" />
			<div><h2 class="font-display text-[15px] font-semibold tracking-tight">Nostr identity</h2><p class="text-[12px] text-[var(--ui-text-muted)]">The key that signs every record</p></div>
		</div>
		<div class="flex items-center justify-between gap-3 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-4 py-3">
			<div class="min-w-0"><div class="truncate font-mono text-[13px] font-semibold">{truncateNpub(session.npub ?? '', 18, 10)}</div><div class="text-[11.5px] text-[var(--ui-text-dimmed)]">{session.loginMethod === 'extension' ? 'NIP-07 extension' : 'Private key'}</div></div>
			<Badge color="success"><span class="live-dot"></span> active</Badge>
		</div>
	</section>
</div>
