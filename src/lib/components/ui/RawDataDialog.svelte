<script lang="ts">
	import Dialog from './Dialog.svelte';
	import Icon from './Icon.svelte';

	let { open = $bindable(), data, title = 'Raw Data' }: { open?: boolean; data: unknown; title?: string } = $props();

	let copied = $state(false);

	function copyJson() {
		const json = JSON.stringify(data, null, 2);
		navigator.clipboard?.writeText(json);
		copied = true;
		setTimeout(() => (copied = false), 1500);
	}

	const jsonStr = $derived(JSON.stringify(data, null, 2));
</script>

<Dialog bind:open {title} size="lg">
	<div class="flex items-center justify-between border-b border-[var(--ui-border-muted)] px-4 py-2.5">
		<span class="text-[11.5px] font-semibold uppercase tracking-wider text-[var(--ui-text-dimmed)]">GLO Event Data</span>
		<button
			type="button"
			onclick={copyJson}
			class="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11.5px] font-semibold text-primary-600 hover:bg-primary-500/10 dark:text-primary-400"
		>
			<Icon name={copied ? 'lucide:check' : 'lucide:copy'} class="size-3.5" />
			{copied ? 'Copied' : 'Copy'}
		</button>
	</div>
	<pre class="max-h-[60vh] overflow-auto bg-[var(--ui-bg-muted)] p-4 text-[11.5px] leading-relaxed"><code>{jsonStr}</code></pre>
</Dialog>
