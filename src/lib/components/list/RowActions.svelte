<script lang="ts">
	/**
	 * Per-row kebab actions menu. `actions` is an array of groups (each group is
	 * separated by a divider). Closes on outside click / ESC.
	 */
	import { tick } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { cn } from '$lib/utils/cn';

	export interface RowAction {
		label: string;
		icon?: string;
		danger?: boolean;
		onSelect: () => void;
	}

	let { actions }: { actions: RowAction[][] } = $props();

	let open = $state(false);
	let root = $state<HTMLElement>();
	let trigger = $state<HTMLButtonElement>();
	let menuEl = $state<HTMLElement>();
	let pos = $state({ top: 0, left: 0 });

	function place() {
		if (!menuEl || !trigger) return;
		const tr = trigger.getBoundingClientRect();
		const mr = menuEl.getBoundingClientRect();
		const below = window.innerHeight - tr.bottom;
		const above = tr.top;
		const openAbove = below < mr.height + 8 && above > below;
		pos = {
			top: openAbove ? tr.top - mr.height - 4 : tr.bottom + 4,
			left: Math.max(8, tr.right - mr.width)
		};
	}

	async function toggle() {
		open = !open;
		if (!open) return;
		await tick();
		place();
	}

	function onPointerDown(e: PointerEvent) {
		if (open && root && !root.contains(e.target as Node) && menuEl && !menuEl.contains(e.target as Node)) {
			open = false;
		}
	}
	function onKey(e: KeyboardEvent) {
		if (open && e.key === 'Escape') open = false;
	}
</script>

<svelte:window onpointerdown={onPointerDown} onkeydown={onKey} />

<div class="relative" bind:this={root}>
	<button
		type="button"
		bind:this={trigger}
		class="grid size-8 place-items-center rounded-lg text-[var(--ui-text-dimmed)] transition-colors hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]"
		aria-label="Row actions"
		onclick={toggle}
	>
		<Icon name="lucide:ellipsis-vertical" class="size-4" />
	</button>
	{#if open}
		<div
			bind:this={menuEl}
			class="animate-rise fixed z-50 min-w-[170px] rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg-elevated)] p-1.5 shadow-xl shadow-black/10"
			style={`top:${pos.top}px;left:${pos.left}px`}
			role="menu"
		>
			{#each actions as group, gi (gi)}
				{#if gi > 0}<div class="my-1 h-px bg-[var(--ui-border-muted)]"></div>{/if}
				{#each group as action (action.label)}
					<button
						type="button"
						role="menuitem"
						class={cn(
							'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[12.5px] font-medium transition-colors hover:bg-[var(--ui-bg-accented)]',
							action.danger ? 'text-[var(--tone-error-text)]' : 'text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'
						)}
						onclick={() => {
							action.onSelect();
							open = false;
						}}
					>
						{#if action.icon}<Icon name={action.icon} class="size-4" />{/if}
						{action.label}
					</button>
				{/each}
			{/each}
		</div>
	{/if}
</div>
