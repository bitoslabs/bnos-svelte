<script lang="ts">
	import type { Snippet } from 'svelte';
	import { fade, scale } from 'svelte/transition';
	import { cn } from '$lib/utils/cn';
	import Icon from './Icon.svelte';

	let {
		open = $bindable(false),
		title,
		size = 'md',
		children,
		footer
	}: {
		open?: boolean;
		title?: string;
		size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'auto';
		children?: Snippet;
		footer?: Snippet;
	} = $props();

	const width = $derived(
		size === 'xs' ? 'max-w-xs' :
		size === 'sm' ? 'max-w-sm' :
		size === 'md' ? 'max-w-md' :
		size === 'lg' ? 'max-w-2xl' :
		size === 'xl' ? 'max-w-4xl' :
		size === '2xl' ? 'max-w-6xl' :
		size === 'auto' ? 'max-w-[calc(100vw-2rem)]' :
		'max-w-md'
	);
	const onKey = (e: KeyboardEvent) => {
		if (open && e.key === 'Escape') open = false;
	};
</script>

<svelte:window onkeydown={onKey} />

{#if open}
	<div class="fixed inset-0 z-[90] flex items-center justify-center p-4">
		<button
			type="button"
			aria-label="Close dialog"
			tabindex="-1"
			class="animate-fade fixed inset-0 bg-black/45 backdrop-blur-[2px]"
			onclick={() => (open = false)}
		></button>
		<div
			in:scale={{ duration: 160, start: 0.96 }}
			out:scale={{ duration: 120, start: 0.98 }}
			class={cn(
				'relative flex max-h-[90vh] w-full flex-col overflow-hidden rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-bg-elevated)] shadow-2xl shadow-black/20',
				width
			)}
			role="dialog"
			aria-modal="true"
		>
			{#if title}
				<header class="flex items-center justify-between gap-3 border-b border-[var(--ui-border-muted)] px-5 py-3.5">
					<h2 class="font-display text-[15px] font-semibold tracking-tight">{title}</h2>
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
			<div class="flex-1 overflow-y-auto px-5 py-4">
				{#if children}{@render children()}{/if}
			</div>
			{#if footer}
				<footer class="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--ui-border-muted)] px-5 py-3.5">
					{@render footer()}
				</footer>
			{/if}
		</div>
	</div>
{/if}
