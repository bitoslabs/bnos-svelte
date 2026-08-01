<script lang="ts">
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';

	const tables = [
		{ id: 'T1', name: 'Table 1', seats: 4, status: 'available' },
		{ id: 'T2', name: 'Table 2', seats: 2, status: 'occupied' },
		{ id: 'T3', name: 'Table 3', seats: 6, status: 'reserved' },
		{ id: 'T4', name: 'Table 4', seats: 4, status: 'available' },
		{ id: 'T5', name: 'Patio A', seats: 8, status: 'occupied' },
		{ id: 'T6', name: 'Patio B', seats: 8, status: 'available' }
	];

	const color = (s: string) =>
		s === 'occupied' ? 'error' : s === 'reserved' ? 'warning' : 'success';
</script>

<svelte:head><title>bdGo OS · Tables</title></svelte:head>

<div class="space-y-4">
	<div>
		<h1 class="font-display text-xl font-bold tracking-tight">Floor & tables</h1>
		<p class="text-[12.5px] text-[var(--ui-text-muted)]">Table layout & live status · kind 30080</p>
	</div>
	<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
		{#each tables as t (t.id)}
			<div class="surface-card accent-bar p-4" style="--accent: var(--ui-color-primary-500);">
				<div class="mb-2 flex items-center justify-between">
					<Icon name="lucide:armchair" class="size-5 text-primary-500" />
					<Badge color={color(t.status)}>{t.status}</Badge>
				</div>
				<div class="font-display text-[15px] font-bold">{t.name}</div>
				<div class="text-[12px] text-[var(--ui-text-muted)]">{t.seats} seats</div>
			</div>
		{/each}
	</div>
</div>
