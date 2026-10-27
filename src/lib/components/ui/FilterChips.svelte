<script lang="ts">
	/**
	 * FilterChips — a single-select set of chips for narrowing a collection
	 * (status, area, category). Chips are toggle buttons (`aria-pressed`), not
	 * tabs: use the `.segmented` control for view/route switches instead.
	 */
	import { cn } from '$lib/utils/cn';

	interface FilterChipOption {
		value: string;
		label: string;
		count?: number;
		/** Tailwind background class for the status dot, e.g. `bg-emerald-500`. */
		dot?: string;
	}

	let {
		value = $bindable(),
		options,
		label,
		class: cls
	}: {
		value: string;
		options: FilterChipOption[];
		/** Accessible name for the group. */
		label?: string;
		class?: string;
	} = $props();
</script>

<div class={cn('flex flex-wrap items-center gap-1.5', cls)} role="group" aria-label={label}>
	{#each options as opt (opt.value)}
		{@const active = value === opt.value}
		<button
			type="button"
			aria-pressed={active}
			onclick={() => (value = opt.value)}
			class={cn(
				'focus-ring flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition-colors',
				active
					? 'border-primary-500/30 bg-primary-500/10 text-primary-700 dark:text-primary-300'
					: 'border-(--ui-border) text-(--ui-text-muted) hover:bg-(--interactive-hover-bg) hover:text-(--ui-text)'
			)}
		>
			{#if opt.dot}<span class="size-2 rounded-full {opt.dot}"></span>{/if}
			{opt.label}
			{#if opt.count !== undefined}
				<span
					class="ml-0.5 rounded-md bg-(--ui-bg-accented) px-1.5 py-0.5 text-[10px] font-bold tabular-nums"
					>{opt.count}</span
				>
			{/if}
		</button>
	{/each}
</div>
