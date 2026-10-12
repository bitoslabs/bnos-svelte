<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { t } from '$lib/i18n/i18n.svelte';

	onMount(() => {
		void goto('/setup/identity', { replaceState: true });
	});
</script>

<svelte:head><title>{t('setup.title')} · {t('common.appName')}</title></svelte:head>
