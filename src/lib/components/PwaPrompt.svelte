<script lang="ts">
	import { onMount } from 'svelte';

	let updateAvailable = $state(false);
	let offlineReady = $state(false);
	let deferredPrompt: { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> } | null = null;
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
	<div class="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-xl border border-[var(--glass-border)] bg-[var(--surface-2)] px-4 py-3 shadow-lg">
		<div class="text-sm">
			<div class="font-medium">Update available</div>
			<div class="text-[var(--text-muted)]">A new version is ready.</div>
		</div>
		<button
			type="button"
			class="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white"
			onclick={applyUpdate}
		>
			Update
		</button>
		<button type="button" class="text-[var(--text-muted)] hover:text-[var(--text)]" onclick={dismiss}>
			✕
		</button>
	</div>
{/if}

{#if canInstall}
	<div class="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-xl border border-[var(--glass-border)] bg-[var(--surface-2)] px-4 py-3 shadow-lg">
		<div class="text-sm">
			<div class="font-medium">Install app</div>
			<div class="text-[var(--text-muted)]">Add BNOS to your home screen.</div>
		</div>
		<button
			type="button"
			class="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white"
			onclick={applyUpdate}
		>
			Install
		</button>
		<button type="button" class="text-[var(--text-muted)] hover:text-[var(--text)]" onclick={dismissInstall}>
			✕
		</button>
	</div>
{/if}

{#if offlineReady}
	<div
		class="fixed bottom-4 right-4 z-50 rounded-xl border border-[var(--glass-border)] bg-[var(--surface-2)] px-4 py-3 text-sm shadow-lg"
	>
		✅ App ready to work offline
	</div>
{/if}
