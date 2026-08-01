<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils/cn';

	let {
		open = $bindable(false),
		align = 'center',
		side = 'top',
		trigger,
		content,
		class: cls
	}: {
		open?: boolean;
		align?: 'start' | 'center' | 'end';
		side?: 'top' | 'right' | 'bottom' | 'left';
		trigger: Snippet;
		content: Snippet;
		class?: string;
	} = $props();

	let root = $state<HTMLElement>();

	const sideClass = $derived(
		{
			top: 'bottom-full mb-1.5',
			bottom: 'top-full mt-1.5',
			right: 'left-full ml-1.5 top-0',
			left: 'right-full mr-1.5 top-0'
		}[side]
	);
	const alignClass = $derived({ start: 'left-0', center: 'left-1/2 -translate-x-1/2', end: 'right-0' }[align]);

	$effect(() => {
		if (!open) return;
		const onDoc = (e: PointerEvent) => {
			if (root && !root.contains(e.target as Node)) open = false;
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') open = false;
		};
		document.addEventListener('pointerdown', onDoc);
		document.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('pointerdown', onDoc);
			document.removeEventListener('keydown', onKey);
		};
	});
</script>

<div bind:this={root} class="relative inline-block">
	<button
		type="button"
		aria-expanded={open}
		class="inline-grid size-9.5 place-items-center rounded-lg text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)] focus-visible:outline-none {open
			? 'bg-[var(--ui-bg-accented)] text-[var(--ui-text)]'
			: ''}"
		onclick={() => (open = !open)}
	>
		{@render trigger()}
	</button>

	{#if open}
		<div
			class={cn(
				'animate-rise absolute z-50 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg-elevated)] p-0 text-[var(--ui-text)] shadow-xl shadow-black/10 outline-none',
				sideClass,
				alignClass,
				cls
			)}
			role="dialog"
		>
			{@render content()}
		</div>
	{/if}
</div>
