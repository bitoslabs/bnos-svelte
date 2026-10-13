<script lang="ts">
	import { onMount } from 'svelte';
	import { t } from '$lib/i18n/i18n.svelte';

	let updateAvailable = $state(false);
	let offlineReady = $state(false);
	let deferredPrompt: {
		prompt: () => Promise<void>;
		userChoice: Promise<{ outcome: string }>;
	} | null = null;
	let canInstall = $state(false);

	onMount(() => {
		if ('serviceWorker' in navigator) {
			navigator.serviceWorker.addEventListener('controllerchange', () => {
				// Page will reload via the SW registration
			});
		}

		// Listen for beforeinstallprompt
		window.addEventListener('beforeinstallprompt', (e) => {
			e.preventDefault();
			deferredPrompt = e as never;
			canInstall = true;
		});

		window.addEventListener('appinstalled', () => {
			canInstall = false;
			deferredPrompt = null;
		});
	});

	async function applyUpdate() {
		if (deferredPrompt) {
			// If install prompt available, trigger it
			await deferredPrompt.prompt();
			deferredPrompt = null;
			canInstall = false;
		} else {
			// Send message to SW to skip waiting
			if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
				navigator.serviceWorker.controller.postMessage({ type: 'SKIP_WAITING' });
			}
			location.reload();
		}
		updateAvailable = false;
	}

	function dismiss() {
		updateAvailable = false;
	}

	function dismissInstall() {
		canInstall = false;
	}

	// Expose for import { pwaInfo } from 'virtual:pwa-type-info'
</script>

{#if updateAvailable}
	<div
		class="fixed right-4 bottom-4 z-50 flex items-center gap-3 rounded-xl border border-(--glass-border) bg-(--surface-2) px-4 py-3 shadow-lg"
	>
		<div class="text-sm">
			<div class="font-medium">{t('pwa.updateAvailable')}</div>
			<div class="text-(--text-muted)">{t('pwa.updateReady')}</div>
		</div>
		<button
			type="button"
			class="rounded-lg bg-(--accent) px-3 py-1.5 text-sm font-medium text-white"
			onclick={applyUpdate}
		>
			{t('common.update')}
		</button>
		<button type="button" class="text-(--text-muted) hover:text-(--text)" onclick={dismiss}>
			✕
		</button>
	</div>
{/if}

{#if canInstall}
	<div
		class="fixed right-4 bottom-4 z-50 flex items-center gap-3 rounded-xl border border-(--glass-border) bg-(--surface-2) px-4 py-3 shadow-lg"
	>
		<div class="text-sm">
			<div class="font-medium">{t('pwa.installApp')}</div>
			<div class="text-(--text-muted)">{t('pwa.installDesc')}</div>
		</div>
		<button
			type="button"
			class="rounded-lg bg-(--accent) px-3 py-1.5 text-sm font-medium text-white"
			onclick={applyUpdate}
		>
			{t('pwa.install')}
		</button>
		<button type="button" class="text-(--text-muted) hover:text-(--text)" onclick={dismissInstall}>
			✕
		</button>
	</div>
{/if}

{#if offlineReady}
	<div
		class="fixed right-4 bottom-4 z-50 rounded-xl border border-(--glass-border) bg-(--surface-2) px-4 py-3 text-sm shadow-lg"
	>
		✅ {t('pwa.offlineReady')}
	</div>
{/if}
