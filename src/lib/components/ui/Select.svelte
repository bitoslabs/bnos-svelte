<script lang="ts">
	import type { HTMLSelectAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils/cn';
	import Icon from './Icon.svelte';

	let {
		class: cls,
		value = $bindable(),
		options,
		size = 'md',
		...rest
	}: {
		class?: string;
		value?: string | number;
		options: { value: string | number; label: string }[];
		size?: 'sm' | 'md';
	} & Omit<HTMLSelectAttributes, 'size'> = $props();
</script>

<div
	class={cn(
		'relative inline-flex items-center rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] transition-colors focus-within:border-[var(--ui-color-primary-500)]',
		size === 'sm' ? 'h-8 px-2.5' : 'h-9.5 px-3',
		cls
	)}
>
	<select
		bind:value
		class="min-w-0 appearance-none bg-transparent pr-5 text-[13.5px] text-[var(--ui-text)] focus:outline-none"
		{...rest}
	>
		{#each options as opt (opt.value)}
			<option value={opt.value}>{opt.label}</option>
		{/each}
	</select>
	<Icon name="lucide:chevron-down" class="pointer-events-none absolute right-2 size-4 text-[var(--ui-text-dimmed)]" />
</div>
