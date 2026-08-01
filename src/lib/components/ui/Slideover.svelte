<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils/cn';
	import Icon from './Icon.svelte';

	let {
		open = $bindable(false),
		side = 'right',
		title,
		subtitle,
		width = 'w-[26rem]',
		children,
		footer
	}: {
		open?: boolean;
		side?: 'left' | 'right';
		title?: string;
		subtitle?: string;
		width?: string;
		children?: Snippet;
		footer?: Snippet;
	} = $props();

	const onKey = (e: KeyboardEvent) => {
		if (open && e.key === 'Escape') open = false;
	};
</script>

<svelte:window onkeydown={onKey} />

{#if open}
	<button
		type="button"
		aria-label="Close panel"
		tabindex="-1"
		class="animate-fade fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]"
		onclick={() => (open = false)}
	></button>
	<div
		class={cn(
			'animate-fade fixed top-0 z-50 flex h-screen flex-col border-[var(--glass-border)] bg-[var(--glass-bg)] backdrop-blur-xl outline-none',
			width,
			side === 'left' ? 'left-0 border-r' : 'right-0 border-l'
		)}
		role="dialog"
		aria-modal="true"
	>
		{#if title}
			<header class="flex items-start justify-between gap-3 border-b border-[var(--ui-border-muted)] px-5 py-4">
				<div class="min-w-0">
					<h2 class="font-display text-[15px] font-semibold tracking-tight">{title}</h2>
					{#if subtitle}<p class="mt-0.5 truncate text-[12px] text-[var(--ui-text-muted)]">{subtitle}</p>{/if}
				</div>
				<button
					type="button"
					onclick={() => (open = false)}
					class="grid size-8 shrink-0 place-items-center rounded-lg text-[var(--ui-text-dimmed)] hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]"
					aria-label="Close"
				>
					<Icon name="lucide:x" class="size-4" />
				</button>
			</header>
		{/if}
		<div class="min-h-0 flex-1 overflow-y-auto">
			{#if children}{@render children()}{/if}
		</div>
		{#if footer}
			<footer class="border-t border-[var(--ui-border-muted)] px-5 py-3.5">
				{@render footer()}
			</footer>
		{/if}
	</div>
{/if}
