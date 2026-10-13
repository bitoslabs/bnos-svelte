<script lang="ts">
	import type { Snippet } from 'svelte';
	import { browser } from '$app/environment';
	import { cn } from '$lib/utils/cn';
	import { t } from '$lib/i18n/i18n.svelte';

	let {
		open = $bindable(false),
		align = 'center',
		side = 'top',
		title,
		triggerClass = 'inline-grid size-9.5 place-items-center rounded-lg text-(--ui-text-muted) transition-colors hover:bg-(--ui-bg-accented) hover:text-(--ui-text) focus-visible:outline-none',
		triggerActiveClass = '',
		sheetOnMobile = true,
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
		/** On phones, render as a full-width bottom sheet instead of a
		 *  trigger-anchored panel. Set false for small menus. */
		sheetOnMobile?: boolean;
		trigger: Snippet;
		content: Snippet;
		class?: string;
	} = $props();

	const panelId = $props.id();
	let root = $state<HTMLElement>();
	let triggerEl = $state<HTMLButtonElement>();
	let panelEl = $state<HTMLElement>();

	// ── Drag-to-close (bottom sheet) ───────────────────────────────────────
	// Pull the grabber down to dismiss. `animateIn` is switched off on the
	// first drag so the intro animation can't fight the inline transform.
	let dragY = $state(0);
	let dragging = $state(false);
	let animateIn = $state(true);
	let dragStartY = 0;
	let dragStartT = 0;

	function sheetDragStart(e: PointerEvent) {
		if (!panelEl || e.button !== 0) return;
		dragging = true;
		animateIn = false;
		dragStartY = e.clientY;
		dragStartT = e.timeStamp;
		dragY = 0;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}
	function sheetDragMove(e: PointerEvent) {
		if (!dragging) return;
		dragY = Math.max(0, e.clientY - dragStartY);
	}
	function sheetDragEnd(e: PointerEvent) {
		if (!dragging) return;
		dragging = false;
		const height = panelEl?.offsetHeight ?? 320;
		const flick = e.timeStamp - dragStartT < 250 && dragY > 48;
		if (flick || dragY > Math.max(96, height * 0.28)) open = false;
		dragY = 0;
	}

	// ── Responsive presentation ────────────────────────────────────────────
	// On phones a trigger-anchored panel is cramped and thumb-unreachable, so
	// switch to a bottom sheet. Tracked reactively so rotation / resize swaps
	// the presentation without a reload.
	let isMobile = $state(false);
	$effect(() => {
		if (!browser) return;
		const mq = window.matchMedia('(max-width: 639px)');
		isMobile = mq.matches;
		const onChange = (e: MediaQueryListEvent) => (isMobile = e.matches);
		mq.addEventListener('change', onChange);
		return () => mq.removeEventListener('change', onChange);
	});
	const asSheet = $derived(sheetOnMobile && isMobile);

	// Reset drag/animation state each time the sheet opens.
	$effect(() => {
		if (open) {
			dragY = 0;
			dragging = false;
			animateIn = true;
		}
	});

	// The sheet lives in the top layer so it escapes the top bar's stacking
	// context (and paints above the mobile bottom tab bar). Svelte 5 delegates
	// to `document`, so handlers keep working after the manual move.
	function portal(node: HTMLElement) {
		if (!browser) return;
		document.body.appendChild(node);
		return {
			destroy() {
				node.remove();
			}
		};
	}

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
		const sheet = asSheet;
		const focusables = () =>
			panel
				? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
						(el) => el.offsetParent !== null || el === document.activeElement
					)
				: [];

		// Move focus into the panel so keyboard users land on its content.
		(focusables()[0] ?? panel)?.focus();

		const onDoc = (e: PointerEvent) => {
			const target = e.target as Node;
			if (root && !root.contains(target) && !panel?.contains(target)) open = false;
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
			if (triggerEl?.isConnected && (sheet || root?.contains(document.activeElement))) {
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

	{#if open && asSheet}
		<div use:portal class="fixed inset-0 z-[95]">
			<button
				type="button"
				aria-label={t('common.close')}
				tabindex="-1"
				class="animate-fade absolute inset-0 bg-black/45 backdrop-blur-[2px]"
				onclick={() => (open = false)}
			></button>
			<div
				bind:this={panelEl}
				id={panelId}
				tabindex="-1"
				role="dialog"
				aria-modal="true"
				class={cn(
					'absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col overflow-hidden rounded-t-2xl border border-(--ui-border) bg-(--surface-bg) pb-[env(safe-area-inset-bottom)] text-(--ui-text) shadow-(--shadow-pop) outline-none',
					!dragging && 'transition-transform duration-200 ease-out',
					animateIn && !dragging && 'animate-sheet-up'
				)}
				style:transform={dragY > 0 ? `translateY(${dragY}px)` : undefined}
			>
				<div
					role="presentation"
					class="flex shrink-0 cursor-grab touch-none justify-center pt-2.5 pb-1.5 active:cursor-grabbing"
					onpointerdown={sheetDragStart}
					onpointermove={sheetDragMove}
					onpointerup={sheetDragEnd}
					onpointercancel={sheetDragEnd}
				>
					<span class="h-1 w-9 rounded-full bg-(--ui-border-accented)" aria-hidden="true"></span>
				</div>
				<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
					{@render content()}
				</div>
			</div>
		</div>
	{:else if open}
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
