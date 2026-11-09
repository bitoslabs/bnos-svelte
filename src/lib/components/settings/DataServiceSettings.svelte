<script lang="ts">
	import { t } from '$lib/i18n/i18n.svelte';
	import { i18n } from '$lib/i18n/i18n.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import SettingsSection from '$lib/components/ui/SettingsSection.svelte';
	import { permissions } from '$lib/permissions.svelte';
	import {
		dataService,
		cloudServiceUrl,
		type DataServiceConnectionState
	} from '$lib/data-service/state.svelte';
	import type { DataServiceErrorCode } from '$lib/data-service/protocol';
	import { toast } from '$lib/stores/toast.svelte';
	import { confirm } from '$lib/stores/confirm.svelte';
	import { dayPeriod, publishReportSnapshot } from '$lib/reports/snapshot-service';

	const canManage = $derived(permissions.can('settings', 'write'));
	const cloudAvailable = cloudServiceUrl !== null;

	let mode = $state<'selfHosted' | 'cloud'>('selfHosted');
	let url = $state('');
	let setupCode = $state('');
	let busy = $state<'connect' | 'test' | 'disconnect' | 'sync' | 'snapshot' | null>(null);
	let formError = $state<string | null>(null);

	$effect(() => {
		const base = dataService.metadata?.baseUrl;
		if (base && !url) url = base;
	});

	const configured = $derived(dataService.configured);
	const reporting = $derived(dataService.metadata?.capabilities.reporting === true);
	const stateLabel = $derived(statusText(dataService.status));
	const stateTone = $derived(statusTone(dataService.status));

	function statusText(status: DataServiceConnectionState): string {
		switch (status) {
			case 'connecting':
				return t('settings.dataService.statusConnecting');
			case 'connected':
				return t('settings.dataService.statusConnected');
			case 'offline':
				return t('settings.dataService.statusOffline');
			case 'auth-required':
				return t('settings.dataService.statusAuthRequired');
			case 'permission-denied':
				return t('settings.dataService.statusPermissionDenied');
			case 'incompatible':
				return t('settings.dataService.statusIncompatible');
			case 'error':
				return t('settings.dataService.statusError');
			default:
				return t('settings.dataService.statusDisconnected');
		}
	}

	function statusTone(
		status: DataServiceConnectionState
	): 'neutral' | 'success' | 'warning' | 'error' | 'info' {
		switch (status) {
			case 'connected':
				return 'success';
			case 'connecting':
				return 'info';
			case 'offline':
			case 'auth-required':
				return 'warning';
			case 'permission-denied':
			case 'incompatible':
			case 'error':
				return 'error';
			default:
				return 'neutral';
		}
	}

	function describeError(error: unknown): string {
		const code = (error as { code?: DataServiceErrorCode } | null)?.code;
		switch (code) {
			case 'insecure-url':
			case 'invalid-url':
				return t('settings.dataService.errorInvalidUrl');
			case 'workspace-mismatch':
				return t('settings.dataService.errorWorkspaceMismatch');
			case 'incompatible':
				return t('settings.dataService.errorIncompatible');
			case 'unauthorized':
			case 'challenge-expired':
			case 'not-signed-in':
				return t('settings.dataService.errorAuth');
			case 'forbidden':
				return t('settings.dataService.errorPermission');
			case 'network':
			case 'timeout':
				return t('settings.dataService.errorNetwork');
			case 'cloud-unavailable':
				return t('settings.dataService.cloudUnavailable');
			default:
				return error instanceof Error ? error.message : t('settings.dataService.errorNetwork');
		}
	}

	async function connect() {
		if (!canManage) return;
		formError = null;
		if ((mode === 'selfHosted' && !url.trim()) || !setupCode.trim()) {
			formError = t('settings.dataService.setupCodeRequired');
			return;
		}
		busy = 'connect';
		try {
			await dataService.connect({
				mode,
				url: mode === 'cloud' ? (cloudServiceUrl ?? '') : url,
				setupCode
			});
			setupCode = '';
			toast.success(t('settings.dataService.connectedToast'));
		} catch (error) {
			formError = describeError(error);
		} finally {
			busy = null;
		}
	}

	async function test() {
		busy = 'test';
		formError = null;
		try {
			await dataService.testConnection();
			toast.success(t('settings.dataService.testSuccess'));
		} catch (error) {
			formError = describeError(error);
		} finally {
			busy = null;
		}
	}

	async function syncNow() {
		busy = 'sync';
		formError = null;
		try {
			await dataService.drain();
		} finally {
			busy = null;
		}
	}

	async function publishSnapshot() {
		busy = 'snapshot';
		formError = null;
		try {
			const { periodStart, periodEnd } = dayPeriod();
			await publishReportSnapshot({ granularity: 'day', periodStart, periodEnd });
			toast.success(t('settings.dataService.snapshotPublished'));
		} catch (error) {
			formError = describeError(error);
		} finally {
			busy = null;
		}
	}

	async function disconnect() {
		if (
			!(await confirm({
				title: t('settings.dataService.disconnectTitle'),
				message: t('settings.dataService.disconnectMsg'),
				tone: 'danger',
				icon: 'lucide:unplug',
				confirmText: t('settings.dataService.disconnect')
			}))
		)
			return;
		busy = 'disconnect';
		try {
			await dataService.disconnect();
			toast.info(t('settings.dataService.disconnectedToast'));
		} finally {
			busy = null;
		}
	}

	function formatWhen(value: number | null, seconds = false): string {
		if (!value) return t('settings.dataService.never');
		const ms = seconds && value < 1_000_000_000_000 ? value * 1000 : value;
		return new Date(ms).toLocaleString(i18n.locale);
	}

	const backup = $derived(dataService.backup);
	const backupText = $derived.by(() => {
		if (!dataService.metadata) return '';
		if (!dataService.metadata.capabilities.status || !backup) {
			return t('settings.dataService.backupUnknown');
		}
		switch (backup.state) {
			case 'current':
				return t('settings.dataService.backupCurrent');
			case 'stale':
				return t('settings.dataService.backupStale');
			case 'failed':
				return t('settings.dataService.backupFailed');
			default:
				return t('settings.dataService.backupUnknown');
		}
	});
</script>

<SettingsSection
	title={t('settings.dataService.title')}
	description={t('settings.dataService.description')}
	icon="lucide:cloud-cog"
>
	<div class="space-y-4 px-5 py-4">
		{#if !canManage}
			<p class="text-[12px] text-(--ui-text-muted)">
				{t('settings.dataService.permissionDenied')}
			</p>
		{:else if !configured}
			<div class="flex flex-wrap items-center gap-2">
				<Badge color={stateTone}>{stateLabel}</Badge>
				<span class="text-[11px] text-(--ui-text-dimmed)">
					{t('settings.dataService.notConnectedDesc')}
				</span>
			</div>

			<fieldset class="flex flex-wrap gap-4 text-[13px] text-(--ui-text)">
				<legend class="sr-only">{t('settings.dataService.mode')}</legend>
				<label class="flex items-center gap-2">
					<input type="radio" bind:group={mode} value="selfHosted" class="accent-primary-500" />
					{t('settings.dataService.selfHosted')}
				</label>
				<label class="flex items-center gap-2" class:opacity-60={!cloudAvailable}>
					<input
						type="radio"
						bind:group={mode}
						value="cloud"
						disabled={!cloudAvailable}
						class="accent-primary-500"
					/>
					{t('settings.dataService.cloud')}
				</label>
			</fieldset>

			{#if mode === 'cloud' && !cloudAvailable}
				<p class="text-[12px] text-(--ui-text-muted)">
					{t('settings.dataService.cloudUnavailable')}
				</p>
			{:else}
				<div class="space-y-3">
					{#if mode === 'selfHosted'}
						<div>
							<label
								for="data-service-url"
								class="mb-1 block text-[11px] font-semibold text-(--ui-text-muted)"
							>
								{t('settings.dataService.serverUrl')}
							</label>
							<Input
								id="data-service-url"
								type="url"
								icon="lucide:link"
								placeholder="https://service.example"
								autocomplete="off"
								spellcheck={false}
								disabled={busy !== null}
								class="w-full"
								bind:value={url}
							/>
							<p class="mt-1 text-[11px] text-(--ui-text-dimmed)">
								{t('settings.dataService.serverUrlHint')}
							</p>
						</div>
					{:else}
						<div>
							<div class="mb-1 block text-[11px] font-semibold text-(--ui-text-muted)">
								{t('settings.dataService.serverUrl')}
							</div>
							<Input
								id="data-service-cloud-url"
								icon="lucide:cloud"
								value={cloudServiceUrl ?? ''}
								disabled
								class="w-full"
							/>
							<p class="mt-1 text-[11px] text-(--ui-text-dimmed)">
								{t('settings.dataService.cloudEndpointHint')}
							</p>
						</div>
					{/if}
					<div>
						<label
							for="data-service-code"
							class="mb-1 block text-[11px] font-semibold text-(--ui-text-muted)"
						>
							{t('settings.dataService.setupCode')}
						</label>
						<Input
							id="data-service-code"
							type="password"
							icon="lucide:key-round"
							autocomplete="one-time-code"
							spellcheck={false}
							disabled={busy !== null}
							class="w-full"
							bind:value={setupCode}
						/>
						<p class="mt-1 text-[11px] text-(--ui-text-dimmed)">
							{t('settings.dataService.setupCodeHint')}
						</p>
					</div>
				</div>
			{/if}

			<p
				class="rounded-lg bg-(--ui-bg-muted) p-3 text-[11px] leading-relaxed text-(--ui-text-muted)"
			>
				{t('settings.dataService.privacyNotice')}
			</p>

			{#if formError}
				<p role="alert" class="text-[12px] text-(--tone-error-text)">{formError}</p>
			{:else if dataService.lastError && !dataService.configured}
				<p role="alert" class="text-[12px] text-(--tone-error-text)">
					{dataService.lastErrorCode === 'queue-unavailable'
						? t('settings.dataService.errorQueueUnavailable')
						: dataService.lastError}
				</p>
			{/if}

			<Button
				color="primary"
				variant="soft"
				onclick={connect}
				disabled={(mode === 'cloud' && !cloudAvailable) || busy !== null}
			>
				<Icon name="lucide:plug" class="size-4" />
				{busy === 'connect'
					? t('settings.dataService.connecting')
					: t('settings.dataService.connect')}
			</Button>
		{:else}
			<div class="flex flex-wrap items-center justify-between gap-3">
				<div class="flex flex-wrap items-center gap-2">
					<Badge color={stateTone}>{stateLabel}</Badge>
					<span class="text-[12px] font-semibold">
						{t('settings.dataService.connectedTo', {
							name: dataService.metadata?.serviceName ?? ''
						})}
					</span>
				</div>
				<Badge color="neutral">{dataService.metadata?.baseUrl}</Badge>
			</div>

			<div class="grid gap-3 rounded-lg bg-(--ui-bg-muted) p-3 text-[11px] sm:grid-cols-2">
				<div>
					<div class="font-semibold text-(--ui-text-muted)">
						{t('settings.dataService.workspaceLabel')}
					</div>
					<div class="mt-0.5">{dataService.metadata?.workspaceName ?? '—'}</div>
				</div>
				<div>
					<div class="font-semibold text-(--ui-text-muted)">
						{t('settings.dataService.queuePending')}
					</div>
					<div class="mt-0.5 tabular-nums">{dataService.queueSize ?? '—'}</div>
				</div>
				{#if reporting}
					<div>
						<div class="font-semibold text-(--ui-text-muted)">
							{t('settings.dataService.snapshotsPending')}
						</div>
						<div class="mt-0.5 tabular-nums">{dataService.snapshotQueueSize ?? '—'}</div>
					</div>
				{/if}
				<div>
					<div class="font-semibold text-(--ui-text-muted)">
						{t('settings.dataService.lastSync')}
					</div>
					<div class="mt-0.5">{formatWhen(dataService.lastSyncAt)}</div>
				</div>
				<div>
					<div class="font-semibold text-(--ui-text-muted)">
						{t('settings.dataService.backupFreshness')}
					</div>
					<div class="mt-0.5">{backupText}</div>
				</div>
				{#if backup}
					<div>
						<div class="font-semibold text-(--ui-text-muted)">
							{t('settings.dataService.lastBackup')}
						</div>
						<div class="mt-0.5">{formatWhen(backup.lastBackupAt, true)}</div>
					</div>
					<div>
						<div class="font-semibold text-(--ui-text-muted)">
							{t('settings.dataService.restoreVerified')}
						</div>
						<div class="mt-0.5">
							{backup.lastVerifiedRestoreAt
								? formatWhen(backup.lastVerifiedRestoreAt, true)
								: t('settings.dataService.restoreNotVerified')}
						</div>
					</div>
				{/if}
			</div>

			{#if dataService.lastRejected.length}
				<p class="text-[11px] text-(--tone-warning-text)">
					{t('settings.dataService.rejectedHint', { n: dataService.lastRejected.length })}
				</p>
			{/if}

			{#if formError || dataService.lastError}
				<p role="alert" class="text-[12px] text-(--tone-error-text)">
					{formError ??
						(dataService.lastErrorCode === 'queue-unavailable'
							? t('settings.dataService.errorQueueUnavailable')
							: dataService.lastError)}
				</p>
			{/if}

			<div class="flex flex-wrap gap-2">
				<Button
					color="primary"
					variant="soft"
					onclick={syncNow}
					disabled={busy !== null || dataService.queueSize === null || dataService.queueSize === 0}
				>
					<Icon name="lucide:refresh-cw" class="size-4" />
					{busy === 'sync' ? t('settings.dataService.syncing') : t('settings.dataService.syncNow')}
				</Button>
				{#if reporting}
					<Button
						color="neutral"
						variant="subtle"
						onclick={publishSnapshot}
						disabled={busy !== null}
					>
						<Icon name="lucide:file-chart-column" class="size-4" />
						{busy === 'snapshot'
							? t('settings.dataService.publishingSnapshot')
							: t('settings.dataService.publishSnapshot')}
					</Button>
				{/if}
				<Button color="neutral" variant="subtle" onclick={test} disabled={busy !== null}>
					<Icon name="lucide:activity" class="size-4" />
					{busy === 'test'
						? t('settings.dataService.testing')
						: t('settings.dataService.testConnection')}
				</Button>
				<Button color="error" variant="subtle" onclick={disconnect} disabled={busy !== null}>
					<Icon name="lucide:unplug" class="size-4" />
					{busy === 'disconnect'
						? t('settings.dataService.disconnecting')
						: t('settings.dataService.disconnect')}
				</Button>
			</div>
		{/if}
	</div>
</SettingsSection>
