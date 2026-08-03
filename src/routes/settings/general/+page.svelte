<script lang="ts">
	import { onMount } from 'svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import SettingsSection from '$lib/components/ui/SettingsSection.svelte';
	import SettingRow from '$lib/components/ui/SettingRow.svelte';
	import SaveBar from '$lib/components/ui/SaveBar.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import Switch from '$lib/components/ui/Switch.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { browser } from '$app/environment';
	import {
		loadGeneralSettings,
		saveGeneralSettings,
		type GeneralSettings
	} from '$lib/settings/local';

	// Business configuration (currency / tax) is owned by the Workspace page —
	// it is org-level, not a device preference. It is shown read-only here and
	// edited in /settings/organization to avoid two screens fighting over the
	// same `tenant` fields.
	const activeCompany = $derived(
		tenant.state.organizationName || tenant.state.organizationId || '—'
	);

	let language = $state('en');
	let defaultPayment = $state('cash');
	let playSound = $state(true);
	let paymentSound = $state(true);
	let autoPrint = $state(false);
	let confirmClear = $state(true);
	let compactMode = $state(false);

	// Snapshot of the last persisted state — used to detect unsaved changes.
	let saved = $state<GeneralSettings | null>(null);

	onMount(() => {
		if (!browser) return;
		const s = loadGeneralSettings();
		language = s.language;
		defaultPayment = s.defaultPayment;
		playSound = s.playSound;
		paymentSound = s.paymentSound;
		autoPrint = s.autoPrint;
		confirmClear = s.confirmClear;
		compactMode = s.compactMode;
		saved = { ...s };
	});

	function snapshot(): GeneralSettings {
		return {
			language,
			defaultPayment,
			playSound,
			paymentSound,
			autoPrint,
			confirmClear,
			compactMode
		};
	}

	const dirty = $derived(saved !== null && JSON.stringify(snapshot()) !== JSON.stringify(saved));

	function save() {
		if (!browser) return;
		const s = snapshot();
		saveGeneralSettings(s);
		saved = s;
		toast.success('Preferences saved');
	}

	function discard() {
		if (!saved) return;
		language = saved.language;
		defaultPayment = saved.defaultPayment;
		playSound = saved.playSound;
		paymentSound = saved.paymentSound;
		autoPrint = saved.autoPrint;
		confirmClear = saved.confirmClear;
		compactMode = saved.compactMode;
	}

	function resetAll() {
		if (!browser) return;
		if (!confirm('Reset all POS preferences to defaults?')) return;
		localStorage.removeItem('bnos-os:settings-general');
		language = 'en';
		defaultPayment = 'cash';
		playSound = true;
		paymentSound = true;
		autoPrint = false;
		confirmClear = true;
		compactMode = false;
		saved = snapshot();
		toast.info('Preferences reset');
	}

	// Warn before closing/refreshing the tab while there are unsaved edits.
	function guardUnload(e: BeforeUnloadEvent) {
		if (dirty) {
			e.preventDefault();
			e.returnValue = '';
		}
	}

	const paymentOptions = [
		{ id: 'cash', label: 'Cash', icon: 'lucide:banknote' },
		{ id: 'card', label: 'Card', icon: 'lucide:credit-card' },
		{ id: 'qr', label: 'QR Code', icon: 'lucide:qr-code' },
		{ id: 'lightning', label: 'Lightning', icon: 'lucide:zap' }
	];

	const taxLabel = $derived(
		tenant.state.defaultTaxRate > 0
			? `${tenant.state.defaultTaxRate}%${tenant.state.taxIncludedInPrice ? ' · included in price' : ' · added on top'}`
			: 'Disabled'
	);
</script>

<svelte:head><title>General · Settings</title></svelte:head>

<svelte:window onbeforeunload={guardUnload} />

<div class="space-y-5">
	<PageHeader
		icon="lucide:sliders-horizontal"
		title="General"
		description="Payment, checkout & display preferences for this device"
	/>

	<!-- Business configuration (read-only — owned by Workspace) -->
	<SettingsSection
		icon="lucide:building-2"
		title="Business configuration"
		meta="Managed in Workspace"
	>
		<div class="px-5 py-4">
			<p class="mb-3 text-[11px] text-[var(--ui-text-dimmed)]">
				Currency and tax apply to the whole organization and are configured per company in the
				Workspace.
			</p>
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
				<div
					class="rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-3.5 py-2.5"
				>
					<p
						class="text-[10px] font-semibold tracking-wider text-[var(--ui-text-dimmed)] uppercase"
					>
						Active company
					</p>
					<p class="truncate text-[13px] font-bold">{activeCompany}</p>
				</div>
				<div
					class="rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-3.5 py-2.5"
				>
					<p
						class="text-[10px] font-semibold tracking-wider text-[var(--ui-text-dimmed)] uppercase"
					>
						Currency
					</p>
					<p class="text-[13px] font-bold">{tenant.state.currency}</p>
				</div>
				<div
					class="rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-3.5 py-2.5"
				>
					<p
						class="text-[10px] font-semibold tracking-wider text-[var(--ui-text-dimmed)] uppercase"
					>
						Tax
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
					Open Workspace
				</Button>
			</div>
		</div>
	</SettingsSection>

	<!-- Language -->
	<SettingsSection icon="lucide:globe" title="Language">
		<div class="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-start">
			<div class="shrink-0 sm:w-44">
				<label class="text-[13px] font-semibold">Language</label>
				<p class="text-[11px] text-[var(--ui-text-dimmed)]">App display language</p>
			</div>
			<Select
				bind:value={language}
				options={[
					{ value: 'en', label: '🇬🇧 English' },
					{ value: 'lo', label: '🇱🇦 Lao' },
					{ value: 'th', label: '🇹🇭 Thai' },
					{ value: 'ja', label: '🇯🇵 Japanese' }
				]}
				class="sm:w-56"
			/>
		</div>
	</SettingsSection>

	<!-- Payment & Checkout -->
	<SettingsSection icon="lucide:credit-card" title="Payment & checkout">
		<div class="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-start">
			<div class="shrink-0 sm:w-44">
				<label class="text-[13px] font-semibold">Default payment</label>
				<p class="text-[11px] text-[var(--ui-text-dimmed)]">Pre-selected at checkout</p>
			</div>
			<div class="flex flex-wrap gap-2">
				{#each paymentOptions as m (m.id)}
					<button
						type="button"
						onclick={() => (defaultPayment = m.id)}
						class="inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-[12px] font-semibold capitalize transition-all {defaultPayment ===
						m.id
							? 'border-primary-500 bg-primary-500/10 text-primary-600 dark:text-primary-400'
							: 'border-[var(--ui-border)] text-[var(--ui-text-muted)] hover:border-[var(--ui-text-dimmed)]'}"
					>
						<Icon name={m.icon} class="size-3.5" />{m.label}
					</button>
				{/each}
			</div>
		</div>

		<SettingRow title="Sound effects" description="UI click sounds">
			<Switch bind:checked={playSound} />
		</SettingRow>
		<SettingRow title="Payment sound" description="Chime on successful payment">
			<Switch bind:checked={paymentSound} />
		</SettingRow>
		<SettingRow title="Auto-print receipt" description="Print automatically after payment">
			<Switch bind:checked={autoPrint} />
		</SettingRow>
		<SettingRow title="Confirm before clearing cart" description="Show dialog to prevent accidents">
			<Switch bind:checked={confirmClear} />
		</SettingRow>
		<SettingRow title="Compact mode" description="Denser layout, more items visible">
			<Switch bind:checked={compactMode} />
		</SettingRow>
	</SettingsSection>

	<!-- Danger Zone -->
	<SettingsSection icon="lucide:triangle-alert" title="Danger zone" danger>
		<SettingRow title="Reset preferences" description="Restore POS preferences to defaults">
			<Button color="error" variant="subtle" size="sm" icon="lucide:rotate-ccw" onclick={resetAll}>
				Reset
			</Button>
		</SettingRow>
	</SettingsSection>

	<SaveBar visible={dirty} onsave={save} ondiscard={discard} />
</div>
