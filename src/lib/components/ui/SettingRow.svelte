<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * A single setting row: title + optional description on the left, a control
	 * (Switch, Button, short Select, badge, …) on the right. The control is the
	 * default slot/children.
	 *
	 * For full-width form fields (Input that should stretch), use a custom
	 * layout instead — this component is for the label → control pattern.
	 */
	let {
		title,
		description = '',
		children
	}: { title: string; description?: string; children: Snippet } = $props();
</script>

<div class="flex items-center justify-between gap-4 px-5 py-4">
	<div class="min-w-0">
		<div class="text-[13px] font-semibold text-[var(--ui-text)]">{title}</div>
		{#if description}
			<p class="mt-0.5 text-[11px] text-[var(--ui-text-dimmed)]">{description}</p>
		{/if}
	</div>
	<div class="flex shrink-0 items-center gap-2">
		{@render children()}
	</div>
</div>
