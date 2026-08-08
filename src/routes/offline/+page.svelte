<script lang="ts">
	import { goto } from '$app/navigation';
	import { t } from '$lib/i18n/i18n.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';

	function reload() { window.location.reload(); }
</script>

<svelte:head><title>{t('common.appName')} · {t('common.offline')}</title></svelte:head>

<div class="flex min-h-screen items-center justify-center px-4 py-10">
	<div class="flex min-h-[70vh] w-full max-w-xl flex-col justify-center">
		<div class="mb-6 grid size-14 place-items-center rounded-lg bg-[var(--tone-warning-bg)]">
			<Icon name="lucide:cloud-off" class="size-7 text-[var(--tone-warning-text)]" />
		</div>
		<h1 class="font-display text-3xl font-bold tracking-tight">You're offline</h1>
		<p class="mt-3 text-[13.5px] leading-6 text-[var(--ui-text-muted)]">
			The app is working in offline mode. You can keep selling — all data is saved locally and will sync to relays when the connection comes back.
		</p>
		<div class="mt-8 flex flex-wrap gap-3">
			<Button color="primary" icon="lucide:scan-line" onclick={() => goto('/pos')}>Open POS</Button>
			<Button color="neutral" variant="subtle" icon="lucide:refresh-cw" onclick={reload}>Retry connection</Button>
		</div>
	</div>
</div>
