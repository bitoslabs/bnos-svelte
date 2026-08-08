<script lang="ts">
	import { onMount } from 'svelte';
	import { t } from '$lib/i18n/i18n.svelte';

	let isOffline = $state(false);

	onMount(() => {
		isOffline = !navigator.onLine;

		const goOffline = () => (isOffline = true);
		const goOnline = () => (isOffline = false);

		window.addEventListener('offline', goOffline);
		window.addEventListener('online', goOnline);

		return () => {
			window.removeEventListener('offline', goOffline);
			window.removeEventListener('online', goOnline);
		};
	});
</script>

{#if isOffline}
	<div
		class="pointer-events-none fixed left-1/2 top-2 z-[60] -translate-x-1/2 rounded-full bg-amber-500/90 px-3 py-1 text-xs font-medium text-white shadow-md backdrop-blur"
	>
		⚠ {t('offline.banner')}
	</div>
{/if}
