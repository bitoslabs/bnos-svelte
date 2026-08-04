<script lang="ts">
	import { resolve } from '$app/paths';
	import Icon from '$lib/components/ui/Icon.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import Button from '$lib/components/ui/Button.svelte';
</script>

<svelte:head><title>Branches · Settings</title></svelte:head>

<div class="mx-auto max-w-xl space-y-4">
	<PageHeader icon="lucide:map-pin" title="Branches" description="Locations & branches" />

	<div class="surface-card p-6 text-center">
		<div
			class="mx-auto grid size-14 place-items-center rounded-2xl bg-primary-500/10 text-primary-500"
		>
			<Icon name="lucide:map-pin" class="size-6" />
		</div>
		<h1 class="mt-4 font-display text-lg font-bold tracking-tight">Branch management moved</h1>
		<p class="mt-2 text-[13px] text-[var(--ui-text-muted)]">
			Branches are now managed inside <strong>Workspace</strong> so company and branch structure live
			in one place.
		</p>
		<div class="mt-5 flex justify-center">
			<Button
				color="primary"
				href={resolve('/settings/organization') + '#branches'}
				icon="lucide:arrow-right"
			>
				Open Workspace Settings
			</Button>
		</div>
	</div>
</div>
