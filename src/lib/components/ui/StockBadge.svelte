<script lang="ts">
	import Badge from './Badge.svelte';

	let {
		level = 0,
		threshold = 5
	}: {
		level: number;
		threshold?: number;
	} = $props();

	let color = $derived<'error' | 'warning' | 'success'>(level === 0 ? 'error' : level <= threshold ? 'warning' : 'success');
	let text = $derived(level === 0 ? 'Out of stock' : level <= threshold ? `Low: ${level}` : `${level} in stock`);
</script>

<Badge {color}>{text}</Badge>
