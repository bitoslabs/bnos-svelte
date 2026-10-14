<script lang="ts">
	import type { HTMLSelectAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils/cn';
	import Icon from './Icon.svelte';

	let {
		class: cls,
		value = $bindable(),
		options,
		size = 'md',
		disabled = false,
		...rest
	}: {
		class?: string;
		value?: string | number;
		options: { value: string | number; label: string }[];
		size?: 'sm' | 'md';
	} & Omit<HTMLSelectAttributes, 'size'> = $props();

	/** Dim the control when nothing is selected, mirroring an empty input. */
	const isEmpty = $derived(value === '' || value === undefined || value === null);
</script>

<div
	class={cn(
		'focus-ring-field relative inline-flex items-center rounded-lg border border-(--ui-border) bg-(--ui-bg-muted) transition-colors',
		size === 'sm' ? 'h-8 px-2.5' : 'h-9.5 px-3',
		disabled
			? 'cursor-not-allowed opacity-60'
			: 'cursor-pointer hover:border-(--ui-border-accented)',
		cls
	)}
>
	<select
		bind:value
		{disabled}
		class={cn(
			'min-w-0 flex-1 cursor-[inherit] appearance-none truncate bg-transparent pr-6 text-[13.5px] focus:outline-none',
			isEmpty ? 'text-(--ui-text-dimmed)' : 'text-(--ui-text)'
		)}
		{...rest}
	>
		{#each options as opt (opt.value)}
			<option value={opt.value}>{opt.label}</option>
		{/each}
	</select>
	<Icon
		name="lucide:chevron-down"
		class="pointer-events-none absolute right-2 size-4 text-(--ui-text-dimmed)"
	/>
</div>
