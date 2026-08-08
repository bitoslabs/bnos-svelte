<script lang="ts">
	import { onMount } from 'svelte';
	import { t } from '$lib/i18n/i18n.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Switch from '$lib/components/ui/Switch.svelte';
	import QrCode from '$lib/components/ui/QrCode.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { confirm } from '$lib/stores/confirm.svelte';
	import { browser } from '$app/environment';
	import {
		loadPayConfig,
		savePayConfig,
		defaultPayConfig,
		type PayConfig
	} from '$lib/pos/pay-config';
	import { buildQrPayment } from '$lib/pos/payment-qr';
	import { getMerchantLightning } from '$lib/pos/lightning';
	import { tenant } from '$nostr/tenant.svelte';

	let cfg = $state<PayConfig>({ ...defaultPayConfig });
	let currency = $state('THB');
	let loaded = $state(false);

	// Live preview amount
	let previewAmount = $state(100);

	onMount(() => {
		cfg = loadPayConfig();
		currency = tenant.state.currency || 'THB';
		loaded = true;
	});

	// Lightning address is read-only here — single source is Settings → Bitcoin.
	const lightningAddr = $derived(loaded ? (getMerchantLightning()?.address ?? '') : '');

	function save() {
		savePayConfig(cfg);
		toast.success(t('settings.toastPayQrSaved'));
	}

	const schemes = [
		{
			id: 'promptpay' as const,
			label: 'PromptPay',
			icon: 'lucide:qr-code',
			desc: 'Thailand · phone / national ID',
			color: 'text-blue-600 dark:text-blue-400'
		},
		{
			id: 'vietqr' as const,
			label: 'VietQR',
			icon: 'lucide:qr-code',
			desc: 'Vietnam · NAPAS bank transfer',
			color: 'text-red-600 dark:text-red-400'
		},
		{
			id: 'bank' as const,
			label: 'Bank QR',
			icon: 'lucide:landmark',
			desc: 'Generic static account QR',
			color: 'text-emerald-600 dark:text-emerald-400'
		}
	];

	// Live QR preview based on the selected scheme + amount
	const qrPreview = $derived.by(() => {
		if (!loaded) return null;
		return buildQrPayment({ method: 'qr', amount: previewAmount, currency, config: cfg });
	});

	async function resetAll() {
		if (
			!(await confirm({
				title: t('common.resetPayQr'),
				message: t('common.payQrResetMsg'),
				tone: 'danger',
				icon: 'lucide:rotate-ccw',
				confirmText: t('settings.resetAll')
			}))
		)
			return;
		cfg = { ...defaultPayConfig };
		savePayConfig(cfg);
		toast.info('Settings reset');
	}
</script>

<svelte:head><title>{t('settings.payQr')} · {t('common.settings')}</title></svelte:head>

<div class="space-y-5">
	<PageHeader
		icon="lucide:qr-code"
		accent="primary"
		title={t('settings.payQr')}
		description={t('settings.payQrDesc')}
	>
		{#snippet actions()}
			<Button variant="ghost" color="neutral" size="sm" icon="lucide:rotate-ccw" onclick={resetAll}
				>{t('common.reset')}</Button
			>
		{/snippet}
	</PageHeader>

	<!-- QR scheme picker -->
	<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
		<div class="flex items-center gap-2 px-5 py-3">
			<Icon name="lucide:layout-grid" class="size-4 text-primary-500" />
			<h2 class="font-display text-[14px] font-semibold">{t('settings.qrScheme')}</h2>
		</div>
		<div class="grid grid-cols-1 gap-2 px-5 py-4 sm:grid-cols-3">
			{#each schemes as s (s.id)}
				<button
					type="button"
					class="flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-all {cfg.qrScheme ===
					s.id
						? 'border-primary-500 bg-primary-500/10'
						: 'border-[var(--ui-border)] hover:bg-[var(--ui-bg-accented)]'}"
					onclick={() => (cfg.qrScheme = s.id)}
				>
					<span
						class="flex items-center gap-2 text-[13px] font-semibold {cfg.qrScheme === s.id
							? s.color
							: ''}"
					>
						<Icon name={s.icon} class="size-4" />
						{s.label}
					</span>
					<span class="text-[10.5px] text-[var(--ui-text-dimmed)]">{s.desc}</span>
				</button>
			{/each}
		</div>
	</section>

	<!-- Scheme-specific config -->
	<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
		<div class="flex items-center gap-2 px-5 py-3">
			<Icon name="lucide:settings-2" class="size-4 text-primary-500" />
			<h2 class="font-display text-[14px] font-semibold">
				{cfg.qrScheme === 'promptpay'
					? t('settings.promptPayAccount')
					: cfg.qrScheme === 'vietqr'
						? t('settings.vietQrAccount')
						: t('settings.bankAccount')}
			</h2>
		</div>

		{#if cfg.qrScheme === 'promptpay'}
			<div class="px-5 py-4">
				<label
					class="mb-1.5 block text-[11px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase"
					>{t('settings.promptPayId')}</label
				>
				<Input
					bind:value={cfg.promptpayId}
					placeholder="0812345678 or national ID"
					class="w-full"
				/>
				<p class="mt-1 text-[10.5px] text-[var(--ui-text-dimmed)]">
					{t('settings.promptPayIdDesc')}
				</p>
			</div>
		{:else if cfg.qrScheme === 'vietqr'}
			<div class="grid grid-cols-1 gap-3 px-5 py-4 sm:grid-cols-2">
				<div>
					<label
						class="mb-1.5 block text-[11px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase"
						>{t('settings.bankBinCode')}</label
					>
					<Input bind:value={cfg.vietqrBin} placeholder="970436 (Vietcombank)" class="w-full" />
					<p class="mt-1 text-[10.5px] text-[var(--ui-text-dimmed)]">{t('settings.bankBinCodeDesc')}</p>
				</div>
				<div>
					<label
						class="mb-1.5 block text-[11px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase"
						>{t('settings.accountNumber')}</label
					>
					<Input bind:value={cfg.vietqrAccount} placeholder="0011001234567" class="w-full" />
				</div>
			</div>
		{:else}
			<div class="grid grid-cols-1 gap-3 px-5 py-4 sm:grid-cols-2">
				<div>
					<label
						class="mb-1.5 block text-[11px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase"
						>{t('settings.accountName')}</label
					>
					<Input bind:value={cfg.bankAccountName} placeholder="Bitdigo Co., Ltd." class="w-full" />
				</div>
				<div>
					<label
						class="mb-1.5 block text-[11px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase"
						>{t('settings.accountNumber')}</label
					>
					<Input bind:value={cfg.bankAccountNumber} placeholder="1234 5678 90" class="w-full" />
				</div>
				<div class="sm:col-span-2">
					<label
						class="mb-1.5 block text-[11px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase"
						>{t('settings.bankName')}</label
					>
					<Input bind:value={cfg.bankName} placeholder="e.g. Kasikornbank" class="w-full" />
				</div>
			</div>
		{/if}
	</section>

	<!-- Live preview -->
	<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
		<div class="flex items-center gap-2 px-5 py-3">
			<Icon name="lucide:eye" class="size-4 text-primary-500" />
			<h2 class="font-display text-[14px] font-semibold">{t('settings.livePreview')}</h2>
			<div class="ml-auto flex items-center gap-2">
				<Input
					bind:value={previewAmount}
					type="number"
					min="0"
					class="w-28"
					placeholder={t('common.amount')}
				/>
				<span class="text-[11px] text-[var(--ui-text-dimmed)]">{currency}</span>
			</div>
		</div>
		<div class="flex flex-col items-center gap-3 px-5 py-6 sm:flex-row sm:items-start sm:gap-6">
			<!-- QR preview -->
			{#if qrPreview?.configured}
				<div class="flex flex-col items-center gap-2">
					<QrCode value={qrPreview.payload} size={180} badge={qrPreview.badge} />
					<span class="text-[11px] font-semibold text-[var(--ui-text-muted)] capitalize">
						{qrPreview.kind} · {previewAmount.toFixed(2)}
						{currency}
					</span>
				</div>
			{:else}
				<div
					class="flex size-[180px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[var(--ui-border)] p-4 text-center"
				>
					<Icon name="lucide:qr-code" class="size-8 text-[var(--ui-text-dimmed)]" />
					<p class="text-[11px] text-[var(--ui-text-dimmed)]">
						{qrPreview?.hint ?? t('settings.notConfigured')}
					</p>
				</div>
			{/if}

			<div class="flex-1">
				<h3 class="text-[13px] font-bold">{t('settings.whatCustomersSee')}</h3>
				<p class="mt-1 text-[12px] text-[var(--ui-text-muted)]">
					When the cashier selects
					<span class="font-semibold">QR</span> at checkout, this exact code is generated (instantly,
					offline) and shown both on the POS dialog and — if enabled — pushed to the customer-facing display.
				</p>
				{#if qrPreview?.payload}
					<details class="mt-3">
						<summary
							class="cursor-pointer text-[11px] font-semibold text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]"
							>{t('settings.rawPayload')}</summary
						>
						<code
							class="mt-1 block rounded-lg bg-[var(--ui-bg-muted)] p-2 font-mono text-[10px] break-all text-[var(--ui-text-muted)]"
							>{qrPreview.payload}</code
						>
					</details>
				{/if}
			</div>
		</div>
	</section>

	<!-- Lightning address (single source: Settings → Bitcoin) -->
	<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
		<div class="flex items-center gap-2 px-5 py-3">
			<Icon name="lucide:zap" class="size-4 text-amber-500" />
			<h2 class="font-display text-[14px] font-semibold">
				{t('settings.lightningAddressHeading')}
			</h2>
			<span class="ml-auto text-[9.5px] font-medium text-[var(--ui-text-dimmed)]"
				>{t('settings.managedInBitcoin')}</span
			>
		</div>
		<div class="px-5 py-4">
			{#if lightningAddr}
				<div class="flex items-center gap-4 rounded-xl bg-[var(--ui-bg-muted)] p-4">
					<QrCode value={`lightning:${lightningAddr}`} size={120} badge="lightning" />
					<div class="min-w-0">
						<p class="text-[12px] font-bold text-amber-600 dark:text-amber-400">
							lightning:{lightningAddr}
						</p>
						<p class="text-[10.5px] text-[var(--ui-text-dimmed)]">
							At checkout the POS fetches a real amount-locked invoice (LNURL-pay). Customers scan
							with any Lightning wallet.
						</p>
						<a
							href="/settings/bitcoin"
							class="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-primary-600 hover:underline dark:text-primary-400"
						>
							<Icon name="lucide:pencil" class="size-3" />{t('settings.editInBitcoin')}
						</a>
					</div>
				</div>
			{:else}
				<div
					class="flex items-center gap-3 rounded-xl border border-dashed border-amber-500/40 bg-amber-500/5 p-4"
				>
					<Icon name="lucide:zap-off" class="size-5 shrink-0 text-amber-500" />
					<div class="min-w-0">
						<p class="text-[12.5px] font-semibold text-[var(--ui-text)]">
							{t('settings.noLightningYet')}
						</p>
						<p class="text-[10.5px] text-[var(--ui-text-dimmed)]">
							The POS shows a static fallback QR but can't fetch amount-locked invoices. Add one to
							accept Lightning.
						</p>
						<a
							href="/settings/bitcoin"
							class="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-amber-600 hover:underline dark:text-amber-400"
						>
							<Icon name="lucide:arrow-right" class="size-3" />{t('settings.configureInBitcoin')}
						</a>
					</div>
				</div>
			{/if}
		</div>
	</section>

	<!-- Checkout behaviour -->
	<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
		<div class="flex items-center gap-2 px-5 py-3">
			<Icon name="lucide:monitor" class="size-4 text-primary-500" />
			<h2 class="font-display text-[14px] font-semibold">{t('settings.checkoutBehaviour')}</h2>
		</div>
		<div class="flex items-center justify-between gap-4 px-5 py-4">
			<div>
				<label class="text-[13px] font-semibold">{t('settings.showQrOnCustomerDisplay')}</label>
				<p class="text-[11px] text-[var(--ui-text-dimmed)]">
					{t('settings.showQrOnCustomerDisplayDesc')}
				</p>
			</div>
			<Switch bind:checked={cfg.showOnCustomerDisplay} />
		</div>
		<div class="flex items-center justify-between gap-4 px-5 py-4">
			<div>
				<label class="text-[13px] font-semibold">{t('settings.confirmSaleOnPaid')}</label>
				<p class="text-[11px] text-[var(--ui-text-dimmed)]">
					{t('settings.confirmSaleOnPaidDesc')}
				</p>
			</div>
			<Switch bind:checked={cfg.confirmOnPaid} />
		</div>
	</section>

	<div class="flex justify-end">
		<Button color="primary" icon="lucide:check" onclick={save}>{t('common.saveChanges')}</Button>
	</div>
</div>
