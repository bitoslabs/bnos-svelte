<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import Switch from '$lib/components/ui/Switch.svelte';
	import { features, FEATURE_META, FEATURE_KEYS, type FeatureKey } from '$lib/features.svelte';
	import { syncWorkspaceSettingsToOrganization } from '$nostr/workspace-settings';
	import { toast } from '$lib/stores/toast.svelte';
	import { browser } from '$app/environment';

	onMount(() => {
		if (browser && !features.hydrated) features.load();
	});

	async function toggle(k: FeatureKey) {
		const next = features.toggle(k);
		await syncWorkspaceSettingsToOrganization();
		toast.success(`${next ? 'Enabled' : 'Disabled'} ${FEATURE_META[k].label}`);
	}
</script>

<svelte:head><title>Features · Settings</title></svelte:head>

<div class="space-y-5">
	<PageHeader
		icon="lucide:layout-grid"
		title="Features"
		description="Enable or disable modules for this workspace"
	/>

	<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
		<div class="flex items-center gap-2 px-5 py-3">
			<Icon name="lucide:layout-grid" class="size-4 text-primary-500" />
			<h2 class="font-display text-[14px] font-semibold">Modules</h2>
		</div>
		{#each FEATURE_KEYS as key (key)}
			{@const f = FEATURE_META[key]}
			<div class="flex items-center justify-between gap-4 px-5 py-4">
				<div class="flex min-w-0 items-start gap-3.5">
					<div
						class="grid size-9 shrink-0 place-items-center rounded-xl transition-colors {features.isEnabled(
							key
						)
							? 'bg-primary-500/10 text-primary-600 dark:text-primary-400'
							: 'bg-[var(--ui-bg-muted)] text-[var(--ui-text-dimmed)]'}"
					>
						<Icon name={f.icon} class="size-4.5" />
					</div>
					<div class="min-w-0">
						<p class="text-[13px] leading-tight font-semibold">{f.label}</p>
						<p class="mt-0.5 text-[11px] text-[var(--ui-text-dimmed)]">{f.description}</p>
					</div>
				</div>
				<Switch checked={features.isEnabled(key)} onCheckedChange={() => toggle(key)} />
			</div>
		{/each}
	</section>

	<div
		class="flex items-center gap-3 rounded-xl border border-[var(--tone-warning-border)] bg-[var(--tone-warning-bg)] px-4 py-3"
	>
		<Icon name="lucide:info" class="size-4 shrink-0 text-[var(--tone-warning-text)]" />
		<p class="text-[11px] text-[var(--tone-warning-text)]">
			Feature toggles affect navigation and available routes. Changes apply immediately.
		</p>
	</div>
</div>
