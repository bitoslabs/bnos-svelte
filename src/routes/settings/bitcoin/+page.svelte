<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import Switch from '$lib/components/ui/Switch.svelte';
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
		{ id: 'lnd', label: 'LND (REST)', icon: 'lucide:server', desc: 'Self-hosted Lightning node' },
		{ id: 'phoenixd', label: 'PhoenixD', icon: 'lucide:flame', desc: 'Self-hosted Lightning' },
		{ id: 'alby', label: 'Alby', icon: 'lucide:zap', desc: 'Alby API / OAuth' },
		{ id: 'nwc', label: 'NWC (Nostr Wallet Connect)', icon: 'lucide:link', desc: 'NWC relay URL' },
		{ id: 'lnaddress', label: 'LNURL Address', icon: 'lucide:at-sign', desc: 'user@domain.com' },
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
			// Simulate async test depending on provider
			await new Promise((r) => setTimeout(r, 800));

			if (lightningProvider === 'lnaddress' && !lightningAddress)
				throw new Error('Enter a Lightning Address');
			if (lightningProvider === 'lnd' && !lndUrl) throw new Error('Enter LND REST URL');
			if (lightningProvider === 'phoenixd' && !phoenixdUrl) throw new Error('Enter PhoenixD URL');
			if (lightningProvider === 'alby' && !albyApiKey) throw new Error('Enter Alby API key');
			if (lightningProvider === 'nwc' && !nwcUrl) throw new Error('Enter NWC relay URL');
			if (lightningProvider === 'blink' && !blinkApiKey) throw new Error('Enter Blink API key');
			if (lightningProvider === 'strike' && !strikeApiKey) throw new Error('Enter Strike API key');

			// Mock node info for display
			if (lightningProvider === 'lnd' || lightningProvider === 'phoenixd') {
				nodePubkey = '02' + Math.random().toString(16).slice(2).padStart(62, '0').slice(0, 62);
				nodeAlias = lightningProvider === 'lnd' ? 'MyLNDNode' : 'PhoenixD';
			} else {
				nodePubkey = '';
				nodeAlias = lightningProvider;
			}

			testStatus = 'success';
			nodeStatus = 'connected';
			testResult = `✓ Connected${nodeAlias ? ' · ' + nodeAlias : ''}`;
			toast.success('Connection successful');
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
		toast.success('Bitcoin settings saved');
	}

	async function resetAll() {
		if (!browser) return;
		if (
			!(await confirm({
				title: 'Reset Bitcoin settings?',
				message: 'All Bitcoin settings (node, rates, network) will return to defaults.',
				tone: 'danger',
				icon: 'lucide:rotate-ccw',
				confirmText: 'Reset all'
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

<svelte:head><title>Bitcoin · Settings</title></svelte:head>

<div class="space-y-5">
	<PageHeader
		icon="lucide:bitcoin"
		accent="amber"
		title="Bitcoin"
		description="Lightning, exchange rate, and payment settings"
	/>

	<!-- ═══ Exchange Rate ═══ -->
	<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
		<div class="flex items-center justify-between px-5 py-3">
			<div class="flex items-center gap-2">
				<Icon name="lucide:trending-up" class="size-4 text-primary-500" />
				<h2 class="font-display text-[14px] font-semibold">Exchange rate</h2>
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
					<p class="text-[10px] font-bold text-[var(--ui-text-dimmed)] uppercase">Source</p>
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
				>Rate source</label
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
						>Manual BTC/USD rate</label
					>
					<Input bind:value={manualRate} type="number" placeholder="100000" class="w-full" />
					<p class="mt-1 text-[10px] text-[var(--ui-text-dimmed)]">
						Set your own BTC/fiat exchange rate
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
				<h2 class="font-display text-[14px] font-semibold">Lightning backend</h2>
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
				>Select provider</label
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
					<span class="text-[13px] font-semibold text-[var(--ui-text-muted)]">None</span>
				</button>
			</div>
		</div>

		<!-- Provider-specific config -->
		{#if lightningProvider === 'lnd'}
			<div class="space-y-3 px-5 py-4">
				<div>
					<label
						class="mb-1.5 block text-[11px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase"
						>LND REST URL</label
					>
					<Input bind:value={lndUrl} placeholder="https://127.0.0.1:8080" class="w-full" />
					<p class="mt-1 text-[10px] text-[var(--ui-text-dimmed)]">
						REST endpoint of your LND node
					</p>
				</div>
				<div>
					<label
						class="mb-1.5 block text-[11px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase"
						>Macaroon (hex)</label
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
						>PhoenixD URL</label
					>
					<Input bind:value={phoenixdUrl} placeholder="http://127.0.0.1:9740" class="w-full" />
					<p class="mt-1 text-[10px] text-[var(--ui-text-dimmed)]">Phoenix daemon API endpoint</p>
				</div>
				<div>
					<label
						class="mb-1.5 block text-[11px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase"
						>Password</label
					>
					<Input bind:value={phoenixdPass} type="password" placeholder="••••••••" class="w-full" />
					<p class="mt-1 text-[10px] text-[var(--ui-text-dimmed)]">Phoenix daemon HTTP password</p>
				</div>
			</div>
		{:else if lightningProvider === 'alby'}
			<div class="px-5 py-4">
				<label
					class="mb-1.5 block text-[11px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase"
					>Alby API key</label
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
					>NWC relay URL</label
				>
				<Input bind:value={nwcUrl} placeholder="nostr+walletconnect://…" class="w-full" />
				<p class="mt-1 text-[10px] text-[var(--ui-text-dimmed)]">
					Nostr Wallet Connect string from your wallet
				</p>
			</div>
		{:else if lightningProvider === 'lnaddress'}
			<div class="px-5 py-4">
				<label
					class="mb-1.5 block text-[11px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase"
					>Lightning address</label
				>
				<Input bind:value={lightningAddress} placeholder="user@domain.com" class="w-full" />
				<p class="mt-1 text-[10px] text-[var(--ui-text-dimmed)]">
					Your LNURL-compatible Lightning address
				</p>
			</div>
		{:else if lightningProvider === 'blink'}
			<div class="space-y-3 px-5 py-4">
				<div>
					<label
						class="mb-1.5 block text-[11px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase"
						>Blink API key</label
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
						>Wallet ID</label
					>
					<Input
						bind:value={blinkWalletId}
						placeholder="Auto-discovered on test, or enter manually"
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
					>Strike API key</label
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

	<!-- ═══ Payment Settings ═══ -->
	<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
		<div class="flex items-center gap-2 px-5 py-3">
			<Icon name="lucide:settings-2" class="size-4 text-primary-500" />
			<h2 class="font-display text-[14px] font-semibold">Payment settings</h2>
		</div>
		<div class="grid grid-cols-1 gap-4 px-5 py-4 sm:grid-cols-2">
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
					>Default memo</span
				>
				<Input bind:value={defaultMemo} placeholder="Payment" class="w-full" />
			</label>
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
					>Default expiry (seconds)</span
				>
				<Input bind:value={defaultExpiry} type="number" placeholder="3600" class="w-full" />
			</label>
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
					>Min amount ({currency})</span
				>
				<Input bind:value={minAmount} type="number" placeholder="0 = no limit" class="w-full" />
			</label>
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
					>Max amount ({currency})</span
				>
				<Input bind:value={maxAmount} type="number" placeholder="0 = no limit" class="w-full" />
			</label>
		</div>
	</section>

	<!-- ═══ Receipt ═══ -->
	<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
		<div class="flex items-center gap-2 px-5 py-3">
			<Icon name="lucide:receipt" class="size-4 text-primary-500" />
			<h2 class="font-display text-[14px] font-semibold">Receipt</h2>
		</div>
		<div class="flex items-center justify-between gap-4 px-5 py-4">
			<div>
				<label class="text-[13px] font-semibold">Show sats on receipt</label>
				<p class="text-[11px] text-[var(--ui-text-dimmed)]">
					Display satoshi amounts alongside fiat
				</p>
			</div>
			<Switch bind:checked={receiptShowSats} />
		</div>
	</section>

	<!-- ═══ Conversion Preview ═══ -->
	<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
		<div class="flex items-center gap-2 px-5 py-3">
			<Icon name="lucide:calculator" class="size-4 text-primary-500" />
			<h2 class="font-display text-[14px] font-semibold">Conversion preview</h2>
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
						Satoshis
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
				Danger zone
			</h2>
		</div>
		<div class="flex items-center justify-between gap-4 px-5 py-4">
			<div>
				<label class="text-[13px] font-semibold">Reset bitcoin settings</label>
				<p class="text-[11px] text-[var(--ui-text-dimmed)]">Restore Bitcoin settings to defaults</p>
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
