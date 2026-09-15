<script lang="ts">
	import { onMount } from 'svelte';
	import { t } from '$lib/i18n/i18n.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { glo } from '$nostr/store.svelte';
	import { dataSync } from '$nostr/sync.svelte';

	let syncState = $state<'syncing' | 'done' | 'skipped'>('syncing');

	onMount(async () => {
		try {
			// Workspace creation already waits for the primary relay to accept both
			// events. Confirm those two records here without blocking the first-run
			// UI on every enabled relay or every operational data type.
			await dataSync.confirmSetupOnPrimary();
			// Restore tenant from synced data
			glo.hydrate('organization');
			glo.hydrate('location');
			const orgs = glo.all('organization');
			if (orgs.length > 0) {
				const d = orgs[0].data as Record<string, unknown>;
				tenant.configure({
					organizationName: (d.name as string) ?? tenant.state.organizationName,
					currency: (d.currency as string) ?? tenant.state.currency
				});
			}
			syncState = 'done';
			// Fan out reads and retry any secondary publish in an idle task. This is
			// intentionally not awaited: setup should feel instant once primary is
			// confirmed, while the normal sync keeps all relays converged.
			dataSync.backgroundOperationalSync();
		} catch {
			syncState = 'skipped';
		}
	});
</script>

<svelte:head><title>{t('setup.title')} · {t('setup.done')}</title></svelte:head>

<div class="flex flex-col items-center justify-center py-8 text-center">
	<div
		class="mb-6 grid size-20 place-items-center rounded-3xl bg-gradient-to-br from-primary-400 to-primary-600 shadow-xl shadow-primary-500/30"
	>
		{#if syncState === 'syncing'}
			<Icon name="lucide:loader-circle" class="size-10 animate-spin text-white" />
		{:else}
			<Icon name="lucide:party-popper" class="size-10 text-white" />
		{/if}
	</div>

	{#if syncState === 'syncing'}
		<h2 class="font-display text-2xl font-bold tracking-tight">Confirming your workspace…</h2>
		<p class="mt-2 max-w-sm text-[13.5px] text-[var(--ui-text-muted)]">
			Saving <strong>{tenant.state.organizationName}</strong> to your primary relay.
		</p>
		<a
			href={resolve('/')}
			class="mt-8 text-[12.5px] font-semibold text-[var(--ui-text-dimmed)] hover:text-[var(--ui-text)]"
			onclick={() => goto(resolve('/'), { replaceState: true })}
		>
			Skip & enter →
		</a>
	{:else}
		<h2 class="font-display text-2xl font-bold tracking-tight">You're all set!</h2>
		<p class="mt-2 max-w-sm text-[13.5px] text-[var(--ui-text-muted)]">
			<strong>{tenant.state.organizationName}</strong> is live on Nostr. Start a sale, build your catalog,
			and track every order — all signed by your key.
		</p>

		<div class="mt-8 flex flex-col gap-2 sm:flex-row">
			<Button
				color="primary"
				size="lg"
				icon="lucide:layout-dashboard"
				onclick={() => goto(resolve('/'), { replaceState: true })}
			>
				Enter BNOS
			</Button>
			<Button
				color="neutral"
				variant="subtle"
				size="lg"
				icon="lucide:scan-line"
				onclick={() => goto(resolve('/pos'), { replaceState: true })}
			>
				Go to POS
			</Button>
		</div>
	{/if}
</div>
