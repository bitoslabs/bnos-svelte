<script lang="ts">
	import { onMount } from 'svelte';
	import { t } from '$lib/i18n/i18n.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import Switch from '$lib/components/ui/Switch.svelte';
	import SettingsSection from '$lib/components/ui/SettingsSection.svelte';
	import SettingRow from '$lib/components/ui/SettingRow.svelte';
	import { features, FEATURE_META, FEATURE_KEYS, type FeatureKey } from '$lib/features.svelte';
	import { syncWorkspaceSettingsToOrganization } from '$nostr/workspace-settings';
	import {
		loadLoyaltySettings,
		saveLoyaltySettings,
		type LoyaltySettings
	} from '$lib/settings/local';
	import { toast } from '$lib/stores/toast.svelte';
	import { browser } from '$app/environment';

	onMount(() => {
		if (browser && !features.hydrated) features.load();
	});

	async function toggle(k: FeatureKey) {
		const next = features.toggle(k);
		await syncWorkspaceSettingsToOrganization();
		toast.success(`${next ? 'Enabled' : 'Disabled'} ${FEATURE_META[k].label}`);
	}

	// ── Loyalty config (earn/redeem rates) ──
	let loyalty = $state<LoyaltySettings>(loadLoyaltySettings());
	let loyaltyDirty = $state(false);
	function setLoyalty(patch: Partial<LoyaltySettings>) {
		loyalty = { ...loyalty, ...patch };
		loyaltyDirty = true;
	}
	function saveLoyalty() {
		saveLoyaltySettings(loyalty);
		loyaltyDirty = false;
		toast.success(t('settings.toastLoyaltySaved'));
	}
</script>

<svelte:head><title>{t('settings.features')} · {t('common.settings')}</title></svelte:head>

<div class="space-y-5">
	<PageHeader
		icon="lucide:layout-grid"
		title={t('settings.features')}
		description={t('settings.featuresDesc')}
	/>

	<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
		<div class="flex items-center gap-2 px-5 py-3">
			<Icon name="lucide:layout-grid" class="size-4 text-primary-500" />
			<h2 class="font-display text-[14px] font-semibold">{t('settings.modules')}</h2>
		</div>
		{#each FEATURE_KEYS as key (key)}
			{@const f = FEATURE_META[key]}
			<div class="flex items-center justify-between gap-4 px-5 py-4">
				<div class="flex min-w-0 items-start gap-3.5">
					<div
						class="grid size-9 shrink-0 place-items-center rounded-xl transition-colors {features.isEnabled(
							key
						)
							? 'bg-primary-500/10 text-primary-600 dark:text-primary-400'
							: 'bg-[var(--ui-bg-muted)] text-[var(--ui-text-dimmed)]'}"
					>
						<Icon name={f.icon} class="size-4.5" />
					</div>
					<div class="min-w-0">
						<p class="text-[13px] leading-tight font-semibold">{f.label}</p>
						<p class="mt-0.5 text-[11px] text-[var(--ui-text-dimmed)]">{f.description}</p>
					</div>
				</div>
				<Switch checked={features.isEnabled(key)} onCheckedChange={() => toggle(key)} />
			</div>
		{/each}
	</section>

	<!-- Loyalty program config -->
	<SettingsSection
		icon="lucide:award"
		title={t('settings.loyaltyProgram')}
		meta={t('settings.loyaltyEarnRedeem')}
	>
		<SettingRow title={t('settings.enableLoyalty')} description={t('settings.loyaltyDesc')}>
			<Switch checked={loyalty.enabled} onCheckedChange={(v) => setLoyalty({ enabled: v })} />
		</SettingRow>
		{#if loyalty.enabled}
			<SettingRow title={t('settings.earnRate')} description={t('settings.earnRateDesc')}>
				<Input
					type="number"
					min="0"
					step="0.1"
					value={loyalty.pointsPerCurrency}
					oninput={(e) =>
						setLoyalty({ pointsPerCurrency: Number((e.target as HTMLInputElement).value) })}
					class="w-28"
				/>
			</SettingRow>
			<SettingRow title={t('common.pointValue')} description={t('settings.pointValueDesc')}>
				<Input
					type="number"
					min="0"
					step="0.001"
					value={loyalty.pointValue}
					oninput={(e) => setLoyalty({ pointValue: Number((e.target as HTMLInputElement).value) })}
					class="w-28"
				/>
			</SettingRow>
			<SettingRow title={t('settings.allowRedeem')} description={t('settings.loyaltyRedeemDesc')}>
				<Switch
					checked={loyalty.redeemEnabled}
					onCheckedChange={(v) => setLoyalty({ redeemEnabled: v })}
				/>
			</SettingRow>
			{#if loyaltyDirty}
				<div class="flex justify-end px-5 pb-4">
					<Button color="primary" size="sm" icon="lucide:save" onclick={saveLoyalty}
						>{t('settings.saveLoyalty')}</Button
					>
				</div>
			{/if}
		{/if}
	</SettingsSection>

	<div
		class="flex items-center gap-3 rounded-xl border border-[var(--tone-warning-border)] bg-[var(--tone-warning-bg)] px-4 py-3"
	>
		<Icon name="lucide:info" class="size-4 shrink-0 text-[var(--tone-warning-text)]" />
		<p class="text-[11px] text-[var(--tone-warning-text)]">
			{t('settings.featureTogglesNote')}
		</p>
	</div>
</div>
