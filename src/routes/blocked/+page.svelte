<script lang="ts">
	import { goto } from '$app/navigation';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { session } from '$nostr/session.svelte';
	import { tenant } from '$nostr/tenant.svelte';
import { glo } from '$nostr/store.svelte';

	async function signOut() {
		await session.logout();
		tenant.reset();
		glo.clearAll();
		goto('/login', { replaceState: true });
	}
</script>

<svelte:head><title>BNOS · Account Restricted</title></svelte:head>

<div class="flex min-h-screen items-center justify-center px-4">
	<div class="w-full max-w-md space-y-6 text-center">
		<div class="grid size-20 place-items-center rounded-full bg-[var(--tone-error-bg)] mx-auto">
			<Icon name="lucide:shield-x" class="size-10 text-[var(--tone-error-text)]" />
		</div>
		<div>
			<h1 class="font-display text-2xl font-bold tracking-tight">Account Restricted</h1>
			<p class="mt-2 text-[13px] text-[var(--ui-text-muted)]">
				Your staff account is currently inactive or suspended. Please contact your manager or company owner to restore access.
			</p>
		</div>
		<div class="surface-card p-4">
			<p class="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--ui-text-dimmed)]">Your Public Key</p>
			<p class="break-all font-mono text-[12px] text-[var(--ui-text-muted)]">{session.npub ?? 'Not available'}</p>
		</div>
		<div class="flex flex-col gap-3">
			<Button color="neutral" variant="subtle" block icon="lucide:log-out" onclick={signOut}>Sign Out</Button>
			<Button color="neutral" variant="ghost" block icon="lucide:arrow-left" onclick={() => goto('/', { replaceState: true })}>Back to Dashboard</Button>
			<p class="text-[11px] text-[var(--ui-text-dimmed)]">
				If you believe this is an error, share your public key with your administrator.
			</p>
		</div>
	</div>
</div>
