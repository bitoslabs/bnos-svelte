<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import Switch from '$lib/components/ui/Switch.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { browser } from '$app/environment';
	import { loadGeneralSettings, saveGeneralSettings } from '$lib/settings/local';
	import { normalizeCurrencyCode } from '$lib/utils/format';

	let currency = $state('USD');
	let taxRate = $state(0);
	let enableTax = $state(false);
	let taxIncluded = $state(false);
	let defaultPayment = $state('cash');
	let playSound = $state(true);
	let paymentSound = $state(true);
	let autoPrint = $state(false);
	let confirmClear = $state(true);
	let compactMode = $state(false);
	let language = $state('en');

	onMount(() => {
		if (!browser) return;
		const s = loadGeneralSettings();
		currency = normalizeCurrencyCode(tenant.state.currency || s.currency);
		taxRate = tenant.state.defaultTaxRate || s.taxRate;
		enableTax = taxRate > 0 || s.enableTax;
		taxIncluded = tenant.state.taxIncludedInPrice;
		defaultPayment = s.defaultPayment;
		playSound = s.playSound;
		paymentSound = s.paymentSound;
		autoPrint = s.autoPrint;
		confirmClear = s.confirmClear;
		compactMode = s.compactMode;
		language = s.language;
	});

	function save() {
		if (!browser) return;
		const normalizedCurrency = normalizeCurrencyCode(currency);
		saveGeneralSettings({ currency: normalizedCurrency, taxRate, enableTax, taxIncluded, defaultPayment, playSound, paymentSound, autoPrint, confirmClear, compactMode, language });
		tenant.configure({ currency: normalizedCurrency, defaultTaxRate: enableTax ? taxRate : 0, taxIncludedInPrice: taxIncluded });
		toast.success('Settings saved');
	}

	function resetAll() {
		if (!browser) return;
		if (!confirm('Reset all POS settings to defaults?')) return;
		localStorage.removeItem('bnos-os:settings-general');
		currency = 'USD'; taxRate = 0; enableTax = false; taxIncluded = false;
		defaultPayment = 'cash'; playSound = true; paymentSound = true;
		autoPrint = false; confirmClear = true; compactMode = false; language = 'en';
		toast.info('Settings reset');
	}

	const paymentOptions = [
		{ id: 'cash', label: 'Cash', icon: 'lucide:banknote' },
		{ id: 'card', label: 'Card', icon: 'lucide:credit-card' },
		{ id: 'qr', label: 'QR Code', icon: 'lucide:qr-code' },
		{ id: 'lightning', label: 'Lightning', icon: 'lucide:zap' }
	];
</script>

<svelte:head><title>General · Settings</title></svelte:head>

<div class="space-y-5">
	<div>
		<h1 class="font-display text-xl font-bold tracking-tight">General</h1>
		<p class="text-[12.5px] text-[var(--ui-text-muted)]">Currency, tax, payment, and display preferences</p>
	</div>

	<!-- Language & Locale -->
	<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
		<div class="flex items-center gap-2 px-5 py-3">
			<Icon name="lucide:globe" class="size-4 text-primary-500" />
			<h2 class="font-display text-[14px] font-semibold">Language & locale</h2>
		</div>
		<div class="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-start">
			<div class="shrink-0 sm:w-44">
				<label class="text-[13px] font-semibold">Language</label>
				<p class="text-[11px] text-[var(--ui-text-dimmed)]">App display language</p>
			</div>
			<Select bind:value={language} options={[{ value: 'en', label: '🇬🇧 English' }, { value: 'lo', label: '🇱🇦 Lao' }, { value: 'th', label: '🇹🇭 Thai' }, { value: 'ja', label: '🇯🇵 Japanese' }]} class="sm:w-56" />
		</div>
		<div class="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-start">
			<div class="shrink-0 sm:w-44">
				<label class="text-[13px] font-semibold">Currency</label>
				<p class="text-[11px] text-[var(--ui-text-dimmed)]">ISO currency used across the app</p>
			</div>
			<Select bind:value={currency} options={[{ value: 'USD', label: 'USD ($ Dollar)' }, { value: 'LAK', label: 'LAK (₭ Kip)' }, { value: 'THB', label: 'THB (฿ Baht)' }, { value: 'JPY', label: 'JPY (¥ Yen)' }, { value: 'CNY', label: 'CNY (¥ Yuan)' }, { value: 'EUR', label: 'EUR (€ Euro)' }, { value: 'GBP', label: 'GBP (£ Pound)' }, { value: 'BTC', label: 'BTC (Bitcoin)' }, { value: 'SATS', label: 'SATS (Satoshis)' }]} class="sm:w-56" />
		</div>
		<div class="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-start">
			<div class="shrink-0 sm:w-44">
				<label class="text-[13px] font-semibold">Tax rate</label>
				<p class="text-[11px] text-[var(--ui-text-dimmed)]">Applied to all sales</p>
			</div>
			<div class="flex flex-col gap-3">
				<label class="flex items-center gap-3"><Switch bind:checked={enableTax} /><span class="text-[13px]">Enable tax</span></label>
				<div class="flex items-center gap-2" class:!opacity-50={!enableTax} class:!pointer-events-none={!enableTax}>
					<Input bind:value={taxRate} type="number" min="0" max="100" step="0.1" placeholder="8" class="w-24" />
					<span class="text-[13px] font-bold text-[var(--ui-text-dimmed)]">%</span>
					<label class="ml-3 flex items-center gap-2"><Switch bind:checked={taxIncluded} /><span class="text-[12px] text-[var(--ui-text-muted)]">Included in price</span></label>
				</div>
			</div>
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
					<button type="button" onclick={() => (defaultPayment = m.id)}
						class="inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-[12px] font-semibold capitalize transition-all {defaultPayment === m.id ? 'border-primary-500 bg-primary-500/10 text-primary-600 dark:text-primary-400' : 'border-[var(--ui-border)] text-[var(--ui-text-muted)] hover:border-[var(--ui-text-dimmed)]'}">
						<Icon name={m.icon} class="size-3.5" />{m.label}
					</button>
				{/each}
			</div>
		</div>
		<div class="flex items-center justify-between gap-4 px-5 py-4">
			<div><div class="text-[13px] font-semibold">Sound effects</div><p class="text-[11px] text-[var(--ui-text-dimmed)]">UI click sounds</p></div>
			<Switch bind:checked={playSound} />
		</div>
		<div class="flex items-center justify-between gap-4 px-5 py-4">
			<div><div class="text-[13px] font-semibold">Payment sound</div><p class="text-[11px] text-[var(--ui-text-dimmed)]">Chime on successful payment</p></div>
			<Switch bind:checked={paymentSound} />
		</div>
		<div class="flex items-center justify-between gap-4 px-5 py-4">
			<div><div class="text-[13px] font-semibold">Auto-print receipt</div><p class="text-[11px] text-[var(--ui-text-dimmed)]">Print automatically after payment</p></div>
			<Switch bind:checked={autoPrint} />
		</div>
		<div class="flex items-center justify-between gap-4 px-5 py-4">
			<div><div class="text-[13px] font-semibold">Confirm before clearing cart</div><p class="text-[11px] text-[var(--ui-text-dimmed)]">Show dialog to prevent accidents</p></div>
			<Switch bind:checked={confirmClear} />
		</div>
		<div class="flex items-center justify-between gap-4 px-5 py-4">
			<div><div class="text-[13px] font-semibold">Compact mode</div><p class="text-[11px] text-[var(--ui-text-dimmed)]">Denser layout, more items visible</p></div>
			<Switch bind:checked={compactMode} />
		</div>
	</section>

	<!-- Danger Zone -->
	<section class="surface-card danger-surface divide-y divide-[var(--ui-border-muted)]">
		<div class="flex items-center gap-2 px-5 py-3">
			<Icon name="lucide:triangle-alert" class="size-4 text-[var(--tone-error-text)]" />
			<h2 class="font-display text-[14px] font-semibold text-[var(--tone-error-text)]">Danger zone</h2>
		</div>
		<div class="flex items-center justify-between gap-4 px-5 py-4">
			<div><div class="text-[13px] font-semibold">Reset all settings</div><p class="text-[11px] text-[var(--ui-text-dimmed)]">Restore POS settings to defaults</p></div>
			<Button color="error" variant="subtle" size="sm" icon="lucide:rotate-ccw" onclick={resetAll}>Reset</Button>
		</div>
	</section>

	<div class="flex justify-end">
		<Button color="primary" icon="lucide:check" onclick={save}>Save changes</Button>
	</div>
</div>
