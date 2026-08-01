<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils/cn';
	import Icon from './Icon.svelte';

	let {
		class: cls,
		title,
		description,
		icon,
		children,
		actions
	}: {
		class?: string;
		title?: string;
		description?: string;
		icon?: string;
		children?: Snippet;
		actions?: Snippet;
	} = $props();
</script>

<div class={cn('surface-card p-5', cls)}>
	{#if title || actions}
		<div class="mb-4 flex items-start justify-between gap-3">
			<div class="flex items-start gap-3">
				{#if icon}
					<div
						class="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-500/10 text-primary-600 dark:text-primary-400"
					>
						<Icon name={icon} class="size-4.5" />
					</div>
				{/if}
				<div>
					{#if title}<h3 class="font-display text-[15px] font-semibold tracking-tight">{title}</h3>{/if}
					{#if description}
						<p class="mt-0.5 text-[12.5px] text-[var(--ui-text-muted)]">{description}</p>
					{/if}
				</div>
			</div>
			{#if actions}
				<div class="flex shrink-0 items-center gap-2">
					{@render actions()}
				</div>
			{/if}
		</div>
	{/if}
	{#if children}{@render children()}{/if}
</div>
