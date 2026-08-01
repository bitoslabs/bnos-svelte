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
		size?: 'sm' | 'md' | 'lg';
		children?: Snippet;
		footer?: Snippet;
	} = $props();

	const width = $derived(size === 'sm' ? 'max-w-sm' : size === 'lg' ? 'max-w-2xl' : 'max-w-md');
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
				'relative w-full overflow-hidden rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-bg-elevated)] shadow-2xl shadow-black/20',
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
			<div class="px-5 py-4">
				{#if children}{@render children()}{/if}
			</div>
			{#if footer}
				<footer class="flex items-center justify-end gap-2 border-t border-[var(--ui-border-muted)] px-5 py-3.5">
					{@render footer()}
				</footer>
			{/if}
		</div>
	</div>
{/if}
