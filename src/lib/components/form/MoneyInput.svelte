<script lang="ts">
	import Input from '$lib/components/ui/Input.svelte';

	let {
		value = $bindable(),
		label,
		currency = 'LAK',
		placeholder
	}: {
		value: number | string;
		label?: string;
		currency?: string;
		placeholder?: string;
	} = $props();
</script>

{#if label}
	<label class="block">
		<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">{label}</span>
		<Input bind:value type="number" min="0" step="0.01" {placeholder} icon="lucide:banknote" class="w-full" />
	</label>
{:else}
	<Input bind:value type="number" min="0" step="0.01" {placeholder} icon="lucide:banknote" class="w-full" />
{/if}
