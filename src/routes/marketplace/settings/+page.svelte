<script lang="ts">
	/**
	 * Marketplace Store Settings — storefront, fulfillment defaults, sync
	 * preferences, and review policy. Persisted to a localStorage settings
	 * blob (offline-first), with a sticky SaveBar.
	 */
	import { onMount } from 'svelte';
	import { t } from '$lib/i18n/i18n.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Switch from '$lib/components/ui/Switch.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import SaveBar from '$lib/components/ui/SaveBar.svelte';
	import SettingsSection from '$lib/components/ui/SettingsSection.svelte';
	import SettingRow from '$lib/components/ui/SettingRow.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { features } from '$lib/features.svelte';
	import { syncWorkspaceSettingsToOrganization } from '$nostr/workspace-settings';
	import { browser } from '$app/environment';

	const KEY = 'bnos-os:marketplace-settings';

	interface MpSettings {
		storeName: string;
		tagline: string;
		supportEmail: string;
		supportPhone: string;
		defaultChannel: string;
		handlingTimeDays: number;
		autoFulfill: boolean;
		originCountry: string;
		originCity: string;
		originZip: string;
		syncInventory: boolean;
		syncOrders: boolean;
		syncIntervalMins: number;
		flagRatingThreshold: number;
		autoReply: string;
	}

	const DEFAULTS: MpSettings = {
		storeName: '',
		tagline: '',
		supportEmail: '',
		supportPhone: '',
		defaultChannel: '',
		handlingTimeDays: 1,
		autoFulfill: false,
		originCountry: '',
		originCity: '',
		originZip: '',
		syncInventory: true,
		syncOrders: true,
		syncIntervalMins: 15,
		flagRatingThreshold: 3,
		autoReply: ''
	};

	let s = $state<MpSettings>({ ...DEFAULTS });
	let dirty = $state(false);

	onMount(() => {
		if (!browser) return;
		try {
			s = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}'), storeName: s.storeName || tenant.state.organizationName };
		} catch {
			/* */
		}
		// ensure store name defaults to org name
		if (!s.storeName) s = { ...s, storeName: tenant.state.organizationName };
	});

	function touch() {
		dirty = true;
	}

	function save() {
		if (!browser) return;
		localStorage.setItem(KEY, JSON.stringify(s));
		dirty = false;
		toast.success('Marketplace settings saved');
	}

	function reset() {
		s = { ...DEFAULTS, storeName: tenant.state.organizationName };
		dirty = false;
		if (browser) localStorage.removeItem(KEY);
		toast.info('Reset to defaults');
	}
</script>

<svelte:head><title>{t('nav.marketplace')} · {t('common.settings')}</title></svelte:head>

<div class="space-y-5">
	<div>
		<h2 class="font-display text-lg font-bold tracking-tight">{t('nav.storeSettings')}</h2>
		<p class="text-[12px] text-[var(--ui-text-muted)]">Storefront, fulfillment & sync preferences</p>
	</div>

	<!-- Storefront -->
	<SettingsSection title={t('marketplace.storefront')} description="How your marketplace store appears to buyers" icon="lucide:store">
		<div class="space-y-4 px-5 py-4">
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
				<label class="block">
					<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Store name</span>
					<Input bind:value={s.storeName} oninput={touch} class="w-full" />
				</label>
				<label class="block">
					<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Support email</span>
					<Input bind:value={s.supportEmail} type="email" oninput={touch} placeholder="help@mystore.com" class="w-full" />
				</label>
			</div>
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Tagline</span>
				<Input bind:value={s.tagline} oninput={touch} placeholder="Quality goods, shipped fast" class="w-full" />
			</label>
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Support phone</span>
				<Input bind:value={s.supportPhone} oninput={touch} placeholder="+1 555 0100" class="w-full" />
			</label>
		</div>
	</SettingsSection>

	<!-- Fulfillment -->
	<SettingsSection title="Fulfillment" description={t('marketplace.defaultShipping')} icon="lucide:truck">
		<SettingRow title={t('marketplace.autoFulfill')} description={t('marketplace.autoFulfillDesc')}>
			<Switch bind:checked={s.autoFulfill} onCheckedChange={touch} />
		</SettingRow>
		<SettingRow title={t('marketplace.defaultHandlingTime')} description={t('marketplace.flagThresholdDesc')}>
			<div class="flex items-center gap-2">
				<Input bind:value={s.handlingTimeDays} type="number" min="0" max="30" oninput={touch} class="w-20 text-center" />
				<span class="text-[11.5px] text-[var(--ui-text-muted)]">days</span>
			</div>
		</SettingRow>
		<div class="space-y-3 px-5 py-4">
			<span class="text-[12px] font-semibold text-[var(--ui-text-muted)]">Shipping origin</span>
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
				<Input bind:value={s.originCity} oninput={touch} placeholder={t('common.city')} class="w-full" />
				<Input bind:value={s.originZip} oninput={touch} placeholder={t('common.zipPostal')} class="w-full" />
				<Input bind:value={s.originCountry} oninput={touch} placeholder="Country" class="w-full" />
			</div>
		</div>
	</SettingsSection>

	<!-- Sync -->
	<SettingsSection title={t('common.sync')} description="How channels exchange data" icon="lucide:refresh-cw">
		<SettingRow title={t('common.syncInventory')} description={t('marketplace.pushStock')}>
			<Switch bind:checked={s.syncInventory} onCheckedChange={touch} />
		</SettingRow>
		<SettingRow title={t('common.syncOrders')} description={t('marketplace.pullOrders')}>
			<Switch bind:checked={s.syncOrders} onCheckedChange={touch} />
		</SettingRow>
		<SettingRow title={t('common.syncInterval')} description="Background sync frequency">
			<Select
				bind:value={s.syncIntervalMins}
				onchange={touch}
				options={[
					{ value: 5, label: 'Every 5 minutes' },
					{ value: 15, label: 'Every 15 minutes' },
					{ value: 30, label: 'Every 30 minutes' },
					{ value: 60, label: 'Every hour' }
				]}
				class="w-44"
			/>
		</SettingRow>
	</SettingsSection>

	<!-- Reviews -->
	<SettingsSection title={t('nav.reviews')} description={t('marketplace.reputation')} icon="lucide:star">
		<SettingRow title={t('marketplace.flagThreshold')} description={t('marketplace.flagThresholdDesc')}>
			<div class="flex items-center gap-2">
				<Input bind:value={s.flagRatingThreshold} type="number" min="1" max="5" oninput={touch} class="w-20 text-center" />
				<span class="text-[11.5px] text-[var(--ui-text-muted)]">★ & below</span>
			</div>
		</SettingRow>
		<div class="space-y-2 px-5 py-4">
			<span class="block text-[12px] font-semibold text-[var(--ui-text-muted)]">Auto-reply template (optional)</span>
			<Input bind:value={s.autoReply} textarea rows={2} oninput={touch} placeholder="Thanks for your feedback! Our team will respond shortly." class="w-full" />
		</div>
	</SettingsSection>

	<!-- Danger zone -->
	<SettingsSection title="Module" description="Marketplace module availability" icon="lucide:power" danger>
		<SettingRow title="Marketplace module" description={features.isEnabled('marketplace') ? 'Currently enabled for this workspace' : 'Disabled'}>
			<Button
				color={features.isEnabled('marketplace') ? 'error' : 'primary'}
				variant="subtle"
				size="sm"
				onclick={async () => {
					features.toggle('marketplace');
					await syncWorkspaceSettingsToOrganization();
					toast.success(`Marketplace ${features.isEnabled('marketplace') ? 'enabled' : 'disabled'}`);
				}}
			>
				{features.isEnabled('marketplace') ? 'Disable' : 'Enable'}
			</Button>
		</SettingRow>
	</SettingsSection>

	<div class="flex justify-end">
		<Button color="neutral" variant="ghost" size="sm" icon="lucide:rotate-ccw" onclick={reset}>Reset to defaults</Button>
	</div>
</div>

<SaveBar visible={dirty} onsave={save} ondiscard={reset} />
