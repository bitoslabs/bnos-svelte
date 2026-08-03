<script lang="ts">
	let {
		label,
		hint,
		required = false,
		children
	}: {
		label: string;
		hint?: string;
		required?: boolean;
		children: import('svelte').Snippet;
	} = $props();
</script>

<label class="block">
	<span class="mb-1.5 flex items-center gap-1 text-[12px] font-semibold text-[var(--ui-text-muted)]">
		{label}{#if required}<span class="text-[var(--tone-error-text)]">*</span>{/if}
	</span>
	{@render children()}
	{#if hint}<span class="mt-1 block text-[11px] text-[var(--ui-text-dimmed)]">{hint}</span>{/if}
</label>
