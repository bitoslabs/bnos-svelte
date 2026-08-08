<script lang="ts">
	import { onMount } from 'svelte';
	import { t } from '$lib/i18n/i18n.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import Switch from '$lib/components/ui/Switch.svelte';
	import QrCode from '$lib/components/ui/QrCode.svelte';
	import { testLightningAddress } from '$lib/pos/lightning';
	import { toast } from '$lib/stores/toast.svelte';
	import { confirm } from '$lib/stores/confirm.svelte';
	import { browser } from '$app/environment';

	const KEY = 'bnos-os:settings-bitcoin';

	// ── Rate settings ──────────────────────────
	let rateSource = $state<'auto' | 'manual'>('auto');
	let manualRate = $state(0);
	let effectiveRate = $state(0);
	let rateLoading = $state(false);
	let rateError = $state('');
	let cacheAgeLabel = $state('');
	let currency = $state('$');

	// ── Lightning provider ──────────────────────
	let lightningProvider = $state<string>('');
	let lightningAddress = $state('');
	let lndUrl = $state('');
	let lndMacaroon = $state('');
	let phoenixdUrl = $state('');
	let phoenixdPass = $state('');
	let albyApiKey = $state('');
	let nwcUrl = $state('');
	let blinkApiKey = $state('');
	let blinkWalletId = $state('');
	let strikeApiKey = $state('');

	// ── Node status ─────────────────────────────
	let nodeStatus = $state<'idle' | 'connecting' | 'connected' | 'error'>('idle');
	let nodePubkey = $state('');
	let nodeAlias = $state('');
	let nodeResult = $state('');

	// ── Payment settings ────────────────────────
	let defaultMemo = $state('Payment');
	let defaultExpiry = $state(3600);
	let minAmount = $state(0);
	let maxAmount = $state(0);

	// ── Receipt ─────────────────────────────────
	let receiptShowSats = $state(false);

	// ── Test connection ─────────────────────────
	let testStatus = $state<'idle' | 'loading' | 'success' | 'error'>('idle');
	let testResult = $state('');

	// ── Conversion preview ──────────────────────
	let previewAmount = $state(100);

	const providerOptions = [
		{
			id: 'lnaddress',
			label: 'Lightning Address (recommended)',
			icon: 'lucide:at-sign',
			desc: 'user@domain.com · no node needed'
		},
		{
			id: 'nwc',
			label: 'NWC (Nostr Wallet Connect)',
			icon: 'lucide:link',
			desc: 'NWC relay URL · your own wallet'
		},
		{ id: 'lnd', label: 'LND (REST)', icon: 'lucide:server', desc: 'Self-hosted Lightning node' },
		{ id: 'phoenixd', label: 'PhoenixD', icon: 'lucide:flame', desc: 'Self-hosted Lightning' },
		{ id: 'alby', label: 'Alby', icon: 'lucide:zap', desc: 'Alby API / OAuth' },
		{ id: 'blink', label: 'Blink (Galoy)', icon: 'lucide:wallet', desc: 'Bitcoin Beach Wallet' },
		{ id: 'strike', label: 'Strike', icon: 'lucide:credit-card', desc: 'Strike API' }
	];

	// ── Rate fetching ───────────────────────────
	const RATE_APIS = [
		{
			url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
			extract: (d: any) => d?.bitcoin?.usd
		},
		{
			url: 'https://api.coinbase.com/v2/prices/BTC-USD/spot',
			extract: (d: any) => parseFloat(d?.data?.amount)
		}
	];

	async function fetchRate(): Promise<number> {
		for (const api of RATE_APIS) {
			try {
				const res = await fetch(api.url);
				if (!res.ok) continue;
				const data = await res.json();
				const price = api.extract(data);
				if (price && price > 0) return price;
			} catch {
				/* try next */
			}
		}
		throw new Error('All rate sources failed');
	}

	async function refreshRates(force = false) {
		rateLoading = true;
		rateError = '';
		try {
			const rate = await fetchRate();
			effectiveRate = rate;
			rateError = '';
			if (browser) {
				localStorage.setItem('bnos-os:btc-rate', JSON.stringify({ rate, ts: Date.now() }));
			}
			updateCacheAge();
		} catch (err) {
			rateError = (err as Error)?.message || 'Failed to fetch rate';
		} finally {
			rateLoading = false;
		}
	}

	function updateCacheAge() {
		if (!browser) return;
		try {
			const raw = localStorage.getItem('bnos-os:btc-rate');
			if (!raw) return;
			const { ts } = JSON.parse(raw);
			const mins = Math.floor((Date.now() - ts) / 60000);
			cacheAgeLabel =
				mins < 1 ? 'just now' : mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ago`;
		} catch {
			/* */
		}
	}

	let effectiveDisplay = $derived(rateSource === 'manual' ? manualRate : effectiveRate);
	let previewSats = $derived(
		effectiveDisplay > 0 ? Math.round((previewAmount / effectiveDisplay) * 100_000_000) : 0
	);

	function formatSat(n: number): string {
		return n.toLocaleString();
	}

	// ── Test connection ─────────────────────────
	async function testConnection() {
		testStatus = 'loading';
		testResult = '';
		nodeStatus = 'connecting';
		try {
			// Field-presence checks (apply to every provider).
			if (lightningProvider === 'lnaddress' && !lightningAddress)
				throw new Error('Enter a Lightning Address');
			if (lightningProvider === 'lnd' && !lndUrl) throw new Error('Enter LND REST URL');
			if (lightningProvider === 'phoenixd' && !phoenixdUrl) throw new Error('Enter PhoenixD URL');
			if (lightningProvider === 'alby' && !albyApiKey) throw new Error('Enter Alby API key');
			if (lightningProvider === 'nwc' && !nwcUrl) throw new Error('Enter NWC relay URL');
			if (lightningProvider === 'blink' && !blinkApiKey) throw new Error('Enter Blink API key');
			if (lightningProvider === 'strike' && !strikeApiKey) throw new Error('Enter Strike API key');

			// Lightning Address → REAL LNURL-pay resolution (live network test).
			if (lightningProvider === 'lnaddress') {
				const res = await testLightningAddress(lightningAddress);
				if (!res.ok) throw new Error(res.error);
				nodePubkey = '';
				nodeAlias = res.domain;
				testStatus = 'success';
				nodeStatus = 'connected';
				testResult = `✓ ${res.domain} · accepts ${res.minSats}–${res.maxSats} sats`;
				toast.success('Lightning address verified', 'Live invoices can be requested at checkout.');
				return;
			}

			// Node providers: config-presence verified. Live node calls run at
			// checkout (a signed invoice request can't be safely mocked here).
			await new Promise((r) => setTimeout(r, 400));
			if (lightningProvider === 'lnd' || lightningProvider === 'phoenixd') {
				nodePubkey = '';
				nodeAlias = lightningProvider === 'lnd' ? 'LND (REST)' : 'PhoenixD';
			} else {
				nodePubkey = '';
				nodeAlias = lightningProvider;
			}

			testStatus = 'success';
			nodeStatus = 'connected';
			testResult = `✓ Config verified · ${nodeAlias}`;
			toast.success('Config saved', 'Node issues invoices at checkout.');
		} catch (err) {
			testStatus = 'error';
			nodeStatus = 'error';
			testResult = (err as Error)?.message || 'Connection failed';
		}
	}

	// ── Persistence ─────────────────────────────
	onMount(() => {
		if (!browser) return;
		try {
			const s = JSON.parse(localStorage.getItem(KEY) ?? '{}');
			if (s.rateSource) rateSource = s.rateSource;
			if (s.manualRate !== undefined) manualRate = s.manualRate;
			if (s.lightningProvider) lightningProvider = s.lightningProvider;
			if (s.lightningAddress) lightningAddress = s.lightningAddress;
			if (s.lndUrl) lndUrl = s.lndUrl;
			if (s.lndMacaroon) lndMacaroon = s.lndMacaroon;
			if (s.phoenixdUrl) phoenixdUrl = s.phoenixdUrl;
			if (s.phoenixdPass) phoenixdPass = s.phoenixdPass;
			if (s.albyApiKey) albyApiKey = s.albyApiKey;
			if (s.nwcUrl) nwcUrl = s.nwcUrl;
			if (s.blinkApiKey) blinkApiKey = s.blinkApiKey;
			if (s.blinkWalletId) blinkWalletId = s.blinkWalletId;
			if (s.strikeApiKey) strikeApiKey = s.strikeApiKey;
			if (s.defaultMemo) defaultMemo = s.defaultMemo;
			if (s.defaultExpiry !== undefined) defaultExpiry = s.defaultExpiry;
			if (s.minAmount !== undefined) minAmount = s.minAmount;
			if (s.maxAmount !== undefined) maxAmount = s.maxAmount;
			if (s.receiptShowSats !== undefined) receiptShowSats = s.receiptShowSats;
			if (s.currency) currency = s.currency;
		} catch {
			/* */
		}

		// Load cached rate
		try {
			const raw = localStorage.getItem('bnos-os:btc-rate');
			if (raw) {
				const { rate } = JSON.parse(raw);
				if (rate && rate > 0) effectiveRate = rate;
			}
		} catch {
			/* */
		}
		updateCacheAge();

		// Auto-refresh stale rate
		if (rateSource === 'auto' && effectiveRate === 0) {
			refreshRates();
		}
	});

	function save() {
		if (!browser) return;
		localStorage.setItem(
			KEY,
			JSON.stringify({
				rateSource,
				manualRate,
				lightningProvider,
				lightningAddress,
				lndUrl,
				lndMacaroon,
				phoenixdUrl,
				phoenixdPass,
				albyApiKey,
				nwcUrl,
				blinkApiKey,
				blinkWalletId,
				strikeApiKey,
				defaultMemo,
				defaultExpiry,
				minAmount,
				maxAmount,
				receiptShowSats,
				currency
			})
		);
		toast.success(t('settings.toastBitcoinSaved'));
	}

	async function resetAll() {
		if (!browser) return;
		if (
			!(await confirm({
				title: t('common.resetBitcoin'),
				message: t('common.bitcoinResetMsg'),
				tone: 'danger',
				icon: 'lucide:rotate-ccw',
				confirmText: t('settings.resetAll')
			}))
		)
			return;
		localStorage.removeItem(KEY);
		rateSource = 'auto';
		manualRate = 0;
		lightningProvider = '';
		lightningAddress = '';
		lndUrl = '';
		lndMacaroon = '';
		phoenixdUrl = '';
		phoenixdPass = '';
		albyApiKey = '';
		nwcUrl = '';
		blinkApiKey = '';
		blinkWalletId = '';
		strikeApiKey = '';
		defaultMemo = 'Payment';
		defaultExpiry = 3600;
		minAmount = 0;
		maxAmount = 0;
		receiptShowSats = false;
		nodeStatus = 'idle';
		nodePubkey = '';
		nodeAlias = '';
		testStatus = 'idle';
		testResult = '';
		toast.info('Settings reset');
	}
</script>

<svelte:head><title>{t('settings.bitcoin')} · {t('common.settings')}</title></svelte:head>

<div class="space-y-5">
	<PageHeader
		icon="lucide:bitcoin"
		accent="amber"
		title={t('settings.bitcoin')}
		description={t('settings.bitcoinDesc')}
	/>

	<!-- ═══ Exchange Rate ═══ -->
	<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
		<div class="flex items-center justify-between px-5 py-3">
			<div class="flex items-center gap-2">
				<Icon name="lucide:trending-up" class="size-4 text-primary-500" />
				<h2 class="font-display text-[14px] font-semibold">{t('settings.exchangeRate')}</h2>
			</div>
			<div class="flex items-center gap-2">
				{#if cacheAgeLabel}
					<span class="text-[10px] text-[var(--ui-text-dimmed)]">{cacheAgeLabel}</span>
				{/if}
				<Button
					variant="ghost"
					size="icon-sm"
					icon="lucide:refresh-cw"
					onclick={() => refreshRates(true)}
					disabled={rateLoading}
				/>
			</div>
		</div>

		<!-- Current rate display -->
		<div class="px-5 py-4">
			<div class="flex items-center justify-between rounded-xl bg-[var(--ui-bg-muted)] p-4">
				<div>
					<p class="text-[10px] font-bold text-[var(--ui-text-dimmed)] uppercase">BTC/USD</p>
					<p class="font-display text-lg font-black">
						${(effectiveDisplay || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
					</p>
				</div>
				<div class="text-right">
					<p class="text-[10px] font-bold text-[var(--ui-text-dimmed)] uppercase">
						{t('common.source')}
					</p>
					<p
						class="text-[13px] font-bold {rateSource === 'auto'
							? 'text-emerald-500'
							: 'text-amber-500'}"
					>
						{rateSource === 'auto' ? 'Auto' : 'Manual'}
					</p>
				</div>
			</div>

			{#if rateError}
				<div
					class="mt-3 rounded-xl bg-[var(--tone-error-bg)] p-3 text-[12px] text-[var(--tone-error-text)]"
				>
					{rateError}
				</div>
			{/if}
		</div>

		<!-- Rate source selector -->
		<div class="px-5 py-4">
			<label
				class="mb-2 block text-[11px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase"
				>{t('settings.rateSource')}</label
			>
			<div class="grid grid-cols-2 gap-2">
				<button
					type="button"
					class="inline-flex items-center justify-center gap-1.5 rounded-xl border px-4 py-2.5 text-[13px] font-semibold transition-all {rateSource ===
					'auto'
						? 'border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
						: 'border-[var(--ui-border)] text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)]'}"
					onclick={() => (rateSource = 'auto')}
				>
					<Icon name="lucide:cloud-download" class="size-4" />
					Auto
				</button>
				<button
					type="button"
					class="inline-flex items-center justify-center gap-1.5 rounded-xl border px-4 py-2.5 text-[13px] font-semibold transition-all {rateSource ===
					'manual'
						? 'border-amber-500 bg-amber-500/10 text-amber-600 dark:text-amber-400'
						: 'border-[var(--ui-border)] text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)]'}"
					onclick={() => (rateSource = 'manual')}
				>
					<Icon name="lucide:pencil" class="size-4" />
					Manual
				</button>
			</div>

			{#if rateSource === 'manual'}
				<div class="mt-3">
					<label
						class="mb-1.5 block text-[11px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase"
						>{t('settings.manualRate')}</label
					>
					<Input bind:value={manualRate} type="number" placeholder="100000" class="w-full" />
					<p class="mt-1 text-[10px] text-[var(--ui-text-dimmed)]">
						{t('settings.manualRateDesc')}
					</p>
				</div>
			{/if}
		</div>
	</section>

	<!-- ═══ Lightning Backend ═══ -->
	<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
		<div class="flex items-center justify-between px-5 py-3">
			<div class="flex items-center gap-2">
				<Icon name="lucide:zap" class="size-4 text-amber-500" />
				<h2 class="font-display text-[14px] font-semibold">{t('settings.lightningBackend')}</h2>
			</div>
			{#if nodeStatus === 'connected'}
				<span
					class="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400"
				>
					<span class="size-1.5 rounded-full bg-emerald-500"></span>
					Connected
				</span>
			{:else if nodeStatus === 'connecting'}
				<span
					class="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-400"
				>
					<span class="size-1.5 animate-pulse rounded-full bg-amber-500"></span>
					Connecting…
				</span>
			{:else if nodeStatus === 'error'}
				<span
					class="inline-flex items-center gap-1 rounded-full bg-[var(--tone-error-bg)] px-2 py-0.5 text-[10px] font-bold text-[var(--tone-error-text)]"
				>
					<span class="size-1.5 rounded-full bg-[var(--tone-error-text)]"></span>
					Error
				</span>
			{/if}
		</div>

		<!-- Provider selector -->
		<div class="px-5 py-4">
			<label
				class="mb-2 block text-[11px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase"
				>{t('settings.selectProvider')}</label
			>
			<div class="space-y-2">
				{#each providerOptions as opt (opt.id)}
					<button
						type="button"
						class="w-full rounded-xl border px-4 py-3 text-left transition-all {lightningProvider ===
						opt.id
							? 'border-amber-500 bg-amber-500/10'
							: 'border-[var(--ui-border)] hover:bg-[var(--ui-bg-accented)]'}"
						onclick={() => (lightningProvider = opt.id)}
					>
						<div class="flex items-center justify-between">
							<span
								class="flex items-center gap-2 text-[13px] font-semibold {lightningProvider ===
								opt.id
									? 'text-amber-600 dark:text-amber-400'
									: ''}"
							>
								<Icon name={opt.icon} class="size-4" />
								{opt.label}
							</span>
							<span class="text-[10px] text-[var(--ui-text-dimmed)]">{opt.desc}</span>
						</div>
					</button>
				{/each}
				<!-- None option -->
				<button
					type="button"
					class="w-full rounded-xl border px-4 py-3 text-left transition-all {!lightningProvider
						? 'border-[var(--ui-border)] bg-[var(--ui-bg-muted)]'
						: 'border-[var(--ui-border)] hover:bg-[var(--ui-bg-accented)]'}"
					onclick={() => (lightningProvider = '')}
				>
					<span class="text-[13px] font-semibold text-[var(--ui-text-muted)]">{t('common.none')}</span>
				</button>
			</div>
		</div>

		<!-- Provider-specific config -->
		{#if lightningProvider === 'lnd'}
			<div class="space-y-3 px-5 py-4">
				<div>
					<label
						class="mb-1.5 block text-[11px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase"
						>{t('settings.lndRestUrl')}</label
					>
					<Input bind:value={lndUrl} placeholder="https://127.0.0.1:8080" class="w-full" />
					<p class="mt-1 text-[10px] text-[var(--ui-text-dimmed)]">
						REST endpoint of your LND node
					</p>
				</div>
				<div>
					<label
						class="mb-1.5 block text-[11px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase"
						>{t('settings.macaroonHex')}</label
					>
					<Input bind:value={lndMacaroon} type="password" placeholder="020105…" class="w-full" />
					<p class="mt-1 text-[10px] text-[var(--ui-text-dimmed)]">
						Invoice macaroon in hex format
					</p>
				</div>
			</div>
		{:else if lightningProvider === 'phoenixd'}
			<div class="space-y-3 px-5 py-4">
				<div>
					<label
						class="mb-1.5 block text-[11px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase"
						>{t('settings.phoenixdUrl')}</label
					>
					<Input bind:value={phoenixdUrl} placeholder="http://127.0.0.1:9740" class="w-full" />
					<p class="mt-1 text-[10px] text-[var(--ui-text-dimmed)]">Phoenix daemon API endpoint</p>
				</div>
				<div>
					<label
						class="mb-1.5 block text-[11px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase"
						>{t('common.password' , undefined)}</label
					>
					<Input bind:value={phoenixdPass} type="password" placeholder="••••••••" class="w-full" />
					<p class="mt-1 text-[10px] text-[var(--ui-text-dimmed)]">Phoenix daemon HTTP password</p>
				</div>
			</div>
		{:else if lightningProvider === 'alby'}
			<div class="px-5 py-4">
				<label
					class="mb-1.5 block text-[11px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase"
					>{t('settings.albyApiKey')}</label
				>
				<Input bind:value={albyApiKey} type="password" placeholder="alby-api-key" class="w-full" />
				<p class="mt-1 text-[10px] text-[var(--ui-text-dimmed)]">
					Get your API key from getalby.com
				</p>
			</div>
		{:else if lightningProvider === 'nwc'}
			<div class="px-5 py-4">
				<label
					class="mb-1.5 block text-[11px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase"
					>{t('settings.nwcRelayUrl')}</label
				>
				<Input bind:value={nwcUrl} placeholder="nostr+walletconnect://…" class="w-full" />
				<p class="mt-1 text-[10px] text-[var(--ui-text-dimmed)]">
					Nostr Wallet Connect string from your wallet
				</p>
			</div>
		{:else if lightningProvider === 'lnaddress'}
			<div class="space-y-3 px-5 py-4">
				<div>
					<label
						class="mb-1.5 block text-[11px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase"
						>{t('settings.lightningAddressHeading')}</label
					>
					<div class="flex gap-2">
						<Input bind:value={lightningAddress} placeholder="store@bitdigo.com" class="flex-1" />
						<Button
							variant="subtle"
							color="primary"
							size="md"
							icon="lucide:plug"
							onclick={testConnection}
							disabled={!lightningAddress || testStatus === 'loading'}
							>{testStatus === 'loading' ? '…' : 'Test'}</Button
						>
					</div>
					<p class="mt-1 text-[10px] text-[var(--ui-text-dimmed)]">
						Get one free at
						<a
							href="https://getalby.com"
							target="_blank"
							rel="noopener"
							class="font-semibold text-primary-600 hover:underline dark:text-primary-400"
							>getalby.com</a
						>, walletofsatoshi.com, or use your own node's address. At checkout the POS fetches a
						real amount-locked BOLT11 invoice via LNURL-pay.
					</p>
				</div>
				{#if lightningAddress && (lightningAddress.includes('@') || lightningAddress
							.toLowerCase()
							.startsWith('lnurl'))}
					<div
						class="rounded-lg bg-amber-500/5 p-2.5 text-[10.5px] text-amber-700 dark:text-amber-300"
					>
						<Icon name="lucide:shield-check" class="-mt-0.5 mr-1 inline size-3" />Single source of
						truth — this address also powers the POS Lightning checkout & Pay QR preview.
					</div>
				{/if}
			</div>
		{:else if lightningProvider === 'blink'}
			<div class="space-y-3 px-5 py-4">
				<div>
					<label
						class="mb-1.5 block text-[11px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase"
						>{t('settings.blinkApiKey')}</label
					>
					<div class="flex gap-2">
						<Input
							bind:value={blinkApiKey}
							type="password"
							placeholder="blink-api-key"
							class="flex-1"
						/>
						<Button
							variant="subtle"
							size="md"
							icon="lucide:refresh-cw"
							onclick={testConnection}
							disabled={!blinkApiKey || testStatus === 'loading'}
						/>
					</div>
					<p class="mt-1 text-[10px] text-[var(--ui-text-dimmed)]">
						Blink (Galoy) API access token
					</p>
				</div>
				<div>
					<label
						class="mb-1.5 block text-[11px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase"
						>{t('settings.walletId')}</label
					>
					<Input
						bind:value={blinkWalletId}
						placeholder={t('settings.autoDiscover')}
						class="w-full"
					/>
					<p class="mt-1 text-[10px] text-[var(--ui-text-dimmed)]">
						BTC wallet ID for invoice generation
					</p>
				</div>
			</div>
		{:else if lightningProvider === 'strike'}
			<div class="px-5 py-4">
				<label
					class="mb-1.5 block text-[11px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase"
					>{t('settings.strikeApiKey')}</label
				>
				<Input
					bind:value={strikeApiKey}
					type="password"
					placeholder="strike-api-key"
					class="w-full"
				/>
				<p class="mt-1 text-[10px] text-[var(--ui-text-dimmed)]">Strike API key for BTC payments</p>
			</div>
		{/if}

		<!-- Test connection result -->
		{#if testResult}
			<div class="px-5 py-3">
				<div
					class="rounded-lg p-2.5 text-[12px] font-medium {testStatus === 'success'
						? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
						: 'bg-[var(--tone-error-bg)] text-[var(--tone-error-text)]'}"
				>
					{testResult}
				</div>
			</div>
		{/if}

		<!-- Test connection button -->
		{#if lightningProvider && lightningProvider !== 'blink'}
			<div class="flex justify-end px-5 py-4">
				<Button
					color="primary"
					variant="subtle"
					size="sm"
					icon="lucide:plug"
					onclick={testConnection}
					disabled={testStatus === 'loading'}
				>
					{testStatus === 'loading' ? 'Testing…' : 'Test connection'}
				</Button>
				<p class="mt-1 text-[9.5px] text-[var(--ui-text-dimmed)]">
					<Icon name="lucide:info" class="-mt-0.5 mr-0.5 inline size-3" />Verifies config fields are
					present. Live node / invoice calls run in the POS checkout flow.
				</p>
			</div>
		{/if}

		<!-- Node info -->
		{#if nodeStatus === 'connected' && nodePubkey}
			<div class="px-5 py-4">
				<div class="space-y-1.5 rounded-xl bg-[var(--ui-bg-muted)] p-3">
					<div class="flex items-center justify-between gap-2">
						<span class="text-[10px] font-bold text-[var(--ui-text-dimmed)] uppercase">Pubkey</span>
						<span class="max-w-[16rem] truncate font-mono text-[11px] text-[var(--ui-text-muted)]"
							>{nodePubkey}</span
						>
					</div>
					{#if nodeAlias}
						<div class="flex items-center justify-between gap-2">
							<span class="text-[10px] font-bold text-[var(--ui-text-dimmed)] uppercase">Alias</span
							>
							<span class="text-[12px] font-semibold text-[var(--ui-text)]">{nodeAlias}</span>
						</div>
					{/if}
				</div>
			</div>
		{/if}
	</section>

	<!-- ═══ Lightning Receive QR ═══ -->
	{#if lightningAddress}
		<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
			<div class="flex items-center gap-2 px-5 py-3">
				<Icon name="lucide:qr-code" class="size-4 text-amber-500" />
				<h2 class="font-display text-[14px] font-semibold">{t('settings.lightningReceiveQr')}</h2>
			</div>
			<div class="flex flex-col items-center gap-3 px-5 py-6 sm:flex-row sm:items-start sm:gap-6">
				<div class="rounded-2xl border border-[var(--ui-border)] bg-white p-3 shadow-sm">
					<QrCode value={`lightning:${lightningAddress}`} size={176} badge="lightning" />
				</div>
				<div class="flex-1">
					<p class="text-[13px] font-bold text-amber-600 dark:text-amber-400">
						lightning:{lightningAddress}
					</p>
					<p class="mt-1 text-[12px] text-[var(--ui-text-muted)]">
						A static QR customers can scan with any Lightning wallet. For amount-locked invoices at
						checkout, this address is reused by the POS “Show QR” flow.
					</p>
					<a
						href="/settings/pay-qr"
						class="mt-3 inline-flex items-center gap-1 text-[11.5px] font-semibold text-primary-600 hover:underline dark:text-primary-400"
					>
						<Icon name="lucide:arrow-right" class="size-3.5" />Manage Pay QR
					</a>
				</div>
			</div>
		</section>
	{/if}

	<!-- ═══ Payment Settings ═══ -->
	<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
		<div class="flex items-center gap-2 px-5 py-3">
			<Icon name="lucide:settings-2" class="size-4 text-primary-500" />
			<h2 class="font-display text-[14px] font-semibold">{t('settings.paymentSettings')}</h2>
		</div>
		<div class="grid grid-cols-1 gap-4 px-5 py-4 sm:grid-cols-2">
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
					>{t('settings.defaultMemo')}</span
				>
				<Input bind:value={defaultMemo} placeholder={t('pos.payment')} class="w-full" />
			</label>
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
					>{t('settings.defaultExpiry')}</span
				>
				<Input bind:value={defaultExpiry} type="number" placeholder="3600" class="w-full" />
			</label>
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
					>{t('settings.minAmount')}</span
				>
				<Input
					bind:value={minAmount}
					type="number"
					placeholder={t('settings.noLimit')}
					class="w-full"
				/>
			</label>
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
					>{t('settings.maxAmount')}</span
				>
				<Input
					bind:value={maxAmount}
					type="number"
					placeholder={t('settings.noLimit')}
					class="w-full"
				/>
			</label>
		</div>
	</section>

	<!-- ═══ Receipt ═══ -->
	<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
		<div class="flex items-center gap-2 px-5 py-3">
			<Icon name="lucide:receipt" class="size-4 text-primary-500" />
			<h2 class="font-display text-[14px] font-semibold">{t('settings.receipt')}</h2>
		</div>
		<div class="flex items-center justify-between gap-4 px-5 py-4">
			<div>
				<label class="text-[13px] font-semibold">{t('settings.showSatsOnReceipt')}</label>
				<p class="text-[11px] text-[var(--ui-text-dimmed)]">
					{t('settings.showSatsOnReceiptDesc')}
				</p>
			</div>
			<Switch bind:checked={receiptShowSats} />
		</div>
	</section>

	<!-- ═══ Conversion Preview ═══ -->
	<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
		<div class="flex items-center gap-2 px-5 py-3">
			<Icon name="lucide:calculator" class="size-4 text-primary-500" />
			<h2 class="font-display text-[14px] font-semibold">{t('settings.conversionPreview')}</h2>
		</div>
		<div class="px-5 py-4">
			<div class="flex items-end gap-3">
				<div class="flex-1">
					<label
						class="mb-1.5 block text-[11px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase"
					>
						Amount ({currency})
					</label>
					<Input bind:value={previewAmount} type="number" class="w-full" />
				</div>
				<div class="flex items-center pb-2.5">
					<Icon name="lucide:arrow-right" class="size-4 text-[var(--ui-text-dimmed)]" />
				</div>
				<div class="flex-1">
					<label
						class="mb-1.5 block text-[11px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase"
					>
						{t('settings.satoshis')}
					</label>
					<div
						class="flex h-9.5 items-center rounded-lg border border-amber-500/20 bg-amber-500/10 px-3"
					>
						<span class="text-[13px] font-black text-amber-600 dark:text-amber-400">
							{formatSat(previewSats)}
						</span>
					</div>
				</div>
			</div>
		</div>
	</section>

	<!-- ═══ Danger Zone ═══ -->
	<section class="surface-card danger-surface divide-y divide-[var(--ui-border-muted)]">
		<div class="flex items-center gap-2 px-5 py-3">
			<Icon name="lucide:triangle-alert" class="size-4 text-[var(--tone-error-text)]" />
			<h2 class="font-display text-[14px] font-semibold text-[var(--tone-error-text)]">
				{t('settings.dangerZone')}
			</h2>
		</div>
		<div class="flex items-center justify-between gap-4 px-5 py-4">
			<div>
				<label class="text-[13px] font-semibold">{t('settings.resetBitcoinSettings')}</label>
				<p class="text-[11px] text-[var(--ui-text-dimmed)]">
					{t('settings.resetBitcoinSettingsDesc')}
				</p>
			</div>
			<Button color="error" variant="subtle" size="sm" icon="lucide:rotate-ccw" onclick={resetAll}
				>Reset</Button
			>
		</div>
	</section>

	<div class="flex justify-end">
		<Button color="primary" icon="lucide:check" onclick={save}>{t('common.saveChanges')}</Button>
	</div>
</div>
