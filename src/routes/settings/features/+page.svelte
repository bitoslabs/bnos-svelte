<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Switch from '$lib/components/ui/Switch.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { browser } from '$app/environment';

	const KEY = 'bnos-os:features';

	type FeatureKey = 'restaurant' | 'retail' | 'loyalty' | 'crm' | 'multiBranch' | 'marketplace' | 'ai';

	let features = $state<Record<FeatureKey, boolean>>({
		restaurant: false,
		retail: true,
		loyalty: false,
		crm: false,
		multiBranch: false,
		marketplace: false,
		ai: false
	});

	onMount(() => {
		if (!browser) return;
		try {
			const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
			features = { ...features, ...saved };
			if (tenant.state.businessType === 'restaurant') features.restaurant = true;
		} catch { /* */ }
	});

	function toggle(k: FeatureKey) {
		features[k] = !features[k];
		if (browser) localStorage.setItem(KEY, JSON.stringify(features));
		toast.success(`${features[k] ? 'Enabled' : 'Disabled'} ${k}`);
	}

	const featureList: { key: FeatureKey; icon: string; label: string; description: string; hint?: string }[] = [
		{ key: 'restaurant', icon: 'lucide:chef-hat', label: 'Restaurant', description: 'Kitchen display, tables, waiter station, queue' },
		{ key: 'retail', icon: 'lucide:shop', label: 'Retail', description: 'Barcode, inventory, stock adjustments' },
		{ key: 'loyalty', icon: 'lucide:star', label: 'Loyalty points', description: 'Earn and redeem points at checkout' },
		{ key: 'crm', icon: 'lucide:users', label: 'CRM', description: 'Customer segments, history, outreach' },
		{ key: 'multiBranch', icon: 'lucide:map-pin', label: 'Multi-branch', description: 'Manage multiple locations and transfers' },
		{ key: 'marketplace', icon: 'lucide:globe', label: 'Marketplace', description: 'Sell on external marketplaces' },
		{ key: 'ai', icon: 'lucide:sparkles', label: 'AI assistant', description: 'Forecasting, restock suggestions, insights' }
	];
</script>

<svelte:head><title>Features · Settings</title></svelte:head>

<div class="space-y-5">
	<div>
		<h1 class="font-display text-xl font-bold tracking-tight">Features</h1>
		<p class="text-[12.5px] text-[var(--ui-text-muted)]">Enable or disable modules for this workspace</p>
	</div>

	<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
		<div class="flex items-center gap-2 px-5 py-3">
			<Icon name="lucide:layout-grid" class="size-4 text-primary-500" />
			<h2 class="font-display text-[14px] font-semibold">Modules</h2>
		</div>
		{#each featureList as f (f.key)}
			<div class="flex items-center justify-between gap-4 px-5 py-4">
				<div class="flex min-w-0 items-start gap-3.5">
					<div class="grid size-9 shrink-0 place-items-center rounded-xl transition-colors {features[f.key] ? 'bg-primary-500/10 text-primary-600 dark:text-primary-400' : 'bg-[var(--ui-bg-muted)] text-[var(--ui-text-dimmed)]'}">
						<Icon name={f.icon} class="size-4.5" />
					</div>
					<div class="min-w-0">
						<p class="text-[13px] font-semibold leading-tight">{f.label}</p>
						<p class="mt-0.5 text-[11px] text-[var(--ui-text-dimmed)]">{f.description}</p>
					</div>
				</div>
				<Switch checked={features[f.key]} onCheckedChange={() => toggle(f.key)} />
			</div>
		{/each}
	</section>

	<div class="flex items-center gap-3 rounded-xl border border-[var(--tone-warning-border)] bg-[var(--tone-warning-bg)] px-4 py-3">
		<Icon name="lucide:info" class="size-4 shrink-0 text-[var(--tone-warning-text)]" />
		<p class="text-[11px] text-[var(--tone-warning-text)]">Feature toggles affect navigation and available routes. Changes apply immediately.</p>
	</div>
</div>
