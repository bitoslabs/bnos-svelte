<script lang="ts" module>
	import { tv, type VariantProps } from 'tailwind-variants';

	/**
	 * Dropdown-menu container. Open state lives in the shared `popovers` store,
	 * so only one menu is open app-wide and outside-click / Escape closing is
	 * handled globally in `+layout.svelte`. Pair with `MenuItem` + `MenuDivider`.
	 *
	 *   <Menu id="row-1" label="Actions" triggerClass="...">
	 *     {#snippet trigger()}<Icon name="lucide:ellipsis-vertical" />{/snippet}
	 *     <MenuItem icon="lucide:pencil" onclick={edit}>Edit</MenuItem>
	 *     <MenuItem icon="lucide:copy" onclick={copy}>Duplicate</MenuItem>
	 *     <MenuDivider />
	 *     <MenuItem tone="danger" icon="lucide:trash-2" onclick={del}>Delete</MenuItem>
	 *   </Menu>
	 */
	export const menuPanel = tv({
		base: 'absolute z-50 min-w-52 rounded-xl border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] p-1.5 shadow-[var(--shadow-pop)] outline-none',
		variants: {
			placement: {
				'bottom-start': 'top-full left-0 mt-1.5',
				'bottom-end': 'top-full right-0 mt-1.5',
				'top-start': 'bottom-full left-0 mb-1.5',
				'top-end': 'bottom-full right-0 mb-1.5'
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
	const panelClass = $derived(menuPanel({ placement, width, class: cls }));

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
			role="menu"
			tabindex="-1"
			class={panelClass}
			onclick={onContentClick}
			onkeydown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') popovers.close();
			}}
		>
			{@render children?.()}
		</div>
	{/if}
</div>
