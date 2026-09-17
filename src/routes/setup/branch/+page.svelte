<script lang="ts">
	import { onMount } from 'svelte';
	import { t } from '$lib/i18n/i18n.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import { tenant } from '$nostr/tenant.svelte';

	let branchName = $state('Main Branch');

	onMount(() => {
		branchName = tenant.state.locationName || 'Main Branch';
	});

	$effect(() => {
		const id = tenant.state.locationId || 'loc-main';
		tenant.configure({ locationId: id, locationName: branchName });
	});
</script>

<svelte:head><title>{t('setup.title')} · {t('setup.branch')}</title></svelte:head>

<div class="space-y-5">
	<div>
		<h2 class="font-display text-xl font-bold tracking-tight">Primary location</h2>
		<p class="mt-1 text-[13.5px] text-[var(--ui-text-muted)]">
			Records are scoped to a branch (GLO <code>location</code>, kind 30600). Add more branches later.
		</p>
	</div>

	<label class="block">
		<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Branch name</span>
		<Input bind:value={branchName} icon="lucide:map-pin" placeholder="e.g. Downtown · Flagship" />
	</label>
</div>
