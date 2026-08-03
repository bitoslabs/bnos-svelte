<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { browser } from '$app/environment';

	const KEY = 'bnos-os:settings-billing';

	type PlanCode = 'lite' | 'starter' | 'pro' | 'pro_max' | 'enterprise';

	interface PlanInfo {
		code: PlanCode;
		name: string;
		description: string;
		price: number; // LAK per month; -1 = contact us
		icon: string;
		gradient: string;
		shadow: string;
		limits: Record<string, number | 'unlimited'>;
		modules: Record<string, boolean>;
	}

	const PLAN_ORDER: PlanCode[] = ['lite', 'starter', 'pro', 'pro_max', 'enterprise'];

	const PLANS: Record<PlanCode, PlanInfo> = {
		lite: {
			code: 'lite',
			name: 'Free',
			description: 'All features, 200 orders/day',
			price: 0,
			icon: 'lucide:package',
			gradient: 'from-gray-600 to-gray-800 dark:from-gray-700 dark:to-gray-900',
			shadow: 'shadow-gray-500/5',
			limits: { ordersPerDay: 200, branches: 1, staff: 3, products: 500, customers: 500 },
			modules: {
				restaurant: true,
				inventory: true,
				multiBranch: false,
				purchaseOrders: false,
				reports: true
			}
		},
		starter: {
			code: 'starter',
			name: 'Solo',
			description: '500 orders/day, 2 branches',
			price: 120000,
			icon: 'lucide:store',
			gradient: 'from-blue-500 to-blue-700 dark:from-blue-700 dark:to-blue-900',
			shadow: 'shadow-blue-500/8',
			limits: { ordersPerDay: 500, branches: 2, staff: 8, products: 5000, customers: 5000 },
			modules: {
				restaurant: true,
				inventory: true,
				multiBranch: true,
				purchaseOrders: false,
				reports: true
			}
		},
		pro: {
			code: 'pro',
			name: 'Business',
			description: '2,000 orders/day, 5 branches',
			price: 280000,
			icon: 'lucide:star',
			gradient: 'from-purple-500 to-indigo-700 dark:from-purple-700 dark:to-indigo-900',
			shadow: 'shadow-purple-500/8',
			limits: {
				ordersPerDay: 2000,
				branches: 5,
				staff: 25,
				products: 20000,
				customers: 'unlimited'
			},
			modules: {
				restaurant: true,
				inventory: true,
				multiBranch: true,
				purchaseOrders: true,
				reports: true
			}
		},
		pro_max: {
			code: 'pro_max',
			name: 'Premium',
			description: 'Unlimited orders, 15 branches',
			price: 580000,
			icon: 'lucide:crown',
			gradient: 'from-amber-500 to-orange-600 dark:from-amber-700 dark:to-orange-800',
			shadow: 'shadow-amber-500/10',
			limits: {
				ordersPerDay: 'unlimited',
				branches: 15,
				staff: 100,
				products: 'unlimited',
				customers: 'unlimited'
			},
			modules: {
				restaurant: true,
				inventory: true,
				multiBranch: true,
				purchaseOrders: true,
				reports: true
			}
		},
		enterprise: {
			code: 'enterprise',
			name: 'Enterprise',
			description: 'Chain, franchise, custom',
			price: -1,
			icon: 'lucide:building-2',
			gradient: 'from-primary-500 to-primary-700 dark:from-primary-700 dark:to-primary-900',
			shadow: 'shadow-primary-500/8',
			limits: {
				ordersPerDay: 'unlimited',
				branches: 'unlimited',
				staff: 'unlimited',
				products: 'unlimited',
				customers: 'unlimited'
			},
			modules: {
				restaurant: true,
				inventory: true,
				multiBranch: true,
				purchaseOrders: true,
				reports: true
			}
		}
	};

	const RESOURCE_ICONS: Record<string, string> = {
		branches: 'lucide:store',
		staff: 'lucide:users',
		products: 'lucide:package',
		customers: 'lucide:user',
		ordersPerDay: 'lucide:receipt-text'
	};

	const MODULE_LIST = [
		{ key: 'ordersPerDay', label: 'Orders/day', type: 'limit' as const },
		{ key: 'branches', label: 'Branches', type: 'limit' as const },
		{ key: 'staff', label: 'Staff', type: 'limit' as const },
		{ key: 'products', label: 'Products', type: 'limit' as const },
		{ key: 'customers', label: 'Customers', type: 'limit' as const },
		{ key: 'restaurant', label: 'Restaurant', type: 'module' as const },
		{ key: 'inventory', label: 'Inventory', type: 'module' as const },
		{ key: 'multiBranch', label: 'Multi-Branch', type: 'module' as const },
		{ key: 'purchaseOrders', label: 'Purchase Orders', type: 'module' as const },
		{ key: 'reports', label: 'Reports & Analytics', type: 'module' as const }
	];

	type SubStatus =
		'trialing' | 'active' | 'past_due' | 'grace' | 'cancel_scheduled' | 'cancelled' | 'expired';

	interface Subscription {
		planCode: PlanCode;
		status: SubStatus;
		companyId: string;
		currentPeriodStart: number;
		currentPeriodEnd: number;
	}

	interface Invoice {
		id: string;
		invoiceNumber: string;
		amount: number;
		currency: string;
		status: 'outstanding' | 'paid';
		dueAt: number;
		paidAt?: number;
		method?: string;
		createdAt: number;
	}

	// ── State ──
	let subscription = $state<Subscription | null>(null);
	let invoices = $state<Invoice[]>([]);
	let showUpgradeModal = $state(false);
	let showDowngradeModal = $state(false);
	let showCancelModal = $state(false);
	let showPayModal = $state(false);
	let selectedPlan = $state<PlanCode | null>(null);
	let payingInvoice = $state<Invoice | null>(null);
	let selectedMethod = $state<string | null>(null);
	let activeLightningInvoice = $state<string | null>(null);
	let payLoading = $state(false);

	// ── Load / persist ──
	onMount(() => {
		if (!browser) return;
		try {
			const raw = localStorage.getItem(KEY);
			if (raw) {
				const s = JSON.parse(raw);
				subscription = s.subscription ?? null;
				invoices = s.invoices ?? [];
			}
		} catch {
			/* */
		}
	});

	function persist() {
		if (!browser) return;
		localStorage.setItem(KEY, JSON.stringify({ subscription, invoices }));
	}

	// ── Derived ──
	const planCode = $derived(subscription?.planCode ?? 'lite');
	const currentPlan = $derived(PLANS[planCode]);
	const currentPlanIndex = $derived(PLAN_ORDER.indexOf(planCode));
	const isActive = $derived(
		subscription?.status === 'active' || subscription?.status === 'trialing'
	);
	const isTrialing = $derived(subscription?.status === 'trialing');
	const isCancelScheduled = $derived(subscription?.status === 'cancel_scheduled');
	const isGrace = $derived(subscription?.status === 'grace' || subscription?.status === 'past_due');

	const statusLabel = $derived.by(() => {
		const status = subscription?.status ?? 'expired';
		const labels: Record<string, string> = {
			trialing: 'Trial',
			active: 'Active',
			past_due: 'Past Due',
			grace: 'Grace Period',
			cancel_scheduled: 'Cancels Soon',
			cancelled: 'Cancelled',
			expired: 'Expired'
		};
		return labels[status] ?? status;
	});

	const daysUntilExpiry = $derived.by(() => {
		if (!subscription) return 0;
		const now = Math.floor(Date.now() / 1000);
		const end = subscription.currentPeriodEnd;
		return Math.max(0, Math.ceil((end - now) / 86400));
	});

	const periodProgressPercent = $derived.by(() => {
		if (!subscription) return 0;
		const start = subscription.currentPeriodStart;
		const end = subscription.currentPeriodEnd;
		if (!start || !end || end <= start) return 0;
		const now = Math.floor(Date.now() / 1000);
		const total = end - start;
		const elapsed = now - start;
		return Math.min(100, Math.max(0, Math.round((elapsed / total) * 100)));
	});

	const canUpgrade = $derived(currentPlanIndex < PLAN_ORDER.length - 1 && isActive);
	const canDowngrade = $derived(currentPlanIndex > 0 && isActive);
	const canCancel = $derived(
		subscription?.status === 'active' ||
			subscription?.status === 'trialing' ||
			subscription?.status === 'past_due' ||
			subscription?.status === 'grace'
	);

	const outstandingInvoices = $derived(invoices.filter((i) => i.status === 'outstanding'));
	const paymentHistory = $derived(invoices.filter((i) => i.status === 'paid').slice(0, 5));

	const upgradePlans = $derived(PLAN_ORDER.slice(currentPlanIndex + 1));
	const downgradePlans = $derived(PLAN_ORDER.slice(0, currentPlanIndex));

	const usage = $derived.by(() => {
		const limits = currentPlan.limits;
		// Mock current usage
		const mockUsage: Record<string, number> = {
			ordersPerDay: 145,
			branches: 1,
			staff: 2,
			products: 230,
			customers: 85
		};
		return Object.entries(RESOURCE_ICONS).map(([key, icon]) => {
			const limit = limits[key];
			const current = mockUsage[key] ?? 0;
			const percent = limit === 'unlimited' ? 0 : Math.round((current / (limit as number)) * 100);
			let threshold = 'ok';
			if (limit !== 'unlimited') {
				if (percent >= 90) threshold = 'danger';
				else if (percent >= 70) threshold = 'warning';
			}
			const labels: Record<string, string> = {
				ordersPerDay: 'Orders / day',
				branches: 'Branches',
				staff: 'Staff accounts',
				products: 'Products',
				customers: 'Customers'
			};
			return { key, icon, label: labels[key] ?? key, current, limit, percent, threshold };
		});
	});

	// ── Helpers ──
	function formatPlanPrice(code: PlanCode): string {
		const plan = PLANS[code];
		if (plan.price < 0) return 'Contact Us';
		if (plan.price === 0) return 'Free';
		return new Intl.NumberFormat('en', { maximumFractionDigits: 0 }).format(plan.price) + ' ₭';
	}

	function formatAmount(amount: number): string {
		if (!amount && amount !== 0) return '-';
		return new Intl.NumberFormat('en', { maximumFractionDigits: 0 }).format(amount) + ' ₭';
	}

	function formatDate(ts?: number): string {
		if (!ts) return '-';
		return new Date(ts * 1000).toLocaleDateString();
	}

	function formatMethod(method?: string): string {
		if (!method) return '-';
		const labels: Record<string, string> = {
			btc_lightning: 'Lightning',
			phajay_qr: 'Bank QR',
			bank_transfer: 'Bank Transfer',
			cash: 'Cash',
			card: 'Card',
			manual: 'Manual'
		};
		return labels[method] ?? method;
	}

	function methodIcon(method?: string): string {
		const map: Record<string, string> = {
			btc_lightning: 'lucide:zap',
			phajay_qr: 'lucide:qr-code',
			bank_transfer: 'lucide:building',
			cash: 'lucide:wallet',
			card: 'lucide:credit-card',
			manual: 'lucide:pen'
		};
		return map[method ?? ''] ?? 'lucide:credit-card';
	}

	const STATUS_COLORS: Record<string, string> = {
		trialing: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
		active: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
		past_due: 'bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30',
		grace: 'bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30',
		cancel_scheduled: 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30',
		cancelled: 'bg-gray-500/15 text-gray-500 border-gray-500/30',
		expired: 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30'
	};

	function getThresholdColor(t: string): string {
		return t === 'danger'
			? 'text-red-500'
			: t === 'warning'
				? 'text-amber-500'
				: 'text-[var(--ui-text-muted)]';
	}

	function getThresholdBarColor(t: string): string {
		return t === 'danger' ? 'bg-red-500' : t === 'warning' ? 'bg-amber-500' : 'bg-primary-500';
	}

	function getPlanLimitText(code: PlanCode, resource: string): string {
		const val = PLANS[code].limits[resource];
		return val === 'unlimited' ? '∞' : String(val);
	}

	function getPlanLimitValue(code: PlanCode, key: string): string {
		const val = PLANS[code].limits[key];
		return val === 'unlimited' ? 'Unlimited' : String(val);
	}

	// ── Actions ──
	function startTrial() {
		const now = Math.floor(Date.now() / 1000);
		subscription = {
			planCode: 'starter',
			status: 'trialing',
			companyId: 'bdgo-' + Math.random().toString(36).slice(2, 10),
			currentPeriodStart: now,
			currentPeriodEnd: now + 30 * 86400
		};
		persist();
		toast.success('Starter trial activated for 30 days');
	}

	function changePlan(newCode: PlanCode) {
		if (!subscription) return;
		const plan = PLANS[newCode];
		if (plan.price < 0) {
			toast.warning('Enterprise plan requires manual review');
			return;
		}
		const now = Math.floor(Date.now() / 1000);
		// Create invoice
		const inv: Invoice = {
			id: 'inv_' + Math.random().toString(36).slice(2, 10),
			invoiceNumber: 'INV-' + String(invoices.length + 1).padStart(4, '0'),
			amount: plan.price,
			currency: 'LAK',
			status: 'outstanding',
			dueAt: now + 7 * 86400,
			createdAt: now
		};
		invoices = [inv, ...invoices];

		// For demo: immediately mark as paid and switch plan
		inv.status = 'paid';
		inv.paidAt = now;
		inv.method = 'btc_lightning';
		subscription.planCode = newCode;
		subscription.status = 'active';
		persist();
		showUpgradeModal = false;
		showDowngradeModal = false;
		selectedPlan = null;
		toast.success(`Switched to ${plan.name} plan`);
	}

	function cancelSubscription() {
		if (!subscription) return;
		subscription.status = 'cancel_scheduled';
		persist();
		showCancelModal = false;
		toast.warning('Subscription will cancel at period end');
	}

	function openPayModal(inv: Invoice) {
		payingInvoice = inv;
		selectedMethod = null;
		activeLightningInvoice = null;
		showPayModal = true;
	}

	function closePayModal() {
		showPayModal = false;
		payingInvoice = null;
		selectedMethod = null;
		activeLightningInvoice = null;
	}

	function processPayment() {
		if (!payingInvoice || !selectedMethod) return;
		const inv = payingInvoice;

		if (selectedMethod === 'btc_lightning') {
			// Generate a fake lightning invoice
			activeLightningInvoice =
				'lnbc' + inv.amount + '0n1ps' + Math.random().toString(36).slice(2, 20);
			toast.info('Lightning invoice generated');
		} else {
			// Simulate payment
			confirmPayment(inv, selectedMethod);
		}
	}

	function confirmPayment(inv: Invoice, method: string) {
		const now = Math.floor(Date.now() / 1000);
		const updated = invoices.map((i) =>
			i.id === inv.id ? { ...i, status: 'paid' as const, paidAt: now, method } : i
		);
		invoices = updated;
		persist();
		closePayModal();
		toast.success('Payment confirmed');
	}

	function copyText(text: string, label: string) {
		navigator.clipboard.writeText(text);
		toast.success(`${label} copied`);
	}

	const paymentMethodOptions = [
		{
			code: 'btc_lightning',
			label: 'Bitcoin Lightning',
			icon: 'lucide:zap',
			iconColor: 'text-amber-500',
			bgColor: 'bg-amber-500/10'
		},
		{
			code: 'phajay_qr',
			label: 'Bank QR',
			icon: 'lucide:qr-code',
			iconColor: 'text-primary-500',
			bgColor: 'bg-primary-500/10'
		}
	];

	const displayPlans = PLAN_ORDER.slice(0, 4);
</script>

<svelte:head><title>Billing · Settings</title></svelte:head>

<div class="space-y-5">
	<!-- Header -->
	<PageHeader
		icon="lucide:credit-card"
		title="Billing"
		description="Manage your subscription, plan, and payment history"
	>
		{#snippet actions()}
			{#if subscription}
				<span
					class="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold {STATUS_COLORS[
						subscription.status
					] ?? STATUS_COLORS.expired}"
				>
					<span class="size-1.5 animate-pulse rounded-full bg-current"></span>
					{statusLabel}
				</span>
			{/if}
		{/snippet}
	</PageHeader>

	{#if !subscription}
		<!-- ════════ No Subscription ════════ -->
		<div class="space-y-6">
			<!-- Hero CTA -->
			<div
				class="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary-600 to-indigo-700 p-6 text-white shadow-lg sm:p-8 dark:from-primary-800 dark:to-indigo-950"
			>
				<div class="absolute inset-0 opacity-10">
					<div class="absolute -top-24 -right-24 size-64 rounded-full bg-white/20 blur-3xl"></div>
					<div class="absolute -bottom-24 -left-24 size-64 rounded-full bg-white/10 blur-3xl"></div>
				</div>
				<div class="relative max-w-2xl">
					<span
						class="mb-4 inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-xs font-bold tracking-wider uppercase backdrop-blur-sm"
					>
						<Icon name="lucide:crown" class="size-3.5" />
						Get started
					</span>
					<h2 class="text-xl font-black tracking-tight sm:text-2xl">Start your free trial today</h2>
					<p class="mt-2 max-w-xl text-sm leading-relaxed text-white/75">
						Unlock multi-branch, advanced reports, and higher limits. No credit card required — try
						any plan free for 30 days.
					</p>
					<div class="mt-5">
						<Button
							color="neutral"
							variant="solid"
							size="lg"
							icon="lucide:play"
							onclick={startTrial}>Start free trial</Button
						>
					</div>
				</div>
			</div>

			<!-- Plan cards -->
			<div>
				<h3 class="mb-3 flex items-center gap-2 font-display text-[15px] font-semibold">
					<Icon name="lucide:layout-grid" class="size-4 text-primary-500" />
					Explore plans
				</h3>
				<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
					{#each displayPlans as code (code)}
						{@const plan = PLANS[code]}
						<div class="surface-card flex flex-col justify-between p-4">
							<div>
								<div class="mb-2 flex items-center justify-between">
									<span
										class="rounded-md bg-primary-500/10 px-2 py-0.5 text-xs font-bold tracking-wide text-primary-500 uppercase"
									>
										{plan.name}
									</span>
									<Icon name={plan.icon} class="size-4 text-[var(--ui-text-dimmed)]" />
								</div>
								<p class="text-lg font-black tracking-tight">{formatPlanPrice(code)}</p>
								<p class="mt-1 text-[11.5px] leading-relaxed text-[var(--ui-text-muted)]">
									{plan.description}
								</p>
							</div>
							<div
								class="mt-4 space-y-1.5 border-t border-[var(--ui-border-muted)] pt-3 text-[11.5px] text-[var(--ui-text-muted)]"
							>
								<div class="flex items-center gap-1.5">
									<Icon name="lucide:check-circle" class="size-3.5 shrink-0 text-emerald-500" />
									Orders/day:
									<strong class="text-[var(--ui-text)]"
										>{getPlanLimitText(code, 'ordersPerDay')}</strong
									>
								</div>
								<div class="flex items-center gap-1.5">
									<Icon name="lucide:check-circle" class="size-3.5 shrink-0 text-emerald-500" />
									Branches:
									<strong class="text-[var(--ui-text)]">{getPlanLimitText(code, 'branches')}</strong
									>
								</div>
								<div class="flex items-center gap-1.5">
									<Icon name="lucide:check-circle" class="size-3.5 shrink-0 text-emerald-500" />
									Products:
									<strong class="text-[var(--ui-text)]">{getPlanLimitText(code, 'products')}</strong
									>
								</div>
							</div>
						</div>
					{/each}
				</div>
			</div>
		</div>
	{:else}
		<!-- ════════ Active Subscription ════════ -->
		<div class="grid grid-cols-1 gap-5 lg:grid-cols-3 lg:items-start">
			<!-- Main column -->
			<div class="space-y-5 lg:col-span-2">
				<!-- Membership Card -->
				<div
					class="relative overflow-hidden rounded-2xl bg-gradient-to-br {currentPlan.gradient} {currentPlan.shadow} p-5 text-white shadow-sm sm:p-6"
				>
					<div class="absolute inset-0 opacity-10">
						<div class="absolute -top-16 -right-16 size-64 rounded-full bg-white/30 blur-3xl"></div>
						<div
							class="absolute -bottom-16 -left-16 size-48 rounded-full bg-white/20 blur-2xl"
						></div>
					</div>
					<div class="relative space-y-4">
						<div class="flex items-start justify-between gap-3">
							<div class="min-w-0">
								<span
									class="mb-2 inline-flex items-center rounded-full bg-white/20 px-2 py-0.5 text-xs font-bold uppercase backdrop-blur-sm"
								>
									{statusLabel}
								</span>
								<h3 class="text-2xl font-black tracking-tight capitalize sm:text-3xl">
									{currentPlan.name}
								</h3>
							</div>
							<div
								class="grid size-10 shrink-0 place-items-center rounded-xl border border-white/20 bg-white/15 backdrop-blur-sm"
							>
								<Icon name={currentPlan.icon} class="size-5" />
							</div>
						</div>
						<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
							<div class="space-y-1.5">
								<div
									class="inline-flex items-center gap-1.5 rounded-lg border border-white/5 bg-white/10 px-2.5 py-1 text-xs backdrop-blur-sm"
								>
									<Icon name="lucide:lock" class="size-3.5 text-white/60" />
									<span class="max-w-[140px] truncate font-mono sm:max-w-none"
										>{subscription.companyId}</span
									>
									<button
										type="button"
										onclick={() => copyText(subscription!.companyId, 'Company ID')}
										class="cursor-pointer p-0.5 hover:text-white"
									>
										<Icon name="lucide:copy" class="size-3" />
									</button>
								</div>
								<div class="flex items-center gap-1 text-xs font-medium text-white/55">
									<Icon name="lucide:info" class="size-3" />
									Support:
									<span class="font-bold text-white/80 capitalize"
										>{planCode === 'lite'
											? 'community'
											: planCode === 'enterprise'
												? 'dedicated'
												: 'email'}</span
									>
								</div>
							</div>
							<div class="shrink-0 text-left sm:text-right">
								<span class="text-2xl font-black tracking-tight sm:text-3xl"
									>{formatPlanPrice(planCode)}</span
								>
								{#if currentPlan.price > 0}
									<p class="mt-0.5 text-xs font-bold text-white/65">/ month</p>
								{/if}
							</div>
						</div>
						<!-- Period progress -->
						<div class="space-y-1.5 border-t border-white/10 pt-3">
							<div class="flex items-center justify-between text-xs">
								<span class="flex items-center gap-1 text-white/60">
									<Icon name="lucide:clock" class="size-3.5" />
									{#if isTrialing}
										Trial ends in {daysUntilExpiry} days
									{:else if isCancelScheduled}
										Access ends in {daysUntilExpiry} days
									{:else}
										Renews in {daysUntilExpiry} days
									{/if}
								</span>
								<span class="font-bold text-white/75">{periodProgressPercent}% elapsed</span>
							</div>
							<div class="h-1.5 w-full overflow-hidden rounded-full bg-white/15">
								<div
									class="h-full rounded-full bg-white/80 transition-all duration-1000"
									style="width: {periodProgressPercent}%"
								></div>
							</div>
						</div>
					</div>
				</div>

				<!-- Usage Metrics -->
				<section class="surface-card overflow-hidden">
					<div class="flex items-center gap-2 border-b border-[var(--ui-border-muted)] px-5 py-3">
						<Icon name="lucide:bar-chart-3" class="size-4 text-primary-500" />
						<h2 class="font-display text-[14px] font-semibold">Usage</h2>
					</div>
					<div class="p-4 sm:p-5">
						<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
							{#each usage as entry (entry.key)}
								<div
									class="rounded-xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] p-4"
								>
									<div class="mb-3 flex items-start justify-between">
										<div class="flex items-center gap-2">
											<div class="grid size-8 place-items-center rounded-lg bg-primary-500/10">
												<Icon name={entry.icon} class="size-4 text-primary-500" />
											</div>
											<span class="text-xs font-bold">{entry.label}</span>
										</div>
										<span class="text-xs font-bold {getThresholdColor(entry.threshold)}">
											{entry.current} /
											<span class="opacity-70"
												>{entry.limit === 'unlimited' ? '∞' : entry.limit}</span
											>
										</span>
									</div>
									{#if entry.limit !== 'unlimited'}
										<div class="space-y-1">
											<div
												class="h-1.5 w-full overflow-hidden rounded-full bg-[var(--ui-bg-accented)]"
											>
												<div
													class="h-full rounded-full transition-all duration-500 {getThresholdBarColor(
														entry.threshold
													)}"
													style="width: {Math.min(entry.percent, 100)}%"
												></div>
											</div>
											<div
												class="text-right text-xs font-bold {getThresholdColor(entry.threshold)}"
											>
												{entry.percent}%
											</div>
										</div>
									{:else}
										<div>
											<div class="h-1.5 w-full overflow-hidden rounded-full bg-emerald-500/10">
												<div
													class="h-full w-full bg-gradient-to-r from-emerald-500/20 to-emerald-400/40"
												></div>
											</div>
											<div
												class="mt-1.5 flex items-center justify-between text-xs font-bold text-emerald-500"
											>
												<span>Unlimited</span>
												<Icon name="lucide:infinity" class="size-4" />
											</div>
										</div>
									{/if}
								</div>
							{/each}
						</div>
					</div>
				</section>
			</div>

			<!-- Sidebar -->
			<div class="space-y-5">
				<!-- Subscription Settings -->
				<section class="surface-card overflow-hidden">
					<div class="flex items-center gap-2 border-b border-[var(--ui-border-muted)] px-5 py-3">
						<Icon name="lucide:settings" class="size-4 text-primary-500" />
						<h2 class="font-display text-[14px] font-semibold">Subscription</h2>
					</div>
					<div class="space-y-3 p-4">
						{#if isGrace}
							<div
								class="flex items-start gap-2.5 rounded-xl border border-red-200/40 bg-red-50 p-3 dark:bg-red-950/20"
							>
								<Icon name="lucide:triangle-alert" class="mt-0.5 size-4 shrink-0 text-red-500" />
								<div class="text-xs">
									<p class="font-bold text-red-800 dark:text-red-400">Action required</p>
									<p class="mt-0.5 leading-relaxed text-red-700/80 dark:text-red-400/70">
										Your subscription is {statusLabel}. Please resolve payment to restore full
										access.
									</p>
								</div>
							</div>
						{/if}
						<div class="flex flex-col gap-2">
							{#if canUpgrade}
								<Button
									color="primary"
									variant="solid"
									block
									icon="lucide:arrow-up"
									onclick={() => {
										selectedPlan = null;
										showUpgradeModal = true;
									}}>Upgrade</Button
								>
							{/if}
							{#if canDowngrade}
								<Button
									color="neutral"
									variant="subtle"
									block
									icon="lucide:arrow-down"
									onclick={() => {
										selectedPlan = null;
										showDowngradeModal = true;
									}}>Downgrade</Button
								>
							{/if}
							{#if canCancel}
								<Button
									color="error"
									variant="ghost"
									block
									size="sm"
									icon="lucide:trash-2"
									onclick={() => {
										showCancelModal = true;
									}}>Cancel subscription</Button
								>
							{/if}
						</div>
					</div>
				</section>

				<!-- Outstanding Invoices -->
				{#if outstandingInvoices.length > 0}
					<section
						class="overflow-hidden rounded-2xl border border-amber-200/50 bg-gradient-to-br from-amber-50 to-orange-50 shadow-sm dark:border-amber-900/30 dark:from-amber-950/15 dark:to-orange-950/10"
					>
						<div
							class="flex items-center gap-2 border-b border-amber-200/40 px-5 py-3 dark:border-amber-900/20"
						>
							<div class="relative flex size-2">
								<span
									class="absolute inline-flex size-full animate-ping rounded-full bg-orange-400 opacity-75"
								></span>
								<span class="relative inline-flex size-2 rounded-full bg-orange-500"></span>
							</div>
							<h3 class="flex items-center gap-1.5 text-xs font-bold tracking-wider uppercase">
								<Icon name="lucide:triangle-alert" class="size-4 text-orange-500" />
								Outstanding invoices
							</h3>
						</div>
						<div class="space-y-2 p-4">
							{#each outstandingInvoices as inv (inv.id)}
								<div
									class="flex items-center justify-between rounded-xl border border-amber-200/30 bg-white/80 p-3 dark:border-amber-500/10 dark:bg-black/25"
								>
									<div class="space-y-0.5">
										<p class="text-xs font-bold">{inv.invoiceNumber}</p>
										<p class="text-xs text-[var(--ui-text-dimmed)]">Due: {formatDate(inv.dueAt)}</p>
									</div>
									<div class="flex flex-col items-end gap-1.5">
										<span class="text-xs font-bold text-orange-600 dark:text-orange-400"
											>{formatAmount(inv.amount)}</span
										>
										<Button
											size="sm"
											color="primary"
											variant="subtle"
											icon="lucide:send"
											onclick={() => openPayModal(inv)}>Pay now</Button
										>
									</div>
								</div>
							{/each}
						</div>
					</section>
				{/if}

				<!-- Payment History -->
				{#if paymentHistory.length > 0}
					<section class="surface-card overflow-hidden">
						<div class="flex items-center gap-2 border-b border-[var(--ui-border-muted)] px-5 py-3">
							<Icon name="lucide:history" class="size-4 text-primary-500" />
							<h2 class="font-display text-[14px] font-semibold">Payment history</h2>
						</div>
						<div class="p-4 sm:p-5">
							<div
								class="relative space-y-4 pl-6 before:absolute before:top-2 before:bottom-2 before:left-[11px] before:w-0.5 before:bg-[var(--ui-border-muted)]"
							>
								{#each paymentHistory as p (p.id)}
									<div class="relative flex items-start justify-between gap-3">
										<div
											class="absolute top-0.5 -left-[29px] z-10 grid size-6 place-items-center rounded-full border-2 border-[var(--ui-bg-elevated)] bg-primary-500/10"
										>
											<Icon name={methodIcon(p.method)} class="size-3 text-primary-500" />
										</div>
										<div class="space-y-0.5">
											<p class="text-xs leading-tight font-bold capitalize">
												{formatMethod(p.method)} payment
											</p>
											<p class="text-xs text-[var(--ui-text-dimmed)]">
												{formatDate(p.paidAt ?? p.createdAt)}
											</p>
										</div>
										<div class="flex shrink-0 items-center gap-1.5">
											<span class="text-xs font-bold">{formatAmount(p.amount)}</span>
											<Icon name="lucide:check-circle" class="size-3.5 text-emerald-500" />
										</div>
									</div>
								{/each}
							</div>
						</div>
					</section>
				{/if}
			</div>
		</div>
	{/if}

	<!-- ════════ Plan Comparison (always shown) ════════ -->
	<section class="surface-card overflow-hidden">
		<div class="flex items-center gap-2 border-b border-[var(--ui-border-muted)] px-5 py-3">
			<Icon name="lucide:table" class="size-4 text-primary-500" />
			<h2 class="font-display text-[14px] font-semibold">Plan comparison</h2>
		</div>
		<div class="-mx-3 overflow-x-auto p-3 sm:mx-0 sm:p-4">
			<div
				class="min-w-[540px] overflow-hidden rounded-xl border border-[var(--ui-border-muted)] sm:min-w-[620px]"
			>
				<!-- Header row -->
				<div
					class="grid border-b border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)]"
					style="grid-template-columns: 1.5fr repeat(4, minmax(110px, 1fr))"
				>
					<div class="p-3">
						<span class="text-xs font-bold tracking-wider text-[var(--ui-text-dimmed)] uppercase"
							>Feature</span
						>
					</div>
					{#each displayPlans as code (code)}
						<div
							class="relative flex flex-col items-center justify-center gap-0.5 border-l border-[var(--ui-border-muted)] p-3 text-center {code ===
								planCode && subscription
								? 'bg-primary-500/10 ring-1 ring-primary-500/30'
								: ''}"
						>
							{#if code === planCode && subscription}
								<span
									class="absolute -top-0.5 rounded-b-md bg-primary-500 px-2 py-0.5 text-xs font-bold tracking-wider text-white uppercase"
									>Current</span
								>
							{/if}
							<span
								class="text-xs font-bold capitalize {code === planCode && subscription
									? 'text-primary-600 dark:text-primary-400'
									: ''}"
							>
								{PLANS[code].name}
							</span>
							<span class="text-xs font-bold text-primary-500">{formatPlanPrice(code)}</span>
						</div>
					{/each}
				</div>
				<!-- Feature rows -->
				<div class="divide-y divide-[var(--ui-border-muted)]">
					{#each MODULE_LIST as mod (mod.key)}
						<div
							class="grid items-center hover:bg-[var(--ui-bg-accented)]/50"
							style="grid-template-columns: 1.5fr repeat(4, minmax(110px, 1fr))"
						>
							<div class="flex items-center gap-2 p-3">
								<Icon
									name={mod.type === 'limit' ? 'lucide:settings-2' : 'lucide:check-square'}
									class="size-3.5 text-[var(--ui-text-dimmed)]"
								/>
								<span class="text-xs font-medium text-[var(--ui-text-muted)]">{mod.label}</span>
							</div>
							{#each displayPlans as code (code)}
								<div
									class="flex items-center justify-center border-l border-[var(--ui-border-muted)] p-3 text-center {code ===
										planCode && subscription
										? 'bg-primary-500/5'
										: ''}"
								>
									{#if mod.type === 'limit'}
										<span
											class="text-xs font-bold {PLANS[code].limits[mod.key] === 'unlimited'
												? 'text-emerald-500'
												: 'text-[var(--ui-text-muted)]'}"
										>
											{getPlanLimitValue(code, mod.key)}
										</span>
									{:else}
										{#if PLANS[code].modules[mod.key]}
											<Icon name="lucide:check-circle" class="size-5 text-emerald-500" />
										{:else}
											<Icon
												name="lucide:minus-circle"
												class="size-4 text-[var(--ui-text-dimmed)] opacity-40"
											/>
										{/if}
									{/if}
								</div>
							{/each}
						</div>
					{/each}
				</div>
			</div>
		</div>
	</section>
</div>

<!-- ════════ Upgrade Modal ════════ -->
<Dialog bind:open={showUpgradeModal} title="Upgrade plan" size="md">
	<div class="space-y-3">
		<div class="rounded-xl border border-primary-500/10 bg-primary-500/5 p-3">
			<p class="text-xs leading-relaxed font-medium text-primary-600 dark:text-primary-400">
				Choose a plan to upgrade to. You'll be charged a prorated amount for the remainder of this
				billing period.
			</p>
		</div>
		<div class="max-h-[380px] space-y-2 overflow-y-auto pr-1">
			{#each upgradePlans as code (code)}
				{@const plan = PLANS[code]}
				<button
					type="button"
					onclick={() => (selectedPlan = code)}
					class="w-full rounded-xl border p-3.5 text-left transition-all {selectedPlan === code
						? 'border-primary-500 bg-primary-500/10 ring-1 ring-primary-500/20'
						: 'border-[var(--ui-border)] hover:border-primary-500/30'}"
				>
					<div class="mb-2 flex items-start justify-between">
						<div class="flex items-center gap-2.5">
							<div
								class="grid size-8 place-items-center rounded-lg bg-gradient-to-br {plan.gradient} text-white"
							>
								<Icon name={plan.icon} class="size-4" />
							</div>
							<div>
								<p class="text-sm font-bold capitalize">{plan.name}</p>
								<p class="mt-0.5 text-xs text-[var(--ui-text-muted)]">{plan.description}</p>
							</div>
						</div>
						<div class="text-right">
							<p class="text-sm font-bold text-primary-500">{formatPlanPrice(code)}</p>
							{#if plan.price > 0}
								<p class="text-xs text-[var(--ui-text-dimmed)]">/ month</p>
							{/if}
						</div>
					</div>
					<div
						class="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 border-t border-[var(--ui-border-muted)] pt-2.5 text-xs text-[var(--ui-text-muted)]"
					>
						<span class="flex items-center gap-1">
							<Icon name="lucide:store" class="size-3" />
							Branches:
							<strong class="text-[var(--ui-text)]">{getPlanLimitText(code, 'branches')}</strong>
						</span>
						<span class="flex items-center gap-1">
							<Icon name="lucide:users" class="size-3" />
							Staff:
							<strong class="text-[var(--ui-text)]">{getPlanLimitText(code, 'staff')}</strong>
						</span>
						<span class="flex items-center gap-1">
							<Icon name="lucide:package" class="size-3" />
							Products:
							<strong class="text-[var(--ui-text)]">{getPlanLimitText(code, 'products')}</strong>
						</span>
					</div>
				</button>
			{/each}
		</div>
	</div>
	{#snippet footer()}
		<Button
			color="neutral"
			variant="ghost"
			onclick={() => {
				showUpgradeModal = false;
				selectedPlan = null;
			}}>Cancel</Button
		>
		<Button
			color="primary"
			icon="lucide:arrow-up"
			disabled={!selectedPlan || payLoading}
			onclick={() => selectedPlan && changePlan(selectedPlan)}
		>
			{payLoading ? 'Processing…' : 'Upgrade'}
		</Button>
	{/snippet}
</Dialog>

<!-- ════════ Downgrade Modal ════════ -->
<Dialog bind:open={showDowngradeModal} title="Downgrade plan" size="md">
	<div class="space-y-3">
		<div
			class="flex items-start gap-2.5 rounded-xl border border-amber-200/40 bg-amber-50 p-3.5 dark:bg-amber-950/20"
		>
			<Icon name="lucide:info" class="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
			<p class="text-xs leading-relaxed font-medium text-amber-700 dark:text-amber-400">
				Downgrading will reduce your limits at the end of the current billing period. Some features
				may become unavailable.
			</p>
		</div>
		<div class="max-h-[300px] space-y-2 overflow-y-auto">
			{#each downgradePlans as code (code)}
				{@const plan = PLANS[code]}
				<button
					type="button"
					onclick={() => (selectedPlan = code)}
					class="w-full rounded-xl border p-3.5 text-left transition-all {selectedPlan === code
						? 'border-amber-500 bg-amber-500/10 ring-1 ring-amber-500/20'
						: 'border-[var(--ui-border)] hover:border-amber-500/30'}"
				>
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2.5">
							<div
								class="grid size-8 place-items-center rounded-lg bg-gradient-to-br {plan.gradient} text-white"
							>
								<Icon name={plan.icon} class="size-4" />
							</div>
							<div>
								<p class="text-sm font-bold capitalize">{plan.name}</p>
								<p class="text-xs text-[var(--ui-text-dimmed)]">Switch to this tier</p>
							</div>
						</div>
						<p class="text-sm font-bold">{formatPlanPrice(code)}</p>
					</div>
				</button>
			{/each}
		</div>
	</div>
	{#snippet footer()}
		<Button
			color="neutral"
			variant="ghost"
			onclick={() => {
				showDowngradeModal = false;
				selectedPlan = null;
			}}>Cancel</Button
		>
		<Button
			color="neutral"
			variant="solid"
			disabled={!selectedPlan || payLoading}
			onclick={() => selectedPlan && changePlan(selectedPlan)}
		>
			{payLoading ? 'Processing…' : 'Downgrade'}
		</Button>
	{/snippet}
</Dialog>

<!-- ════════ Cancel Modal ════════ -->
<Dialog bind:open={showCancelModal} title="Cancel subscription" size="sm">
	<div class="space-y-3">
		<div class="flex items-center gap-2">
			<div class="grid size-8 shrink-0 place-items-center rounded-lg bg-red-100 dark:bg-red-950/30">
				<Icon name="lucide:triangle-alert" class="size-4 text-red-600" />
			</div>
			<h3 class="font-display text-[15px] font-semibold text-red-600 dark:text-red-400">
				Are you sure?
			</h3>
		</div>
		<p class="text-sm leading-relaxed text-[var(--ui-text-muted)]">
			Your subscription will remain active until the end of the current billing period, then switch
			to the Free plan.
		</p>
		<div class="rounded-xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] p-4">
			<ul class="space-y-2.5 text-xs text-[var(--ui-text-muted)]">
				<li class="flex items-start gap-2.5">
					<Icon name="lucide:x-circle" class="mt-0.5 size-4 shrink-0 text-red-500" />
					<span>Limits will drop to Free plan levels</span>
				</li>
				<li class="flex items-start gap-2.5">
					<Icon name="lucide:x-circle" class="mt-0.5 size-4 shrink-0 text-red-500" />
					<span>Multi-branch and advanced reports disabled</span>
				</li>
				<li class="flex items-start gap-2.5">
					<Icon name="lucide:info" class="mt-0.5 size-4 shrink-0 text-amber-500" />
					<span>You can reactivate anytime — your data stays safe</span>
				</li>
			</ul>
		</div>
	</div>
	{#snippet footer()}
		<Button
			color="neutral"
			variant="ghost"
			onclick={() => {
				showCancelModal = false;
			}}>Keep plan</Button
		>
		<Button color="error" variant="solid" icon="lucide:trash-2" onclick={cancelSubscription}
			>Confirm cancel</Button
		>
	{/snippet}
</Dialog>

<!-- ════════ Pay Invoice Modal ════════ -->
<Dialog bind:open={showPayModal} title="Pay invoice" size="md">
	{#if payingInvoice}
		<div class="space-y-4">
			<!-- Invoice summary -->
			<div
				class="rounded-xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] p-4 text-center"
			>
				<p class="mb-1 text-xs font-bold tracking-widest text-[var(--ui-text-dimmed)] uppercase">
					{payingInvoice.invoiceNumber}
				</p>
				<p class="text-3xl font-black">{formatAmount(payingInvoice.amount)}</p>
				<p class="mt-1.5 text-xs text-[var(--ui-text-muted)]">
					Due: {formatDate(payingInvoice.dueAt)}
				</p>
			</div>

			{#if activeLightningInvoice}
				<!-- Lightning invoice view -->
				<div class="space-y-4 text-center">
					<div
						class="relative flex flex-col items-center overflow-hidden rounded-2xl border border-amber-200/50 bg-amber-50 p-5 dark:border-amber-900/30 dark:bg-amber-950/20"
					>
						<span class="absolute top-2.5 right-2.5 flex size-2">
							<span
								class="absolute inline-flex size-full animate-ping rounded-full bg-amber-400 opacity-75"
							></span>
							<span class="relative inline-flex size-2 rounded-full bg-amber-500"></span>
						</span>
						<div
							class="grid size-40 place-items-center rounded-xl border border-amber-200/50 bg-white p-3 dark:border-amber-500/10 dark:bg-gray-900"
						>
							<Icon name="lucide:zap" class="size-14 text-amber-500" />
						</div>
						<div class="mt-4 w-full space-y-2">
							<p
								class="rounded-xl border border-amber-200/30 bg-white p-3 text-center font-mono text-xs break-all text-amber-800 select-all dark:bg-black/35 dark:text-amber-400"
							>
								{activeLightningInvoice}
							</p>
							<div class="flex gap-2">
								<Button
									size="sm"
									color="neutral"
									variant="subtle"
									block
									icon="lucide:copy"
									onclick={() => copyText(activeLightningInvoice!, 'Invoice')}>Copy</Button
								>
								<Button
									size="sm"
									color="neutral"
									variant="solid"
									block
									icon="lucide:wallet"
									href={'lightning:' + (activeLightningInvoice ?? '')}>Open wallet</Button
								>
							</div>
							<Button
								size="sm"
								color="primary"
								variant="soft"
								block
								icon="lucide:refresh-cw"
								onclick={() => {
									if (payingInvoice) {
										confirmPayment(payingInvoice, 'btc_lightning');
									}
								}}>Simulate payment received</Button
							>
						</div>
					</div>
					<div
						class="flex items-center justify-center gap-2 rounded-lg border border-amber-500/10 bg-amber-500/5 py-2"
					>
						<span class="size-2 animate-pulse rounded-full bg-amber-500"></span>
						<p class="text-xs font-bold text-amber-600 dark:text-amber-400">Waiting for payment…</p>
					</div>
				</div>
			{:else}
				<!-- Payment method selection -->
				<div class="space-y-3">
					<p class="text-sm font-bold text-[var(--ui-text)]">Select payment method</p>
					<div class="grid grid-cols-2 gap-3">
						{#each paymentMethodOptions as m (m.code)}
							<button
								type="button"
								onclick={() => (selectedMethod = m.code)}
								class="rounded-xl border p-3 text-center transition-all {selectedMethod === m.code
									? 'border-primary-500 bg-primary-500/10 ring-1 ring-primary-500/20'
									: 'border-[var(--ui-border)] hover:border-primary-500/30'}"
							>
								<div class="mx-auto mb-2 grid size-10 place-items-center rounded-xl {m.bgColor}">
									<Icon name={m.icon} class="size-5 {m.iconColor}" />
								</div>
								<p class="text-xs font-bold">{m.label}</p>
							</button>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	{/if}
	{#snippet footer()}
		<Button color="neutral" variant="ghost" onclick={closePayModal}>Cancel</Button>
		{#if !activeLightningInvoice}
			<Button color="primary" disabled={!selectedMethod || payLoading} onclick={processPayment}>
				{payLoading ? 'Processing…' : 'Confirm payment'}
			</Button>
		{/if}
	{/snippet}
</Dialog>
