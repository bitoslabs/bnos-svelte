<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { t } from '$lib/i18n/i18n.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { resolveWorkspace } from '$nostr/workspace.svelte';
	import { memberships } from '$nostr/memberships.svelte';
	import { toast } from '$lib/stores/toast.svelte';

	let restoring = $state(false);

	function startNew() {
		void goto(resolve('/setup/identity'));
	}

	/** Restore an existing workspace (company + branch + data) from relays. */
	async function restoreExisting() {
		if (restoring) return;
		restoring = true;
		try {
			const workspace = await resolveWorkspace({ allowRelaySync: true });
			const staffWorkspace = workspace.found ? false : await memberships.resolveStaffWorkspace();
			if (workspace.found) await memberships.resolve();
			memberships.autoResolve();

			if (workspace.found || staffWorkspace || tenant.state.setupComplete) {
				toast.success(t('setup.restoreDone'), t('setup.restoreDoneDesc'));
				await goto(resolve('/'), { replaceState: true });
			} else {
				toast.warning(t('setup.restoreEmpty'), t('setup.restoreEmptyDesc'));
			}
		} catch (e) {
			toast.error(t('setup.restoreFailed'), e instanceof Error ? e.message : undefined);
		} finally {
			restoring = false;
		}
	}
</script>

<svelte:head><title>{t('setup.title')} · {t('common.appName')}</title></svelte:head>

<div class="mx-auto max-w-lg">
	<div class="mb-6 text-center">
		<div class="mx-auto mb-4 grid size-16 place-items-center rounded-2xl bg-primary-500/10">
			<Icon name="lucide:layers" class="size-8 text-primary-500" />
		</div>
		<h1 class="font-display text-xl font-bold tracking-tight">{t('setup.welcomeTitle')}</h1>
		<p class="mt-1 text-[12.5px] text-(--ui-text-muted)">{t('setup.welcomeDesc')}</p>
	</div>

	<div class="surface-card divide-y divide-(--ui-border-muted) overflow-hidden">
		<button
			type="button"
			onclick={restoreExisting}
			disabled={restoring}
			class="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-(--ui-bg-muted) disabled:opacity-60"
		>
			<span
				class="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-500/10 text-primary-500"
			>
				<Icon
					name={restoring ? 'lucide:loader-circle' : 'lucide:refresh-cw'}
					class="size-5 {restoring ? 'animate-spin' : ''}"
				/>
			</span>
			<span class="min-w-0 flex-1">
				<span class="block text-[13.5px] font-semibold text-(--ui-text)"
					>{restoring ? t('setup.restoring') : t('setup.haveDataTitle')}</span
				>
				<span class="mt-0.5 block text-[11.5px] text-(--ui-text-muted)"
					>{t('setup.haveDataDesc')}</span
				>
				<span class="mt-1 block text-[11px] text-(--ui-text-dimmed)">{t('setup.restoreHint')}</span>
			</span>
			<Icon name="lucide:chevron-right" class="size-4 shrink-0 text-(--ui-text-dimmed)" />
		</button>

		<button
			type="button"
			onclick={startNew}
			disabled={restoring}
			class="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-(--ui-bg-muted) disabled:opacity-60"
		>
			<span
				class="grid size-10 shrink-0 place-items-center rounded-xl bg-(--ui-bg-accented) text-(--ui-text-muted)"
			>
				<Icon name="lucide:sparkles" class="size-5" />
			</span>
			<span class="min-w-0 flex-1">
				<span class="block text-[13.5px] font-semibold text-(--ui-text)"
					>{t('setup.startNewTitle')}</span
				>
				<span class="mt-0.5 block text-[11.5px] text-(--ui-text-muted)"
					>{t('setup.startNewDesc')}</span
				>
			</span>
			<Icon name="lucide:chevron-right" class="size-4 shrink-0 text-(--ui-text-dimmed)" />
		</button>
	</div>
</div>
