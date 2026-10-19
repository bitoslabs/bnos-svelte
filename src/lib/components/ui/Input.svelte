<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLInputAttributes, HTMLTextareaAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils/cn';
	import Icon from './Icon.svelte';

	let {
		class: cls,
		icon,
		value = $bindable(),
		trailing,
		size = 'md',
		textarea = false,
		// eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept off the native input
		label,
		...rest
	}: {
		class?: string;
		icon?: string;
		value?: string | number;
		trailing?: Snippet;
		size?: 'sm' | 'md' | 'lg';
		textarea?: boolean;
		label?: string;
	} & Omit<HTMLInputAttributes & HTMLTextareaAttributes, 'size'> = $props();

	const height = $derived(
		size === 'sm' ? 'h-8 px-2.5' : size === 'lg' ? 'h-11 px-4' : 'h-9.5 px-3'
	);
</script>

{#if textarea}
	<textarea
		bind:value
		class={cn(
			'focus-ring-field w-full rounded-lg border border-(--ui-border) bg-(--ui-bg-muted) px-3 py-2 text-[13.5px] text-(--ui-text) transition-colors placeholder:text-(--ui-text-dimmed)',
			cls
		)}
		{...rest as HTMLTextareaAttributes}></textarea>
{:else}
	<div
		class={cn(
			'focus-ring-field inline-flex items-center gap-2 rounded-lg border border-(--ui-border) bg-(--ui-bg-muted) transition-colors',
			height,
			cls
		)}
	>
		{#if icon}<Icon name={icon} class="size-4 shrink-0 text-(--ui-text-dimmed)" />{/if}
		<input
			bind:value
			class="min-w-0 flex-1 bg-transparent text-[13.5px] text-(--ui-text) placeholder:text-(--ui-text-dimmed) focus:outline-none"
			{...rest as HTMLInputAttributes}
		/>
		{#if trailing}
			<div class="flex shrink-0 items-center gap-1">
				{@render trailing()}
			</div>
		{/if}
	</div>
{/if}
