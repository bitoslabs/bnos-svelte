<script lang="ts">
	import { cn } from '$lib/utils/cn';

	let {
		class: cls,
		children,
		color = 'neutral',
		variant = 'subtle'
	}: {
		class?: string;
		children: import('svelte').Snippet;
		color?: 'neutral' | 'primary' | 'success' | 'info' | 'warning' | 'error';
		variant?: 'subtle' | 'solid' | 'outline';
	} = $props();

	const tone = $derived(
		color === 'primary'
			? 'is-active-badge'
			: color === 'success'
				? 'tone-success'
				: color === 'info'
					? 'tone-info'
					: color === 'warning'
						? 'tone-warning'
						: color === 'error'
							? 'tone-error'
							: 'tone-neutral'
	);
</script>

<span
	class={cn(
		'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold',
		variant === 'outline' ? 'border border-[var(--ui-border)] text-[var(--ui-text-muted)]' : tone,
		cls
	)}
>
	{@render children()}
</span>
