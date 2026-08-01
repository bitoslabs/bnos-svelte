<script lang="ts" module>
	import Iconify from '@iconify/svelte';
	import { resolveIcon } from '$lib/icons';
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
</script>

{#if name}
	<Iconify icon={resolveIcon(name)} width={size} height={size} class={cls} />
{/if}
