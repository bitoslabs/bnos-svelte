<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils/cn';

	let {
		open = $bindable(false),
		align = 'center',
		side = 'top',
		title,
		triggerClass = 'inline-grid size-9.5 place-items-center rounded-lg text-(--ui-text-muted) transition-colors hover:bg-(--ui-bg-accented) hover:text-(--ui-text) focus-visible:outline-none',
		triggerActiveClass = '',
		trigger,
		content,
		class: cls
	}: {
		open?: boolean;
		align?: 'start' | 'center' | 'end';
		side?: 'top' | 'right' | 'bottom' | 'left';
		/** Native tooltip shown on the trigger button (e.g. status text). */
		title?: string;
		/** Style the trigger button. Defaults to a square icon button; pass a pill
		 *  class to render e.g. a status chip instead. */
		triggerClass?: string;
		/** Extra classes applied only while open (e.g. a focus ring). Falls back to
		 *  the standard accent highlight when omitted. */
		triggerActiveClass?: string;
		trigger: Snippet;
		content: Snippet;
		class?: string;
	} = $props();

	const panelId = $props.id();
	let root = $state<HTMLElement>();
	let triggerEl = $state<HTMLButtonElement>();
	let panelEl = $state<HTMLElement>();

	const FOCUSABLE =
		'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

	const sideClass = $derived(
		{
			top: 'bottom-full mb-1.5',
			bottom: 'top-full mt-1.5',
			right: 'left-full ml-1.5 top-0',
			left: 'right-full mr-1.5 top-0'
		}[side]
	);
	const alignClass = $derived(
		{ start: 'left-0', center: 'left-1/2 -translate-x-1/2', end: 'right-0' }[align]
	);

	$effect(() => {
		if (!open) return;
		const panel = panelEl;
		const focusables = () =>
			panel
				? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
						(el) => el.offsetParent !== null || el === document.activeElement
					)
				: [];

		// Move focus into the panel so keyboard users land on its content.
		(focusables()[0] ?? panel)?.focus();

		const onDoc = (e: PointerEvent) => {
			if (root && !root.contains(e.target as Node)) open = false;
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				open = false;
				return;
			}
			if (e.key !== 'Tab' || !panel) return;
			const items = focusables();
			if (items.length === 0) {
				e.preventDefault();
				panel.focus();
				return;
			}
			const first = items[0];
			const last = items[items.length - 1];
			const active = document.activeElement;
			if (e.shiftKey && (active === first || !panel.contains(active))) {
				e.preventDefault();
				last.focus();
			} else if (!e.shiftKey && active === last) {
				e.preventDefault();
				first.focus();
			}
		};
		document.addEventListener('pointerdown', onDoc);
		document.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('pointerdown', onDoc);
			document.removeEventListener('keydown', onKey);
			// Return focus to the trigger on keyboard/Escape close, but not when
			// the user moved focus elsewhere via an outside click.
			if (triggerEl?.isConnected && root?.contains(document.activeElement)) {
				triggerEl.focus();
			}
		};
	});
</script>

<div bind:this={root} class="relative inline-block">
	<button
		type="button"
		bind:this={triggerEl}
		aria-haspopup="dialog"
		aria-controls={open ? panelId : undefined}
		aria-expanded={open}
		{title}
		class={cn(
			triggerClass,
			open && (triggerActiveClass || 'bg-(--ui-bg-accented) text-(--ui-text)')
		)}
		onclick={() => (open = !open)}
	>
		{@render trigger()}
	</button>

	{#if open}
		<div
			bind:this={panelEl}
			id={panelId}
			tabindex="-1"
			class={cn(
				'animate-rise absolute z-50 rounded-xl border border-(--ui-border) bg-(--surface-bg) p-1.5 text-(--ui-text) shadow-(--shadow-pop) outline-none',
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
