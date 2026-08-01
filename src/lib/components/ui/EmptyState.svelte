<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';

	let {
		icon = 'lucide:inbox',
		title,
		description,
		actions
	}: {
		icon?: string;
		title: string;
		description?: string;
		actions?: Snippet;
	} = $props();
</script>

<div class="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[var(--ui-border-accented)] bg-[var(--ui-bg-muted)] px-6 py-14 text-center">
	<div
		class="grid size-12 place-items-center rounded-2xl bg-[var(--ui-bg-elevated)] text-[var(--ui-text-dimmed)]"
	>
		<Icon name={icon} class="size-6" />
	</div>
	<div>
		<h3 class="font-display text-[15px] font-semibold text-[var(--ui-text)]">{title}</h3>
		{#if description}
			<p class="mx-auto mt-1 max-w-sm text-[12.5px] text-[var(--ui-text-muted)]">{description}</p>
		{/if}
	</div>
	{#if actions}
		<div class="mt-1">
			{@render actions()}
		</div>
	{/if}
</div>
