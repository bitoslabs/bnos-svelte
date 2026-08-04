<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLInputAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils/cn';
	import Icon from './Icon.svelte';

	/**
	 * Checkbox — matches the app design system (tokens, focus ring, Icon).
	 *
	 * API mirrors {@link Switch}: `bind:checked` + optional `onCheckedChange`.
	 * Backed by a real (visually-hidden) `<input type="checkbox">` so it stays a
	 * native form control — accessible by default, keyboard-operable (Space),
	 * and drop-in for existing `bind:checked` usages.
	 *
	 * Variants:
	 *  - bare: `<Checkbox bind:checked />`
	 *  - labeled: `<Checkbox bind:checked label="…" description="…" />`
	 *  - custom content: `<Checkbox bind:checked>{@render …}</Checkbox>`
	 *  - select-all: `<Checkbox checked={all} indeterminate={some} onCheckedChange={…} />`
	 */
	let {
		class: cls,
		checked = $bindable(false),
		indeterminate = false,
		disabled = false,
		size = 'md',
		label,
		description,
		onCheckedChange,
		children,
		...rest
	}: {
		class?: string;
		checked?: boolean;
		/** Visual "mixed" state (dash). Does not affect `checked`. */
		indeterminate?: boolean;
		disabled?: boolean;
		size?: 'sm' | 'md' | 'lg';
		label?: string;
		description?: string;
		onCheckedChange?: (v: boolean) => void;
		children?: Snippet;
	} & Omit<HTMLInputAttributes, 'checked' | 'type' | 'size'> = $props();

	const boxSize = $derived(
		size === 'sm' ? 'size-3.5 rounded-[4px]' : size === 'lg' ? 'size-5 rounded-[6px]' : 'size-4 rounded-[5px]'
	);
	const tickSize = $derived(size === 'sm' ? 'size-2.5' : size === 'lg' ? 'size-3.5' : 'size-3');
	const dashSize = $derived(
		size === 'sm' ? 'h-0.5 w-1.5' : size === 'lg' ? 'h-0.5 w-2.5' : 'h-0.5 w-2'
	);
	const textSize = $derived(size === 'sm' ? 'text-[12px]' : 'text-[13px]');

	const active = $derived(checked || indeterminate);

	const boxClass = $derived(
		cn(
			// layout + base ring (focus comes from the peer input below)
			'pointer-events-none grid shrink-0 place-items-center border-2 transition-colors',
			boxSize,
			active
				? 'border-[var(--ui-color-primary-500)] bg-primary-500 text-white'
				: 'border-[var(--ui-border-accented)] bg-[var(--ui-bg-muted)] text-transparent group-hover/check:border-[var(--ui-color-primary-500)]',
			// focus ring driven by the visually-hidden native input
			'peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--ui-color-primary-500)] peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-[var(--ui-bg)]'
		)
	);

	const wrapperClass = $derived(
		cn(
			'group/check relative inline-flex select-none',
			// vertical alignment shifts slightly so the box sits on the text baseline
			label || description || children ? 'items-start gap-2.5' : 'items-center',
			disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
			cls
		)
	);

	function handleChange(e: Event) {
		onCheckedChange?.((e.currentTarget as HTMLInputElement).checked);
	}

	/** Keep the native input's `indeterminate` DOM property in sync with the prop
	 *  (it's a property, not an attribute, so it needs an action). */
	function syncIndeterminate(node: HTMLInputElement, value: boolean) {
		node.indeterminate = value;
		return {
			update(next: boolean) {
				node.indeterminate = next;
			}
		};
	}
</script>

<label class={wrapperClass}>
	<span class="relative inline-flex shrink-0 items-center pt-px">
		<input
			type="checkbox"
			bind:checked
			{disabled}
			onchange={handleChange}
			use:syncIndeterminate={indeterminate}
			class="peer sr-only"
			{...rest as HTMLInputAttributes}
		/>
		<span class={boxClass}>
			{#if indeterminate}
				<span class={cn('rounded-full bg-current', dashSize)}></span>
			{:else if checked}
				<Icon name="lucide:check" class={cn('stroke-[3]', tickSize)} />
			{/if}
		</span>
	</span>

	{#if label || description || children}
		<span class="min-w-0 flex-1 leading-tight">
			{#if children}
				{@render children()}
			{:else if label}
				<span class={cn('block font-medium text-[var(--ui-text)]', textSize)}>{label}</span>
			{/if}
			{#if description}
				<span class="mt-0.5 block text-[11.5px] text-[var(--ui-text-dimmed)]">{description}</span>
			{/if}
		</span>
	{/if}
</label>
