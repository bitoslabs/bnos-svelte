<script lang="ts">
	import { onMount } from 'svelte';
	import { t } from '$lib/i18n/i18n.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import SettingsSection from '$lib/components/ui/SettingsSection.svelte';
	import SettingRow from '$lib/components/ui/SettingRow.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { bitosPay, bitosPayUrl } from '$lib/pay/state.svelte';

	onMount(() => bitosPay.load());

	async function connect() {
		try {
			await bitosPay.connect();
			toast.success(t('settings.bitosPayConnectToast'));
		} catch (error) {
			toast.error(t('settings.bitosPayError'), error instanceof Error ? error.message : undefined);
		}
	}

	async function sync() {
		try {
			await bitosPay.sync();
			toast.success(t('settings.bitosPaySyncToast'));
		} catch (error) {
			toast.error(t('settings.bitosPayError'), error instanceof Error ? error.message : undefined);
		}
	}

	function disconnect() {
		bitosPay.disconnect();
		toast.success(t('settings.bitosPayDisconnectToast'));
	}
</script>

<svelte:head><title>{t('settings.bitosPay')} · {t('common.settings')}</title></svelte:head>

<div class="space-y-5">
	<PageHeader
		icon="lucide:zap"
		title={t('settings.bitosPay')}
		description={t('settings.bitosPayDesc')}
	/>

	{#if !bitosPayUrl}
		<div
			class="flex items-start gap-3 rounded-xl border border-(--tone-warning-text)/30 bg-(--tone-warning-bg) px-4 py-3"
		>
			<Icon name="lucide:info" class="mt-0.5 size-4 shrink-0 text-(--tone-warning-text)" />
			<p class="text-[12px] text-(--tone-warning-text)">{t('settings.bitosPayUnavailable')}</p>
		</div>
	{:else}
		<SettingsSection
			icon="lucide:link"
			title={t('settings.bitosPayWorkspace')}
			meta={bitosPay.connection
				? t('settings.bitosPayConnected')
				: t('settings.bitosPayNotConnected')}
		>
			{#if !bitosPay.connection}
				<div class="space-y-4 px-5 py-4">
					<p class="text-[12px] text-(--ui-text-muted)">{t('settings.bitosPayConnectDesc')}</p>
					<Button color="primary" icon="lucide:link" disabled={bitosPay.busy} onclick={connect}>
						{bitosPay.busy ? t('settings.bitosPayConnecting') : t('settings.bitosPayConnect')}
					</Button>
				</div>
			{:else}
				<SettingRow
					title={t('settings.bitosPayWorkspace')}
					description={bitosPay.connection?.workspaceName}
				>
					<span class="font-mono text-[11px] text-(--ui-text-muted)"
						>{bitosPay.connection?.workspaceId}</span
					>
				</SettingRow>
				<SettingRow title={t('settings.bitosPaySubject')}>
					<span class="font-mono text-[11px] text-(--ui-text-muted)"
						>{bitosPay.connection?.subjectRef}</span
					>
				</SettingRow>
				<SettingRow title={t('settings.bitosPayMerchantId')}>
					<span class="font-mono text-[11px] text-(--ui-text-muted)"
						>{bitosPay.connection?.merchantId}</span
					>
				</SettingRow>
				<SettingRow
					title={t('settings.bitosPayPlan')}
					description={bitosPay.entitlement?.source === 'default_free'
						? t('settings.bitosPayFreePlan')
						: undefined}
				>
					<span class="text-[12px] font-semibold">
						{bitosPay.entitlement?.plan ?? t('settings.bitosPayPlanUnknown')}
					</span>
				</SettingRow>
				<SettingRow title={t('settings.bitosPayPlanStatus')}>
					<span class="text-[12px]">{bitosPay.entitlement?.status ?? '—'}</span>
				</SettingRow>
				<div class="flex flex-wrap gap-2 px-5 py-4">
					<Button
						color="primary"
						icon="lucide:external-link"
						href={bitosPay.connection?.consoleUrl}
						target="_blank"
						rel="noopener"
					>
						{t('settings.bitosPayOpenConsole')}
					</Button>
					<Button icon="lucide:refresh-cw" disabled={bitosPay.busy} onclick={sync}>
						{t('settings.bitosPaySync')}
					</Button>
					<Button color="error" variant="ghost" icon="lucide:unlink" onclick={disconnect}>
						{t('settings.bitosPayDisconnect')}
					</Button>
				</div>
				{#if !bitosPay.connection?.apiKey}
					<div class="px-5 py-4">
						<p class="text-[11px] text-(--tone-warning-text)">{t('settings.bitosPayNoKey')}</p>
					</div>
				{/if}
			{/if}
		</SettingsSection>

		<div
			class="flex items-start gap-3 rounded-xl border border-(--tone-warning-text)/30 bg-(--tone-warning-bg) px-4 py-3"
		>
			<Icon name="lucide:shield-alert" class="mt-0.5 size-4 shrink-0 text-(--tone-warning-text)" />
			<p class="text-[11px] text-(--tone-warning-text)">{t('settings.bitosPayKeyNote')}</p>
		</div>

		{#if bitosPay.error}
			<div
				class="rounded-xl border border-(--tone-error-text)/30 bg-(--tone-error-bg) px-4 py-3 text-[12px] text-(--tone-error-text)"
			>
				{bitosPay.error}
			</div>
		{/if}
	{/if}
</div>
