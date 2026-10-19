<script lang="ts">
	/**
	 * Rare-path icon renderer: the generated Lucide subset misses this name, so
	 * pull in the full collection once and render when it arrives. Keeping this
	 * in its own component means normal icons don't pay for an effect.
	 */
	import Iconify from '@iconify/svelte';
	import { loadFullIcons } from '$lib/icons';

	let {
		icon,
		size = '1em',
		class: cls
	}: { icon: string; size?: string; class?: string } = $props();

	let ready = $state(false);
	$effect(() => {
		let cancelled = false;
		void loadFullIcons().then(() => {
			if (!cancelled) ready = true;
		});
		return () => {
			cancelled = true;
		};
	});
</script>

{#if ready}
	<Iconify {icon} width={size} height={size} class={cls} />
{/if}
