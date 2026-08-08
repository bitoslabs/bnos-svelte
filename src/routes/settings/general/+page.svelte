<script lang="ts">
	import { onMount } from 'svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import SettingsSection from '$lib/components/ui/SettingsSection.svelte';
	import SettingRow from '$lib/components/ui/SettingRow.svelte';
	import SaveBar from '$lib/components/ui/SaveBar.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Switch from '$lib/components/ui/Switch.svelte';
	import LanguageSwitcher from '$lib/components/LanguageSwitcher.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { confirm } from '$lib/stores/confirm.svelte';
	import { browser } from '$app/environment';
	import { t, i18n } from '$lib/i18n/i18n.svelte';
	import {
		loadGeneralSettings,
		saveGeneralSettings,
		type GeneralSettings
	} from '$lib/settings/local';
	import { syncWorkspaceSettingsToOrganization } from '$nostr/workspace-settings';

	// Business configuration (currency / tax) is owned by the Workspace page —
	// it is org-level, not a device preference. It is shown read-only here and
	// edited in /settings/organization to avoid two screens fighting over the
	// same `tenant` fields.
	const activeCompany = $derived(
		tenant.state.organizationName || tenant.state.organizationId || '—'
	);

	let defaultPayment = $state('cash');
	let playSound = $state(true);
	let paymentSound = $state(true);
	let autoPrint = $state(false);
	let confirmClear = $state(true);
	let compactMode = $state(false);
	let autoApplyPromotions = $state(true);

	// Snapshot of the last persisted state — used to detect unsaved changes.
	let saved = $state<GeneralSettings | null>(null);

	onMount(() => {
		if (!browser) return;
		const s = loadGeneralSettings();
		defaultPayment = s.defaultPayment;
		playSound = s.playSound;
		paymentSound = s.paymentSound;
		autoPrint = s.autoPrint;
		confirmClear = s.confirmClear;
		compactMode = s.compactMode;
		autoApplyPromotions = s.autoApplyPromotions;
		saved = { ...s };
	});

	function snapshot(): GeneralSettings {
		return {
			language: i18n.locale,
			defaultPayment,
			playSound,
			paymentSound,
			autoPrint,
			confirmClear,
			compactMode,
			autoApplyPromotions
		};
	}

	const dirty = $derived(saved !== null && JSON.stringify(snapshot()) !== JSON.stringify(saved));

	async function save() {
		if (!browser) return;
		const s = snapshot();
		saveGeneralSettings(s);
		saved = s;
		await syncWorkspaceSettingsToOrganization();
		toast.success(t('toast.preferencesSaved'));
	}

	function discard() {
		if (!saved) return;
		defaultPayment = saved.defaultPayment;
		playSound = saved.playSound;
		paymentSound = saved.paymentSound;
		autoPrint = saved.autoPrint;
		confirmClear = saved.confirmClear;
		compactMode = saved.compactMode;
		autoApplyPromotions = saved.autoApplyPromotions;
	}

	async function resetAll() {
		if (!browser) return;
		if (
			!(await confirm({
				title: t('settings.resetPosPrefs'),
				message: t('settings.resetPosPrefsMsg'),
				tone: 'danger',
				icon: 'lucide:rotate-ccw',
				confirmText: t('settings.resetAll')
			}))
		)
			return;
		localStorage.removeItem('bnos-os:settings-general');
		i18n.set('en');
		defaultPayment = 'cash';
		playSound = true;
		paymentSound = true;
		autoPrint = false;
		confirmClear = true;
		compactMode = false;
		autoApplyPromotions = true;
		saved = snapshot();
		toast.info(t('toast.preferencesReset'));
	}

	// Warn before closing/refreshing the tab while there are unsaved edits.
	function guardUnload(e: BeforeUnloadEvent) {
		if (dirty) {
			e.preventDefault();
			e.returnValue = '';
		}
	}

	const paymentOptions = $derived([
		{ id: 'cash', label: t('pos.cash'), icon: 'lucide:banknote' },
		{ id: 'card', label: t('pos.card'), icon: 'lucide:credit-card' },
		{ id: 'qr', label: t('pos.qrCode'), icon: 'lucide:qr-code' },
		{ id: 'lightning', label: t('pos.lightning'), icon: 'lucide:zap' }
	]);

	const taxLabel = $derived.by(() => {
		if (tenant.state.defaultTaxRate <= 0) return t('common.disabled');
		const incl = tenant.state.taxIncludedInPrice;
		return `${tenant.state.defaultTaxRate}%${incl ? '' : ''}`;
	});
</script>

<svelte:head><title>{t('settings.general')} · {t('common.settings')}</title></svelte:head>

<svelte:window onbeforeunload={guardUnload} />

<div class="space-y-5">
	<PageHeader
		icon="lucide:sliders-horizontal"
		title={t('settings.general')}
		description={t('settings.generalDesc')}
	/>

	<!-- Business configuration (read-only — owned by Workspace) -->
	<SettingsSection
		icon="lucide:building-2"
		title={t('settings.businessConfig')}
		meta={t('settings.businessConfigManaged')}
	>
		<div class="px-5 py-4">
			<p class="mb-3 text-[11px] text-[var(--ui-text-dimmed)]">
				{t('settings.businessConfigNote')}
			</p>
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
				<div
					class="rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-3.5 py-2.5"
				>
					<p
						class="text-[10px] font-semibold tracking-wider text-[var(--ui-text-dimmed)] uppercase"
					>
						{t('settings.activeCompany')}
					</p>
					<p class="truncate text-[13px] font-bold">{activeCompany}</p>
				</div>
				<div
					class="rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-3.5 py-2.5"
				>
					<p
						class="text-[10px] font-semibold tracking-wider text-[var(--ui-text-dimmed)] uppercase"
					>
						{t('common.currency')}
					</p>
					<p class="text-[13px] font-bold">{tenant.state.currency}</p>
				</div>
				<div
					class="rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-3.5 py-2.5"
				>
					<p
						class="text-[10px] font-semibold tracking-wider text-[var(--ui-text-dimmed)] uppercase"
					>
						{t('common.tax')}
					</p>
					<p class="text-[13px] font-bold">{taxLabel}</p>
				</div>
			</div>
			<div class="mt-3">
				<Button
					href="/settings/organization"
					variant="subtle"
					size="sm"
					icon="lucide:arrow-up-right"
				>
					{t('settings.openWorkspace')}
				</Button>
			</div>
		</div>
	</SettingsSection>

	<!-- Language -->
	<SettingsSection icon="lucide:globe" title={t('settings.language')}>
		<div class="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-start">
			<div class="shrink-0 sm:w-44">
				<label class="text-[13px] font-semibold">{t('settings.language')}</label>
				<p class="text-[11px] text-[var(--ui-text-dimmed)]">{t('settings.languageDesc')}</p>
			</div>
			<div class="sm:w-72">
				<LanguageSwitcher />
			</div>
		</div>
	</SettingsSection>

	<!-- Payment & Checkout -->
	<SettingsSection icon="lucide:credit-card" title={t('settings.paymentCheckout')}>
		<div class="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-start">
			<div class="shrink-0 sm:w-44">
				<label class="text-[13px] font-semibold">{t('settings.defaultPayment')}</label>
				<p class="text-[11px] text-[var(--ui-text-dimmed)]">{t('settings.defaultPaymentDesc')}</p>
			</div>
			<div class="flex flex-wrap gap-2">
				{#each paymentOptions as m (m.id)}
					<button
						type="button"
						onclick={() => (defaultPayment = m.id)}
						class="inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-[12px] font-semibold transition-all {defaultPayment ===
						m.id
							? 'border-primary-500 bg-primary-500/10 text-primary-600 dark:text-primary-400'
							: 'border-[var(--ui-border)] text-[var(--ui-text-muted)] hover:border-[var(--ui-text-dimmed)]'}"
					>
						<Icon name={m.icon} class="size-3.5" />{m.label}
					</button>
				{/each}
			</div>
		</div>

		<SettingRow title={t('settings.soundEffects')} description={t('settings.soundEffectsDesc')}>
			<Switch bind:checked={playSound} />
		</SettingRow>
		<SettingRow title={t('settings.paymentSound')} description={t('settings.paymentSoundDesc')}>
			<Switch bind:checked={paymentSound} />
		</SettingRow>
		<SettingRow title={t('settings.autoPrint')} description={t('settings.autoPrintDesc')}>
			<Switch bind:checked={autoPrint} />
		</SettingRow>
		<SettingRow title={t('settings.confirmClear')} description={t('settings.confirmClearDesc')}>
			<Switch bind:checked={confirmClear} />
		</SettingRow>
		<SettingRow
			title={t('settings.autoApplyPromotions')}
			description={t('settings.autoApplyPromotionsDesc')}
		>
			<Switch bind:checked={autoApplyPromotions} />
		</SettingRow>
		<SettingRow title={t('settings.compactMode')} description={t('settings.compactModeDesc')}>
			<Switch bind:checked={compactMode} />
		</SettingRow>
	</SettingsSection>

	<!-- Danger Zone -->
	<SettingsSection icon="lucide:triangle-alert" title={t('settings.dangerZone')} danger>
		<SettingRow
			title={t('settings.resetPreferences')}
			description={t('settings.resetPreferencesDesc')}
		>
			<Button color="error" variant="subtle" size="sm" icon="lucide:rotate-ccw" onclick={resetAll}>
				{t('settings.reset')}
			</Button>
		</SettingRow>
	</SettingsSection>

	<SaveBar visible={dirty} onsave={save} ondiscard={discard} />
</div>
