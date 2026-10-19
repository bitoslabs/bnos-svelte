<script lang="ts" module>
	import Iconify from '@iconify/svelte';
	import IconFallback from './IconFallback.svelte';
	import { hasLocalIcon, resolveIcon } from '$lib/icons';
</script>

<script lang="ts">
	/**
	 * App-level Icon wrapper around @iconify/svelte.
	 * Accepts Nuxt-Icon style names (`i-lucide-plus`) OR Iconify names (`lucide:plus`)
	 * OR bdgo-os names (`solar:…`, `flowbite:…`) which are resolved to the closest
	 * Lucide glyph. Lucide is registered offline in lib/icons.ts (SSR-safe).
	 */
	let {
		name,
		class: cls,
		size = '1em'
	}: {
		name: string;
		class?: string;
		size?: string;
	} = $props();

	const iconName = $derived(resolveIcon(name));
</script>

{#if name}
	{#if hasLocalIcon(iconName)}
		<Iconify icon={iconName} width={size} height={size} class={cls} />
	{:else}
		<!-- Name came from external data rather than the source scan. -->
		<IconFallback icon={iconName} {size} class={cls} />
	{/if}
{/if}
