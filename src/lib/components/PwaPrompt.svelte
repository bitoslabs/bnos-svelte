<script lang="ts">
	import { onMount } from 'svelte';
	import { t } from '$lib/i18n/i18n.svelte';
	import { pwaInfo } from 'virtual:pwa-info';

	let updateAvailable = $state(false);
	let offlineReady = $state(false);
	let deferredPrompt: {
		prompt: () => Promise<void>;
		userChoice: Promise<{ outcome: string }>;
	} | null = null;
	let canInstall = $state(false);

	onMount(() => {
		if (pwaInfo && 'serviceWorker' in navigator) {
			void navigator.serviceWorker.register('/sw.js').catch((error) => {
				console.error('Service worker registration failed:', error);
			});
		}

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
			void navigator.serviceWorker.ready.then((registration) => {
				registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
			});
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
</script>

{#if updateAvailable || canInstall || offlineReady}
	<div class="fixed right-4 bottom-4 z-50 flex flex-col items-end gap-2">
		{#if updateAvailable}
			<div
				class="flex items-center gap-3 rounded-xl border border-(--ui-border) bg-(--ui-bg-elevated) px-4 py-3 text-(--ui-text) shadow-(--shadow-pop)"
			>
				<div class="text-sm">
					<div class="font-medium">{t('pwa.updateAvailable')}</div>
					<div class="text-(--ui-text-muted)">{t('pwa.updateReady')}</div>
				</div>
				<button
					type="button"
					class="rounded-lg bg-primary-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-primary-400"
					onclick={applyUpdate}
				>
					{t('common.update')}
				</button>
				<button
					type="button"
					class="text-(--ui-text-muted) transition-colors hover:text-(--ui-text)"
					aria-label={t('common.close')}
					onclick={dismiss}
				>
					✕
				</button>
			</div>
		{/if}

		{#if canInstall}
			<div
				class="flex items-center gap-3 rounded-xl border border-(--ui-border) bg-(--ui-bg-elevated) px-4 py-3 text-(--ui-text) shadow-(--shadow-pop)"
			>
				<div class="text-sm">
					<div class="font-medium">{t('pwa.installApp')}</div>
					<div class="text-(--ui-text-muted)">{t('pwa.installDesc')}</div>
				</div>
				<button
					type="button"
					class="rounded-lg bg-primary-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-primary-400"
					onclick={installApp}
				>
					{t('pwa.install')}
				</button>
				<button
					type="button"
					class="text-(--ui-text-muted) transition-colors hover:text-(--ui-text)"
					aria-label={t('common.close')}
					onclick={dismissInstall}
				>
					✕
				</button>
			</div>
		{/if}

		{#if offlineReady}
			<div
				class="rounded-xl border border-(--ui-border) bg-(--ui-bg-elevated) px-4 py-3 text-sm text-(--ui-text) shadow-(--shadow-pop)"
			>
				✅ {t('pwa.offlineReady')}
			</div>
		{/if}
	</div>
{/if}
