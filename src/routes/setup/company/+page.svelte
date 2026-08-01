<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import Switch from '$lib/components/ui/Switch.svelte';
	import { tenant, type BusinessModel, type BusinessType } from '$nostr/tenant.svelte';
	import { businessModels, businessTypes, currencies } from '$lib/business';
	import { titleCase } from '$lib/utils/format';

	let name = $state('');
	let code = $state('');
	let codeFollowsName = $state(true);

	function slugify(v: string) {
		return v
			.toLowerCase()
			.trim()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 24);
	}

	onMount(() => {
		name = tenant.state.organizationName || '';
		code = tenant.state.organizationCode || '';
		if (code) codeFollowsName = false;
	});

	// persist every field live so later steps + review see it
	$effect(() => {
		const resolvedCode = codeFollowsName ? slugify(name) : code;
		tenant.configure({
			organizationName: name,
			organizationCode: resolvedCode,
			businessModel: tenant.state.businessModel,
			businessType: tenant.state.businessType,
			currency: tenant.state.currency,
			defaultTaxRate: tenant.state.defaultTaxRate,
			taxIncludedInPrice: tenant.state.taxIncludedInPrice
		});
	});

	function pickModel(m: BusinessModel) {
		tenant.configure({ businessModel: m });
	}
	function pickType(ty: BusinessType) {
		tenant.configure({ businessType: ty });
	}

	const activeType = $derived(businessTypes.find((t) => t.value === tenant.state.businessType));
</script>

<svelte:head><title>Setup · Company</title></svelte:head>

<div class="space-y-6">
	<div>
		<h2 class="font-display text-xl font-bold tracking-tight">Tell us about your business</h2>
		<p class="mt-1 text-[13.5px] text-[var(--ui-text-muted)]">
			These choices tailor bdGo OS — business type unlocks the right modules (e.g. Restaurant enables
			tables, kitchen & waiter flows).
		</p>
	</div>

	<!-- Name + code -->
	<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
		<label class="block">
			<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Company name</span>
			<Input bind:value={name} class="w-full" icon="lucide:building-2" placeholder="e.g. Morning Brew Café" />
		</label>
		<label class="block">
			<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Company code</span>
			<Input
				bind:value={code}
				icon="lucide:hash" 
				class="w-full"
				placeholder={codeFollowsName ? slugify(name) || 'my-store' : 'my-store'}
				oninput={() => (codeFollowsName = false)}
			/>
			<span class="mt-1 block text-[11px] text-[var(--ui-text-dimmed)]">
				Lowercase, used as your Nostr identifier.
			</span>
		</label>
	</div>

	<!-- Business model -->
	<div>
		<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Business model</span>
		<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
			{#each businessModels as model (model.value)}
				{@const active = tenant.state.businessModel === model.value}
				<button
					type="button"
					onclick={() => pickModel(model.value)}
					class="flex items-center gap-3 rounded-xl border-2 p-3 text-left text-[13px] font-medium transition-all {active
						? 'border-primary-500 bg-primary-500/10 text-primary-700 dark:text-primary-300'
						: 'border-[var(--ui-border)] hover:border-[var(--ui-border-accented)]'}"
				>
					<Icon name={model.icon} class="size-5 shrink-0 {active ? 'text-primary-500' : 'text-[var(--ui-text-dimmed)]'}" />
					<div class="min-w-0">
						<div>{model.label}</div>
						<div class="text-[11px] font-normal opacity-70">{model.desc}</div>
					</div>
				</button>
			{/each}
		</div>
	</div>

	<!-- Business type -->
	<div>
		<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Business type</span>
		<div class="flex flex-wrap gap-2">
			{#each businessTypes as type (type.value)}
				{@const active = tenant.state.businessType === type.value}
				<button
					type="button"
					onclick={() => pickType(type.value)}
					class="inline-flex items-center gap-1.5 rounded-xl border-2 px-3.5 py-2 text-[13px] font-medium transition-all {active
						? 'border-primary-500 bg-primary-500/10 text-primary-700 dark:text-primary-300'
						: 'border-[var(--ui-border)] hover:border-[var(--ui-border-accented)]'}"
				>
					<Icon name={type.icon} class="size-4" />
					{type.label}
				</button>
			{/each}
		</div>
		{#if activeType?.restaurant}
			<p class="mt-2 flex items-center gap-1.5 text-[11.5px] text-primary-600 dark:text-primary-400">
				<Icon name="lucide:utensils" class="size-3.5" />
				Restaurant module (tables, kitchen, waiter, queue) will be enabled.
			</p>
		{/if}
	</div>

	<!-- Currency -->
	<label class="block">
		<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Default currency</span>
		<Select bind:value={tenant.state.currency} options={currencies} class="w-full" />
	</label>

	<!-- Tax -->
	<div class="surface-card grid grid-cols-1 gap-4 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
		<div>
			<span class="text-[12px] font-semibold text-[var(--ui-text-muted)]">Sales tax</span>
			<p class="mt-0.5 text-[11.5px] text-[var(--ui-text-dimmed)]">
				Applied at checkout. {tenant.state.taxIncludedInPrice ? 'Prices are tax-inclusive.' : 'Prices are tax-exclusive.'}
			</p>
		</div>
		<div class="flex items-center gap-4">
			<label class="flex items-center gap-2 text-[12.5px] font-semibold text-[var(--ui-text-muted)]">
				<Input
					bind:value={tenant.state.defaultTaxRate}
					type="number"
					icon="lucide:percent"
					min="0"
					max="100"
					step="0.5"
					class="w-24"
				/>
			</label>
			<label class="flex items-center gap-2 text-[12.5px] font-semibold text-[var(--ui-text-muted)]">
				<Switch
					checked={tenant.state.taxIncludedInPrice}
					onCheckedChange={(v) => tenant.configure({ taxIncludedInPrice: v })}
				/>
				Included
			</label>
		</div>
	</div>

	{#if name.trim()}
		<div class="rounded-lg border border-primary-500/30 bg-primary-500/10 px-4 py-3 text-[12.5px] text-primary-700 dark:text-primary-300">
			<strong>{name}</strong> · {titleCase(tenant.state.businessModel.replace(/_/g, ' '))} ·
			{titleCase(tenant.state.businessType)} · {tenant.state.currency}
		</div>
	{/if}
</div>
