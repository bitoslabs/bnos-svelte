<script lang="ts">
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { t } from '$lib/i18n/i18n.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { session } from '$nostr/session.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { glo } from '$nostr/store.svelte';

	async function signOut() {
		await session.logout();
		tenant.reset();
		glo.clearAll();
		goto(resolve('/login'), { replaceState: true });
	}
</script>

<svelte:head><title>{t('common.appName')} · {t('blocked.title')}</title></svelte:head>

<div class="flex min-h-screen items-center justify-center px-4">
	<div class="w-full max-w-md space-y-6 text-center">
		<div class="mx-auto grid size-20 place-items-center rounded-full bg-(--tone-error-bg)">
			<Icon name="lucide:shield-x" class="size-10 text-(--tone-error-text)" />
		</div>
		<div>
			<h1 class="font-display text-2xl font-bold tracking-tight">Account Restricted</h1>
			<p class="mt-2 text-[13px] text-(--ui-text-muted)">
				Your staff account is currently inactive or suspended. Please contact your manager or
				company owner to restore access.
			</p>
		</div>
		<div class="surface-card p-4">
			<p class="mb-1 text-[11px] font-semibold tracking-wider text-(--ui-text-dimmed) uppercase">
				Your Public Key
			</p>
			<p class="font-mono text-[12px] break-all text-(--ui-text-muted)">
				{session.npub ?? 'Not available'}
			</p>
		</div>
		<div class="flex flex-col gap-3">
			<Button color="neutral" variant="subtle" block icon="lucide:log-out" onclick={signOut}
				>Sign Out</Button
			>
			<Button
				color="neutral"
				variant="ghost"
				block
				icon="lucide:arrow-left"
				onclick={() => goto(resolve('/'), { replaceState: true })}>Back to Dashboard</Button
			>
			<p class="text-[11px] text-(--ui-text-dimmed)">
				If you believe this is an error, share your public key with your administrator.
			</p>
		</div>
	</div>
</div>
