<script lang="ts">
	/**
	 * Sortable table header cell bound to a createListControls() column.
	 * Click toggles asc/desc; shows a chevron on the active column.
	 */
	import Icon from '$lib/components/ui/Icon.svelte';
	import { cn } from '$lib/utils/cn';

	let {
		column,
		active = false,
		direction = 'asc',
		align = 'left',
		applySort,
		children
	}: {
		column: string;
		active?: boolean;
		direction?: 'asc' | 'desc';
		align?: 'left' | 'right' | 'center';
		applySort?: (key: string) => void;
		children?: import('svelte').Snippet;
	} = $props();
</script>

<th
	class={cn(
		'px-5 py-2.5 text-[11px] font-semibold tracking-wider uppercase',
		align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left',
		active ? 'text-[var(--ui-text)]' : 'text-[var(--ui-text-dimmed)]'
	)}
>
	{#if applySort}
		<button
			type="button"
			class={cn(
				'inline-flex cursor-pointer items-center gap-1 transition-colors hover:text-[var(--ui-text)]',
				align === 'right' ? 'flex-row-reverse' : ''
			)}
			onclick={() => applySort(column)}
		>
			{@render children?.()}
			{#if active}
				<Icon
					name={direction === 'asc' ? 'lucide:arrow-up-narrow-wide' : 'lucide:arrow-down-narrow-wide'}
					class="size-3 text-primary-500"
				/>
			{/if}
		</button>
	{:else}
		{@render children?.()}
	{/if}
</th>
