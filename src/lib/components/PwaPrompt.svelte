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
		const onBeforeInstall = (event: Event) => {
			event.preventDefault();
			deferredPrompt = event as never;
			canInstall = true;
		};
		const onInstalled = () => {
			canInstall = false;
			deferredPrompt = null;
		};

		let cancelled = false;
		if ('serviceWorker' in navigator) {
			const hadController = !!navigator.serviceWorker.controller;
			void navigator.serviceWorker.ready.then((registration) => {
				if (cancelled) return;
				if (!hadController) {
					offlineReady = true;
					setTimeout(() => (offlineReady = false), 4000);
				}
				if (registration.waiting) updateAvailable = true;
				registration.addEventListener('updatefound', () => {
					const installing = registration.installing;
					if (!installing) return;
					installing.addEventListener('statechange', () => {
						if (
							!cancelled &&
							installing.state === 'installed' &&
							navigator.serviceWorker.controller
						) {
							updateAvailable = true;
						}
					});
				});
			});
		}

		window.addEventListener('beforeinstallprompt', onBeforeInstall);
		window.addEventListener('appinstalled', onInstalled);
		return () => {
			cancelled = true;
			window.removeEventListener('beforeinstallprompt', onBeforeInstall);
			window.removeEventListener('appinstalled', onInstalled);
		};
	});

	async function installApp() {
		if (!deferredPrompt) return;
		await deferredPrompt.prompt();
		deferredPrompt = null;
		canInstall = false;
	}

	function applyUpdate() {
		if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
			// Wait for the new worker to take control before reloading; reloading
			// immediately can re-run the old worker before skipWaiting is handled.
			const onControllerChange = () => {
				navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
				location.reload();
			};
			navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
			navigator.serviceWorker.controller.postMessage({ type: 'SKIP_WAITING' });
		} else {
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
			onclick={installApp}
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
