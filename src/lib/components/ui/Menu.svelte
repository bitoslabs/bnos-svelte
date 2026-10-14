<script lang="ts" module>
	import { tv, type VariantProps } from 'tailwind-variants';
	import { t } from '$lib/i18n/i18n.svelte';

	/**
	 * Dropdown-menu container. Open state lives in the shared `popovers` store,
	 * so only one menu is open app-wide and outside-click / Escape closing is
	 * handled globally in `+layout.svelte`. Pair with `MenuItem` + `MenuDivider`.
	 *
	 * The panel is positioned in JS (`position: fixed`) and clamped to the
	 * viewport: it flips above the trigger when there is no room below, and
	 * slides back inside the left/right edges on narrow screens, so it never
	 * runs off-screen. `placement` is the *preferred* side/alignment only.
	 *
	 *   <Menu id="row-1" label={t('common.actions')} triggerClass="...">
	 *     {#snippet trigger()}<Icon name="lucide:ellipsis-vertical" />{/snippet}
	 *     <MenuItem icon="lucide:pencil" onclick={edit}>Edit</MenuItem>
	 *     <MenuItem icon="lucide:copy" onclick={copy}>Duplicate</MenuItem>
	 *     <MenuDivider />
	 *     <MenuItem tone="danger" icon="lucide:trash-2" onclick={del}>Delete</MenuItem>
	 *   </Menu>
	 */
	export const menuPanel = tv({
		base: 'fixed z-50 max-h-[calc(100dvh-1rem)] min-w-52 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-xl border border-(--ui-border) bg-(--surface-bg) p-1.5 shadow-(--shadow-pop) outline-none',
		variants: {
			// Position is computed in JS (`place()`); the variant is kept so the
			// `placement` prop stays typed and documented.
			placement: {
				'bottom-start': '',
				'bottom-end': '',
				'top-start': '',
				'top-end': ''
			},
			width: {
				auto: '',
				sm: 'w-52',
				md: 'w-56',
				lg: 'w-64'
			}
		},
		defaultVariants: { placement: 'bottom-end', width: 'md' }
	});

	export type MenuVariants = VariantProps<typeof menuPanel>;

	let fallbackId = 0;
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import { untrack } from 'svelte';
	import { popovers } from '$lib/stores/popovers.svelte';
	import { cn } from '$lib/utils/cn';

	let {
		id,
		placement = 'bottom-end',
		width = 'md',
		class: cls,
		rootClass = '',
		triggerClass = '',
		triggerActiveClass = '',
		label,
		trigger,
		children
	}: {
		id?: string;
		placement?: MenuVariants['placement'];
		width?: MenuVariants['width'];
		class?: string;
		rootClass?: string;
		triggerClass?: string;
		triggerActiveClass?: string;
		label?: string;
		trigger?: Snippet;
		children?: Snippet;
	} = $props();

	const menuId = untrack(() => id) ?? `menu:${fallbackId++}`;
	const open = $derived(popovers.isOpen(menuId));
	const panelClass = $derived(menuPanel({ width, class: cls }));

	/** Gap between trigger and panel, and minimum margin to the viewport edge. */
	const GAP = 6;
	const MARGIN = 8;

	let triggerEl = $state<HTMLButtonElement | null>(null);
	let panelEl = $state<HTMLDivElement | null>(null);
	let pos = $state({ top: 0, left: 0, ready: false });

	/** Resolve the preferred placement, then flip/clamp so the panel fits. */
	function place() {
		if (!triggerEl || !panelEl) return;
		const tr = triggerEl.getBoundingClientRect();
		const mr = panelEl.getBoundingClientRect();
		const vw = document.documentElement.clientWidth;
		const vh = document.documentElement.clientHeight;

		const preferTop = placement.startsWith('top');
		const alignEnd = placement.endsWith('end');
		const needed = mr.height + GAP + MARGIN;

		const spaceBelow = vh - tr.bottom;
		const spaceAbove = tr.top;
		let openUp = preferTop;
		if (preferTop && spaceAbove < needed && spaceBelow > spaceAbove) openUp = false;
		else if (!preferTop && spaceBelow < needed && spaceAbove > spaceBelow) openUp = true;

		const top = openUp ? tr.top - mr.height - GAP : tr.bottom + GAP;
		const left = alignEnd ? tr.right - mr.width : tr.left;

		pos = {
			top: Math.min(Math.max(MARGIN, top), Math.max(MARGIN, vh - mr.height - MARGIN)),
			left: Math.min(Math.max(MARGIN, left), Math.max(MARGIN, vw - mr.width - MARGIN)),
			ready: true
		};
	}

	// Position whenever the menu opens (and once the panel is measured), and
	// keep it pinned to the trigger while the page scrolls or resizes.
	$effect(() => {
		if (!open) {
			pos.ready = false;
			return;
		}
		place();
		const onReflow = () => place();
		window.addEventListener('resize', onReflow);
		window.addEventListener('scroll', onReflow, true);
		return () => {
			window.removeEventListener('resize', onReflow);
			window.removeEventListener('scroll', onReflow, true);
		};
	});

	function toggle(event: MouseEvent) {
		// Stop the global window pointerdown handler from immediately re-closing.
		event.stopPropagation();
		popovers.toggle(menuId);
	}
	// Close on any item click (delegated). Fine for menus where each action navigates/closes.
	function onContentClick() {
		popovers.close();
	}
</script>

<div class={cn('relative inline-flex', rootClass)}>
	<button
		type="button"
		bind:this={triggerEl}
		onclick={toggle}
		class={cn('inline-flex items-center justify-center', triggerClass, open && triggerActiveClass)}
		aria-label={label}
		aria-expanded={open}
		aria-haspopup="menu"
	>
		{@render trigger?.()}
	</button>
	{#if open}
		<div
			bind:this={panelEl}
			role="menu"
			tabindex="-1"
			class={panelClass}
			style:top="{pos.top}px"
			style:left="{pos.left}px"
			style:visibility={pos.ready ? 'visible' : 'hidden'}
			onclick={onContentClick}
			onkeydown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') popovers.close();
			}}
		>
			{@render children?.()}
		</div>
	{/if}
</div>
