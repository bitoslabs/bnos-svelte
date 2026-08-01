<script lang="ts" module>
	import { tv, type VariantProps } from 'tailwind-variants';

	export const button = tv({
		base: 'inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-semibold transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 select-none',
		variants: {
			color: { primary: '', neutral: '', error: '' },
			variant: { solid: '', subtle: 'border', ghost: '', soft: '' },
			size: {
				sm: 'h-8 px-3 text-[13px] rounded-lg',
				md: 'h-9.5 px-3.5 text-[13.5px] rounded-lg',
				lg: 'h-11 px-5 text-[14px] rounded-xl',
				icon: 'size-9.5 rounded-lg',
				'icon-sm': 'size-8 rounded-lg'
			},
			block: { true: 'w-full', false: '' }
		},
		compoundVariants: [
			{ color: 'primary', variant: 'solid', class: 'bg-primary-500 text-white hover:bg-primary-400' },
			{
				color: 'primary',
				variant: 'subtle',
				class: 'bg-primary-500/10 text-primary-700 dark:text-primary-300 border-primary-500/30 hover:bg-primary-500/15'
			},
			{
				color: 'primary',
				variant: 'soft',
				class: 'bg-primary-500/15 text-primary-700 dark:text-primary-300 hover:bg-primary-500/20'
			},
			{
				color: 'primary',
				variant: 'ghost',
				class: 'text-primary-600 dark:text-primary-400 hover:bg-primary-500/10'
			},
			{
				color: 'neutral',
				variant: 'solid',
				class: 'bg-[var(--ui-bg-elevated)] text-[var(--ui-text)] border border-[var(--ui-border)] hover:bg-[var(--interactive-hover-bg)]'
			},
			{
				color: 'neutral',
				variant: 'subtle',
				class: 'bg-[var(--ui-bg-muted)] text-[var(--ui-text)] border-[var(--ui-border)] hover:bg-[var(--interactive-hover-bg)]'
			},
			{
				color: 'neutral',
				variant: 'soft',
				class: 'bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)] hover:text-[var(--ui-text)] hover:bg-[var(--interactive-hover-bg)]'
			},
			{
				color: 'neutral',
				variant: 'ghost',
				class: 'text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]'
			},
			{ color: 'error', variant: 'solid', class: 'bg-[var(--tone-error-text)] text-white hover:opacity-90' },
			{
				color: 'error',
				variant: 'subtle',
				class: 'bg-[var(--tone-error-bg)] text-[var(--tone-error-text)] border-[var(--danger-border)] hover:opacity-90'
			},
			{
				color: 'error',
				variant: 'soft',
				class: 'bg-[var(--tone-error-bg)] text-[var(--tone-error-text)] hover:opacity-90'
			},
			{
				color: 'error',
				variant: 'ghost',
				class: 'text-[var(--tone-error-text)] hover:bg-[var(--tone-error-bg)]'
			}
		],
		defaultVariants: { color: 'neutral', variant: 'solid', size: 'md' }
	});

	export type ButtonVariants = VariantProps<typeof button>;
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';
	import Icon from './Icon.svelte';

	let {
		class: cls,
		color = 'neutral',
		variant = 'solid',
		size = 'md',
		block = false,
		icon,
		trailingIcon,
		square = false,
		href,
		type = 'button',
		children,
		...rest
	}: {
		class?: string;
		color?: ButtonVariants['color'];
		variant?: ButtonVariants['variant'];
		size?: ButtonVariants['size'];
		block?: boolean;
		icon?: string;
		trailingIcon?: string;
		square?: boolean;
		href?: string;
		type?: HTMLButtonAttributes['type'];
		children?: Snippet;
	} & HTMLButtonAttributes &
		HTMLAnchorAttributes = $props();

	const sizeKey = $derived(square ? (size === 'sm' || size === 'lg' ? 'icon-sm' : 'icon') : size);
	const computed = $derived(button({ color, variant, size: sizeKey, block, class: cls }));
</script>

{#if href}
	<a {href} class={computed} {...rest}>
		{#if icon}<Icon name={icon} class="size-4 shrink-0" />{/if}
		{#if children}{@render children()}{/if}
		{#if trailingIcon}<Icon name={trailingIcon} class="size-4 shrink-0" />{/if}
	</a>
{:else}
	<button {type} class={computed} {...rest}>
		{#if icon}<Icon name={icon} class="size-4 shrink-0" />{/if}
		{#if children}{@render children()}{/if}
		{#if trailingIcon}<Icon name={trailingIcon} class="size-4 shrink-0" />{/if}
	</button>
{/if}
