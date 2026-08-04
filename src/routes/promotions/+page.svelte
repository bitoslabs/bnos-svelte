<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Switch from '$lib/components/ui/Switch.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import RawDataDialog from '$lib/components/ui/RawDataDialog.svelte';
	import Pagination from '$lib/components/list/Pagination.svelte';
	import { createListControls } from '$lib/utils/list.svelte';
	import { glo } from '$nostr/store.svelte';
	import { dataSync } from '$nostr/sync.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatMoney } from '$lib/utils/format';
	import { newRecordId } from '$lib/utils/record-id';
	import {
		TYPE,
		statusColor,
		type Coupon,
		type Promotion,
		type PromotionType,
		type Product,
		type CatalogCategory
	} from '$lib/domain';

	// ── Tabs ──────────────────────────────────────────────────────────
	type Tab = 'coupons' | 'promotions';
	let tab = $state<Tab>('promotions');
	let rawOpen = $state(false);
	let rawItem = $state<any>(null);

	onMount(() => {
		dataSync.pageSync([TYPE.coupon, TYPE.promotion, TYPE.product, TYPE.category], {
			scope: 'promotions'
		});
	});

	const currency = $derived(tenant.state.currency);
	const coupons = $derived(glo.all<Coupon, typeof TYPE.coupon>(TYPE.coupon));
	const promos = $derived(glo.all<Promotion, typeof TYPE.promotion>(TYPE.promotion));
	const products = $derived(glo.all<Product, typeof TYPE.product>(TYPE.product));
	const categories = $derived(glo.all<CatalogCategory, typeof TYPE.category>(TYPE.category));

	// ── Derived helpers ───────────────────────────────────────────────
	const now = $derived(Date.now());

	function promoStatus(
		p: Promotion
	): 'active' | 'scheduled' | 'expired' | 'disabled' | 'limit_reached' {
		if (!p.active) return 'disabled';
		if (p.validUntil && new Date(p.validUntil).getTime() < now) return 'expired';
		if (p.validFrom && new Date(p.validFrom).getTime() > now) return 'scheduled';
		if (p.maxUsage && p.maxUsage > 0 && (p.currentUsage ?? 0) >= p.maxUsage) return 'limit_reached';
		return 'active';
	}

	function promoStatusBadgeColor(
		s: ReturnType<typeof promoStatus>
	): 'success' | 'info' | 'warning' | 'neutral' {
		return s === 'active'
			? 'success'
			: s === 'scheduled'
				? 'info'
				: s === 'expired'
					? 'warning'
					: 'neutral';
	}

	function promoStatusLabel(s: ReturnType<typeof promoStatus>): string {
		return s === 'limit_reached' ? 'Limit Reached' : s.charAt(0).toUpperCase() + s.slice(1);
	}

	function isPercentType(t: PromotionType): boolean {
		return t === 'percent' || t === 'discount_percent' || t === 'flash_sale' || t === 'happy_hour';
	}

	function promoValueLabel(p: Promotion): string {
		if (p.type === 'bogo') return `Buy ${p.buyQuantity ?? 1} Get ${p.getQuantity ?? 1}`;
		if (isPercentType(p.type)) return `${p.value}%`;
		return formatMoney(p.value, currency);
	}

	const PERCENT_TYPES: PromotionType[] = [
		'percent',
		'discount_percent',
		'flash_sale',
		'happy_hour'
	];

	const PROMO_TYPES: { value: PromotionType; label: string; icon: string }[] = [
		{ value: 'percent', label: '% Off', icon: 'lucide:percent' },
		{ value: 'fixed', label: 'Fixed Off', icon: 'lucide:dollar-sign' },
		{ value: 'bogo', label: 'BOGO', icon: 'lucide:gift' },
		{ value: 'flash_sale', label: 'Flash Sale', icon: 'lucide:zap' },
		{ value: 'happy_hour', label: 'Happy Hour', icon: 'lucide:clock' },
		{ value: 'spend_x_get_y', label: 'Spend & Save', icon: 'lucide:shopping-cart' }
	];

	const PROMO_TYPE_ICON: Record<string, string> = {
		percent: 'lucide:percent',
		fixed: 'lucide:dollar-sign',
		bogo: 'lucide:gift',
		flash_sale: 'lucide:zap',
		happy_hour: 'lucide:clock',
		spend_x_get_y: 'lucide:shopping-cart',
		discount_percent: 'lucide:percent',
		discount_fixed: 'lucide:dollar-sign',
		bundle: 'lucide:package'
	};

	const PROMO_TYPE_COLOR: Record<string, string> = {
		percent: 'bg-blue-500/10 text-blue-500',
		fixed: 'bg-emerald-500/10 text-emerald-500',
		bogo: 'bg-purple-500/10 text-purple-500',
		flash_sale: 'bg-red-500/10 text-red-500',
		happy_hour: 'bg-orange-500/10 text-orange-500',
		spend_x_get_y: 'bg-cyan-500/10 text-cyan-500',
		discount_percent: 'bg-blue-500/10 text-blue-500',
		discount_fixed: 'bg-emerald-500/10 text-emerald-500',
		bundle: 'bg-pink-500/10 text-pink-500'
	};

	const promoTypeLabel = (t: string) => PROMO_TYPES.find((p) => p.value === t)?.label ?? t;

	// ── Stats ─────────────────────────────────────────────────────────
	const activeCount = $derived(promos.filter((p) => promoStatus(p.data) === 'active').length);
	const scheduledCount = $derived(promos.filter((p) => promoStatus(p.data) === 'scheduled').length);
	const expiredCount = $derived(promos.filter((p) => promoStatus(p.data) === 'expired').length);

	// ── Filters ───────────────────────────────────────────────────────
	let searchQuery = $state('');
	let filterType = $state('');
	let filterStatus = $state('');

	const filteredPromos = $derived.by(() => {
		let list = promos;
		if (filterType) list = list.filter((p) => p.data.type === filterType);
		if (filterStatus) {
			list = list.filter((p) => promoStatus(p.data) === filterStatus);
		}
		if (searchQuery.trim()) {
			const q = searchQuery.trim().toLowerCase();
			list = list.filter(
				(p) =>
					p.data.name.toLowerCase().includes(q) ||
					(p.data.description?.toLowerCase().includes(q) ?? false)
			);
		}
		return list;
	});

	// ── List controls for pagination ──────────────────────────────────
	const cCtrl = createListControls<{ id: string; data: Coupon }>({
		items: () => coupons,
		search: (c, q) => (c.data.code ?? '').toLowerCase().includes(q),
		sortOptions: () => [
			{ key: 'code', label: 'Code', value: (c) => c.data.code },
			{ key: 'uses', label: 'Uses', value: (c) => c.data.uses ?? 0 },
			{ key: 'status', label: 'Status', value: (c) => c.data.status }
		],
		defaultSortKey: 'code',
		defaultViewMode: 'grid',
		storageKey: 'promos-coupons'
	});

	const pCtrl = createListControls<{ id: string; data: Promotion }>({
		items: () => filteredPromos,
		search: () => true, // search handled above
		sortOptions: () => [
			{ key: 'name', label: 'Name', value: (p) => p.data.name },
			{ key: 'status', label: 'Status', value: (p) => promoStatus(p.data) },
			{ key: 'value', label: 'Value', value: (p) => p.data.value }
		],
		defaultSortKey: 'name',
		defaultViewMode: 'list',
		storageKey: 'promos-promos-v2'
	});

	// ── Modal / Form state ─────────────────────────────────────────────
	let modalOpen = $state(false);
	let editingId = $state<string | null>(null);
	let saving = $state(false);
	let confirmDeleteId = $state<string | null>(null);

	// Coupon form
	let cCode = $state('');
	let cType = $state<'percent' | 'fixed' | 'bogo'>('percent');
	let cValue = $state<number | ''>('');
	let cMax = $state<number | ''>('');
	let cMinSpend = $state<number | ''>('');
	let cDesc = $state('');

	// Promotion form
	let fName = $state('');
	let fDescription = $state('');
	let fType = $state<PromotionType>('percent');
	let fValue = $state<number | ''>(10);
	let fMinimumSpend = $state<number | ''>('');
	let fBuyQuantity = $state(1);
	let fGetQuantity = $state(1);
	let fValidFrom = $state('');
	let fValidUntil = $state('');
	let fMaxUsage = $state<number | ''>('');
	let fActive = $state(true);
	let fApplicabilityMode = $state<'all' | 'categories' | 'products'>('all');
	let fSelectedProductIds = $state<string[]>([]);
	let fSelectedCategoryIds = $state<string[]>([]);

	const dateRangeError = $derived(
		fValidFrom && fValidUntil && new Date(fValidUntil).getTime() <= new Date(fValidFrom).getTime()
			? 'End date must be after start date'
			: ''
	);

	const formErrors = $derived.by(() => {
		const errors: string[] = [];
		if (!fName.trim()) errors.push('Name is required');
		if (typeof fValue === 'number' ? fValue <= 0 : Number(fValue) <= 0)
			errors.push('Value must be greater than 0');
		if (isPercentType(fType) && (typeof fValue === 'number' ? fValue : Number(fValue)) > 100)
			errors.push('Percentage cannot exceed 100');
		if (dateRangeError) errors.push(dateRangeError);
		if (fType === 'bogo' && (fBuyQuantity < 1 || fGetQuantity < 1))
			errors.push('BOGO quantities must be at least 1');
		return errors;
	});

	const canSave = $derived(
		fName.trim() !== '' &&
			(typeof fValue === 'number' ? fValue : Number(fValue)) > 0 &&
			!(isPercentType(fType) && (typeof fValue === 'number' ? fValue : Number(fValue)) > 100) &&
			!dateRangeError &&
			!(fType === 'bogo' && (fBuyQuantity < 1 || fGetQuantity < 1))
	);

	function resetPromoForm() {
		fName = '';
		fDescription = '';
		fType = 'percent';
		fValue = 10;
		fMinimumSpend = '';
		fBuyQuantity = 1;
		fGetQuantity = 1;
		fValidFrom = '';
		fValidUntil = '';
		fMaxUsage = '';
		fActive = true;
		fApplicabilityMode = 'all';
		fSelectedProductIds = [];
		fSelectedCategoryIds = [];
	}

	function openCreate(t: Tab) {
		if (t === 'coupons') {
			cCode = '';
			cType = 'percent';
			cValue = '';
			cMax = '';
			cMinSpend = '';
			cDesc = '';
			editingId = null;
		} else {
			resetPromoForm();
			editingId = null;
		}
		modalOpen = true;
	}

	function openEditCoupon(id: string, data: Coupon) {
		editingId = id;
		cCode = data.code;
		cType = (data.type as 'percent' | 'fixed' | 'bogo') ?? 'percent';
		cValue = data.value;
		cMax = data.maxUses ?? '';
		cMinSpend = data.minSpend ?? '';
		cDesc = data.description ?? '';
		modalOpen = true;
	}

	function openEditPromo(id: string, data: Promotion) {
		editingId = id;
		fName = data.name;
		fDescription = data.description ?? '';
		fType = data.type;
		fValue = data.value;
		fMinimumSpend = data.minimumSpend ?? '';
		fBuyQuantity = data.buyQuantity ?? 1;
		fGetQuantity = data.getQuantity ?? 1;
		fValidFrom = data.validFrom ? toDatetimeLocal(data.validFrom) : '';
		fValidUntil = data.validUntil ? toDatetimeLocal(data.validUntil) : '';
		fMaxUsage = data.maxUsage ?? '';
		fActive = data.active ?? true;
		fSelectedCategoryIds = data.categoryIds?.slice() ?? [];
		fSelectedProductIds = data.productIds?.slice() ?? [];
		fApplicabilityMode =
			fSelectedCategoryIds.length > 0
				? 'categories'
				: fSelectedProductIds.length > 0
					? 'products'
					: 'all';
		modalOpen = true;
	}

	function toDatetimeLocal(dateStr: string): string {
		const d = new Date(dateStr);
		if (isNaN(d.getTime())) return '';
		const off = d.getTimezoneOffset() * 60000;
		return new Date(d.getTime() - off).toISOString().slice(0, 16);
	}

	function setPromoType(t: PromotionType) {
		fType = t;
		if (t !== 'bogo') {
			fBuyQuantity = 1;
			fGetQuantity = 1;
		}
		if (isPercentType(t) && (typeof fValue === 'number' ? fValue : Number(fValue)) > 100) {
			fValue = 100;
		}
	}

	function setApplicabilityMode(mode: 'all' | 'categories' | 'products') {
		fApplicabilityMode = mode;
		if (mode === 'all') {
			fSelectedProductIds = [];
			fSelectedCategoryIds = [];
		}
	}

	function toggleProduct(id: string) {
		const idx = fSelectedProductIds.indexOf(id);
		if (idx >= 0) fSelectedProductIds.splice(idx, 1);
		else fSelectedProductIds.push(id);
	}

	function toggleCategory(id: string) {
		const idx = fSelectedCategoryIds.indexOf(id);
		if (idx >= 0) fSelectedCategoryIds.splice(idx, 1);
		else fSelectedCategoryIds.push(id);
	}

	async function savePromo() {
		if (!canSave || saving) return;
		saving = true;
		const num = (v: number | '') => (typeof v === 'number' ? v : Number(v) || 0);
		const promoData: Promotion = {
			name: fName.trim(),
			description: fDescription.trim() || undefined,
			type: fType,
			value: num(fValue),
			minimumSpend: fMinimumSpend ? num(fMinimumSpend) : undefined,
			buyQuantity: fType === 'bogo' ? fBuyQuantity : undefined,
			getQuantity: fType === 'bogo' ? fGetQuantity : undefined,
			validFrom: fValidFrom || undefined,
			validUntil: fValidUntil || undefined,
			maxUsage: fMaxUsage ? num(fMaxUsage) : 0,
			currentUsage: 0,
			productIds: fSelectedProductIds.length ? fSelectedProductIds : undefined,
			categoryIds: fSelectedCategoryIds.length ? fSelectedCategoryIds : undefined,
			active: fActive,
			status: fActive ? 'active' : 'disabled'
		};
		try {
			if (editingId) {
				await glo.upsert<Promotion>(TYPE.promotion, promoData, { id: editingId });
				toast.success('Promotion updated');
			} else {
				await glo.upsert<Promotion>(TYPE.promotion, promoData, { id: newRecordId('promotion') });
				toast.success('Promotion created');
			}
			modalOpen = false;
		} catch (e: unknown) {
			toast.error('Failed to save promotion');
			console.error(e);
		} finally {
			saving = false;
		}
	}

	async function saveCoupon() {
		if (!cCode.trim()) return toast.warning('Code required');
		const num = (v: number | '') => (typeof v === 'number' ? v : Number(v) || 0);
		const data: Coupon = {
			code: cCode.trim().toUpperCase(),
			type: cType,
			value: num(cValue),
			currency,
			description: cDesc.trim() || undefined,
			minSpend: cMinSpend ? num(cMinSpend) : undefined,
			maxUses: cMax ? num(cMax) : undefined,
			uses: 0,
			status: 'active'
		};
		try {
			if (editingId) {
				await glo.upsert<Coupon>(TYPE.coupon, data, { id: editingId });
				toast.success('Coupon updated');
			} else {
				await glo.upsert<Coupon>(TYPE.coupon, data, { id: newRecordId('coupon') });
				toast.success('Coupon created');
			}
			modalOpen = false;
		} catch {
			toast.error('Failed to save coupon');
		}
	}

	async function togglePromoActive(id: string, data: Promotion) {
		try {
			await glo.upsert<Promotion>(
				TYPE.promotion,
				{ ...data, active: !data.active, status: !data.active ? 'active' : 'disabled' },
				{ id }
			);
			toast.success(data.active ? 'Promotion deactivated' : 'Promotion activated');
		} catch {
			toast.error('Failed to toggle promotion');
		}
	}

	function confirmDelete(id: string) {
		confirmDeleteId = id;
	}

	function doDelete() {
		if (!confirmDeleteId) return;
		if (tab === 'coupons') {
			glo.remove(TYPE.coupon, confirmDeleteId);
			toast.info('Coupon removed');
		} else {
			glo.remove(TYPE.promotion, confirmDeleteId);
			toast.info('Promotion removed');
		}
		confirmDeleteId = null;
	}

	function badge(v: { type: string; value: number }): string {
		return v.type === 'percent' ? `${v.value}%` : v.type === 'bogo' ? 'BOGO' : `${v.value}`;
	}

	const WEEK_DAYS = [
		{ value: 0, label: 'Su' },
		{ value: 1, label: 'Mo' },
		{ value: 2, label: 'Tu' },
		{ value: 3, label: 'We' },
		{ value: 4, label: 'Th' },
		{ value: 5, label: 'Fr' },
		{ value: 6, label: 'Sa' }
	];
	let fDaysOfWeek = $state<number[]>([]);
	let fEnableTimeRestrictions = $state(false);
	let fStartTime = $state('');
	let fEndTime = $state('');

	function toggleDay(day: number) {
		const idx = fDaysOfWeek.indexOf(day);
		if (idx >= 0) fDaysOfWeek.splice(idx, 1);
		else fDaysOfWeek.push(day);
	}

	const STATUS_FILTERS = [
		{ value: '', label: 'All' },
		{ value: 'active', label: 'Active' },
		{ value: 'scheduled', label: 'Scheduled' },
		{ value: 'expired', label: 'Expired' },
		{ value: 'disabled', label: 'Disabled' }
	];
</script>

<svelte:head><title>BNOS · Promotions</title></svelte:head>

<div class="space-y-5">
	<!-- Header -->
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h1 class="font-display text-xl font-bold tracking-tight">Promotions</h1>
			<p class="text-[12.5px] text-[var(--ui-text-muted)]">
				Discount campaigns, coupons & BOGO offers
			</p>
		</div>
		<Button color="primary" icon="lucide:plus" onclick={() => openCreate(tab)}>
			New {tab === 'coupons' ? 'coupon' : 'promotion'}
		</Button>
	</div>

	<!-- Tabs -->
	<div class="segmented inline-flex w-fit gap-1 p-1">
		{#each [{ id: 'promotions' as Tab, label: 'Promotions', icon: 'lucide:megaphone', n: promos.length }, { id: 'coupons' as Tab, label: 'Coupons', icon: 'lucide:ticket', n: coupons.length }] as t (t.id)}
			<button
				type="button"
				onclick={() => (tab = t.id)}
				class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-semibold transition-colors {tab ===
				t.id
					? 'bg-[var(--ui-bg-elevated)] text-[var(--ui-text)] shadow-sm'
					: 'text-[var(--ui-text-muted)]'}"
			>
				<Icon name={t.icon} class="size-3.5" />
				{t.label}
				<span class="rounded bg-[var(--ui-bg-accented)] px-1.5 text-[10px] tabular-nums">{t.n}</span
				>
			</button>
		{/each}
	</div>

	<!-- ═══════════════ PROMOTIONS TAB ═══════════════ -->
	{#if tab === 'promotions'}
		<!-- Stats -->
		<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
			<div class="surface-card p-4">
				<p class="text-[11px] tracking-wider text-[var(--ui-text-dimmed)] uppercase">Total</p>
				<p class="mt-1 text-2xl font-black tabular-nums">{promos.length}</p>
			</div>
			<div class="surface-card p-4">
				<p class="text-[11px] tracking-wider text-[var(--ui-text-dimmed)] uppercase">Active</p>
				<p class="mt-1 text-2xl font-black text-emerald-500 tabular-nums">{activeCount}</p>
			</div>
			<div class="surface-card p-4">
				<p class="text-[11px] tracking-wider text-[var(--ui-text-dimmed)] uppercase">Scheduled</p>
				<p class="mt-1 text-2xl font-black text-blue-500 tabular-nums">{scheduledCount}</p>
			</div>
			<div class="surface-card p-4">
				<p class="text-[11px] tracking-wider text-[var(--ui-text-dimmed)] uppercase">Expired</p>
				<p class="mt-1 text-2xl font-black text-[var(--ui-text-dimmed)] tabular-nums">
					{expiredCount}
				</p>
			</div>
		</div>

		<!-- Search + Filters -->
		<div class="space-y-3">
			<div class="relative">
				<Icon
					name="lucide:search"
					class="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--ui-text-dimmed)]"
				/>
				<input
					bind:value={searchQuery}
					type="text"
					placeholder="Search promotions..."
					class="w-full rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] py-2.5 pr-3 pl-9 text-[13px] text-[var(--ui-text)] placeholder:text-[var(--ui-text-dimmed)] focus:border-[var(--ui-color-primary-500)] focus:outline-none"
				/>
			</div>
			<div class="flex flex-wrap items-center gap-2">
				<!-- Type filter pills -->
				<div class="flex items-center gap-1 rounded-lg bg-[var(--ui-bg-accented)] p-1">
					<button
						type="button"
						onclick={() => (filterType = '')}
						class="rounded-md px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap transition-all {filterType ===
						''
							? 'bg-[var(--ui-bg-elevated)] text-[var(--ui-text)] shadow-sm'
							: 'text-[var(--ui-text-muted)]'}"
					>
						All Types
					</button>
					{#each PROMO_TYPES as pt (pt.value)}
						<button
							type="button"
							onclick={() => (filterType = filterType === pt.value ? '' : pt.value)}
							class="flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap transition-all {filterType ===
							pt.value
								? 'bg-[var(--ui-bg-elevated)] text-[var(--ui-text)] shadow-sm'
								: 'text-[var(--ui-text-muted)]'}"
						>
							<Icon name={pt.icon} class="size-3" />
							{pt.label}
						</button>
					{/each}
				</div>
				<!-- Status filter -->
				<div class="flex items-center gap-1 rounded-lg bg-[var(--ui-bg-accented)] p-1">
					{#each STATUS_FILTERS as sf (sf.value)}
						<button
							type="button"
							onclick={() => (filterStatus = filterStatus === sf.value ? '' : sf.value)}
							class="rounded-md px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap transition-all {filterStatus ===
							sf.value
								? 'bg-[var(--ui-bg-elevated)] text-[var(--ui-text)] shadow-sm'
								: 'text-[var(--ui-text-muted)]'}"
						>
							{sf.label}
						</button>
					{/each}
				</div>
				<span class="ml-1 text-[11px] text-[var(--ui-text-dimmed)]">
					{filteredPromos.length} items
				</span>
			</div>
		</div>

		<!-- Promotions List -->
		{#if filteredPromos.length === 0}
			<EmptyState
				icon="lucide:megaphone"
				title="No promotions"
				description="Create your first promotion to get started."
			>
				{#snippet actions()}
					<Button
						color="primary"
						size="sm"
						icon="lucide:plus"
						onclick={() => openCreate('promotions')}>New promotion</Button
					>
				{/snippet}
			</EmptyState>
		{:else}
			<div
				class="overflow-hidden rounded-2xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-elevated)] shadow-sm"
			>
				<div class="divide-y divide-[var(--ui-border-muted)]">
					{#each pCtrl.pagedList as p (p.id)}
						{@const ps = promoStatus(p.data)}
						<div class="group p-5 transition-colors hover:bg-[var(--ui-bg-muted)]">
							<div class="flex items-start justify-between gap-3">
								<div class="flex min-w-0 items-start gap-3">
									<!-- Type icon -->
									<div
										class="grid size-10 shrink-0 place-items-center rounded-xl {PROMO_TYPE_COLOR[
											p.data.type
										] ?? 'bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)]'}"
									>
										<Icon name={PROMO_TYPE_ICON[p.data.type] ?? 'lucide:tag'} class="size-5" />
									</div>
									<div class="min-w-0">
										<div class="flex items-center gap-2">
											<p class="truncate text-[14px] font-bold text-[var(--ui-text)]">
												{p.data.name}
											</p>
											<Badge color={promoStatusBadgeColor(ps)}>{promoStatusLabel(ps)}</Badge>
										</div>
										{#if p.data.description}
											<p class="mt-0.5 truncate text-[11.5px] text-[var(--ui-text-dimmed)]">
												{p.data.description}
											</p>
										{/if}
										<!-- Meta row -->
										<div class="mt-1.5 flex flex-wrap items-center gap-3">
											<span class="flex items-center gap-1 text-[10px] text-[var(--ui-text-muted)]">
												<Icon name="lucide:tag" class="size-3" />
												{promoTypeLabel(p.data.type)}
											</span>
											<span
												class="flex items-center gap-1 text-[10px] font-semibold text-[var(--ui-text-muted)]"
											>
												<Icon name="lucide:wallet" class="size-3" />
												{promoValueLabel(p.data)}
											</span>
											{#if p.data.minimumSpend}
												<span
													class="flex items-center gap-1 text-[10px] text-[var(--ui-text-muted)]"
												>
													<Icon name="lucide:shopping-cart" class="size-3" />
													Min: {formatMoney(p.data.minimumSpend, currency)}
												</span>
											{/if}
										</div>
										<!-- Usage + dates -->
										<div class="mt-1 flex flex-wrap items-center gap-3">
											{#if p.data.maxUsage && p.data.maxUsage > 0}
												<span class="text-[10px] text-[var(--ui-text-dimmed)]">
													Usage: {p.data.currentUsage ?? 0}/{p.data.maxUsage}
													{#if (p.data.currentUsage ?? 0) >= p.data.maxUsage}<span
															class="text-amber-500">· Limit reached</span
														>{/if}
												</span>
											{:else}
												<span class="text-[10px] text-[var(--ui-text-dimmed)]">Unlimited usage</span
												>
											{/if}
											{#if p.data.validFrom || p.data.validUntil}
												<span class="text-[10px] text-[var(--ui-text-dimmed)]">
													{#if p.data.validFrom}{new Date(
															p.data.validFrom
														).toLocaleDateString()}{/if}
													→
													{#if p.data.validUntil}{new Date(
															p.data.validUntil
														).toLocaleDateString()}{:else}∞{/if}
												</span>
											{/if}
										</div>
										<!-- Product/category chips -->
										{#if (p.data.categoryIds?.length ?? 0) > 0 || (p.data.productIds?.length ?? 0) > 0}
											<div class="mt-1.5 flex flex-wrap items-center gap-1">
												{#each (p.data.categoryIds ?? []).slice(0, 3) as catId (catId)}
													<span
														class="inline-flex items-center gap-0.5 rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[9px] font-medium text-blue-500"
													>
														<Icon name="lucide:folder" class="size-2.5" />
														{categories.find((c) => c.id === catId)?.data.name ?? catId}
													</span>
												{/each}
												{#each (p.data.productIds ?? []).slice(0, 2) as prodId (prodId)}
													<span
														class="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-medium text-emerald-500"
													>
														<Icon name="lucide:package" class="size-2.5" />
														{products.find((pr) => pr.id === prodId)?.data.name ?? prodId}
													</span>
												{/each}
												{#if (p.data.categoryIds?.length ?? 0) > 3 || (p.data.productIds?.length ?? 0) > 2}
													<span class="text-[9px] text-[var(--ui-text-dimmed)]">
														+{Math.max(0, (p.data.categoryIds?.length ?? 0) - 3) +
															Math.max(0, (p.data.productIds?.length ?? 0) - 2)} more
													</span>
												{/if}
											</div>
										{/if}
									</div>
								</div>
								<!-- Actions -->
								<div class="flex shrink-0 items-center gap-1">
									<button
										type="button"
										onclick={() => togglePromoActive(p.id, p.data)}
										class="grid size-8 place-items-center rounded-lg transition-colors {p.data
											.active
											? 'text-emerald-500 hover:bg-emerald-500/10'
											: 'text-[var(--ui-text-dimmed)] hover:bg-[var(--ui-bg-accented)]'}"
										title={p.data.active ? 'Deactivate' : 'Activate'}
									>
										<Icon
											name={p.data.active ? 'lucide:circle-check' : 'lucide:circle-x'}
											class="size-4"
										/>
									</button>
									<button
										type="button"
										onclick={() => {
											rawItem = glo.get(TYPE.promotion, p.id);
											rawOpen = true;
										}}
										class="grid size-8 place-items-center rounded-lg text-[var(--ui-text-dimmed)] transition-colors hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]"
										title="View raw"
									>
										<Icon name="lucide:code" class="size-4" />
									</button>
									<button
										type="button"
										onclick={() => openEditPromo(p.id, p.data)}
										class="grid size-8 place-items-center rounded-lg text-[var(--ui-text-dimmed)] transition-colors hover:bg-blue-500/10 hover:text-blue-500"
										title="Edit"
									>
										<Icon name="lucide:pencil" class="size-4" />
									</button>
									<button
										type="button"
										onclick={() => confirmDelete(p.id)}
										class="grid size-8 place-items-center rounded-lg text-[var(--ui-text-dimmed)] transition-colors hover:bg-red-500/10 hover:text-red-500"
										title="Delete"
									>
										<Icon name="lucide:trash-2" class="size-4" />
									</button>
								</div>
							</div>
						</div>
					{/each}
				</div>
			</div>
			<Pagination controls={pCtrl} />
		{/if}

		<!-- ═══════════════ COUPONS TAB ═══════════════ -->
	{:else}
		{#if coupons.length === 0}
			<EmptyState
				icon="lucide:ticket"
				title="No coupons"
				description="Create discount codes for checkout."
			>
				{#snippet actions()}
					<Button color="primary" size="sm" icon="lucide:plus" onclick={() => openCreate('coupons')}
						>New coupon</Button
					>
				{/snippet}
			</EmptyState>
		{:else}
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{#each cCtrl.pagedList as c (c.id)}
					<div class="accent-bar surface-card p-5" style="--accent:var(--color-amber-accent);">
						<div class="flex items-start justify-between">
							<div
								class="grid size-10 place-items-center rounded-xl bg-[var(--tone-warning-bg)] text-[var(--tone-warning-text)]"
							>
								<Icon name="lucide:ticket" class="size-5" />
							</div>
							<Badge color={statusColor(c.data.status)}>{c.data.status}</Badge>
						</div>
						<div class="mt-3 font-mono text-lg font-bold tracking-wider">{c.data.code}</div>
						<div
							class="font-display text-2xl font-bold text-[var(--tone-warning-text)] tabular-nums"
						>
							{badge(c.data)}
						</div>
						<div class="mt-1 text-[11.5px] text-[var(--ui-text-muted)]">
							{c.data.uses ?? 0}{#if c.data.maxUses}/{c.data.maxUses}{/if} uses
						</div>
						{#if c.data.minSpend}
							<div class="mt-0.5 text-[10px] text-[var(--ui-text-dimmed)]">
								Min spend: {formatMoney(c.data.minSpend, currency)}
							</div>
						{/if}
						<div class="mt-3 flex items-center justify-end gap-1">
							<button
								type="button"
								onclick={() => {
									rawItem = glo.get(TYPE.coupon, c.id);
									rawOpen = true;
								}}
								class="grid size-8 place-items-center rounded-lg text-[var(--ui-text-dimmed)] transition-colors hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]"
								title="View raw"
							>
								<Icon name="lucide:code" class="size-4" />
							</button>
							<button
								type="button"
								onclick={() => openEditCoupon(c.id, c.data)}
								class="grid size-8 place-items-center rounded-lg text-[var(--ui-text-dimmed)] transition-colors hover:bg-blue-500/10 hover:text-blue-500"
								title="Edit"
							>
								<Icon name="lucide:pencil" class="size-4" />
							</button>
							<button
								type="button"
								onclick={() => confirmDelete(c.id)}
								class="grid size-8 place-items-center rounded-lg text-[var(--ui-text-dimmed)] transition-colors hover:bg-red-500/10 hover:text-red-500"
								title="Delete"
							>
								<Icon name="lucide:trash-2" class="size-4" />
							</button>
						</div>
					</div>
				{/each}
			</div>
			<Pagination controls={cCtrl} />
		{/if}
	{/if}
</div>

<!-- ═══════════════ CREATE / EDIT MODAL ═══════════════ -->
<Dialog
	bind:open={modalOpen}
	title={editingId
		? tab === 'coupons'
			? 'Edit coupon'
			: 'Edit promotion'
		: tab === 'coupons'
			? 'New coupon'
			: 'New promotion'}
	size="lg"
>
	{#if tab === 'coupons'}
		<!-- ── Coupon form ── -->
		<div class="space-y-3">
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Code</span>
				<Input bind:value={cCode} placeholder="SUMMER20" class="w-full font-mono uppercase" />
			</label>
			<div class="grid grid-cols-2 gap-3">
				<label class="block">
					<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>Type</span
					>
					<Select
						bind:value={cType}
						options={[
							{ value: 'percent', label: 'Percent' },
							{ value: 'fixed', label: 'Fixed amount' },
							{ value: 'bogo', label: 'Buy one get one' }
						]}
						class="w-full"
					/>
				</label>
				<label class="block">
					<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>Value {cType === 'percent' ? '(%)' : `(${currency})`}</span
					>
					<Input bind:value={cValue} type="number" min="0" class="w-full" />
				</label>
			</div>
			<div class="grid grid-cols-2 gap-3">
				<label class="block">
					<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>Min spend (optional)</span
					>
					<Input bind:value={cMinSpend} type="number" min="0" class="w-full" />
				</label>
				<label class="block">
					<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>Max uses (optional)</span
					>
					<Input bind:value={cMax} type="number" min="0" class="w-full" />
				</label>
			</div>
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
					>Description</span
				>
				<Input bind:value={cDesc} class="w-full" />
			</label>
		</div>
	{:else}
		<!-- ── Promotion form ── -->
		<div class="max-h-[70vh] space-y-5 overflow-y-auto">
			<!-- Section: Basic -->
			<div class="space-y-3">
				<div
					class="flex items-center gap-2 text-[12px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase"
				>
					<Icon name="lucide:info" class="size-3.5" /> Basic
				</div>
				<label class="block">
					<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>Name <span class="text-red-500">*</span></span
					>
					<Input bind:value={fName} placeholder="Happy Hour" class="w-full" />
				</label>
				<label class="block">
					<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>Description</span
					>
					<Input
						bind:value={fDescription}
						textarea
						rows={2}
						placeholder="Optional description..."
						class="w-full"
					/>
				</label>
				<div>
					<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>Type</span
					>
					<div class="grid grid-cols-3 gap-2 sm:grid-cols-4">
						{#each PROMO_TYPES as pt (pt.value)}
							<button
								type="button"
								onclick={() => setPromoType(pt.value)}
								class="rounded-lg border-2 px-2 py-2.5 text-center text-[11px] font-medium transition-all {fType ===
								pt.value
									? 'border-[var(--ui-color-primary-500)] bg-[var(--ui-color-primary-500)]/10 text-[var(--ui-color-primary-500)]'
									: 'border-[var(--ui-border)] hover:border-[var(--ui-border-muted)]'}"
							>
								<Icon name={pt.icon} class="mx-auto mb-1 block size-4" />
								{pt.label}
							</button>
						{/each}
					</div>
				</div>
			</div>

			<!-- Section: Discount -->
			<div class="space-y-3">
				<div
					class="flex items-center gap-2 text-[12px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase"
				>
					<Icon name="lucide:percent" class="size-3.5" /> Discount
				</div>
				<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
					<label class="block">
						<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">
							{isPercentType(fType) ? 'Discount %' : `Discount (${currency})`}
							<span class="text-red-500">*</span>
						</span>
						<div class="relative">
							<Input
								bind:value={fValue}
								type="number"
								min="0"
								max={isPercentType(fType) ? 100 : undefined}
								placeholder={isPercentType(fType) ? '10' : '5.00'}
								class="w-full"
							/>
							{#if isPercentType(fType)}
								<span
									class="absolute top-1/2 right-3 -translate-y-1/2 text-[12px] text-[var(--ui-text-dimmed)]"
									>%</span
								>
							{/if}
						</div>
					</label>
					<label class="block">
						<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
							>Minimum spend</span
						>
						<Input
							bind:value={fMinimumSpend}
							type="number"
							min="0"
							placeholder="0.00"
							class="w-full">{#snippet trailing()}{currency}{/snippet}</Input
						>
					</label>
				</div>
				{#if fType === 'bogo'}
					<div class="grid grid-cols-2 gap-3">
						<label class="block">
							<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
								>Buy quantity <span class="text-red-500">*</span></span
							>
							<Input bind:value={fBuyQuantity} type="number" min="1" class="w-full" />
						</label>
						<label class="block">
							<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
								>Get quantity <span class="text-red-500">*</span></span
							>
							<Input bind:value={fGetQuantity} type="number" min="1" class="w-full" />
						</label>
					</div>
				{/if}
			</div>

			<!-- Section: Schedule -->
			<div class="space-y-3">
				<div
					class="flex items-center gap-2 text-[12px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase"
				>
					<Icon name="lucide:calendar" class="size-3.5" /> Schedule
				</div>
				<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
					<label class="block">
						<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
							>Valid from</span
						>
						<Input bind:value={fValidFrom} type="datetime-local" class="w-full" />
					</label>
					<label class="block">
						<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
							>Valid until</span
						>
						<Input bind:value={fValidUntil} type="datetime-local" class="w-full" />
					</label>
				</div>
				{#if dateRangeError}
					<p class="text-[11px] text-red-500">{dateRangeError}</p>
				{/if}

				<!-- Time restrictions -->
				<div class="space-y-3 rounded-xl bg-[var(--ui-bg-accented)] p-4">
					<div class="flex items-center justify-between">
						<p class="text-[12px] font-semibold text-[var(--ui-text-muted)]">Time restrictions</p>
						<Switch bind:checked={fEnableTimeRestrictions} />
					</div>
					{#if fEnableTimeRestrictions}
						<div class="grid grid-cols-2 gap-3">
							<label class="block">
								<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
									>Start time</span
								>
								<Input bind:value={fStartTime} type="time" class="w-full" />
							</label>
							<label class="block">
								<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
									>End time</span
								>
								<Input bind:value={fEndTime} type="time" class="w-full" />
							</label>
						</div>
						<div class="flex flex-wrap gap-2">
							{#each WEEK_DAYS as day (day.value)}
								<button
									type="button"
									onclick={() => toggleDay(day.value)}
									class="grid size-9 place-items-center rounded-lg text-[11px] font-bold transition-all {fDaysOfWeek.includes(
										day.value
									)
										? 'bg-[var(--ui-color-primary-500)] text-white'
										: 'bg-[var(--ui-bg-muted)] text-[var(--ui-text-muted)]'}"
								>
									{day.label}
								</button>
							{/each}
						</div>
					{/if}
				</div>
			</div>

			<!-- Section: Limits -->
			<div class="space-y-3">
				<div
					class="flex items-center gap-2 text-[12px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase"
				>
					<Icon name="lucide:gauge" class="size-3.5" /> Limits
				</div>
				<label class="block">
					<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>Max usage count (0 = unlimited)</span
					>
					<Input
						bind:value={fMaxUsage}
						type="number"
						min="0"
						placeholder="Unlimited"
						class="w-full"
					/>
				</label>
			</div>

			<!-- Section: Targeting -->
			<div class="space-y-3">
				<div
					class="flex items-center gap-2 text-[12px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase"
				>
					<Icon name="lucide:target" class="size-3.5" /> Targeting
				</div>
				<div class="space-y-3 rounded-xl bg-[var(--ui-bg-accented)] p-4">
					<p class="text-[11px] text-[var(--ui-text-dimmed)]">
						Applies to specific products, categories, or everything.
					</p>
					<!-- Mode selector -->
					<div class="flex gap-1 rounded-lg bg-[var(--ui-bg-muted)] p-1">
						{#each [{ id: 'all' as const, label: 'All products' }, { id: 'categories' as const, label: 'Categories' }, { id: 'products' as const, label: 'Products' }] as mode (mode.id)}
							<button
								type="button"
								onclick={() => setApplicabilityMode(mode.id)}
								class="flex-1 rounded-md px-3 py-1.5 text-[11px] font-semibold transition-all {fApplicabilityMode ===
								mode.id
									? 'bg-[var(--ui-bg-elevated)] text-[var(--ui-text)] shadow-sm'
									: 'text-[var(--ui-text-muted)]'}"
							>
								{mode.label}
							</button>
						{/each}
					</div>
					<!-- Category multi-select -->
					{#if fApplicabilityMode === 'categories' && categories.length > 0}
						<div class="flex flex-wrap gap-1.5">
							{#each categories as cat (cat.id)}
								<button
									type="button"
									onclick={() => toggleCategory(cat.id)}
									class="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-all {fSelectedCategoryIds.includes(
										cat.id
									)
										? 'bg-blue-500/15 text-blue-500 ring-1 ring-blue-500/30'
										: 'bg-[var(--ui-bg-muted)] text-[var(--ui-text-muted)]'}"
								>
									{#if fSelectedCategoryIds.includes(cat.id)}<Icon
											name="lucide:check"
											class="size-3"
										/>{/if}
									{cat.data.name}
								</button>
							{/each}
						</div>
					{/if}
					<!-- Product multi-select -->
					{#if fApplicabilityMode === 'products' && products.length > 0}
						<div class="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
							{#each products as prod (prod.id)}
								<button
									type="button"
									onclick={() => toggleProduct(prod.id)}
									class="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-all {fSelectedProductIds.includes(
										prod.id
									)
										? 'bg-emerald-500/15 text-emerald-500 ring-1 ring-emerald-500/30'
										: 'bg-[var(--ui-bg-muted)] text-[var(--ui-text-muted)]'}"
								>
									{#if fSelectedProductIds.includes(prod.id)}<Icon
											name="lucide:check"
											class="size-3"
										/>{/if}
									{prod.data.name}
								</button>
							{/each}
						</div>
					{/if}
					{#if (fApplicabilityMode === 'categories' && categories.length === 0) || (fApplicabilityMode === 'products' && products.length === 0)}
						<p class="text-[11px] text-[var(--ui-text-dimmed)]">
							No {fApplicabilityMode} available.
						</p>
					{/if}
				</div>
			</div>

			<!-- Section: Active toggle -->
			<div class="flex items-center justify-between rounded-xl bg-[var(--ui-bg-accented)] p-3">
				<div>
					<p class="text-[12px] font-semibold text-[var(--ui-text-muted)]">Active</p>
					<p class="text-[11px] text-[var(--ui-text-dimmed)]">
						Inactive promotions won't apply at checkout.
					</p>
				</div>
				<Switch bind:checked={fActive} />
			</div>

			<!-- Validation errors -->
			{#if formErrors.length > 0}
				<div class="rounded-xl border border-red-500/20 bg-red-500/10 p-3">
					<ul class="space-y-1">
						{#each formErrors as err (err)}
							<li class="flex items-center gap-1 text-[11px] text-red-500">
								<Icon name="lucide:alert-triangle" class="size-3 shrink-0" />
								{err}
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		</div>
	{/if}

	{#snippet footer()}
		<Button color="neutral" variant="ghost" onclick={() => (modalOpen = false)}>Cancel</Button>
		{#if tab === 'coupons'}
			<Button color="primary" icon="lucide:check" onclick={saveCoupon}
				>{editingId ? 'Update' : 'Create'}</Button
			>
		{:else}
			<Button color="primary" icon="lucide:check" disabled={!canSave || saving} onclick={savePromo}>
				{saving ? 'Saving...' : editingId ? 'Update' : 'Create'}
			</Button>
		{/if}
	{/snippet}
</Dialog>

<!-- ═══════════════ DELETE CONFIRMATION ═══════════════ -->
{#if confirmDeleteId}
	<div class="fixed inset-0 z-[95] flex items-center justify-center p-4">
		<button
			type="button"
			tabindex="-1"
			class="fixed inset-0 bg-black/45 backdrop-blur-[2px]"
			onclick={() => (confirmDeleteId = null)}
			aria-label="Cancel delete"
		></button>
		<div
			class="animate-in relative w-full max-w-sm scale-96 rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-bg-elevated)] p-5 shadow-2xl"
		>
			<div class="flex items-center gap-3">
				<div class="grid size-10 place-items-center rounded-xl bg-red-500/10 text-red-500">
					<Icon name="lucide:trash-2" class="size-5" />
				</div>
				<div>
					<p class="font-display text-[14px] font-bold">
						Delete {tab === 'coupons' ? 'coupon' : 'promotion'}?
					</p>
					<p class="text-[11.5px] text-[var(--ui-text-dimmed)]">This action cannot be undone.</p>
				</div>
			</div>
			<div class="mt-4 flex justify-end gap-2">
				<Button color="neutral" variant="ghost" size="sm" onclick={() => (confirmDeleteId = null)}
					>Cancel</Button
				>
				<Button color="error" variant="solid" size="sm" icon="lucide:trash-2" onclick={doDelete}
					>Delete</Button
				>
			</div>
		</div>
	</div>
{/if}

<RawDataDialog bind:open={rawOpen} data={rawItem} title="Promotion / Coupon Raw Data" />
