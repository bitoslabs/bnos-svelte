<script lang="ts">
	/**
	 * ChoiceGroup — inline pill options for a small, fixed set of choices
	 * (2–5 items). Mirrors the appearance chips (Tint / Surface / Font size):
	 * the active option gets a primary border + tinted fill.
	 *
	 * For long or dynamic option lists use the native `Select` dropdown instead.
	 */
	import Icon from './Icon.svelte';
	import { cn } from '$lib/utils/cn';

	let {
		value = $bindable(),
		options,
		size = 'md',
		label,
		class: cls
	}: {
		value?: string;
		options: { value: string; label: string; icon?: string }[];
		size?: 'sm' | 'md';
		/** Accessible name for the group (also render a visible label next to it). */
		label?: string;
		class?: string;
	} = $props();
</script>

<div class={cn('flex flex-wrap gap-2', cls)} role="group" aria-label={label}>
	{#each options as opt (opt.value)}
		{@const active = value === opt.value}
		<button
			type="button"
			onclick={() => (value = opt.value)}
			aria-pressed={active}
			class={cn(
				'focus-ring inline-flex items-center gap-1.5 rounded-lg border-2 font-semibold transition-colors',
				size === 'sm' ? 'px-2.5 py-1 text-[12px]' : 'px-3 py-1.5 text-[12.5px]',
				active
					? 'border-primary-500 bg-primary-500/10 text-primary-700 dark:text-primary-300'
					: 'border-(--ui-border) text-(--ui-text-muted) hover:bg-(--interactive-hover-bg)'
			)}
		>
			{#if opt.icon}<Icon name={opt.icon} class="size-3.5" />{/if}
			{opt.label}
		</button>
	{/each}
</div>
