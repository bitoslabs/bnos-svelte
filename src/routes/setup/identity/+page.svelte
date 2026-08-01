<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import { session } from '$nostr/session.svelte';

	// identity is established at /login; this step confirms + explains.
</script>

<svelte:head><title>Setup · Identity</title></svelte:head>

<div class="space-y-5">
	<div>
		<h2 class="font-display text-xl font-bold tracking-tight">Your Nostr identity</h2>
		<p class="mt-1 text-[13.5px] text-[var(--ui-text-muted)]">
			bdGo OS signs every record (orders, products, payments) with your Nostr key. This identity is your
			company's root of trust on relays.
		</p>
	</div>

	<div class="surface-card flex items-center gap-4 p-4">
		<div class="grid size-12 shrink-0 place-items-center rounded-xl bg-primary-500/10 text-primary-600 dark:text-primary-400">
			<Icon name="lucide:fingerprint" class="size-6" />
		</div>
		<div class="min-w-0">
			<div class="text-[11px] font-semibold uppercase tracking-wider text-[var(--ui-text-dimmed)]">
				{session.loginMethod === 'extension' ? 'NIP-07 extension' : 'Private key'}
			</div>
			<div class="truncate font-mono text-[13.5px] font-semibold">{session.npub ?? '—'}</div>
		</div>
	</div>

	<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
		<div class="surface-card p-4">
			<Icon name="lucide:shield-check" class="mb-2 size-5 text-primary-500" />
			<div class="text-[13px] font-semibold">Self-custodial</div>
			<p class="mt-0.5 text-[12px] text-[var(--ui-text-muted)]">Your keys never leave this device.</p>
		</div>
		<div class="surface-card p-4">
			<Icon name="lucide:radio" class="mb-2 size-5 text-primary-500" />
			<div class="text-[13px] font-semibold">Relay-native</div>
			<p class="mt-0.5 text-[12px] text-[var(--ui-text-muted)]">Records sync over Nostr relays.</p>
		</div>
		<div class="surface-card p-4">
			<Icon name="lucide:wifi-off" class="mb-2 size-5 text-primary-500" />
			<div class="text-[13px] font-semibold">Offline-first</div>
			<p class="mt-0.5 text-[12px] text-[var(--ui-text-muted)]">Keep selling with no connection.</p>
		</div>
	</div>
</div>
