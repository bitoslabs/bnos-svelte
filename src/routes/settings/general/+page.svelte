<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import Switch from '$lib/components/ui/Switch.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { browser } from '$app/environment';
	import { loadGeneralSettings, saveGeneralSettings } from '$lib/settings/local';

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
	});

	function save() {
		if (!browser) return;
		saveGeneralSettings({
			language,
			defaultPayment,
			playSound,
			paymentSound,
			autoPrint,
			confirmClear,
			compactMode
		});
		toast.success('Preferences saved');
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
		toast.info('Preferences reset');
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

<div class="space-y-5">
	<PageHeader
		icon="lucide:sliders-horizontal"
		title="General"
		description="Payment, checkout & display preferences for this device"
	/>

	<!-- Business configuration (read-only — owned by Workspace) -->
	<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
		<div class="flex items-center gap-2 px-5 py-3">
			<Icon name="lucide:building-2" class="size-4 text-primary-500" />
			<h2 class="font-display text-[14px] font-semibold">Business configuration</h2>
			<span class="ml-auto text-[10px] font-medium text-[var(--ui-text-dimmed)]"
				>Managed in Workspace</span
			>
		</div>
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
	</section>

	<!-- Language -->
	<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
		<div class="flex items-center gap-2 px-5 py-3">
			<Icon name="lucide:globe" class="size-4 text-primary-500" />
			<h2 class="font-display text-[14px] font-semibold">Language</h2>
		</div>
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
	</section>

	<!-- Payment & Checkout -->
	<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
		<div class="flex items-center gap-2 px-5 py-3">
			<Icon name="lucide:credit-card" class="size-4 text-primary-500" />
			<h2 class="font-display text-[14px] font-semibold">Payment & checkout</h2>
		</div>
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
		<div class="flex items-center justify-between gap-4 px-5 py-4">
			<div>
				<div class="text-[13px] font-semibold">Sound effects</div>
				<p class="text-[11px] text-[var(--ui-text-dimmed)]">UI click sounds</p>
			</div>
			<Switch bind:checked={playSound} />
		</div>
		<div class="flex items-center justify-between gap-4 px-5 py-4">
			<div>
				<div class="text-[13px] font-semibold">Payment sound</div>
				<p class="text-[11px] text-[var(--ui-text-dimmed)]">Chime on successful payment</p>
			</div>
			<Switch bind:checked={paymentSound} />
		</div>
		<div class="flex items-center justify-between gap-4 px-5 py-4">
			<div>
				<div class="text-[13px] font-semibold">Auto-print receipt</div>
				<p class="text-[11px] text-[var(--ui-text-dimmed)]">Print automatically after payment</p>
			</div>
			<Switch bind:checked={autoPrint} />
		</div>
		<div class="flex items-center justify-between gap-4 px-5 py-4">
			<div>
				<div class="text-[13px] font-semibold">Confirm before clearing cart</div>
				<p class="text-[11px] text-[var(--ui-text-dimmed)]">Show dialog to prevent accidents</p>
			</div>
			<Switch bind:checked={confirmClear} />
		</div>
		<div class="flex items-center justify-between gap-4 px-5 py-4">
			<div>
				<div class="text-[13px] font-semibold">Compact mode</div>
				<p class="text-[11px] text-[var(--ui-text-dimmed)]">Denser layout, more items visible</p>
			</div>
			<Switch bind:checked={compactMode} />
		</div>
	</section>

	<!-- Danger Zone -->
	<section class="surface-card danger-surface divide-y divide-[var(--ui-border-muted)]">
		<div class="flex items-center gap-2 px-5 py-3">
			<Icon name="lucide:triangle-alert" class="size-4 text-[var(--tone-error-text)]" />
			<h2 class="font-display text-[14px] font-semibold text-[var(--tone-error-text)]">
				Danger zone
			</h2>
		</div>
		<div class="flex items-center justify-between gap-4 px-5 py-4">
			<div>
				<div class="text-[13px] font-semibold">Reset preferences</div>
				<p class="text-[11px] text-[var(--ui-text-dimmed)]">Restore POS preferences to defaults</p>
			</div>
			<Button color="error" variant="subtle" size="sm" icon="lucide:rotate-ccw" onclick={resetAll}
				>Reset</Button
			>
		</div>
	</section>

	<div class="flex justify-end">
		<Button color="primary" icon="lucide:check" onclick={save}>Save changes</Button>
	</div>
</div>
