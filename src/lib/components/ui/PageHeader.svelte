<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils/cn';
	import Icon from './Icon.svelte';

	/**
	 * Standard page header used at the top of settings/section subpages.
	 * Renders a consistent icon chip + title + optional description, with an
	 * optional `actions` snippet aligned to the right.
	 *
	 * Uses an <h2> because AppTopbar already owns the page-level <h1>.
	 */
	type Accent = 'primary' | 'amber' | 'success' | 'neutral';

	let {
		title,
		description = '',
		icon,
		accent = 'primary',
		actions,
		class: cls
	}: {
		title: string;
		description?: string;
		icon?: string;
		accent?: Accent;
		actions?: Snippet;
		class?: string;
	} = $props();

	const accentClasses: Record<Accent, string> = {
		primary: 'bg-primary-500/10 text-primary-600 dark:text-primary-400',
		amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
		success: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
		neutral: 'bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)]'
	};
</script>

<header class={cn('page-header flex items-center gap-3', cls)}>
	{#if icon}
		<div
			class="page-header-icon grid size-10 shrink-0 place-items-center rounded-xl {accentClasses[accent]}"
			aria-hidden="true"
		>
			<Icon name={icon} class="size-5" />
		</div>
	{/if}
	<div class="min-w-0 flex-1">
		<h2 class="font-display text-[16px] font-semibold tracking-tight">{title}</h2>
		{#if description}
			<p class="mt-0.5 text-[12px] text-[var(--ui-text-muted)]">{description}</p>
		{/if}
	</div>
	{#if actions}
		<div class="flex shrink-0 items-center gap-2">
			{@render actions()}
		</div>
	{/if}
</header>
