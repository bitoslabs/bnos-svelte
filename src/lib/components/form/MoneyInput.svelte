<script lang="ts">
	import NumberInput from '$lib/components/ui/NumberInput.svelte';

	let {
		value = $bindable<number | ''>(''),
		label,
		currency = 'LAK',
		placeholder
	}: {
		value?: number | '';
		label?: string;
		currency?: string;
		placeholder?: string;
	} = $props();
</script>

{#snippet field()}
	<NumberInput
		bind:value
		min={0}
		decimals={2}
		suffix={currency}
		{placeholder}
		icon="lucide:banknote"
		class="w-full"
	/>
{/snippet}

{#if label}
	<label class="block">
		<span class="mb-1.5 block text-[12px] font-semibold text-(--ui-text-muted)">{label}</span>
		{@render field()}
	</label>
{:else}
	{@render field()}
{/if}
