<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils/cn';
	import Icon from './Icon.svelte';

	/**
	 * A grouped settings card with an optional header (icon + title + meta/actions).
	 * Use <SettingRow> (or custom markup) as children for the rows, which are
	 * separated by the divider. `danger` styles it as a destructive zone.
	 *
	 * Section titles use <h3> because <PageHeader> owns the page-level <h2>.
	 */
	let {
		title,
		description = '',
		icon,
		meta = '',
		danger = false,
		actions,
		class: cls,
		children
	}: {
		title?: string;
		description?: string;
		icon?: string;
		meta?: string;
		danger?: boolean;
		actions?: Snippet;
		class?: string;
		children: Snippet;
	} = $props();
</script>

<section
	class={cn(
		'surface-card divide-y divide-[var(--ui-border-muted)]',
		danger && 'danger-surface',
		cls
	)}
>
	{#if title || actions}
		<div class="flex items-center gap-2 px-5 py-3">
			{#if icon}
				<Icon
					name={icon}
					class={cn(
						'size-4 shrink-0',
						danger ? 'text-[var(--tone-error-text)]' : 'text-primary-500'
					)}
				/>
			{/if}
			<div class="min-w-0">
				{#if title}
					<h3
						class="font-display text-[14px] font-semibold {danger
							? 'text-[var(--tone-error-text)]'
							: 'text-[var(--ui-text)]'}"
					>
						{title}
					</h3>
				{/if}
				{#if description}
					<p class="text-[11px] text-[var(--ui-text-dimmed)]">{description}</p>
				{/if}
			</div>
			{#if meta}
				<span class="ml-auto text-[10px] font-medium text-[var(--ui-text-dimmed)]">{meta}</span>
			{:else if actions}
				<div class="ml-auto flex items-center gap-2">{@render actions()}</div>
			{/if}
		</div>
	{/if}
	{@render children()}
</section>
