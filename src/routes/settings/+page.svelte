<script lang="ts">
	import { onMount } from 'svelte';
	import { t } from '$lib/i18n/i18n.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Icon from '$lib/components/ui/Icon.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import SettingsNav from '$lib/components/SettingsNav.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import QrCode from '$lib/components/ui/QrCode.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { session } from '$nostr/session.svelte';
	import { glo } from '$nostr/store.svelte';
	import { preferences } from '$lib/theme/preferences.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { truncateNpub, titleCase } from '$lib/utils/format';
	import Menu from '$lib/components/ui/Menu.svelte';
	import MenuItem from '$lib/components/ui/MenuItem.svelte';
	import MenuDivider from '$lib/components/ui/MenuDivider.svelte';
	import { isEncryptionEnabled, setEncryptionEnabled } from '$lib/crypto/organization-key.svelte';
	import { organizationKey } from '$lib/crypto/organization-key.svelte';
	import { cipherActive } from '$lib/crypto/glo-cipher';
	import {
		grantKeyToAllStaff,
		canDistributeKey,
		staffEligibleForKey,
		keyDistributionActive
	} from '$lib/crypto/key-grants-manage';

	onMount(() => preferences.load());

	let qrOpen = $state(false);
	let encryptionOn = $state(false);
	let keyReady = $state(false);
	let staffEligible = $state(0);
	let granting = $state(false);

	function refreshEncryptionState() {
		encryptionOn = isEncryptionEnabled();
		keyReady = organizationKey.hasActiveKey;
		staffEligible = canDistributeKey() ? staffEligibleForKey().length : 0;
	}
	onMount(refreshEncryptionState);

	async function toggleEncryption(on: boolean) {
		if (on) {
			try {
				// Mint (owner/admin) or import via NIP-44 grants (staff) the org key first.
				await organizationKey.ensureActiveKey();
				setEncryptionEnabled(true);
				refreshEncryptionState();
				toast.success(
					'Payload encryption on',
					'New orders, payments, customers & staff sync encrypted (AES-256-GCM).'
				);
				// Owner/admin: share the key with every existing staff device so they
				// can actually decrypt the now-encrypted records (kind 30512 grant).
				if (canDistributeKey()) await reShareKey(false);
			} catch (e) {
				toast.error('Could not enable encryption', e instanceof Error ? e.message : undefined);
				return;
			}
		} else {
			setEncryptionEnabled(false);
			toast.info('Payload encryption off', 'New records sync in plaintext.');
		}
		refreshEncryptionState();
	}

	async function reShareKey(showToast = true) {
		if (granting || !keyDistributionActive()) return;
		granting = true;
		try {
			const r = await grantKeyToAllStaff();
			if (showToast) {
				if (r.granted > 0)
					toast.success('Key shared', `Encrypted key sent to ${r.granted} staff device(s).`);
				else if (r.failed > 0)
					toast.warning('Could not share key', 'Check relay connection / login method.');
				else toast.info('Nothing to share', 'No staff with a pubkey yet.');
			}
		} finally {
			granting = false;
			refreshEncryptionState();
		}
	}

	// Organization fields (name / code / currency / business model / type) are
	// owned by the Workspace page to avoid duplicate editors fighting over the
	// same `tenant` fields. They are shown read-only here.
	const orgRows = $derived([
		{
			label: t('common.name'),
			value: tenant.state.organizationName || '—',
			icon: 'lucide:building-2'
		},
		{ label: t('common.code'), value: tenant.state.organizationCode || '—', icon: 'lucide:hash' },
		{
			label: t('settings.branchLabel'),
			value: tenant.state.locationName || '—',
			icon: 'lucide:map-pin'
		},
		{ label: t('common.currency'), value: tenant.state.currency || '—', icon: 'lucide:coins' },
		{
			label: t('settings.businessModel'),
			value: titleCase(tenant.state.businessModel.replace(/_/g, ' ')) || '—',
			icon: 'lucide:layers'
		},
		{
			label: t('settings.businessType'),
			value: titleCase(tenant.state.businessType) || '—',
			icon: 'lucide:tag'
		}
	]);

	async function copyNpub() {
		try {
			await navigator.clipboard.writeText(session.npub ?? '');
			toast.success('npub copied');
		} catch {
			toast.error('Copy failed');
		}
	}
</script>

<svelte:head><title>{t('common.appName')} · {t('common.settings')}</title></svelte:head>

<div class="settings-home settings-home-stack">
	<PageHeader
		icon="lucide:settings"
		title={t('common.settings')}
		description={t('settings.organizationDesc')}
	/>

	<!-- Mobile: in-page navigation list (desktop uses the sticky sidebar) -->
	<SettingsNav class="lg:hidden" />

	<!-- Organization (read-only — owned by Workspace) -->
	<section class="settings-home-card surface-card divide-y divide-[var(--ui-border-muted)]">
		<div class="settings-home-card-header flex items-center gap-2 px-5 py-3">
			<Icon name="lucide:building-2" class="size-4 text-primary-500" />
			<h2 class="font-display text-[14px] font-semibold">{t('settings.organizationHeading')}</h2>
			<span class="ml-auto text-[10px] font-medium text-[var(--ui-text-dimmed)]"
				>GLO · kind 30078</span
			>
		</div>
		<div class="settings-home-org-grid grid grid-cols-1 gap-3 px-5 py-4 sm:grid-cols-2">
			{#each orgRows as row (row.label)}
				<div
					class="settings-home-org-item flex items-center gap-3 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-3.5 py-2.5"
				>
					<Icon name={row.icon} class="size-4 shrink-0 text-[var(--ui-text-dimmed)]" />
					<div class="min-w-0">
						<p
							class="text-[10px] font-semibold tracking-wider text-[var(--ui-text-dimmed)] uppercase"
						>
							{row.label}
						</p>
						<p class="truncate text-[13px] font-bold capitalize">{row.value}</p>
					</div>
				</div>
			{/each}
		</div>
		<div class="settings-home-card-footer flex flex-wrap items-center gap-2 px-5 py-3">
			{#if tenant.restaurantEnabled}
				<Badge color="info"
					><Icon name="lucide:utensils" class="mr-1 size-3" />{t(
						'settings.restaurantModuleOn'
					)}</Badge
				>
			{/if}
			{#if tenant.isMultiLocation}
				<Badge color="neutral"
					><Icon name="lucide:git-branch" class="mr-1 size-3" />{t('settings.multiLocation')}</Badge
				>
			{/if}
			<div class="ml-auto">
				<Button
					href={resolve('/settings/organization')}
					variant="subtle"
					size="sm"
					icon="lucide:arrow-up-right"
				>
					{t('settings.manageInWorkspace')}
				</Button>
			</div>
		</div>
	</section>

	<!-- Identity -->
	<section class="settings-home-card settings-home-panel surface-card p-5">
		<div class="settings-home-panel-header mb-4 flex items-center gap-3">
			<Icon name="lucide:fingerprint" class="size-5 text-primary-500" />
			<div class="min-w-0 flex-1">
				<h2 class="font-display text-[15px] font-semibold tracking-tight">
					{t('profile.nostrIdentity')}
				</h2>
				<p class="text-[12px] text-[var(--ui-text-muted)]">{t('profile.identitySigns')}</p>
			</div>
			<Menu
				id="settings-identity"
				label={t('settings.identityActions')}
				triggerClass="grid size-8 place-items-center rounded-lg text-[var(--ui-text-dimmed)] transition-colors hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]"
				triggerActiveClass="bg-[var(--ui-bg-accented)] text-[var(--ui-text)]"
			>
				{#snippet trigger()}<Icon name="lucide:ellipsis-vertical" class="size-4" />{/snippet}
				<MenuItem icon="lucide:copy" onclick={copyNpub}>{t('settings.copyNpub')}</MenuItem>
				<MenuItem icon="lucide:qr-code" onclick={() => (qrOpen = true)}
					>{t('settings.showQr')}</MenuItem
				>
				<MenuDivider />
				<MenuItem
					tone="danger"
					icon="lucide:log-out"
					onclick={async () => {
						await session.logout();
						tenant.reset();
						glo.clearAll();
						await goto(resolve('/login'), { replaceState: true });
					}}>{t('common.signOut')}</MenuItem
				>
			</Menu>
		</div>
		<div
			class="settings-home-identity-box flex items-center justify-between gap-3 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-4 py-3"
		>
			<div class="min-w-0">
				<div class="truncate font-mono text-[13px] font-semibold">
					{truncateNpub(session.npub ?? '', 18, 10)}
				</div>
				<div class="text-[11.5px] text-[var(--ui-text-dimmed)]">
					{session.loginMethod === 'extension'
						? t('settings.nip07Extension')
						: t('settings.privateKey')}
				</div>
			</div>
			<Badge color="success"><span class="live-dot"></span> {t('common.active')}</Badge>
		</div>
	</section>

	<!-- Security / encryption -->
	<section class="settings-home-card settings-home-panel surface-card p-5">
		<div class="settings-home-panel-header mb-4 flex items-center gap-3">
			<Icon
				name="lucide:shield-check"
				class="size-5 {encryptionOn ? 'text-emerald-500' : 'text-[var(--ui-text-dimmed)]'}"
			/>
			<div class="min-w-0 flex-1">
				<h2 class="font-display text-[15px] font-semibold tracking-tight">
					{t('settings.payloadEncryption')}
				</h2>
				<p class="text-[12px] text-[var(--ui-text-muted)]">
					{t('settings.payloadEncryptionDesc')}
				</p>
			</div>
			{#if encryptionOn}
				<Badge color="success"><span class="live-dot"></span> {t('settings.active')}</Badge>
			{:else}
				<Badge color="warning">{t('settings.off')}</Badge>
			{/if}
		</div>
		<div
			class="rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] p-3.5 text-[12px]"
		>
			<div class="flex items-center justify-between gap-3">
				<div class="min-w-0">
					<p class="font-semibold">{t('settings.syncEncryption')}</p>
					<p class="mt-0.5 text-[11.5px] text-[var(--ui-text-dimmed)]">
						{encryptionOn ? t('settings.syncEncryptionOn') : t('settings.syncEncryptionOff')}
					</p>
				</div>
				<button
					type="button"
					role="switch"
					aria-checked={encryptionOn}
					onclick={() => toggleEncryption(!encryptionOn)}
					class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors {encryptionOn
						? 'bg-emerald-500'
						: 'bg-[var(--ui-border-accented)]'}"
				>
					<span
						class="inline-block size-4.5 translate-x-0.5 rounded-full bg-white transition-transform {encryptionOn
							? 'translate-x-5'
							: ''}"
					></span>
				</button>
			</div>
			<div class="mt-3 flex flex-wrap items-center gap-2 text-[10.5px]">
				<span
					class="inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-semibold {cipherActive()
						? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
						: 'bg-[var(--ui-bg-accented)] text-[var(--ui-text-dimmed)]'}"
				>
					<Icon name="lucide:key-round" class="size-3" />
					{cipherActive()
						? t('settings.orgKeyActive')
						: keyReady
							? t('settings.keyReadyToggle')
							: t('settings.noOrgKey')}
				</span>
				<span
					class="inline-flex items-center gap-1 rounded-md bg-[var(--ui-bg-accented)] px-2 py-0.5 font-semibold text-[var(--ui-text-dimmed)]"
				>
					<Icon name="lucide:lock" class="size-3" />AES-256-GCM
				</span>
				<span
					class="inline-flex items-center gap-1 rounded-md bg-[var(--ui-bg-accented)] px-2 py-0.5 font-semibold text-[var(--ui-text-dimmed)]"
				>
					<Icon name="lucide:users" class="size-3" />NIP-44 grants
				</span>
			</div>

			<!-- Staff key-distribution status + re-share (owner/admin only) -->
			{#if canDistributeKey()}
				<div
					class="mt-3 flex flex-col gap-2 rounded-lg border border-[var(--ui-border)] p-3 sm:flex-row sm:items-center sm:justify-between"
				>
					<div class="min-w-0">
						<p class="text-[12px] font-semibold">
							{#if encryptionOn}
								{t('settings.keyShared', { n: staffEligible })}
							{:else}
								{t('settings.staffCanBeGranted', { n: staffEligible })}
							{/if}
						</p>
						<p class="mt-0.5 text-[10.5px] text-[var(--ui-text-dimmed)]">
							{#if !encryptionOn}
								{t('settings.encryptionOnTurnOn')}
							{:else if staffEligible === 0}
								{t('settings.encryptionNoStaff')}
							{:else}
								{t('settings.encryptionReShare')}
							{/if}
						</p>
					</div>
					<Button
						color="primary"
						variant="subtle"
						size="sm"
						icon="lucide:share-2"
						disabled={!keyDistributionActive() || granting || staffEligible === 0}
						onclick={() => reShareKey()}
					>
						{#if granting}<Icon
								name="lucide:loader-circle"
								class="size-3.5 animate-spin"
							/>…{:else}{t('settings.reShareKey')}{/if}
					</Button>
				</div>
			{/if}
		</div>
	</section>
</div>

<!-- Nostr identity QR -->
<Dialog bind:open={qrOpen} title={t('profile.nostrIdentity')} size="sm">
	<div class="flex flex-col items-center gap-4 py-1">
		<QrCode value={session.npub ?? ''} size={220} badge="store" />
		<div class="text-center">
			<p class="font-mono text-[11px] text-[var(--ui-text-muted)]">
				{truncateNpub(session.npub ?? '', 24, 12)}
			</p>
			<p class="mt-1 text-[11px] text-[var(--ui-text-dimmed)]">
				{t('settings.scanToVerify')}
			</p>
		</div>
		<Button color="neutral" variant="subtle" size="sm" icon="lucide:copy" onclick={copyNpub}
			>{t('settings.copyNpub')}</Button
		>
	</div>
	{#snippet footer()}
		<Button color="neutral" variant="ghost" onclick={() => (qrOpen = false)}
			>{t('common.close')}</Button
		>
	{/snippet}
</Dialog>
