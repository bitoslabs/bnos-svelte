<script lang="ts">
	import { onMount } from 'svelte';
	import { t } from '$lib/i18n/i18n.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import RawDataDialog from '$lib/components/ui/RawDataDialog.svelte';
	import ListToolbar from '$lib/components/list/ListToolbar.svelte';
	import SortableTh from '$lib/components/list/SortableTh.svelte';
	import Pagination from '$lib/components/list/Pagination.svelte';
	import RowActions from '$lib/components/list/RowActions.svelte';
	import { createListControls } from '$lib/utils/list.svelte';
	import { glo } from '$nostr/store.svelte';
	import { dataSync } from '$nostr/sync.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatMoney, relativeTime } from '$lib/utils/format';
	import { newRecordId, nextReadableNumber } from '$lib/utils/record-id';
	import {
		TYPE,
		statusColor,
		type StockAdjustment,
		type Supplier,
		type PurchaseOrder,
		type Product
	} from '$lib/domain';

	type Tab = 'overview' | 'counts' | 'adjustments' | 'suppliers' | 'orders';
	let tab = $state<Tab>('overview');
	let rawOpen = $state(false);
	let rawItem = $state<any>(null);

	onMount(() => {
		dataSync.pageSync([TYPE.product, TYPE.adjustment, TYPE.supplier, TYPE.purchaseOrder], {
			scope: 'inventory'
		});
	});

	const currency = $derived(tenant.state.currency);

	// ── Tracked products (for Overview & Counts) ──
	const allProducts = $derived(glo.all<Product, typeof TYPE.product>(TYPE.product));
	const trackedProducts = $derived(allProducts.filter((p) => p.data.trackInventory === true));

	// ── Mock stock levels (in a real app, from inventory records) ──
	// For now, use product.inventory or default 0
	function getStock(p: Product): number {
		return ((p as any).stockLevel ?? 0) as number;
	}
	function getLowThreshold(p: Product): number {
		return (p.inventory?.lowStockThreshold ?? 5) as number;
	}
	function stockStatus(p: Product): 'in_stock' | 'low_stock' | 'out_of_stock' {
		const s = getStock(p);
		if (s <= 0) return 'out_of_stock';
		if (s <= getLowThreshold(p)) return 'low_stock';
		return 'in_stock';
	}

	// ── Stats cards ──
	const stats = $derived.by(() => {
		const total = trackedProducts.length;
		let inStock = 0,
			lowStock = 0,
			outOfStock = 0;
		for (const p of trackedProducts) {
			const st = stockStatus(p.data);
			if (st === 'in_stock') inStock++;
			else if (st === 'low_stock') lowStock++;
			else outOfStock++;
		}
		return { total, inStock, lowStock, outOfStock };
	});

	// ── Stock count sessions (localStorage) ──
	const COUNTS_KEY = 'bnos-os:stock-counts';
	type CountSession = {
		id: string;
		date: string;
		status: 'draft' | 'in_progress' | 'completed';
		items: { productId: string; productName: string; expected: number; counted: number | null }[];
	};
	let countSessions = $state<CountSession[]>([]);
	let activeCountId = $state<string | null>(null);

	function loadCounts() {
		try {
			const raw = localStorage.getItem(COUNTS_KEY);
			countSessions = raw ? JSON.parse(raw) : [];
		} catch {
			countSessions = [];
		}
	}
	function saveCounts() {
		localStorage.setItem(COUNTS_KEY, JSON.stringify(countSessions));
	}
	function newCount() {
		const items = trackedProducts.map((p) => ({
			productId: p.id,
			productName: String(p.data.name ?? 'Unknown'),
			expected: getStock(p.data),
			counted: null
		}));
		const session: CountSession = {
			id: newRecordId('stock-count'),
			date: new Date().toISOString(),
			status: 'in_progress',
			items
		};
		countSessions = [session, ...countSessions];
		saveCounts();
		activeCountId = session.id;
	}
	function activeCount() {
		return countSessions.find((s) => s.id === activeCountId) ?? null;
	}
	function setCounted(productId: string, val: number | null) {
		const s = activeCount();
		if (!s) return;
		const item = s.items.find((i) => i.productId === productId);
		if (item) item.counted = val;
		saveCounts();
		countSessions = [...countSessions];
	}
	async function completeCount() {
		const s = activeCount();
		if (!s) return;

		// Write adjustments for each variance found
		for (const item of s.items) {
			if (item.counted === null) continue;
			const diff = item.counted - item.expected;
			if (diff === 0) continue;

			const adjType = diff > 0 ? 'increase' : 'decrease';
			const adjQty = Math.abs(diff);

			try {
				await glo.upsert<StockAdjustment>(
					TYPE.adjustment,
					{
						productId: item.productId,
						productName: item.productName,
						type: adjType,
						quantity: adjQty,
						reason: 'Stock count adjustment',
						referenceType: 'count',
						occurredAt: new Date().toISOString()
					},
					{ id: newRecordId('stock-adjustment') }
				);

				// Update product stock to counted value
				const product = glo.get(TYPE.product, item.productId);
				if (product) {
					await glo.upsert(
						TYPE.product,
						{
							...(product.data as Record<string, unknown>),
							stockLevel: item.counted
						},
						{ id: product.id }
					);
				}
			} catch (e) {
				console.warn('[inventory] count adjustment failed for', item.productId, e);
			}
		}

		s.status = 'completed';
		saveCounts();
		countSessions = [...countSessions];
		activeCountId = null;
		toast.success('Stock count completed');
	}
	function deleteCount(id: string) {
		countSessions = countSessions.filter((s) => s.id !== id);
		if (activeCountId === id) activeCountId = null;
		saveCounts();
	}

	// ── Overview filtering ──
	let overviewSearch = $state('');
	let overviewFilter = $state<'all' | 'in_stock' | 'low_stock' | 'out_of_stock'>('all');

	const overviewList = $derived.by(() => {
		const q = overviewSearch.toLowerCase();
		return trackedProducts
			.filter((p) => {
				const name = String(p.data.name ?? '').toLowerCase();
				if (q && !name.includes(q)) return false;
				if (overviewFilter !== 'all' && stockStatus(p.data) !== overviewFilter) return false;
				return true;
			})
			.sort((a, b) => String(a.data.name ?? '').localeCompare(String(b.data.name ?? '')));
	});

	// ── Quick adjust dialog ──
	let adjDlgOpen = $state(false);
	let adjProduct = $state<{ id: string; name: string }>({ id: '', name: '' });
	let adjQty = $state(1);
	let adjDir = $state<'increase' | 'decrease'>('increase');
	let adjReason = $state('');

	function openQuickAdjust(id: string, name: string) {
		adjProduct = { id, name };
		adjQty = 1;
		adjDir = 'increase';
		adjReason = '';
		adjDlgOpen = true;
	}
	async function saveQuickAdjust() {
		try {
			await glo.upsert<StockAdjustment>(
				TYPE.adjustment,
				{
					productId: adjProduct.id,
					productName: adjProduct.name,
					type: adjDir,
					quantity: Number(adjQty) || 0,
					reason: adjReason.trim() || 'Manual adjustment',
					occurredAt: new Date().toISOString()
				},
				{ id: newRecordId('stock-adjustment') }
			);

			// After saving adjustment, update product stock
			const product = glo.get(TYPE.product, adjProduct.id);
			if (product) {
				const currentStock = (product.data as any).stockLevel ?? 0;
				const adjQtyNum = Math.abs(Number(adjQty) || 0);
				const newStock =
					adjDir === 'increase' ? currentStock + adjQtyNum : Math.max(0, currentStock - adjQtyNum);
				await glo.upsert(
					TYPE.product,
					{
						...(product.data as Record<string, unknown>),
						stockLevel: newStock
					},
					{ id: product.id }
				);
			}

			toast.success('Adjustment saved');
			adjDlgOpen = false;
		} catch (e) {
			toast.error('Save failed', e instanceof Error ? e.message : undefined);
		}
	}

	const tabs: { id: Tab; label: string; icon: string; count: () => number }[] = [
		{
			id: 'overview',
			label: 'Overview',
			icon: 'lucide:layout-dashboard',
			count: () => trackedProducts.length
		},
		{
			id: 'counts',
			label: 'Counts',
			icon: 'lucide:clipboard-check',
			count: () => countSessions.length
		},
		{
			id: 'adjustments',
			label: 'Adjustments',
			icon: 'lucide:arrow-up-down',
			count: () => glo.all(TYPE.adjustment).length
		},
		{
			id: 'suppliers',
			label: 'Suppliers',
			icon: 'lucide:truck',
			count: () => glo.all(TYPE.supplier).length
		},
		{
			id: 'orders',
			label: 'Purchase Orders',
			icon: 'lucide:clipboard-list',
			count: () => glo.all(TYPE.purchaseOrder).length
		}
	];

	const adjustments = $derived(glo.all<StockAdjustment, typeof TYPE.adjustment>(TYPE.adjustment));
	const suppliers = $derived(glo.all<Supplier, typeof TYPE.supplier>(TYPE.supplier));
	const orders = $derived(glo.all<PurchaseOrder, typeof TYPE.purchaseOrder>(TYPE.purchaseOrder));

	const adjCtrl = createListControls<{ id: string; data: StockAdjustment }>({
		items: () => adjustments,
		search: (a, q) => (a.data.productName ?? '').toLowerCase().includes(q),
		sortOptions: () => [
			{ key: 'product', label: 'Product', value: (a) => a.data.productName },
			{ key: 'date', label: 'Date', value: (a) => a.data.occurredAt }
		],
		defaultSortKey: 'date',
		defaultSortDir: 'desc',
		defaultViewMode: 'table',
		storageKey: 'inv-adjustments'
	});
	const supCtrl = createListControls<{ id: string; data: Supplier }>({
		items: () => suppliers,
		search: (s, q) => (s.data.name ?? '').toLowerCase().includes(q),
		sortOptions: () => [
			{ key: 'name', label: 'Name', value: (s) => s.data.name },
			{ key: 'status', label: 'Status', value: (s) => s.data.status ?? 'active' }
		],
		defaultSortKey: 'name',
		defaultViewMode: 'table',
		storageKey: 'inv-suppliers'
	});
	const poCtrl = createListControls<{ id: string; data: PurchaseOrder }>({
		items: () => orders,
		search: (o, q) => (o.data.number ?? '').toLowerCase().includes(q),
		sortOptions: () => [
			{ key: 'number', label: 'Number', value: (o) => o.data.number },
			{ key: 'total', label: 'Total', value: (o) => o.data.total },
			{ key: 'status', label: 'Status', value: (o) => o.data.status }
		],
		defaultSortKey: 'number',
		defaultSortDir: 'desc',
		defaultViewMode: 'table',
		storageKey: 'inv-pos'
	});

	// forms
	let dlgOpen = $state(false);
	let dlgKind = $state<Tab>('adjustments');
	let aProduct = $state('');
	let aQty = $state(1);
	let aType = $state<'increase' | 'decrease'>('increase');
	let aReason = $state('');
	let adjProductSearch = $state('');
	let adjProductResults = $derived(
		adjProductSearch.trim()
			? allProducts
					.filter((p) =>
						String(p.data.name ?? '')
							.toLowerCase()
							.includes(adjProductSearch.trim().toLowerCase())
					)
					.slice(0, 8)
			: []
	);
	let adjSelectedProduct = $state<{ id: string; name: string } | null>(null);
	let sName = $state('');
	let sContact = $state('');
	let sPhone = $state('');
	let sTerms = $state('');
	let poSupplier = $state('');
	let poLines = $state('');

	function openCreate(t: Tab) {
		if (t === 'overview' || t === 'counts') return;
		dlgKind = t;
		aProduct = '';
		aQty = 1;
		aType = 'increase';
		aReason = '';
		adjSelectedProduct = null;
		adjProductSearch = '';
		sName = sContact = sPhone = sTerms = '';
		poSupplier = '';
		poLines = '';
		dlgOpen = true;
	}

	async function save() {
		try {
			if (dlgKind === 'adjustments') {
				const prodId = adjSelectedProduct?.id ?? null;
				const prodName = adjSelectedProduct?.name ?? aProduct.trim();
				if (!prodName) return toast.warning('Select a product');
				// Try to find the product by id or name for stock update
				const matchedProduct = prodId
					? allProducts.find((p) => p.id === prodId)
					: allProducts.find(
							(p) => String(p.data.name ?? '').toLowerCase() === prodName.toLowerCase()
						);
				await glo.upsert<StockAdjustment>(
					TYPE.adjustment,
					{
						productId: matchedProduct?.id ?? prodId ?? undefined,
						productName: prodName,
						type: aType,
						quantity: Number(aQty) || 0,
						reason: aReason.trim() || 'Manual adjustment',
						occurredAt: new Date().toISOString()
					},
					{ id: newRecordId('stock-adjustment') }
				);
				// Update product stock if matched
				if (matchedProduct) {
					const currentStock = (matchedProduct.data as any).stockLevel ?? 0;
					const adjQtyNum = Math.abs(Number(aQty) || 0);
					const newStock =
						aType === 'increase' ? currentStock + adjQtyNum : Math.max(0, currentStock - adjQtyNum);
					await glo.upsert(
						TYPE.product,
						{
							...(matchedProduct.data as Record<string, unknown>),
							stockLevel: newStock
						},
						{ id: matchedProduct.id }
					);
				}
			} else if (dlgKind === 'suppliers') {
				if (!sName.trim()) return toast.warning('Name required');
				await glo.upsert<Supplier>(
					TYPE.supplier,
					{
						name: sName.trim(),
						contactName: sContact.trim() || undefined,
						phone: sPhone.trim() || undefined,
						paymentTerms: sTerms.trim() || undefined,
						status: 'active'
					},
					{ id: newRecordId('supplier') }
				);
			} else {
				const lines = poLines
					.split('\n')
					.map((l) => l.trim())
					.filter(Boolean)
					.map((l) => {
						const m = l.match(/^(.+?)\s*x\s*(\d+)\s*@\s*([\d.]+)$/i);
						const qty = m ? Number(m[2]) : 1;
						const price = m ? Number(m[3]) : 0;
						const name = m ? m[1].trim() : l;
						return { name, quantity: qty, unitPrice: price, total: qty * price };
					});
				await glo.upsert<PurchaseOrder>(
					TYPE.purchaseOrder,
					{
						number: nextReadableNumber({ prefix: 'PO', scope: tenant.state.locationId }),
						supplierName: poSupplier.trim() || undefined,
						status: 'sent',
						lines,
						total: lines.reduce((s, l) => s + l.total, 0),
						currency,
						orderedAt: new Date().toISOString()
					},
					{ id: newRecordId('purchase-order') }
				);
			}
			toast.success('Saved');
			dlgOpen = false;
		} catch (e) {
			toast.error('Save failed', e instanceof Error ? e.message : undefined);
		}
	}
	function del(t: string, id: string) {
		glo.remove(t, id);
		toast.info('Removed');
	}
	const dlgTitle = $derived(
		{
			adjustments: 'New stock adjustment',
			suppliers: 'Add supplier',
			orders: 'New purchase order'
		}[dlgKind as 'adjustments' | 'suppliers' | 'orders'] ?? ''
	);

	// load counts on mount
	$effect(() => {
		loadCounts();
	});
</script>

<svelte:head><title>{t('common.appName')} · {t('nav.inventory')}</title></svelte:head>

<div class="space-y-4">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h1 class="font-display text-xl font-bold tracking-tight">{t('nav.inventory')}</h1>
			<p class="text-[12.5px] text-[var(--ui-text-muted)]">
				Stock, counts, suppliers & purchase orders
			</p>
		</div>
		{#if tab === 'overview'}
			<Button color="primary" icon="lucide:arrow-up-down" onclick={() => openCreate('adjustments')}
				>New adjustment</Button
			>
		{:else if tab === 'counts'}
			<Button color="primary" icon="lucide:plus" onclick={newCount}>{t('common.new') + ' ' + t('common.count')}</Button>
		{:else}
			<Button color="primary" icon="lucide:plus" onclick={() => openCreate(tab)}
				>New {tab === 'adjustments'
					? 'adjustment'
					: tab === 'suppliers'
						? 'supplier'
						: 'order'}</Button
			>
		{/if}
	</div>

	<!-- Stats cards -->
	{#if trackedProducts.length > 0}
		<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
			<div class="data-panel flex items-center gap-3 p-4">
				<div class="flex size-10 items-center justify-center rounded-xl bg-[var(--ui-bg-accented)]">
					<Icon name="lucide:package" class="size-5 text-[var(--ui-text-muted)]" />
				</div>
				<div>
					<div
						class="text-[11px] font-semibold tracking-wide text-[var(--ui-text-dimmed)] uppercase"
					>
						Total Products
					</div>
					<div class="text-lg font-bold tabular-nums">{stats.total}</div>
				</div>
			</div>
			<div class="data-panel flex items-center gap-3 p-4">
				<div class="flex size-10 items-center justify-center rounded-xl bg-emerald-500/10">
					<Icon name="lucide:check-circle" class="size-5 text-emerald-500" />
				</div>
				<div>
					<div
						class="text-[11px] font-semibold tracking-wide text-[var(--ui-text-dimmed)] uppercase"
					>
						In Stock
					</div>
					<div class="text-lg font-bold text-emerald-600 tabular-nums dark:text-emerald-400">
						{stats.inStock}
					</div>
				</div>
			</div>
			<div class="data-panel flex items-center gap-3 p-4">
				<div class="flex size-10 items-center justify-center rounded-xl bg-amber-500/10">
					<Icon name="lucide:alert-triangle" class="size-5 text-amber-500" />
				</div>
				<div>
					<div
						class="text-[11px] font-semibold tracking-wide text-[var(--ui-text-dimmed)] uppercase"
					>
						Low Stock
					</div>
					<div class="text-lg font-bold text-amber-600 tabular-nums dark:text-amber-400">
						{stats.lowStock}
					</div>
				</div>
			</div>
			<div class="data-panel flex items-center gap-3 p-4">
				<div class="flex size-10 items-center justify-center rounded-xl bg-rose-500/10">
					<Icon name="lucide:x-circle" class="size-5 text-rose-500" />
				</div>
				<div>
					<div
						class="text-[11px] font-semibold tracking-wide text-[var(--ui-text-dimmed)] uppercase"
					>
						Out of Stock
					</div>
					<div class="text-lg font-bold text-rose-600 tabular-nums dark:text-rose-400">
						{stats.outOfStock}
					</div>
				</div>
			</div>
		</div>
	{/if}

	<div class="segmented inline-flex w-fit gap-1 p-1">
		{#each tabs as t (t.id)}
			<button
				type="button"
				onclick={() => (tab = t.id)}
				class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-semibold transition-colors {tab ===
				t.id
					? 'bg-[var(--ui-bg-elevated)] text-[var(--ui-text)] shadow-sm'
					: 'text-[var(--ui-text-muted)]'}"
			>
				<Icon name={t.icon} class="size-3.5" />{t.label}<span
					class="rounded bg-[var(--ui-bg-accented)] px-1.5 text-[10px] tabular-nums"
					>{t.count()}</span
				>
			</button>
		{/each}
	</div>

	<!-- ── OVERVIEW TAB ── -->
	{#if tab === 'overview'}
		{#if trackedProducts.length === 0}
			<EmptyState
				icon="lucide:layout-dashboard"
				title={t('inventory.noTrackedProducts')}
				description="Enable 'Track inventory' on products to see stock overview."
			></EmptyState>
		{:else}
			<!-- Search + filter -->
			<div class="flex flex-wrap items-center gap-2">
				<div class="min-w-[200px] flex-1">
					<Input
						bind:value={overviewSearch}
						icon="lucide:search"
						placeholder="Search product…"
						class="w-full"
					/>
				</div>
				<Select
					bind:value={overviewFilter}
					options={[
						{ value: 'all', label: 'All' },
						{ value: 'in_stock', label: 'In Stock' },
						{ value: 'low_stock', label: 'Low Stock' },
						{ value: 'out_of_stock', label: 'Out of Stock' }
					]}
				/>
			</div>

			{#if overviewList.length === 0}
				<EmptyState
					icon="lucide:search-x"
					title="No products match"
					description={t('common.tryDifferentSearch')}
				/>
			{:else}
				<div class="data-panel">
					<div class="overflow-x-auto">
						<table class="table-surface w-full text-left">
							<thead
								><tr>
									<th class="px-5 py-2.5">{t('common.product')}</th>
									<th class="px-5 py-2.5">{t('common.sku')}</th>
									<th class="px-5 py-2.5 text-right">{t('common.price')}</th>
									<th class="px-5 py-2.5 text-right">{t('common.stock')}</th>
									<th class="px-5 py-2.5">{t('common.status')}</th>
									<th class="px-5 py-2.5 text-right">{t('common.value')}</th>
									<th class="w-10 px-5 py-2.5"></th>
								</tr></thead
							>
							<tbody class="divide-y divide-[var(--ui-border-muted)] text-[13px]">
								{#each overviewList as p (p.id)}
									{@const st = stockStatus(p.data)}
									{@const stock = getStock(p.data)}
									<tr>
										<td class="px-5 py-3">
											<div class="flex items-center gap-2">
												{#if (p.data as any).image}
													<img
														src={(p.data as any).image}
														alt=""
														class="size-8 rounded-lg object-cover"
													/>
												{/if}
												<span class="font-semibold">{p.data.name}</span>
											</div>
										</td>
										<td class="px-5 py-3 font-mono text-[11.5px] text-[var(--ui-text-dimmed)]"
											>{p.data.sku ?? '—'}</td
										>
										<td class="px-5 py-3 text-right tabular-nums"
											>{formatMoney(
												(p.data as any).price ?? 0,
												(p.data as any).currency ?? currency
											)}</td
										>
										<td class="px-5 py-3 text-right"
											><Badge
												color={st === 'in_stock'
													? 'success'
													: st === 'low_stock'
														? 'warning'
														: 'error'}>{stock}</Badge
											></td
										>
										<td class="px-5 py-3">
											{#if st === 'in_stock'}<Badge color="success">In Stock</Badge>
											{:else if st === 'low_stock'}<Badge color="warning">Low Stock</Badge>
											{:else}<Badge color="error">Out of Stock</Badge>{/if}
										</td>
										<td class="px-5 py-3 text-right font-semibold tabular-nums"
											>{formatMoney(stock * ((p.data as any).price ?? 0), currency)}</td
										>
										<td class="px-5 py-3 text-right">
											<Button
												size="sm"
												variant="subtle"
												icon="lucide:arrow-up-down"
												onclick={() => openQuickAdjust(p.id, String(p.data.name ?? 'Unknown'))}
												>Adjust</Button
											>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</div>
			{/if}
		{/if}

		<!-- ── COUNTS TAB ── -->
	{:else if tab === 'counts'}
		{#if !activeCountId && countSessions.length === 0}
			<EmptyState
				icon="lucide:clipboard-check"
				title="No stock counts"
				description="Start a stocktake session to reconcile inventory."
			>
				{#snippet actions()}<Button color="primary" size="sm" icon="lucide:plus" onclick={newCount}
						>{t('common.new') + ' ' + t('common.count')}</Button
					>{/snippet}
			</EmptyState>
		{:else if activeCountId && activeCount()}
			{@const ac = activeCount()!}
			<!-- Count form -->
			<div class="flex items-center justify-between gap-3">
				<div>
					<h2 class="font-display text-base font-bold">{ac.id}</h2>
					<p class="text-[12px] text-[var(--ui-text-muted)]">
						{relativeTime(ac.date)} · {ac.items.filter((i) => i.counted !== null).length}/{ac.items
							.length} counted
					</p>
				</div>
				<div class="flex gap-2">
					<Button color="neutral" variant="ghost" onclick={() => (activeCountId = null)}
						>Back</Button
					>
					<Button color="primary" icon="lucide:check" onclick={completeCount}>Complete</Button>
				</div>
			</div>
			<div class="data-panel">
				<table class="table-surface w-full text-left">
					<thead
						><tr>
							<th class="px-5 py-2.5">{t('common.product')}</th>
							<th class="px-5 py-2.5 text-right">{t('common.expected')}</th>
							<th class="px-5 py-2.5 text-right">{t('common.counted')}</th>
							<th class="px-5 py-2.5 text-right">{t('common.diff')}</th>
						</tr></thead
					>
					<tbody class="divide-y divide-[var(--ui-border-muted)] text-[13px]">
						{#each ac.items as item (item.productId)}
							{@const diff = item.counted !== null ? item.counted - item.expected : null}
							<tr>
								<td class="px-5 py-3 font-semibold">{item.productName}</td>
								<td class="px-5 py-3 text-right text-[var(--ui-text-muted)] tabular-nums"
									>{item.expected}</td
								>
								<td class="px-5 py-3 text-right">
									<input
										type="number"
										value={item.counted ?? ''}
										oninput={(e) =>
											setCounted(
												item.productId,
												e.currentTarget.value === '' ? null : Number(e.currentTarget.value)
											)}
										class="w-20 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-2 py-1 text-right text-[13px] focus:border-[var(--ui-color-primary-500)] focus:outline-none"
									/>
								</td>
								<td class="px-5 py-3 text-right tabular-nums">
									{#if diff === null}<span class="text-[var(--ui-text-dimmed)]">—</span>
									{:else if diff === 0}<span class="text-[var(--ui-text-muted)]">0</span>
									{:else if diff! > 0}<span
											class="font-semibold text-emerald-600 dark:text-emerald-400">+{diff}</span
										>
									{:else}<span class="font-semibold text-rose-600 dark:text-rose-400">{diff}</span
										>{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<!-- Session list -->
			<div class="data-panel">
				<table class="table-surface w-full text-left">
					<thead
						><tr>
							<th class="px-5 py-2.5">{t('common.session')}</th>
							<th class="px-5 py-2.5">{t('common.date')}</th>
							<th class="px-5 py-2.5">{t('common.status')}</th>
							<th class="px-5 py-2.5 text-right">{t('common.progress')}</th>
							<th class="w-10 px-5 py-2.5"></th>
						</tr></thead
					>
					<tbody class="divide-y divide-[var(--ui-border-muted)] text-[13px]">
						{#each countSessions as s (s.id)}
							<tr
								class="cursor-pointer hover:bg-[var(--ui-bg-accented)]"
								onclick={() => (activeCountId = s.id)}
							>
								<td class="px-5 py-3 font-mono text-[12.5px] font-semibold">{s.id}</td>
								<td class="px-5 py-3 text-[var(--ui-text-muted)]">{relativeTime(s.date)}</td>
								<td class="px-5 py-3"
									><Badge
										color={s.status === 'completed'
											? 'success'
											: s.status === 'in_progress'
												? 'info'
												: 'neutral'}>{s.status.replace('_', ' ')}</Badge
									></td
								>
								<td class="px-5 py-3 text-right tabular-nums"
									>{s.items.filter((i) => i.counted !== null).length}/{s.items.length}</td
								>
								<td class="px-5 py-3 text-right"
									><RowActions
										actions={[
											[
												{
													label: 'Delete',
													icon: 'lucide:trash-2',
													danger: true,
													onSelect: () => deleteCount(s.id)
												}
											]
										]}
									/></td
								>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}

		<!-- ── ADJUSTMENTS TAB ── -->
	{:else if tab === 'adjustments'}
		{#if adjustments.length || adjCtrl.search}<ListToolbar
				bind:search={adjCtrl.search}
				bind:sortKey={adjCtrl.sortKey}
				bind:sortDir={adjCtrl.sortDir}
				viewMode={adjCtrl.viewMode}
				sortItems={adjCtrl.sortItems}
				allowViewModes={['table']}
				applySort={adjCtrl.applySort}
				searchPlaceholder="Search product…"
			/>{/if}
		{#if adjCtrl.list.length === 0}
			<EmptyState
				icon="lucide:arrow-up-down"
				title="No stock adjustments"
				description="Record increases or decreases to keep stock accurate."
			>
				{#snippet actions()}<Button
						color="primary"
						size="sm"
						icon="lucide:plus"
						onclick={() => openCreate('adjustments')}>New adjustment</Button
					>{/snippet}
			</EmptyState>
		{:else}
			<div class="data-panel">
				<table class="table-surface w-full text-left">
					<thead
						><tr>
							<SortableTh
								column="product"
								active={adjCtrl.sortKey === 'product'}
								direction={adjCtrl.sortDir}
								applySort={adjCtrl.applySort}>{t('common.product')}</SortableTh
							>
							<th class="px-5 py-2.5">{t('common.type')}</th><th class="px-5 py-2.5 text-right">{t('common.qty')}</th>
							<SortableTh
								column="date"
								active={adjCtrl.sortKey === 'date'}
								direction={adjCtrl.sortDir}
								align="right"
								applySort={adjCtrl.applySort}>{t('common.when')}</SortableTh
							>
							<th class="w-10 px-5 py-2.5"></th>
						</tr></thead
					>
					<tbody class="divide-y divide-[var(--ui-border-muted)] text-[13px]">
						{#each adjCtrl.pagedList as a (a.id)}
							<tr>
								<td class="px-5 py-3"
									><div class="font-semibold">{a.data.productName}</div>
									<div class="text-[11.5px] text-[var(--ui-text-dimmed)]">{a.data.reason}</div></td
								>
								<td class="px-5 py-3"
									><Badge color={a.data.type === 'increase' ? 'success' : 'error'}
										>{a.data.type}</Badge
									></td
								>
								<td class="px-5 py-3 text-right tabular-nums"
									>{a.data.type === 'increase' ? '+' : '−'}{a.data.quantity}</td
								>
								<td class="px-5 py-3 text-right text-[12px] text-[var(--ui-text-dimmed)]"
									>{relativeTime(a.data.occurredAt)}</td
								>
								<td class="px-5 py-3 text-right"
									><RowActions
										actions={[
											[
												{
													label: t('common.viewRaw'),
													icon: 'lucide:code',
													onSelect: () => { rawItem = glo.get(TYPE.adjustment, a.id); rawOpen = true; }
												}
											],
											[
												{
													label: 'Delete',
													icon: 'lucide:trash-2',
													danger: true,
													onSelect: () => del(TYPE.adjustment, a.id)
												}
											]
										]}
									/></td
								>
							</tr>
						{/each}
					</tbody>
				</table>
				<Pagination controls={adjCtrl} />
			</div>
		{/if}

		<!-- ── SUPPLIERS TAB ── -->
	{:else if tab === 'suppliers'}
		{#if suppliers.length || supCtrl.search}<ListToolbar
				bind:search={supCtrl.search}
				bind:sortKey={supCtrl.sortKey}
				bind:sortDir={supCtrl.sortDir}
				viewMode={supCtrl.viewMode}
				sortItems={supCtrl.sortItems}
				allowViewModes={['table']}
				applySort={supCtrl.applySort}
				searchPlaceholder="Search supplier…"
			/>{/if}
		{#if supCtrl.list.length === 0}
			<EmptyState
				icon="lucide:truck"
				title="No suppliers"
				description="Add suppliers to raise purchase orders."
			>
				{#snippet actions()}<Button
						color="primary"
						size="sm"
						icon="lucide:plus"
						onclick={() => openCreate('suppliers')}>{t('common.add') + ' ' + t('common.supplier')}</Button
					>{/snippet}
			</EmptyState>
		{:else}
			<div class="data-panel">
				<table class="table-surface w-full text-left">
					<thead
						><tr>
							<SortableTh
								column="name"
								active={supCtrl.sortKey === 'name'}
								direction={supCtrl.sortDir}
								applySort={supCtrl.applySort}>{t('common.supplier')}</SortableTh
							>
							<th class="px-5 py-2.5">{t('common.contact')}</th>
							<SortableTh
								column="status"
								active={supCtrl.sortKey === 'status'}
								direction={supCtrl.sortDir}
								applySort={supCtrl.applySort}>{t('common.status')}</SortableTh
							>
							<th class="w-10 px-5 py-2.5"></th>
						</tr></thead
					>
					<tbody class="divide-y divide-[var(--ui-border-muted)] text-[13px]">
						{#each supCtrl.pagedList as s (s.id)}
							<tr>
								<td class="px-5 py-3 font-semibold"
									>{s.data.name}{#if s.data.paymentTerms}<div
											class="text-[11px] text-[var(--ui-text-dimmed)]"
										>
											{s.data.paymentTerms}
										</div>{/if}</td
								>
								<td class="px-5 py-3 text-[var(--ui-text-muted)]"
									>{s.data.contactName ?? s.data.phone ?? '—'}</td
								>
								<td class="px-5 py-3"
									><Badge color={statusColor(s.data.status ?? 'active')}
										>{s.data.status ?? 'active'}</Badge
									></td
								>
								<td class="px-5 py-3 text-right"
									><RowActions
										actions={[
											[
												{
													label: t('common.viewRaw'),
													icon: 'lucide:code',
													onSelect: () => { rawItem = glo.get(TYPE.supplier, s.id); rawOpen = true; }
												}
											],
											[
												{
													label: 'Delete',
													icon: 'lucide:trash-2',
													danger: true,
													onSelect: () => del(TYPE.supplier, s.id)
												}
											]
										]}
									/></td
								>
							</tr>
						{/each}
					</tbody>
				</table>
				<Pagination controls={supCtrl} />
			</div>
		{/if}

		<!-- ── PURCHASE ORDERS TAB ── -->
	{:else}
		{#if orders.length || poCtrl.search}<ListToolbar
				bind:search={poCtrl.search}
				bind:sortKey={poCtrl.sortKey}
				bind:sortDir={poCtrl.sortDir}
				viewMode={poCtrl.viewMode}
				sortItems={poCtrl.sortItems}
				allowViewModes={['table']}
				applySort={poCtrl.applySort}
				searchPlaceholder="Search PO no…"
			/>{/if}
		{#if poCtrl.list.length === 0}
			<EmptyState
				icon="lucide:clipboard-list"
				title="No purchase orders"
				description="Raise POs to your suppliers."
			>
				{#snippet actions()}<Button
						color="primary"
						size="sm"
						icon="lucide:plus"
						onclick={() => openCreate('orders')}>{t('common.new') + ' ' + t('common.order')}</Button
					>{/snippet}
			</EmptyState>
		{:else}
			<div class="data-panel">
				<table class="table-surface w-full text-left">
					<thead
						><tr>
							<SortableTh
								column="number"
								active={poCtrl.sortKey === 'number'}
								direction={poCtrl.sortDir}
								applySort={poCtrl.applySort}>{t('common.po')}</SortableTh
							>
							<th class="px-5 py-2.5">{t('common.supplier')}</th>
							<SortableTh
								column="status"
								active={poCtrl.sortKey === 'status'}
								direction={poCtrl.sortDir}
								applySort={poCtrl.applySort}>{t('common.status')}</SortableTh
							>
							<SortableTh
								column="total"
								active={poCtrl.sortKey === 'total'}
								direction={poCtrl.sortDir}
								align="right"
								applySort={poCtrl.applySort}>{t('common.total')}</SortableTh
							>
							<th class="w-10 px-5 py-2.5"></th>
						</tr></thead
					>
					<tbody class="divide-y divide-[var(--ui-border-muted)] text-[13px]">
						{#each poCtrl.pagedList as o (o.id)}
							<tr>
								<td class="px-5 py-3 font-mono text-[12.5px]">{o.data.number}</td>
								<td class="px-5 py-3 text-[var(--ui-text-muted)]">{o.data.supplierName ?? '—'}</td>
								<td class="px-5 py-3"
									><Badge color={statusColor(o.data.status)}>{o.data.status}</Badge></td
								>
								<td class="px-5 py-3 text-right font-semibold tabular-nums"
									>{formatMoney(o.data.total, o.data.currency || currency)}</td
								>
								<td class="px-5 py-3 text-right"
									><RowActions
										actions={[
											[
												{
													label: t('common.viewRaw'),
													icon: 'lucide:code',
													onSelect: () => { rawItem = glo.get(TYPE.purchaseOrder, o.id); rawOpen = true; }
												}
											],
											[
												{
													label: 'Delete',
													icon: 'lucide:trash-2',
													danger: true,
													onSelect: () => del(TYPE.purchaseOrder, o.id)
												}
											]
										]}
									/></td
								>
							</tr>
						{/each}
					</tbody>
				</table>
				<Pagination controls={poCtrl} />
			</div>
		{/if}
	{/if}
</div>

<!-- Quick Adjust Dialog -->
<Dialog bind:open={adjDlgOpen} title={t('common.quickAdjust')}>
	<div class="space-y-3">
		<div class="text-[13px] font-semibold text-[var(--ui-text-muted)]">{adjProduct.name}</div>
		{#if adjProduct.id}
			{@const prod = allProducts.find((p) => p.id === adjProduct.id)}
			{#if prod}
				<div
					class="flex items-center gap-2 rounded-lg bg-[var(--ui-bg-muted)] px-3 py-2 text-[12px]"
				>
					<Icon name="lucide:boxes" class="size-4 text-[var(--ui-text-dimmed)]" />
					<span class="text-[var(--ui-text-muted)]">Current stock:</span>
					<span class="font-bold">{(prod.data as any).stockLevel ?? 0}</span>
					<span class="ml-auto text-[var(--ui-text-dimmed)]"
						>→ New: <span class="font-bold text-primary-600 dark:text-primary-400"
							>{adjDir === 'increase'
								? ((allProducts.find((p) => p.id === adjProduct.id)?.data as any)?.stockLevel ??
										0) + Math.abs(Number(adjQty) || 0)
								: Math.max(
										0,
										((allProducts.find((p) => p.id === adjProduct.id)?.data as any)?.stockLevel ??
											0) - Math.abs(Number(adjQty) || 0)
									)}</span
						></span
					>
				</div>
			{/if}
		{/if}
		<div class="segmented flex gap-1 p-1">
			<button
				type="button"
				onclick={() => (adjDir = 'increase')}
				class="flex-1 rounded-md px-3 py-1.5 text-[12px] font-semibold {adjDir === 'increase'
					? 'bg-[var(--ui-bg-elevated)]'
					: 'text-[var(--ui-text-muted)]'}">{t('common.increase')}</button
			>
			<button
				type="button"
				onclick={() => (adjDir = 'decrease')}
				class="flex-1 rounded-md px-3 py-1.5 text-[12px] font-semibold {adjDir === 'decrease'
					? 'bg-[var(--ui-bg-elevated)]'
					: 'text-[var(--ui-text-muted)]'}">{t('common.decrease')}</button
			>
		</div>
		<label class="block"
			><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
				>{t('common.quantity')}</span
			><Input bind:value={adjQty} type="number" min="0" class="w-full" /></label
		>
		<label class="block"
			><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">{t('common.reason')}</span
			><Input bind:value={adjReason} class="w-full" /></label
		>
	</div>
	{#snippet footer()}<Button color="neutral" variant="ghost" onclick={() => (adjDlgOpen = false)}
			>{t('common.cancel')}</Button
		><Button color="primary" icon="lucide:check" onclick={saveQuickAdjust}>{t('common.save')}</Button>{/snippet}
</Dialog>

<!-- Create Dialog (adjustments / suppliers / orders) -->
<Dialog bind:open={dlgOpen} title={dlgTitle}>
	{#if dlgKind === 'adjustments'}
		<div class="space-y-3">
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
					>{t('common.product')}</span
				>
				{#if adjSelectedProduct}
					<div
						class="flex items-center gap-2 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-3 py-2"
					>
						<Icon name="lucide:package" class="size-4 text-[var(--ui-text-dimmed)]" />
						<span class="flex-1 truncate text-[13px] font-semibold">{adjSelectedProduct.name}</span>
						<button
							type="button"
							onclick={() => {
								adjSelectedProduct = null;
								adjProductSearch = '';
								aProduct = '';
							}}
							class="text-[var(--ui-text-dimmed)] hover:text-[var(--tone-error-text)]"
						>
							<Icon name="lucide:x" class="size-4" />
						</button>
					</div>
				{:else}
					<div class="relative">
						<Input
							bind:value={adjProductSearch}
							placeholder="Search product by name…"
							icon="lucide:search"
							class="w-full"
						/>
						{#if adjProductResults.length > 0}
							<div
								class="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-[var(--ui-border)] bg-[var(--surface-bg)] shadow-lg"
							>
								{#each adjProductResults as p (p.id)}
									<button
										type="button"
										onclick={() => {
											adjSelectedProduct = { id: p.id, name: String(p.data.name ?? 'Unknown') };
											aProduct = String(p.data.name ?? '');
											adjProductSearch = '';
										}}
										class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12.5px] transition-colors hover:bg-[var(--ui-bg-accented)]"
									>
										<Icon
											name="lucide:package"
											class="size-4 shrink-0 text-[var(--ui-text-dimmed)]"
										/>
										<span class="flex-1 truncate font-medium">{p.data.name ?? 'Unnamed'}</span>
										<span class="text-[11px] text-[var(--ui-text-dimmed)]"
											>Stock: {(p.data as any).stockLevel ?? 0}</span
										>
									</button>
								{/each}
							</div>
						{/if}
					</div>
				{/if}
			</label>
			<div class="grid grid-cols-2 gap-3">
				<label class="block"
					><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>{t('common.type')}</span
					>
					<div class="segmented flex gap-1 p-1">
						<button
							type="button"
							onclick={() => (aType = 'increase')}
							class="flex-1 rounded-md px-3 py-1.5 text-[12px] font-semibold {aType === 'increase'
								? 'bg-[var(--ui-bg-elevated)]'
								: 'text-[var(--ui-text-muted)]'}">{t('common.increase')}</button
						>
						<button
							type="button"
							onclick={() => (aType = 'decrease')}
							class="flex-1 rounded-md px-3 py-1.5 text-[12px] font-semibold {aType === 'decrease'
								? 'bg-[var(--ui-bg-elevated)]'
								: 'text-[var(--ui-text-muted)]'}">{t('common.decrease')}</button
						>
					</div>
				</label>
				<label class="block"
					><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>{t('common.quantity')}</span
					><Input bind:value={aQty} type="number" min="0" class="w-full" /></label
				>
			</div>
			<label class="block"
				><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
					>{t('common.reason')}</span
				><Input bind:value={aReason} class="w-full" /></label
			>
		</div>
	{:else if dlgKind === 'suppliers'}
		<div class="space-y-3">
			<label class="block"
				><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">{t('common.name')}</span
				><Input bind:value={sName} class="w-full" /></label
			>
			<div class="grid grid-cols-2 gap-3">
				<label class="block"
					><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>{t('common.contact')}</span
					><Input bind:value={sContact} class="w-full" /></label
				>
				<label class="block"
					><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>{t('common.phone')}</span
					><Input bind:value={sPhone} class="w-full" /></label
				>
			</div>
			<label class="block"
				><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
					>Payment terms</span
				><Input bind:value={sTerms} placeholder="Net 30" class="w-full" /></label
			>
		</div>
	{:else}
		<div class="space-y-3">
			<label class="block"
				><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
					>{t('common.supplier')}</span
				><Input bind:value={poSupplier} list="sups" class="w-full" /><datalist id="sups"
					>{#each suppliers as s (s.id)}<option value={s.data.name}></option>{/each}</datalist
				></label
			>
			<label class="block"
				><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
					>Lines (one per line: <code>Name xQty@Price</code>)</span
				><Input
					bind:value={poLines}
					textarea
					placeholder="Coffee Beans x10@35000&#10;Milk x20@8000"
					class="w-full font-mono text-[12px]"
				/></label
			>
		</div>
	{/if}
	{#snippet footer()}<Button color="neutral" variant="ghost" onclick={() => (dlgOpen = false)}
			>{t('common.cancel')}</Button
		><Button color="primary" icon="lucide:check" onclick={save}>{t('common.save')}</Button>{/snippet}
</Dialog>

<RawDataDialog bind:open={rawOpen} data={rawItem} title="Inventory Raw Data" />
