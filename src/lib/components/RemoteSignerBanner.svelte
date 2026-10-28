<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { t } from '$lib/i18n/i18n.svelte';
	import { session } from '$nostr/session.svelte';
	import { signOutAndClear } from '$nostr/sign-out';

	let retrying = $state(false);
	let signingOut = $state(false);

	async function retry() {
		retrying = true;
		try {
			await session.verifyRemoteSigner(true);
		} finally {
			retrying = false;
		}
	}

	async function reconnect() {
		signingOut = true;
		try {
			await signOutAndClear();
			await goto(resolve('/login'), { replaceState: true });
		} finally {
			signingOut = false;
		}
	}
</script>

{#if session.remoteSignerLost}
	<div
		class="fixed inset-x-3 bottom-3 z-[95] mx-auto flex max-w-md items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 shadow-lg dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-100"
		role="alert"
	>
		<Icon name="lucide:plug-zap" class="mt-0.5 size-5 shrink-0" />
		<div class="min-w-0 flex-1">
			<p class="text-[12.5px] font-semibold">{t('auth.remoteSignerLostTitle')}</p>
			<p class="mt-0.5 text-[11px] leading-relaxed opacity-90">
				{t('auth.remoteSignerLostDesc')}
			</p>
			<div class="mt-2 flex items-center gap-2">
				<button
					type="button"
					class="rounded-lg bg-amber-600 px-2.5 py-1.5 text-[11.5px] font-semibold text-white transition-colors hover:bg-amber-500 disabled:opacity-60"
					onclick={reconnect}
					disabled={signingOut || retrying}
				>
					{t('auth.remoteSignerReconnect')}
				</button>
				<button
					type="button"
					class="rounded-lg px-2.5 py-1.5 text-[11.5px] font-semibold text-amber-900/80 transition-colors hover:bg-amber-100 disabled:opacity-60 dark:text-amber-100/80 dark:hover:bg-amber-500/20"
					onclick={retry}
					disabled={retrying || signingOut}
				>
					{retrying ? t('auth.remoteSignerRetrying') : t('auth.remoteSignerRetry')}
				</button>
			</div>
		</div>
	</div>
{/if}
