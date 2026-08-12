<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { glo } from '$nostr/store.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { session } from '$nostr/session.svelte';
	import { relays } from '$nostr/relay.svelte';
	import { CORE_DATA_TYPES, dataSync } from '$nostr/sync.svelte';
	import { formatMoney, formatNumber, formatInt, relativeTime } from '$lib/utils/format';
	import {
		toOrderRows,
		metricsSummary,
		expenseSummary,
		lowStockSummary,
		buildHourly,
		buildChartBars,
		paymentBreakdown,
		orderTypeSegments,
		topProducts,
		startOfToday,
		type DashboardOrder
	} from '$lib/dashboard/metrics';
	import { TYPE } from '$lib/domain';
	import type { Expense } from '$lib/domain/types';
	import type { GloProduct, GloCustomer } from '@bitos/bnos-core/glo';
	import { t } from '$lib/i18n/i18n.svelte';
	import { btcRate } from '$lib/bitcoin/rate.svelte';
	import { shifts as shiftStore } from '$lib/pos/shifts.svelte';

	let clock = $state('');
	let blockHeight = $state<number | null>(null);
	let blockTimestamp = $state<number | null>(null);
	let blockLoading = $state(false);

	const greet = $derived.by(() => {
		const h = new Date().getHours();
		if (h < 12) return t('dashboard.goodMorning');
		if (h < 17) return t('dashboard.goodAfternoon');
		return t('dashboard.goodEvening');
	});

	function hasDashboardCache() {
		return (
			glo.all('commerce.order').length > 0 ||
			glo.all('commerce.payment').length > 0 ||
			glo.all('catalog.product').length > 0 ||
			glo.all('crm.customer').length > 0
		);
	}

	async function waitForHydration() {
		let attempts = 0;
		while (attempts < 20) {
			const hydrated = ['commerce.order', 'commerce.payment', 'catalog.product', 'crm.customer']
				.every((type) => glo.isHydrated(type));
			if (hydrated) return;
			await new Promise((resolve) => setTimeout(resolve, 80));
			attempts++;
		}
	}

	onMount(() => {
		// Dashboard leads with CORE data; also hydrate expenses (secondary) so the
		// net-profit card has local-cache data the moment background sync runs.
		dataSync.hydrate([...CORE_DATA_TYPES, TYPE.expense]);

		void (async () => {
			await waitForHydration();

			const hasCache = hasDashboardCache();
			const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;

			if (hasCache) {
				if (!isOffline) {
					dataSync.backgroundOperationalSync();
				}
				return;
			}

			if (!isOffline) {
				dataSync.backgroundOperationalSync();
			}
		})();

		// live clock — drives both the time display and the shift duration tick
		const tick = () =>
			(clock = new Date().toLocaleTimeString('en-US', {
				hour: '2-digit',
				minute: '2-digit',
				hour12: true
			}));
		tick();
		const id = setInterval(tick, 1000);
		void refreshBlockchain();
		const blockId = setInterval(refreshBlockchain, 60_000);
		return () => {
			clearInterval(id);
			clearInterval(blockId);
		};
	});

	const orderObjects = $derived(glo.all<DashboardOrder, 'commerce.order'>('commerce.order'));

	// Build payment method lookup: orderId → method
	const paymentMethodMap = $derived.by(() => {
		const payments = glo.all<Record<string, unknown>, 'commerce.payment'>('commerce.payment');
		const methods: Record<string, string> = {};
		for (const p of payments) {
			const oid = typeof p.data.orderId === 'string' ? p.data.orderId : '';
			if (oid) methods[oid] = typeof p.data.method === 'string' ? p.data.method : 'cash';
		}
		return methods;
	});

	const rows = $derived(toOrderRows(orderObjects as never, paymentMethodMap));
	const todayRows = $derived(rows.filter((o) => o.atMs >= startOfToday()));
	const currency = $derived(tenant.state.currency);
	const btcPrice = $derived(btcRate.rateFor(currency));
	const btcUsdPrice = $derived(btcRate.rateFor('USD'));

	// Sats equivalent of one unit of the merchant's currency (e.g. 1 THB ≈ N sats).
	// Useful in a Bitcoin-native POS — the merchant thinks in sats when stacking.
	const showSats = $derived(btcRate.canConvert(currency));
	const satsPerUnit = $derived(showSats ? btcRate.satsFromAmount(1, currency) : 0);
	const rateAge = $derived(btcRate.ageLabelFor(currency));
	const blockAgeMinutes = $derived.by(() => {
		void clock;
		return blockTimestamp ? Math.max(0, Math.floor(Date.now() / 1000 - blockTimestamp) / 60) : 0;
	});
	const blockAge = $derived.by(() => {
		const minutes = Math.floor(blockAgeMinutes);
		if (minutes < 1) return 'just now';
		if (minutes < 60) return `${minutes}m ago`;
		const hours = Math.floor(minutes / 60);
		return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
	});

	$effect(() => {
		if (!tenant.hydrated || !currency) return;
		untrack(() => void btcRate.ensureRate(currency));
		if (currency !== 'USD') untrack(() => void btcRate.ensureRate('USD'));
	});

	const m = $derived(metricsSummary(rows));
	const expenses = $derived(glo.all<Expense, typeof TYPE.expense>(TYPE.expense));
	const exp = $derived(expenseSummary(expenses));
	const netProfitToday = $derived(m.todaysTotal - exp.todaysTotal);
	const marginToday = $derived(m.todaysTotal > 0 ? (netProfitToday / m.todaysTotal) * 100 : 0);
	const hourly = $derived(buildHourly(rows));
	const chartBars = $derived(buildChartBars(rows));
	const payments = $derived(paymentBreakdown(todayRows));
	const segments = $derived(orderTypeSegments(todayRows));
	const products = $derived(topProducts(orderObjects as never));
	const recent = $derived([...rows].sort((a, b) => b.atMs - a.atMs).slice(0, 8));
	const allProducts = $derived(glo.all<GloProduct, 'catalog.product'>('catalog.product'));
	const stock = $derived(lowStockSummary(allProducts as never));
	const productCount = $derived(allProducts.length);
	const customerCount = $derived(glo.all<GloCustomer, 'crm.customer'>('crm.customer').length);

	// Active shift + running duration (ticks every second via `clock` dep).
	const activeShift = $derived(shiftStore.activeShift);
	const shiftSummary = $derived(activeShift ? shiftStore.summaryFor(activeShift.id) : null);
	const shiftDuration = $derived.by(() => {
		void clock; // re-evaluate each second so the timer stays live
		if (!activeShift) return '';
		const ms = Date.now() - new Date(activeShift.data.openedAt).getTime();
		if (!Number.isFinite(ms) || ms < 0) return '0m';
		const mins = Math.floor(ms / 60000);
		const h = Math.floor(mins / 60);
		const mm = mins % 60;
		return h > 0 ? `${h}h ${mm}m` : `${mm}m`;
	});

	// Sync / online status line under the org name.
	const syncStatus = $derived.by(() => {
		if (!relays.online) return { tone: 'tone-warning', label: t('common.offline') };
		if (dataSync.status === 'syncing') return { tone: 'tone-info', label: t('common.sync') + '…' };
		if (dataSync.status === 'failed') return { tone: 'tone-error', label: t('common.syncFailed') };
		return {
			tone: 'tone-success',
			label: dataSync.lastSyncedAt
				? `${t('common.allDataSynced')} · ${relativeTime(dataSync.lastSyncedAt)}`
				: t('common.allDataSynced')
		};
	});

	const todayLong = $derived(
		new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
	);

	async function refreshRate() {
		await Promise.all([
			btcRate.refresh(currency),
			currency !== 'USD' ? btcRate.refresh('USD') : Promise.resolve(),
			refreshBlockchain()
		]);
	}

	async function refreshBlockchain() {
		if (blockLoading) return;
		blockLoading = true;
		try {
			let latest: { height?: number; timestamp?: number } | undefined;
			try {
				// Blockstream is the primary source.
				const hashResponse = await fetch('https://blockstream.info/api/blocks/tip/hash');
				if (!hashResponse.ok) throw new Error(`HTTP ${hashResponse.status}`);
				const hash = (await hashResponse.text()).trim();
				const blockResponse = await fetch(`https://blockstream.info/api/block/${hash}`);
				if (!blockResponse.ok) throw new Error(`HTTP ${blockResponse.status}`);
				latest = (await blockResponse.json()) as { height?: number; timestamp?: number };
			} catch {
				// Mempool.space fallback.
				const response = await fetch('https://mempool.space/api/blocks');
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				const blocks = (await response.json()) as Array<{ height?: number; timestamp?: number }>;
				latest = blocks[0];
			}
			if (typeof latest?.height === 'number' && typeof latest.timestamp === 'number') {
				blockHeight = latest.height;
				blockTimestamp = latest.timestamp;
			}
		} catch {
			// Keep the last known block when the network is unavailable.
		} finally {
			blockLoading = false;
		}
	}

	function statusColor(status: string): 'success' | 'info' | 'warning' | 'neutral' {
		const s = status.toLowerCase();
		if (s.includes('paid') || s.includes('complete') || s.includes('done')) return 'success';
		if (s.includes('pending') || s.includes('draft')) return 'warning';
		if (s.includes('cancel') || s.includes('refund')) return 'info';
		return 'neutral';
	}

	const quickActions = $derived([
		{
			to: resolve('/pos'),
			icon: 'lucide:scan-line',
			label: t('common.new') + ' ' + t('common.sale'),
			desc: t('dashboard.openThePos'),
			color: 'text-primary-500',
			bg: 'bg-primary-500/10'
		},
		{
			to: resolve('/orders'),
			icon: 'lucide:receipt-text',
			label: t('dashboard.orders'),
			desc: `${m.allTimeCount}`,
			color: 'text-blue-500',
			bg: 'bg-blue-500/10'
		},
		{
			to: resolve('/catalog'),
			icon: 'lucide:package',
			label: t('nav.catalog'),
			desc: `${productCount} ${t('dashboard.totalProducts').toLowerCase()}`,
			color: 'text-orange-500',
			bg: 'bg-orange-500/10'
		},
		{
			to: resolve('/customers'),
			icon: 'lucide:users',
			label: t('dashboard.totalCustomers'),
			desc: `${customerCount} ${t('dashboard.people')}`,
			color: 'text-emerald-500',
			bg: 'bg-emerald-500/10'
		}
	]);
</script>

<svelte:head><title>{t('common.appName')} · {t('nav.dashboard')}</title></svelte:head>

<div class="dashboard-page dashboard-stack pt-1 pb-12">
	<!-- ══════════════════ Welcome header + premium status cluster ══════════════════ -->
	<header class="dashboard-header flex flex-wrap items-end justify-between gap-3">
		<div class="min-w-0">
			<p class="text-[12px] font-semibold tracking-wider text-[var(--ui-text-dimmed)] uppercase">
				{greet}
			</p>
			<h1 class="font-display text-2xl font-bold tracking-tight">
				{tenant.state.organizationName || t('dashboard.yourStore')}
			</h1>
			<div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-[var(--ui-text-muted)]">
				<span class="inline-flex items-center gap-1.5">
					<span
						class="relative inline-flex size-2 rounded-full {relays.online
							? 'bg-emerald-500'
							: 'bg-amber-500'}"
						aria-hidden="true"
					>
						{#if relays.online}
							<span class="absolute inset-0 animate-ping rounded-full bg-emerald-500/60"></span>
						{/if}
					</span>
					<span class="font-semibold {syncStatus.tone}">{syncStatus.label}</span>
				</span>
				<span class="text-[var(--ui-text-dimmed)]">·</span>
				<span class="font-mono">{session.shortNpub ?? t('profile.nostrIdentity')}</span>
				<span class="text-[var(--ui-text-dimmed)]">·</span>
				<span>{tenant.state.currency}</span>
			</div>
		</div>

		<!-- Premium status cluster: BTC price · live clock/date -->
		<div class="flex flex-wrap items-stretch gap-2">
			<!-- BTC price card -->
			<div
				class="surface-card flex items-stretch overflow-hidden"
				role="group"
				aria-label={t('dashboard.btcPrice')}
			>
				<div
					class="grid w-11 shrink-0 place-items-center bg-amber-500/10 text-amber-500"
					aria-hidden="true"
				>
					<Icon name="lucide:bitcoin" class="size-5" />
				</div>
				<div class="flex flex-col justify-center px-3.5 py-2">
					<div class="flex items-center gap-2">
						<span
							class="text-[10px] font-semibold tracking-wide text-[var(--ui-text-dimmed)] uppercase"
						>
							BTC · {currency}
						</span>
						<button
							type="button"
							class="grid size-5 place-items-center rounded-md text-[var(--ui-text-dimmed)] transition-colors hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)] focus-brand"
							onclick={refreshRate}
							disabled={btcRate.loading}
							aria-label={t('dashboard.refreshRate')}
							title={t('dashboard.refreshRate')}
						>
							<Icon
								name="lucide:refresh-cw"
								class="size-3.5 {btcRate.loading ? 'animate-spin' : ''}"
							/>
						</button>
					</div>
					<div class="font-display text-[15px] font-bold leading-tight tabular-nums">
						{#if btcPrice > 0}
							{formatMoney(btcPrice, currency)}
						{:else if btcRate.loading}
							<span class="inline-block h-4 w-24 animate-pulse rounded bg-[var(--ui-bg-accented)]"></span>
						{:else}
							<span class="text-[12px] font-semibold text-[var(--ui-text-dimmed)]">
								{t('dashboard.rateUnavailable')}
							</span>
						{/if}
					</div>
					<div class="mt-0.5 flex items-center gap-1.5 text-[10px] text-[var(--ui-text-dimmed)]">
						{#if satsPerUnit > 0}
							<span class="tabular-nums"
								>1 {currency} ≈ {formatNumber(satsPerUnit)} sats</span
							>
							<span aria-hidden="true">·</span>
						{/if}
						{#if rateAge}
							<span>{t('dashboard.rateUpdated')} {rateAge}</span>
						{/if}
						{#if currency !== 'USD' && btcUsdPrice > 0}
							<span aria-hidden="true">·</span>
							<span class="tabular-nums">{formatMoney(btcUsdPrice, 'USD')} USD</span>
						{/if}
					</div>
					{#if blockHeight !== null}
						<div
							class="mt-1 text-[10px] tabular-nums {blockAgeMinutes >= 15 ? 'text-[var(--tone-warning-text)]' : 'text-[var(--ui-text-dimmed)]'}"
							title="Latest Bitcoin blockchain block"
						>
							Block {formatInt(blockHeight)} · {blockAge}
						</div>
					{/if}
				</div>
			</div>

			<!-- Live clock + date card -->
			<div
				class="surface-card flex items-stretch overflow-hidden"
				role="group"
				aria-label={t('common.today')}
			>
				<div
					class="grid w-11 shrink-0 place-items-center bg-[var(--ui-bg-muted)] text-[var(--ui-text-dimmed)]"
					aria-hidden="true"
				>
					<Icon name="lucide:calendar-clock" class="size-5" />
				</div>
				<div class="flex flex-col justify-center px-3.5 py-2">
					<div class="font-mono text-[16px] font-bold leading-tight tabular-nums">
						{clock || '--:--'}
					</div>
					<div class="mt-0.5 text-[10px] font-semibold tracking-wide text-[var(--ui-text-dimmed)] uppercase">
						{todayLong}
					</div>
					{#if activeShift}
						<a
							href={resolve('/transactions/shifts')}
							class="mt-0.5 inline-flex items-center gap-1 text-[10px] font-semibold text-primary-600 hover:underline dark:text-primary-400"
							title={t('dashboard.viewShifts')}
						>
							<span class="live-dot !size-1.5"></span>
							{t('dashboard.shiftRunning')} {shiftDuration}
						</a>
					{/if}
				</div>
			</div>
		</div>
	</header>

	<!-- Active shift banner (only when a shift is open) -->
	{#if activeShift && shiftSummary}
		<a
			href={resolve('/transactions/shifts')}
			class="surface-card flex flex-wrap items-center gap-3 p-3 transition-colors hover:border-[var(--ui-border-accented)]"
		>
			<span class="grid size-9 shrink-0 place-items-center rounded-xl bg-primary-500/10 text-primary-600 dark:text-primary-400">
				<Icon name="lucide:lock-open" class="size-4" />
			</span>
			<div class="min-w-0 flex-1">
				<div class="flex items-center gap-2">
					<span class="text-[13px] font-semibold">{t('dashboard.shiftRunning')}</span>
					<span class="inline-flex items-center gap-1 rounded-md bg-primary-500/10 px-1.5 py-0.5 text-[11px] font-bold text-primary-600 tabular-nums dark:text-primary-400">
						<Icon name="lucide:timer" class="size-3" />{shiftDuration}
					</span>
				</div>
				<p class="text-[11.5px] text-[var(--ui-text-muted)]">
					{shiftSummary.totalOrders} {t('dashboard.orders')} · {t('dashboard.shiftSales')}
					{formatMoney(shiftSummary.totalSales - shiftSummary.totalRefundAmount, currency)}
				</p>
			</div>
			<span class="hidden items-center gap-1 text-[12px] font-semibold text-primary-600 sm:inline-flex dark:text-primary-400">
				{t('dashboard.viewShifts')}
				<Icon name="lucide:arrow-right" class="size-3.5" />
			</span>
		</a>
	{/if}

	<!-- Quick actions -->
	<div class="dashboard-quick-actions grid grid-cols-2 lg:grid-cols-4">
		{#each quickActions as action (action.label)}
			<a
				href={action.to}
				class="dashboard-quick-action surface-card group flex items-center transition-colors hover:border-[var(--ui-border-accented)]"
			>
				<div
					class="dashboard-quick-action-icon grid size-10 shrink-0 place-items-center rounded-xl {action.bg} {action.color}"
				>
					<Icon name={action.icon} class="size-5" />
				</div>
				<div class="min-w-0">
					<div class="text-[13px] font-semibold">{action.label}</div>
					<div class="truncate text-[11.5px] text-[var(--ui-text-muted)]">{action.desc}</div>
				</div>
			</a>
		{/each}
	</div>

	<!-- Main grid -->
	<div class="dashboard-grid grid grid-cols-1 xl:grid-cols-12">
		<!-- LEFT COLUMN -->
		<div class="dashboard-column flex flex-col xl:col-span-5">
			<!-- Today's sales (hero) -->
			<div class="dashboard-card accent-bar surface-card" style="--accent: var(--ui-color-primary-500);">
				<div class="flex items-start justify-between">
					<div>
						<div class="text-[12px] font-semibold text-[var(--ui-text-muted)]">
							{t('dashboard.todaysSales')}
						</div>
						<div class="mt-1 font-display text-3xl font-bold tracking-tight tabular-nums">
							{formatMoney(m.todaysTotal, currency)}
						</div>
					</div>
					{#if m.salesChange !== 0}
						<span
							class="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold {m.salesChange >=
							0
								? 'tone-success'
								: 'tone-error'}"
						>
							<Icon
								name={m.salesChange >= 0 ? 'lucide:trending-up' : 'lucide:trending-down'}
								class="size-3"
							/>
							{m.salesChange >= 0 ? '+' : ''}{m.salesChange.toFixed(1)}%
						</span>
					{/if}
				</div>
				<div class="mt-4 grid grid-cols-2 gap-3">
					<div class="dashboard-stat rounded-lg bg-[var(--ui-bg-muted)]">
						<div class="text-[11px] text-[var(--ui-text-dimmed)]">{t('dashboard.orders')}</div>
						<div class="font-display text-lg font-bold tabular-nums">
							{formatInt(m.todaysCount)}
						</div>
					</div>
					<div class="dashboard-stat rounded-lg bg-[var(--ui-bg-muted)]">
						<div class="text-[11px] text-[var(--ui-text-dimmed)]">{t('dashboard.avgOrder')}</div>
						<div class="font-display text-lg font-bold tabular-nums">
							{formatMoney(m.avgOrder, currency)}
						</div>
					</div>
				</div>
			</div>

			<!-- Low-stock alerts (only when there's something to flag) -->
			{#if stock.low + stock.out > 0}
				<div class="dashboard-card surface-card">
					<div class="mb-3 flex items-center justify-between gap-2">
						<h3 class="flex items-center gap-2 font-display text-[15px] font-semibold tracking-tight">
							<Icon name="lucide:package-x" class="size-4 text-amber-500" />
							{t('dashboard.lowStock')}
						</h3>
						<span class="tone-warning rounded-md px-2 py-0.5 text-[11px] font-semibold tabular-nums">
							{stock.low} low · {stock.out} out
						</span>
					</div>
					<p class="mb-3 text-[12px] text-[var(--ui-text-muted)]">{t('dashboard.lowStockDesc')}</p>
					<ul class="space-y-1.5">
						{#each stock.items as item (item.id)}
							<li class="flex items-center gap-2.5 text-[12.5px]">
								<span
									class="grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-bold {item
										.state === 'out'
										? 'tone-error'
										: 'tone-warning'}"
								>
									<Icon
										name={item.state === 'out' ? 'lucide:x' : 'lucide:alert-triangle'}
										class="size-3"
									/>
								</span>
								<span class="min-w-0 flex-1 truncate font-semibold">{item.name}</span>
								<span class="shrink-0 font-mono text-[11.5px] tabular-nums text-[var(--ui-text-muted)]">
									{item.stock}/{item.threshold}
								</span>
							</li>
						{/each}
					</ul>
					<a
						href={resolve('/inventory')}
						class="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold text-primary-600 hover:underline dark:text-primary-400"
					>
						{t('dashboard.lowStockManage')}
						<Icon name="lucide:arrow-right" class="size-3.5" />
					</a>
				</div>
			{/if}

			<!-- Hourly sales -->
			<div class="dashboard-card surface-card">
				<div class="mb-4 flex items-center justify-between">
					<h3 class="font-display text-[15px] font-semibold tracking-tight">
						{t('dashboard.hourlySales')}
					</h3>
					<span class="text-[11px] text-[var(--ui-text-dimmed)]">{t('common.today')}</span>
				</div>
				{#if hourly.length}
					<div class="flex h-32 items-end justify-between gap-1">
						{#each hourly as hr (hr.label)}
							<div class="flex flex-1 flex-col items-center gap-1">
								<div
									class="w-full rounded-t-md transition-all {hr.isPeak
										? 'bg-primary-500'
										: 'bg-primary-500/40'}"
									style="height: {Math.max(3, (hr.height / 100) * 112)}px"
									aria-label={`${hr.label}: ${formatMoney(hr.value, currency)}`}
									title={formatMoney(hr.value, currency)}
								></div>
								<span class="text-[9.5px] font-semibold text-[var(--ui-text-dimmed)]">{hr.label}</span>
							</div>
						{/each}
					</div>
				{:else}
					<p class="py-8 text-center text-[12.5px] text-[var(--ui-text-dimmed)]">
						{t('dashboard.noSalesToday')}
					</p>
				{/if}
			</div>

			<!-- Payment breakdown -->
			<div class="dashboard-card surface-card">
				<h3 class="mb-3 font-display text-[15px] font-semibold tracking-tight">
					{t('dashboard.paymentMethods')}
				</h3>
				{#if payments.length}
					<div class="space-y-2.5">
						{#each payments as p (p.key)}
							<div class="flex items-center gap-3">
								<div
									class="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)]"
								>
									<Icon name={p.icon} class="size-4" />
								</div>
								<div class="min-w-0 flex-1">
									<div class="flex items-center justify-between text-[12.5px]">
										<span class="font-semibold">{p.label}</span>
										<span class="text-[var(--ui-text-muted)] tabular-nums"
											>{formatMoney(p.total, currency)}</span
										>
									</div>
									<div class="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--ui-bg-accented)]">
										<div class="h-full rounded-full bg-primary-500" style="width: {p.percent}%"></div>
									</div>
								</div>
							</div>
						{/each}
					</div>
				{:else}
					<p class="py-4 text-center text-[12.5px] text-[var(--ui-text-dimmed)]">
						{t('dashboard.noPaymentsToday')}
					</p>
				{/if}
			</div>

			<!-- Order types + top products -->
			<div class="dashboard-card surface-card">
				<h3 class="mb-3 font-display text-[15px] font-semibold tracking-tight">
					{t('dashboard.orderTypes')}
				</h3>
				{#if segments.length}
					<div class="mb-4 flex flex-wrap gap-2">
						{#each segments as s (s.key)}
							<span
								class="inline-flex items-center gap-1.5 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-2.5 py-1 text-[11.5px] font-semibold"
							>
								<Icon name={s.icon} class="size-3.5 text-[var(--ui-text-dimmed)]" />
								{s.label}
								<span class="text-[var(--ui-text-dimmed)] tabular-nums">{s.count}</span>
							</span>
						{/each}
					</div>
				{:else}
					<p class="mb-4 text-[12.5px] text-[var(--ui-text-dimmed)]">{t('dashboard.noOrdersToday')}</p>
				{/if}

				<div class="border-t border-[var(--ui-border-muted)] pt-3">
					<h4 class="mb-2 text-[12px] font-semibold text-[var(--ui-text-muted)]">
						{t('dashboard.topProducts')}
					</h4>
					{#if products.length}
						<ol class="space-y-1.5">
							{#each products as p, i (p.name)}
								<li class="flex items-center gap-2.5 text-[12.5px]">
									<span
										class="grid size-5 shrink-0 place-items-center rounded-full bg-primary-500/10 text-[10px] font-bold text-primary-600 dark:text-primary-400"
										>{i + 1}</span
									>
									<span class="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
									<span class="shrink-0 text-[var(--ui-text-muted)] tabular-nums"
										>{formatInt(p.qty)} {t('dashboard.sold')}</span
									>
								</li>
							{/each}
						</ol>
					{:else}
						<p class="text-[12px] text-[var(--ui-text-dimmed)]">{t('dashboard.noProductSales')}</p>
					{/if}
				</div>
			</div>
		</div>

		<!-- RIGHT COLUMN -->
		<div class="dashboard-column flex flex-col xl:col-span-7">
			<!-- Metrics row: Net profit (today) · this week · this month -->
			<div class="dashboard-metrics grid grid-cols-1 sm:grid-cols-3">
				<div class="metric-card dashboard-metric-card">
					<div class="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--ui-text-dimmed)]">
						<Icon name="lucide:wallet" class="size-3.5" />
						{t('dashboard.netProfit')}
						<span class="text-[var(--ui-text-dimmed)]">· {t('common.today')}</span>
					</div>
					<div
						class="mt-1 font-display text-lg font-bold tabular-nums {netProfitToday < 0
							? 'text-[var(--tone-error-text)]'
							: ''}"
					>
						{formatMoney(netProfitToday, currency)}
					</div>
					<div class="text-[11px] text-[var(--ui-text-muted)]">
						{t('dashboard.expensesToday')} {formatMoney(exp.todaysTotal, currency)}
						{#if m.todaysTotal > 0}
							· {t('dashboard.margin')} {marginToday.toFixed(0)}%
						{/if}
					</div>
				</div>
				<div class="metric-card dashboard-metric-card">
					<div class="text-[11px] font-semibold text-[var(--ui-text-dimmed)]">{t('common.thisWeek')}</div>
					<div class="mt-1 font-display text-lg font-bold tabular-nums">
						{formatMoney(m.weekTotal, currency)}
					</div>
					<div class="text-[11px] text-[var(--ui-text-muted)]">{m.weekCount} {t('dashboard.orders')}</div>
				</div>
				<div class="metric-card dashboard-metric-card">
					<div class="text-[11px] font-semibold text-[var(--ui-text-dimmed)]">{t('common.thisMonth')}</div>
					<div class="mt-1 font-display text-lg font-bold tabular-nums">
						{formatMoney(m.monthTotal, currency)}
					</div>
					<div class="text-[11px] text-[var(--ui-text-muted)]">{m.monthCount} {t('dashboard.orders')}</div>
				</div>
			</div>

			<!-- Sales chart (7 days) -->
			<div class="dashboard-card surface-card">
				<div class="mb-4 flex items-center justify-between">
					<h3 class="font-display text-[15px] font-semibold tracking-tight">{t('dashboard.salesLast7')}</h3>
					<span class="font-display text-base font-bold text-primary-600 tabular-nums dark:text-primary-400">
						{formatMoney(chartBars.reduce((s, b) => s + b.value, 0), currency)}
					</span>
				</div>
				<div class="flex h-44 items-end justify-between gap-2">
					{#each chartBars as bar (bar.label)}
						<div class="flex flex-1 flex-col items-center gap-1.5">
							<div
								class="w-full rounded-t-md transition-all {bar.isCurrent
									? 'bg-primary-500'
									: 'bg-primary-500/40'}"
								style="height: {Math.max(4, bar.height * 1.4)}px"
								title={formatMoney(bar.value, currency)}
							></div>
							<span
								class="text-[10.5px] font-semibold {bar.isCurrent
									? 'text-primary-500'
									: 'text-[var(--ui-text-dimmed)]'}"
							>
								{bar.label}
							</span>
						</div>
					{/each}
				</div>
			</div>

			<!-- Recent orders -->
			<div class="surface-card overflow-hidden">
				<div class="dashboard-card-header flex items-center justify-between border-b border-[var(--ui-border-muted)]">
					<h3 class="font-display text-[15px] font-semibold tracking-tight">{t('dashboard.recentOrders')}</h3>
					<a
						href={resolve('/orders')}
						class="text-[12.5px] font-semibold text-primary-600 hover:underline dark:text-primary-400"
						>{t('common.viewAll')}</a
					>
				</div>
				{#if recent.length === 0}
					<div class="dashboard-card-body">
						<EmptyState
							icon="lucide:receipt-text"
							title={t('dashboard.noOrdersYet')}
							description={t('dashboard.noOrdersDesc')}
						>
							{#snippet actions()}
								<Button color="primary" size="sm" icon="lucide:scan-line" href={resolve('/pos')}
									>{t('dashboard.openPos')}</Button
								>
							{/snippet}
						</EmptyState>
					</div>
				{:else}
					<div class="divide-y divide-[var(--ui-border-muted)]">
						{#each recent as o (o.id)}
							<a
								href={resolve(`/orders/${o.id}`)}
								class="dashboard-order-row flex items-center gap-3 transition-colors hover:bg-[var(--ui-bg-accented)]"
							>
								<div
									class="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-500/10 text-primary-600 dark:text-primary-400"
								>
									<Icon name="lucide:receipt-text" class="size-4" />
								</div>
								<div class="min-w-0 flex-1">
									<div class="flex items-center gap-2">
										<span class="text-[13px] font-semibold">{o.number}</span>
										<Badge color={statusColor(o.status)}>{o.status}</Badge>
									</div>
									<p class="mt-0.5 text-[11.5px] text-[var(--ui-text-dimmed)]">
										{o.items} {o.items !== 1 ? t('dashboard.items') : t('dashboard.item')} · {relativeTime(o.atMs)}
									</p>
								</div>
								<div class="text-right">
									<div class="text-[13px] font-bold tabular-nums">{formatMoney(o.total, currency)}</div>
									<div
										class="mt-0.5 flex items-center justify-end gap-1 text-[10.5px] font-semibold text-[var(--ui-text-dimmed)]"
									>
										<Icon
											name={o.method === 'cash'
												? 'lucide:banknote'
												: o.method === 'card'
													? 'lucide:credit-card'
													: o.method === 'qr'
														? 'lucide:qr-code'
														: o.method === 'lightning'
															? 'lucide:zap'
															: 'lucide:circle-dot'}
											class="size-3"
										/>
										<span class="capitalize">{o.method}</span>
									</div>
								</div>
							</a>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</div>
</div>
