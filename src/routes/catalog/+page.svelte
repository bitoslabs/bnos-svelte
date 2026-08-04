<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import MediaImageInput from '$lib/components/media/MediaImageInput.svelte';
	import MediaImageGallery from '$lib/components/media/MediaImageGallery.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Menu from '$lib/components/ui/Menu.svelte';
	import MenuItem from '$lib/components/ui/MenuItem.svelte';
	import MenuDivider from '$lib/components/ui/MenuDivider.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import ListToolbar from '$lib/components/list/ListToolbar.svelte';
	import SortableTh from '$lib/components/list/SortableTh.svelte';
	import Pagination from '$lib/components/list/Pagination.svelte';
	import RowActions, { type RowAction } from '$lib/components/list/RowActions.svelte';
	import RawDataDialog from '$lib/components/ui/RawDataDialog.svelte';
	import ProductDetail from '$lib/components/product/ProductDetail.svelte';
	import StockBadge from '$lib/components/ui/StockBadge.svelte';
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
		type Product,
		type ProductVariant,
		type CatalogCategory,
		type CatalogUnit,
		type ModifierGroup
	} from '$lib/domain';

	type Tab = 'products' | 'categories' | 'units' | 'modifiers' | 'bundles';
	let tab = $state<Tab>('products');

	onMount(() => {
		loadBundles();
		dataSync.pageSync([TYPE.product, TYPE.category, TYPE.unit, TYPE.modifierGroup], {
			scope: 'catalog'
		});
	});

	// ── Bundles (localStorage) ──
	const BUNDLES_KEY = 'bnos-os:bundles';
	type BundleGroup = {
		id: string;
		name: string;
		min: number;
		max: number;
		productIds: string[];
		includedQuantity: number;
	};
	type Bundle = {
		id: string;
		name: string;
		description?: string;
		image?: string;
		priceMode: 'fixed' | 'sum_components' | 'discounted';
		fixedPrice?: number;
		discountPercent?: number;
		sortOrder: number;
		status: 'active' | 'inactive';
		groups: BundleGroup[];
	};
	let bundles = $state<Bundle[]>([]);
	let bundleSearch = $state('');

	function loadBundles() {
		try {
			const raw = localStorage.getItem(BUNDLES_KEY);
			bundles = raw ? JSON.parse(raw) : [];
		} catch {
			bundles = [];
		}
	}
	function saveBundles() {
		localStorage.setItem(BUNDLES_KEY, JSON.stringify(bundles));
	}

	const filteredBundles = $derived.by(() => {
		const q = bundleSearch.toLowerCase();
		return bundles
			.filter((b) => !q || b.name.toLowerCase().includes(q))
			.sort((a, b) => a.sortOrder - b.sortOrder);
	});

	// Bundle form state
	let bDlgOpen = $state(false);

	// Raw data viewer
	let rawOpen = $state(false);
	let rawItem = $state<any>(null);

	// Product detail slideover
	let detailProduct = $state<{ id: string; data: Record<string, unknown> } | null>(null);
	let detailOpen = $state(false);

	// Quick stock adjust from catalog
	let quickAdjustOpen = $state(false);
	let quickAdjustId = $state('');
	let quickAdjustName = $state('');
	let quickAdjustQty = $state(1);
	let quickAdjustDir = $state<'increase' | 'decrease'>('increase');
	let quickAdjustReason = $state('');

	function openQuickAdjustFromCatalog(id: string) {
		const p = glo.get(TYPE.product, id);
		if (!p) return;
		quickAdjustId = id;
		quickAdjustName = String((p.data as Record<string, unknown>).name ?? 'Unknown');
		quickAdjustQty = 1;
		quickAdjustDir = 'increase';
		quickAdjustReason = '';
		quickAdjustOpen = true;
	}

	async function saveQuickAdjust() {
		const product = glo.get(TYPE.product, quickAdjustId);
		if (!product) return;
		await glo.upsert(
			TYPE.adjustment,
			{
				productId: quickAdjustId,
				productName: quickAdjustName,
				type: quickAdjustDir,
				quantity: Math.abs(quickAdjustQty),
				reason: quickAdjustReason.trim() || 'Manual adjustment',
				occurredAt: new Date().toISOString()
			},
			{ id: newRecordId('stock-adjustment') }
		);
		const current = ((product.data as Record<string, unknown>).stockLevel ?? 0) as number;
		const newStock =
			quickAdjustDir === 'increase'
				? current + Math.abs(quickAdjustQty)
				: Math.max(0, current - Math.abs(quickAdjustQty));
		await glo.upsert(
			TYPE.product,
			{ ...(product.data as Record<string, unknown>), stockLevel: newStock },
			{ id: product.id }
		);
		toast.success('Stock adjusted');
		quickAdjustOpen = false;
	}
	let bEditingId = $state<string | null>(null);
	let bName = $state('');
	let bDesc = $state('');
	let bImage = $state('');
	let bPriceMode = $state<'fixed' | 'sum_components' | 'discounted'>('fixed');
	let bFixedPrice = $state<number | ''>('');
	let bDiscountPercent = $state<number | ''>('');
	let bSortOrder = $state(0);
	let bGroups = $state<BundleGroup[]>([]);

	function openBundleCreate() {
		bEditingId = null;
		bName = '';
		bDesc = '';
		bImage = '';
		bPriceMode = 'fixed';
		bFixedPrice = '';
		bDiscountPercent = '';
		bSortOrder = bundles.length + 1;
		bGroups = [];
		bDlgOpen = true;
	}
	function openBundleEdit(b: Bundle) {
		bEditingId = b.id;
		bName = b.name;
		bDesc = b.description ?? '';
		bImage = b.image ?? '';
		bPriceMode = b.priceMode;
		bFixedPrice = b.fixedPrice ?? '';
		bDiscountPercent = b.discountPercent ?? '';
		bSortOrder = b.sortOrder;
		bGroups = b.groups.map((g) => ({ ...g }));
		bDlgOpen = true;
	}
	function addBundleGroup() {
		bGroups = [
			...bGroups,
			{
				id: 'grp-' + Date.now().toString().slice(-6),
				name: '',
				min: 1,
				max: 1,
				productIds: [],
				includedQuantity: 1
			}
		];
	}
	function removeBundleGroup(idx: number) {
		bGroups = bGroups.filter((_, i) => i !== idx);
	}
	function toggleBundleProduct(group: BundleGroup, productId: string) {
		if (group.productIds.includes(productId)) {
			group.productIds = group.productIds.filter((id) => id !== productId);
		} else {
			group.productIds = [...group.productIds, productId];
		}
		bGroups = [...bGroups];
	}
	function saveBundle() {
		if (!bName.trim()) return toast.warning('Name required');
		const groups = bGroups.filter((g) => g.name.trim());
		const payload: Bundle = {
			id: bEditingId ?? 'bnd-' + Date.now().toString().slice(-8),
			name: bName.trim(),
			description: bDesc.trim() || undefined,
			image: bImage.trim() || undefined,
			priceMode: bPriceMode,
			fixedPrice:
				bPriceMode === 'fixed'
					? typeof bFixedPrice === 'number'
						? bFixedPrice
						: Number(bFixedPrice) || 0
					: undefined,
			discountPercent:
				bPriceMode === 'discounted'
					? typeof bDiscountPercent === 'number'
						? bDiscountPercent
						: Number(bDiscountPercent) || 0
					: undefined,
			sortOrder: bSortOrder,
			status: 'active',
			groups
		};
		if (bEditingId) {
			const idx = bundles.findIndex((b) => b.id === bEditingId);
			if (idx >= 0) {
				bundles[idx] = { ...bundles[idx], ...payload };
			}
			toast.success('Bundle updated');
		} else {
			bundles = [payload, ...bundles];
			toast.success('Bundle created');
		}
		saveBundles();
		bDlgOpen = false;
	}
	function deleteBundle(id: string) {
		bundles = bundles.filter((b) => b.id !== id);
		saveBundles();
		toast.info('Bundle deleted');
	}
	function toggleBundleStatus(id: string) {
		const b = bundles.find((x) => x.id === id);
		if (!b) return;
		b.status = b.status === 'active' ? 'inactive' : 'active';
		saveBundles();
		bundles = [...bundles];
	}

	// Bundle price previews
	const bundleRegularPrice = $derived.by(() => {
		let total = 0;
		for (const g of bGroups) {
			if (g.productIds.length > 0) {
				const p = products.find((x) => x.id === g.productIds[0]);
				if (p) total += ((p.data as any).price ?? 0) * g.includedQuantity;
			}
		}
		return total;
	});
	const bundleFinalPrice = $derived.by(() => {
		if (bPriceMode === 'fixed')
			return typeof bFixedPrice === 'number' ? bFixedPrice : Number(bFixedPrice) || 0;
		if (bPriceMode === 'discounted')
			return (
				bundleRegularPrice *
				(1 -
					(typeof bDiscountPercent === 'number'
						? bDiscountPercent
						: Number(bDiscountPercent) || 0) /
						100)
			);
		return bundleRegularPrice;
	});

	const currency = $derived(tenant.state.currency);
	const tabs: { id: Tab; label: string; icon: string; count: () => number }[] = [
		{
			id: 'products',
			label: 'Products',
			icon: 'lucide:package',
			count: () => glo.all(TYPE.product).length
		},
		{
			id: 'categories',
			label: 'Categories',
			icon: 'lucide:folder',
			count: () => glo.all(TYPE.category).length
		},
		{ id: 'units', label: 'Units', icon: 'lucide:ruler', count: () => glo.all(TYPE.unit).length },
		{
			id: 'modifiers',
			label: 'Modifiers',
			icon: 'lucide:sliders-horizontal',
			count: () => glo.all(TYPE.modifierGroup).length
		},
		{
			id: 'bundles',
			label: 'Bundles',
			icon: 'lucide:package-open',
			count: () => bundles.length
		}
	];

	// ── Products ──
	const products = $derived(glo.all<Product, typeof TYPE.product>(TYPE.product));
	const prodCtrl = createListControls<{ id: string; data: Product }>({
		items: () => products,
		search: (p, q) => ((p.data as any).name ?? '').toLowerCase().includes(q),
		sortOptions: () => [
			{ key: 'name', label: 'Name', value: (p) => (p.data as any).name ?? '~' },
			{ key: 'price', label: 'Price', value: (p) => (p.data as any).price ?? 0 },
			{ key: 'category', label: 'Category', value: (p) => (p.data as any).categoryId ?? '~' }
		],
		defaultSortKey: 'name',
		defaultViewMode: 'table',
		storageKey: 'catalog-products'
	});

	// ── Categories ──
	const categories = $derived(glo.all<CatalogCategory, typeof TYPE.category>(TYPE.category));
	const catCtrl = createListControls<{ id: string; data: CatalogCategory }>({
		items: () => categories,
		search: (c, q) => (c.data.name ?? '').toLowerCase().includes(q),
		sortOptions: () => [
			{ key: 'name', label: 'Name', value: (c) => c.data.name },
			{ key: 'order', label: 'Order', value: (c) => c.data.sortOrder ?? 0 }
		],
		defaultSortKey: 'name',
		defaultViewMode: 'table',
		storageKey: 'catalog-categories'
	});

	// ── Units ──
	const units = $derived(glo.all<CatalogUnit, typeof TYPE.unit>(TYPE.unit));
	const unitCtrl = createListControls<{ id: string; data: CatalogUnit }>({
		items: () => units,
		search: (u, q) =>
			(u.data.name ?? '').toLowerCase().includes(q) ||
			(u.data.symbol ?? '').toLowerCase().includes(q),
		sortOptions: () => [
			{ key: 'name', label: 'Name', value: (u) => (u.data as any).name },
			{ key: 'symbol', label: 'Symbol', value: (u) => (u.data as any).symbol }
		],
		defaultSortKey: 'name',
		defaultViewMode: 'table',
		storageKey: 'catalog-units'
	});

	// ── Modifiers ──
	const modifiers = $derived(glo.all<ModifierGroup, typeof TYPE.modifierGroup>(TYPE.modifierGroup));
	const modCtrl = createListControls<{ id: string; data: ModifierGroup }>({
		items: () => modifiers,
		search: (m, q) => (m.data.name ?? '').toLowerCase().includes(q),
		sortOptions: () => [{ key: 'name', label: 'Name', value: (m) => m.data.name }],
		defaultSortKey: 'name',
		defaultViewMode: 'table',
		storageKey: 'catalog-modifiers'
	});

	// ── Create/Edit dialogs + forms ──
	let dlgOpen = $state(false);
	let dlgKind = $state<Tab>('products');
	let editingId = $state<string | null>(null);

	// product form
	let pName = $state('');
	let pPrice = $state<number | ''>('');
	let pCostPrice = $state<number | ''>('');
	let pCompareAtPrice = $state<number | ''>('');
	let pCat = $state('');
	let pSku = $state('');
	let pBarcode = $state('');
	let pDesc = $state('');
	let pImage = $state('');
	let pImages = $state<string[]>([]);
	let pUnitId = $state('');
	let pVariants = $state<{ name: string; price: number }[]>([]);
	let pVariantName = $state('');
	let pVariantPrice = $state<number | ''>('');
	let pModGroupIds = $state<string[]>([]);
	let pTrackInv = $state(false);
	let pLowStock = $state<number | ''>('');
	let pDenyOos = $state(false);
	let pIsPublic = $state(true);
	let pAvailable = $state(true);
	let pPrepTime = $state<number | ''>('');
	let pSortOrder = $state<number | ''>('');
	let pTaxInclusive = $state(false);
	// category form
	let cName = $state('');
	let cDesc = $state('');
	let cIcon = $state('');
	let cColor = $state('');
	let cOrder = $state(0);
	let cStatus = $state<'active' | 'inactive'>('active');
	// unit form
	let uName = $state('');
	let uSymbol = $state('');
	let uType = $state<CatalogUnit['type']>('count');
	let uBaseUnitId = $state('');
	let uConversionFactor = $state<number | ''>('');
	// modifier form
	let mName = $state('');
	let mOpt = $state('');

	const isEditing = $derived(editingId !== null);
	const dlgTitle = $derived(
		(isEditing ? 'Edit ' : 'Add ') +
			(dlgKind === 'products'
				? 'product'
				: dlgKind === 'categories'
					? 'category'
					: dlgKind === 'units'
						? 'unit'
						: dlgKind === 'modifiers'
							? 'modifier group'
							: 'item')
	);

	/** Dynamic dialog width: product editor is wide (gallery + details),
	 *  the lighter forms stay compact. */
	const dlgSize = $derived(
		dlgKind === 'products' ? 'xl' : dlgKind === 'modifiers' ? 'md' : 'sm'
	);

	function openCreate(t: Tab) {
		dlgKind = t;
		editingId = null;
		// product form
		pName = pCat = pSku = pBarcode = pDesc = pImage = pUnitId = '';
		pImages = [];
		pPrice = pCostPrice = pCompareAtPrice = '';
		pVariants = [];
		pVariantName = '';
		pVariantPrice = '';
		pModGroupIds = [];
		pTrackInv = false;
		pLowStock = '';
		pDenyOos = false;
		pIsPublic = true;
		pAvailable = true;
		pPrepTime = '';
		pSortOrder = '';
		pTaxInclusive = false;
		// category form
		cName = cDesc = cIcon = cColor = '';
		cOrder = 0;
		cStatus = 'active';
		// unit form
		uName = uSymbol = uBaseUnitId = '';
		uType = 'count';
		uConversionFactor = '';
		// modifier form
		mName = mOpt = '';
		dlgOpen = true;
	}

	function openEditProduct(id: string) {
		const obj = glo.get(TYPE.product, id);
		if (!obj) return toast.warning('Product not found');
		const d = obj.data as any;
		dlgKind = 'products';
		editingId = id;
		pName = d.name ?? '';
		pPrice = d.price ?? '';
		pCostPrice = d.costPrice ?? '';
		pCompareAtPrice = d.compareAtPrice ?? '';
		pCat = d.categoryId ?? '';
		pSku = d.sku ?? '';
		pBarcode = d.barcode ?? '';
		pDesc = d.description ?? '';
		pImage = d.image ?? '';
		pImages = Array.isArray(d.images) ? d.images : (d.image ? [d.image] : []);
		pUnitId = d.unitId ?? '';
		pVariants = (d.variants ?? []).map((v: any) => ({
			name: v.name ?? v.shortName ?? '',
			price: v.priceModifier ?? 0
		}));
		pVariantName = '';
		pVariantPrice = '';
		pModGroupIds = d.modifierGroupIds ?? [];
		pTrackInv = d.trackInventory ?? false;
		pLowStock = d.inventory?.lowStockThreshold ?? '';
		pDenyOos = d.inventory?.denySaleWhenOutOfStock ?? false;
		pIsPublic = d.isPublic ?? true;
		pAvailable = d.available ?? true;
		pPrepTime = d.prepTime ?? '';
		pSortOrder = d.sortOrder ?? '';
		pTaxInclusive = d.taxInclusive ?? false;
		dlgOpen = true;
	}

	function openEditCategory(id: string) {
		const obj = glo.get(TYPE.category, id);
		if (!obj) return toast.warning('Category not found');
		const d = obj.data as any;
		dlgKind = 'categories';
		editingId = id;
		cName = d.name ?? '';
		cDesc = d.description ?? '';
		cIcon = d.icon ?? '';
		cColor = d.color ?? '';
		cOrder = d.sortOrder ?? 0;
		cStatus = d.active === false ? 'inactive' : 'active';
		dlgOpen = true;
	}

	function openEditUnit(id: string) {
		const obj = glo.get(TYPE.unit, id);
		if (!obj) return toast.warning('Unit not found');
		const d = obj.data as any;
		dlgKind = 'units';
		editingId = id;
		uName = d.name ?? '';
		uSymbol = d.symbol ?? '';
		uType = d.type ?? 'count';
		uBaseUnitId = d.baseUnitId ?? '';
		uConversionFactor = d.conversionFactor ?? '';
		dlgOpen = true;
	}

	function openEditModifier(id: string) {
		const obj = glo.get(TYPE.modifierGroup, id);
		if (!obj) return toast.warning('Modifier group not found');
		const d = obj.data as any;
		dlgKind = 'modifiers';
		editingId = id;
		mName = d.name ?? '';
		mOpt = (d.options ?? d.modifiers ?? []).map((o: any) => o.name).join(', ');
		dlgOpen = true;
	}

	async function save() {
		try {
			if (dlgKind === 'products') {
				if (!pName.trim()) return toast.warning('Name required');
				const variants: ProductVariant[] = pVariants.map((v, i) => ({
					id: `${pName
						.trim()
						.slice(0, 12)
						.toLowerCase()
						.replace(/[^a-z0-9]+/g, '-')}-${i + 1}`,
					name: v.name,
					shortName: v.name,
					priceModifier: v.price,
					priceModifierType: 'fixed',
					available: true
				}));
				const payload: Record<string, any> = {
					name: pName.trim(),
					price: typeof pPrice === 'number' ? pPrice : Number(pPrice) || 0,
					currency,
					categoryId: pCat.trim() || undefined,
					sku: pSku.trim() || undefined,
					barcode: pBarcode.trim() || undefined,
					description: pDesc.trim() || undefined,
					image: (pImages[0] ?? pImage.trim()) || undefined,
				images: pImages.length ? pImages : undefined,
					unitId: pUnitId.trim() || undefined,
					costPrice:
						typeof pCostPrice === 'number'
							? pCostPrice
							: pCostPrice !== ''
								? Number(pCostPrice) || undefined
								: undefined,
					compareAtPrice:
						typeof pCompareAtPrice === 'number'
							? pCompareAtPrice
							: pCompareAtPrice !== ''
								? Number(pCompareAtPrice) || undefined
								: undefined,
					status: 'active',
					available: pAvailable,
					isPublic: pIsPublic,
					type: variants.length ? 'variable' : 'standard',
					hasVariants: variants.length > 0,
					variants: variants.length ? variants : undefined,
					modifierGroupIds: pModGroupIds.length ? pModGroupIds : undefined,
					trackInventory: pTrackInv,
					prepTime:
						typeof pPrepTime === 'number'
							? pPrepTime
							: pPrepTime !== ''
								? Number(pPrepTime) || undefined
								: undefined,
					sortOrder:
						typeof pSortOrder === 'number'
							? pSortOrder
							: pSortOrder !== ''
								? Number(pSortOrder) || undefined
								: undefined,
					taxInclusive: pTaxInclusive,
					inventory: pTrackInv
						? {
								lowStockThreshold: typeof pLowStock === 'number' ? pLowStock : undefined,
								denySaleWhenOutOfStock: pDenyOos,
								allowBackorder: !pDenyOos
							}
						: undefined,
					stockLevel: pTrackInv ? 0 : undefined
				};
				await glo.upsert<Product>(TYPE.product, payload, {
					id: editingId ?? newRecordId('product')
				});
			} else if (dlgKind === 'categories') {
				if (!cName.trim()) return toast.warning('Name required');
				await glo.upsert<CatalogCategory>(
					TYPE.category,
					{
						name: cName.trim(),
						description: cDesc.trim() || undefined,
						icon: cIcon.trim() || undefined,
						color: cColor.trim() || undefined,
						sortOrder: cOrder,
						active: cStatus === 'active',
						status: cStatus
					},
					{ id: editingId ?? newRecordId('category') }
				);
			} else if (dlgKind === 'units') {
				if (!uName.trim() || !uSymbol.trim()) return toast.warning('Name and symbol required');
				await glo.upsert<CatalogUnit>(
					TYPE.unit,
					{
						name: uName.trim(),
						symbol: uSymbol.trim(),
						abbreviation: uSymbol.trim(),
						type: uType,
						baseUnitId: uBaseUnitId.trim() || undefined,
						conversionFactor:
							typeof uConversionFactor === 'number'
								? uConversionFactor
								: uConversionFactor !== ''
									? Number(uConversionFactor) || undefined
									: undefined
					},
					{ id: editingId ?? newRecordId('unit') }
				);
			} else {
				if (!mName.trim()) return toast.warning('Name required');
				const opts = mOpt
					.split(',')
					.map((s) => s.trim())
					.filter(Boolean)
					.map((name) => ({ name }));
				await glo.upsert<ModifierGroup>(
					TYPE.modifierGroup,
					{
						name: mName.trim(),
						options: opts,
						singleChoice: true,
						status: 'active'
					},
					{ id: editingId ?? newRecordId('modifier-group') }
				);
			}
			toast.success(isEditing ? 'Updated' : 'Saved');
			dlgOpen = false;
			editingId = null;
		} catch (e) {
			toast.error('Save failed', e instanceof Error ? e.message : undefined);
		}
	}

	function addVariant() {
		if (!pVariantName.trim()) return;
		pVariants = [
			...pVariants,
			{
				name: pVariantName.trim(),
				price: typeof pVariantPrice === 'number' ? pVariantPrice : Number(pVariantPrice) || 0
			}
		];
		pVariantName = '';
		pVariantPrice = '';
	}
	function removeVariant(i: number) {
		pVariants = pVariants.filter((_, idx) => idx !== i);
	}
	function toggleModGroup(id: string) {
		pModGroupIds = pModGroupIds.includes(id)
			? pModGroupIds.filter((x) => x !== id)
			: [...pModGroupIds, id];
	}

	function remove(t: string, id: string) {
		glo.remove(t, id);
		toast.info('Removed');
	}

	// ── Export / Import ──
	function exportCatalog() {
		const data = {
			products: products.map((p) => ({ id: p.id, ...p.data })),
			categories: categories.map((c) => ({ id: c.id, ...c.data })),
			units: units.map((u) => ({ id: u.id, ...u.data })),
			modifiers: modifiers.map((m) => ({ id: m.id, ...m.data })),
			bundles
		};
		const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `bnos-catalog-${new Date().toISOString().slice(0, 10)}.json`;
		a.click();
		URL.revokeObjectURL(url);
		toast.success('Catalog exported');
	}

	function importCatalog() {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = 'application/json';
		input.onchange = async () => {
			const file = input.files?.[0];
			if (!file) return;
			try {
				const data = JSON.parse(await file.text());
				if (data.products) {
					for (const p of data.products) {
						const { id, ...payload } = p;
						await glo.upsert(TYPE.product, payload, {
							id: typeof id === 'string' ? id : newRecordId('product')
						});
					}
				}
				if (data.categories) {
					for (const c of data.categories) {
						const { id, ...payload } = c;
						await glo.upsert(TYPE.category, payload, {
							id: typeof id === 'string' ? id : newRecordId('category')
						});
					}
				}
				toast.success('Catalog imported');
			} catch (e) {
				toast.error('Import failed', e instanceof Error ? e.message : undefined);
			}
		};
		input.click();
	}
	function catName(id: string): string {
		const c = glo.get(TYPE.category, id);
		return (c?.data as any)?.name ?? id;
	}
	async function toggleProductActive(id: string, active: boolean) {
		const obj = glo.get(TYPE.product, id);
		if (!obj) return;
		await glo.upsert(
			TYPE.product,
			{ ...(obj.data as any), available: active, status: active ? 'active' : 'inactive' },
			{ id }
		);
		toast.success(active ? 'Product activated' : 'Product deactivated');
	}
	function prodActions(p: { id: string }): RowAction[][] {
		return [
			[
				{
					label: 'View detail',
					icon: 'lucide:eye',
					onSelect: () => {
						const obj = glo.get(TYPE.product, p.id);
						if (obj) {
							detailProduct = { id: obj.id, data: obj.data as Record<string, unknown> };
							detailOpen = true;
						}
					}
				},
				{
					label: 'Edit',
					icon: 'lucide:pencil',
					onSelect: () => openEditProduct(p.id)
				},
				{
					label: 'Adjust stock',
					icon: 'lucide:arrow-up-down',
					onSelect: () => openQuickAdjustFromCatalog(p.id)
				},
				{
					label: 'Duplicate',
					icon: 'lucide:copy',
					onSelect: async () => {
						const product = glo.get(TYPE.product, p.id);
						if (!product) return;
						const data = {
							...(product.data as Record<string, unknown>),
							name: String((product.data as Record<string, unknown>).name ?? 'Product') + ' (copy)',
							stockLevel: 0
						};
						await glo.upsert(TYPE.product, data, { id: newRecordId('product') });
						toast.success('Product duplicated');
					}
				},
				{
					label: 'View raw',
					icon: 'lucide:code',
					onSelect: () => {
						rawItem = glo.get(TYPE.product, p.id);
						rawOpen = true;
					}
				}
			],
			[
				{
					label: 'Delete',
					icon: 'lucide:trash-2',
					danger: true,
					onSelect: () => remove(TYPE.product, p.id)
				}
			]
		];
	}
	function catActions(c: { id: string }): RowAction[][] {
		return [
			[
				{
					label: 'Edit',
					icon: 'lucide:pencil',
					onSelect: () => openEditCategory(c.id)
				}
			],
			[
				{
					label: 'Delete',
					icon: 'lucide:trash-2',
					danger: true,
					onSelect: () => remove(TYPE.category, c.id)
				}
			]
		];
	}
	function unitActions(u: { id: string }): RowAction[][] {
		return [
			[
				{
					label: 'Edit',
					icon: 'lucide:pencil',
					onSelect: () => openEditUnit(u.id)
				}
			],
			[
				{
					label: 'Delete',
					icon: 'lucide:trash-2',
					danger: true,
					onSelect: () => remove(TYPE.unit, u.id)
				}
			]
		];
	}
	function modActions(m: { id: string }): RowAction[][] {
		return [
			[
				{
					label: 'Edit',
					icon: 'lucide:pencil',
					onSelect: () => openEditModifier(m.id)
				}
			],
			[
				{
					label: 'Delete',
					icon: 'lucide:trash-2',
					danger: true,
					onSelect: () => remove(TYPE.modifierGroup, m.id)
				}
			]
		];
	}
</script>

<svelte:head><title>BNOS · Catalog</title></svelte:head>

<div class="space-y-4">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h1 class="font-display text-xl font-bold tracking-tight">Catalog</h1>
			<p class="text-[12.5px] text-[var(--ui-text-muted)]">
				Products, categories, units, modifiers & bundles
			</p>
		</div>
		<div class="flex items-center gap-2">
			<!-- More actions dropdown -->
			<Menu id="catalog-header-more" placement="bottom-end" width="md">
				{#snippet trigger()}
					<Button color="neutral" variant="ghost" size="icon-sm" title="More options">
						<Icon name="lucide:more-horizontal" class="size-4" />
					</Button>
				{/snippet}
				<MenuItem icon="lucide:download" onclick={exportCatalog}>Export catalog</MenuItem>
				<MenuItem icon="lucide:upload" onclick={importCatalog}>Import catalog</MenuItem>
				<MenuDivider />
				<MenuItem icon="lucide:package-open" onclick={() => openBundleCreate()}
					>Quick add bundle</MenuItem
				>
			</Menu>
			<Button
				color="primary"
				icon="lucide:plus"
				title="Add new item"
				onclick={() => (tab === 'bundles' ? openBundleCreate() : openCreate(tab))}
				>Add {tab === 'products'
					? 'product'
					: tab === 'categories'
						? 'category'
						: tab === 'units'
							? 'unit'
							: tab === 'modifiers'
								? 'modifier'
								: 'bundle'}</Button
			>
		</div>
	</div>

	<!-- tabs -->
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
				<Icon name={t.icon} class="size-3.5" />{t.label}
				<span class="rounded bg-[var(--ui-bg-accented)] px-1.5 text-[10px] tabular-nums"
					>{t.count()}</span
				>
			</button>
		{/each}
	</div>

	<!-- PRODUCTS -->
	{#if tab === 'products'}
		{#if products.length || prodCtrl.search}
			<ListToolbar
				bind:search={prodCtrl.search}
				bind:sortKey={prodCtrl.sortKey}
				bind:sortDir={prodCtrl.sortDir}
				bind:viewMode={prodCtrl.viewMode}
				sortItems={prodCtrl.sortItems}
				applySort={prodCtrl.applySort}
				setViewMode={prodCtrl.setViewMode}
				searchPlaceholder="Search products…"
			/>
		{/if}
		{#if prodCtrl.list.length === 0}
			<EmptyState
				icon="lucide:package"
				title="No products"
				description="Add your first product to start selling."
			>
				{#snippet actions()}<Button
						color="primary"
						size="sm"
						icon="lucide:plus"
						onclick={() => openCreate('products')}>Add product</Button
					>{/snippet}
			</EmptyState>
		{:else}
			<div class="data-panel">
				<div class="overflow-x-auto">
					<table class="table-surface w-full text-left">
						<thead
							><tr>
								<SortableTh
									column="name"
									active={prodCtrl.sortKey === 'name'}
									direction={prodCtrl.sortDir}
									applySort={prodCtrl.applySort}>Product</SortableTh
								>
								<SortableTh
									column="category"
									active={prodCtrl.sortKey === 'category'}
									direction={prodCtrl.sortDir}
									applySort={prodCtrl.applySort}>Category</SortableTh
								>
								<SortableTh
									column="price"
									active={prodCtrl.sortKey === 'price'}
									direction={prodCtrl.sortDir}
									align="right"
									applySort={prodCtrl.applySort}>Price</SortableTh
								>
								<SortableTh
									column="promotion"
									active={prodCtrl.sortKey === 'promotion'}
									direction={prodCtrl.sortDir}
									applySort={prodCtrl.applySort}>Promotion</SortableTh
								>
								<SortableTh
									column="status"
									active={prodCtrl.sortKey === 'status'}
									direction={prodCtrl.sortDir}
									align="center"
									applySort={prodCtrl.applySort}>Status</SortableTh
								>
								<th class="w-10 px-5 py-2.5"></th>
							</tr></thead
						>
						<tbody class="divide-y divide-[var(--ui-border-muted)] text-[13px]">
							{#each prodCtrl.pagedList as p (p.id)}
								<tr>
									<td class="px-5 py-3">
										<div class="flex items-center gap-3">
											<div
												class="size-10 shrink-0 overflow-hidden rounded-lg bg-[var(--ui-bg-accented)]"
											>
												{#if (p.data as any).image}
													<img
														src={(p.data as any).image}
														alt={String((p.data as any).name ?? '')}
														class="size-full object-cover"
													/>
												{:else}
													<div class="flex size-full items-center justify-center">
														<Icon
															name="lucide:package"
															class="size-4 text-[var(--ui-text-dimmed)]"
														/>
													</div>
												{/if}
											</div>
											<div>
												<div class="font-semibold">{p.data.name}</div>
												{#if p.data.sku}<div
														class="font-mono text-[11px] text-[var(--ui-text-dimmed)]"
													>
														{p.data.sku}
													</div>{/if}
												<div class="mt-0.5 flex flex-wrap gap-1">
													<span
														class="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold {(
															p.data as any
														).isPublic !== false
															? 'bg-primary-50 text-primary-600 dark:bg-primary-500/10 dark:text-primary-400'
															: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400'}"
													>
														<Icon
															name={(p.data as any).isPublic !== false
																? 'lucide:globe'
																: 'lucide:lock'}
															class="size-2.5"
														/>
														{(p.data as any).isPublic !== false ? 'Public' : 'Private'}
													</span>
													{#if p.data.hasVariants}<Badge color="info"
															>{p.data.variants?.length ?? 0} variants</Badge
														>{/if}
													{#if p.data.modifierGroupIds?.length}<Badge color="info"
															>{p.data.modifierGroupIds.length} mods</Badge
														>{/if}
													{#if p.data.trackInventory}<StockBadge
															level={Number((p.data as any).stockLevel ?? 0)}
															threshold={Number((p.data as any).inventory?.lowStockThreshold ?? 5)}
														/>{/if}
												</div>
											</div>
										</div>
									</td>
									<td class="px-5 py-3"
										>{#if (p.data as any).categoryId}<Badge
												>{catName((p.data as any).categoryId)}</Badge
											>{:else}<span class="text-[var(--ui-text-dimmed)]">—</span>{/if}</td
									>
									<td class="px-5 py-3 text-right">
										<div class="font-semibold tabular-nums">
											{formatMoney(
												(p.data as any).price ?? 0,
												(p.data as any).currency ?? currency
											)}
										</div>
										{#if (p.data as any).compareAtPrice && (p.data as any).compareAtPrice > ((p.data as any).price ?? 0)}
											<div
												class="text-[11px] text-[var(--ui-text-dimmed)] tabular-nums line-through"
											>
												{formatMoney(
													(p.data as any).compareAtPrice,
													(p.data as any).currency ?? currency
												)}
											</div>
										{/if}
									</td>
									<td class="px-5 py-3">
										{#if (p.data as any).promotionIds?.length || (p.data as any).promotion?.promotionIds?.length}
											<span
												class="inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400"
											>
												On sale
											</span>
										{:else}
											<span class="text-xs text-[var(--ui-text-dimmed)]">—</span>
										{/if}
									</td>
									<td class="px-5 py-3 text-center">
										<button
											class="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold {(
												p.data as any
											).available !== false
												? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400'
												: 'bg-gray-100 text-gray-400 dark:bg-gray-800'}"
											onclick={() => toggleProductActive(p.id, (p.data as any).available === false)}
										>
											{(p.data as any).available !== false ? 'Active' : 'Inactive'}
										</button>
									</td>
									<td class="px-5 py-3 text-right"><RowActions actions={prodActions(p)} /></td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				<Pagination controls={prodCtrl} />
			</div>
		{/if}
	{:else if tab === 'categories'}
		{#if categories.length || catCtrl.search}
			<ListToolbar
				bind:search={catCtrl.search}
				bind:sortKey={catCtrl.sortKey}
				bind:sortDir={catCtrl.sortDir}
				viewMode={catCtrl.viewMode}
				sortItems={catCtrl.sortItems}
				allowViewModes={['table']}
				applySort={catCtrl.applySort}
				searchPlaceholder="Search categories…"
			/>
		{/if}
		{#if catCtrl.list.length === 0}
			<EmptyState
				icon="lucide:folder"
				title="No categories"
				description="Group your products with categories."
			>
				{#snippet actions()}<Button
						color="primary"
						size="sm"
						icon="lucide:plus"
						onclick={() => openCreate('categories')}>Add category</Button
					>{/snippet}
			</EmptyState>
		{:else}
			<div class="data-panel">
				<table class="table-surface w-full text-left">
					<thead
						><tr>
							<SortableTh
								column="name"
								active={catCtrl.sortKey === 'name'}
								direction={catCtrl.sortDir}
								applySort={catCtrl.applySort}>Category</SortableTh
							>
							<SortableTh
								column="order"
								active={catCtrl.sortKey === 'order'}
								direction={catCtrl.sortDir}
								align="right"
								applySort={catCtrl.applySort}>Order</SortableTh
							>
							<th class="w-10 px-5 py-2.5"></th>
						</tr></thead
					>
					<tbody class="divide-y divide-[var(--ui-border-muted)] text-[13px]">
						{#each catCtrl.pagedList as c (c.id)}
							<tr>
								<td class="px-5 py-3"
									><div class="flex items-center gap-2 font-semibold">
										{#if c.data.icon}<Icon
												name={c.data.icon}
												class="size-4 text-[var(--ui-text-dimmed)]"
											/>{/if}{c.data.name}
									</div>
									{#if c.data.description}<div class="text-[11.5px] text-[var(--ui-text-dimmed)]">
											{c.data.description}
										</div>{/if}</td
								>
								<td class="px-5 py-3 text-right text-[var(--ui-text-muted)] tabular-nums"
									>{c.data.sortOrder ?? 0}</td
								>
								<td class="px-5 py-3 text-right"><RowActions actions={catActions(c)} /></td>
							</tr>
						{/each}
					</tbody>
				</table>
				<Pagination controls={catCtrl} />
			</div>
		{/if}
	{:else if tab === 'units'}
		{#if units.length || unitCtrl.search}
			<ListToolbar
				bind:search={unitCtrl.search}
				bind:sortKey={unitCtrl.sortKey}
				bind:sortDir={unitCtrl.sortDir}
				viewMode={unitCtrl.viewMode}
				sortItems={unitCtrl.sortItems}
				allowViewModes={['table']}
				applySort={unitCtrl.applySort}
				searchPlaceholder="Search units…"
			/>
		{/if}
		{#if unitCtrl.list.length === 0}
			<EmptyState
				icon="lucide:ruler"
				title="No units"
				description="Define units of measure (kg, liter, piece…)."
			>
				{#snippet actions()}<Button
						color="primary"
						size="sm"
						icon="lucide:plus"
						onclick={() => openCreate('units')}>Add unit</Button
					>{/snippet}
			</EmptyState>
		{:else}
			<div class="data-panel">
				<table class="table-surface w-full text-left">
					<thead
						><tr>
							<SortableTh
								column="name"
								active={unitCtrl.sortKey === 'name'}
								direction={unitCtrl.sortDir}
								applySort={unitCtrl.applySort}>Unit</SortableTh
							>
							<SortableTh
								column="symbol"
								active={unitCtrl.sortKey === 'symbol'}
								direction={unitCtrl.sortDir}
								applySort={unitCtrl.applySort}>Symbol</SortableTh
							>
							<th class="px-5 py-2.5">Type</th>
							<th class="w-10 px-5 py-2.5"></th>
						</tr></thead
					>
					<tbody class="divide-y divide-[var(--ui-border-muted)] text-[13px]">
						{#each unitCtrl.pagedList as u (u.id)}
							<tr>
								<td class="px-5 py-3 font-semibold">{u.data.name}</td>
								<td class="px-5 py-3 font-mono text-[var(--ui-text-muted)]">{u.data.symbol}</td>
								<td class="px-5 py-3 text-[var(--ui-text-muted)] capitalize"
									>{u.data.type ?? 'count'}</td
								>
								<td class="px-5 py-3 text-right"><RowActions actions={unitActions(u)} /></td>
							</tr>
						{/each}
					</tbody>
				</table>
				<Pagination controls={unitCtrl} />
			</div>
		{/if}
	{:else if tab === 'modifiers'}
		{#if modifiers.length || modCtrl.search}
			<ListToolbar
				bind:search={modCtrl.search}
				bind:sortKey={modCtrl.sortKey}
				bind:sortDir={modCtrl.sortDir}
				viewMode={modCtrl.viewMode}
				sortItems={modCtrl.sortItems}
				allowViewModes={['table']}
				applySort={modCtrl.applySort}
				searchPlaceholder="Search modifiers…"
			/>
		{/if}
		{#if modCtrl.list.length === 0}
			<EmptyState
				icon="lucide:sliders-horizontal"
				title="No modifier groups"
				description="Create modifier groups like sizes or toppings."
			>
				{#snippet actions()}<Button
						color="primary"
						size="sm"
						icon="lucide:plus"
						onclick={() => openCreate('modifiers')}>Add modifier</Button
					>{/snippet}
			</EmptyState>
		{:else}
			<div class="data-panel">
				<table class="table-surface w-full text-left">
					<thead
						><tr>
							<SortableTh
								column="name"
								active={modCtrl.sortKey === 'name'}
								direction={modCtrl.sortDir}
								applySort={modCtrl.applySort}>Modifier group</SortableTh
							>
							<th class="px-5 py-2.5">Options</th>
							<th class="w-10 px-5 py-2.5"></th>
						</tr></thead
					>
					<tbody class="divide-y divide-[var(--ui-border-muted)] text-[13px]">
						{#each modCtrl.pagedList as m (m.id)}
							<tr>
								<td class="px-5 py-3 font-semibold"
									>{m.data.name}{#if m.data.singleChoice}<span
											class="ml-2 text-[10px] text-[var(--ui-text-dimmed)]">single</span
										>{/if}</td
								>
								<td class="px-5 py-3 text-[var(--ui-text-muted)]"
									>{m.data.options?.map((o) => o.name).join(', ') || '—'}</td
								>
								<td class="px-5 py-3 text-right"><RowActions actions={modActions(m)} /></td>
							</tr>
						{/each}
					</tbody>
				</table>
				<Pagination controls={modCtrl} />
			</div>
		{/if}
	{:else if tab === 'bundles'}
		<div class="flex items-center gap-2">
			<div class="flex-1">
				<Input
					bind:value={bundleSearch}
					icon="lucide:search"
					placeholder="Search bundles…"
					class="w-full"
				/>
			</div>
		</div>
		{#if filteredBundles.length === 0}
			<EmptyState
				icon="lucide:package-open"
				title="No bundles"
				description="Create product bundles to sell items together at a special price."
			>
				{#snippet actions()}<Button
						color="primary"
						size="sm"
						icon="lucide:plus"
						onclick={openBundleCreate}>Add bundle</Button
					>{/snippet}
			</EmptyState>
		{:else}
			<div class="data-panel">
				<div class="overflow-x-auto">
					<table class="table-surface w-full text-left">
						<thead
							><tr>
								<th class="px-5 py-2.5">Bundle</th>
								<th class="px-5 py-2.5">Price Mode</th>
								<th class="px-5 py-2.5 text-right">Price</th>
								<th class="px-5 py-2.5 text-center">Groups</th>
								<th class="px-5 py-2.5 text-center">Sort</th>
								<th class="px-5 py-2.5 text-center">Status</th>
								<th class="w-10 px-5 py-2.5"></th>
							</tr></thead
						>
						<tbody class="divide-y divide-[var(--ui-border-muted)] text-[13px]">
							{#each filteredBundles as b (b.id)}
								<tr>
									<td class="px-5 py-3">
										<div class="flex items-center gap-2">
											{#if b.image}
												<img src={b.image} alt="" class="size-8 rounded-lg object-cover" />
											{/if}
											<div>
												<div class="font-semibold">{b.name}</div>
												{#if b.description}<div class="text-[11.5px] text-[var(--ui-text-dimmed)]">
														{b.description}
													</div>{/if}
											</div>
										</div>
									</td>
									<td class="px-5 py-3"
										><Badge
											color={b.priceMode === 'fixed'
												? 'success'
												: b.priceMode === 'discounted'
													? 'error'
													: 'info'}
											>{b.priceMode === 'fixed'
												? 'Fixed'
												: b.priceMode === 'discounted'
													? 'Discounted'
													: 'Sum'}</Badge
										></td
									>
									<td class="px-5 py-3 text-right font-semibold tabular-nums">
										{#if b.priceMode === 'fixed'}{formatMoney(b.fixedPrice ?? 0, currency)}
										{:else if b.priceMode === 'discounted'}-{b.discountPercent ?? 0}%
										{:else}<span class="text-[11px] text-[var(--ui-text-dimmed)]">auto</span>{/if}
									</td>
									<td class="px-5 py-3 text-center tabular-nums">{b.groups.length}</td>
									<td class="px-5 py-3 text-center text-[var(--ui-text-muted)] tabular-nums"
										>{b.sortOrder}</td
									>
									<td class="px-5 py-3 text-center">
										<button
											type="button"
											onclick={() => toggleBundleStatus(b.id)}
											class="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold transition {b.status ===
											'active'
												? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
												: 'bg-[var(--ui-bg-accented)] text-[var(--ui-text-dimmed)]'}"
										>
											<Icon
												name={b.status === 'active' ? 'lucide:check-circle' : 'lucide:circle'}
												class="size-3"
											/>
											{b.status === 'active' ? 'Active' : 'Inactive'}
										</button>
									</td>
									<td class="px-5 py-3 text-right">
										<RowActions
											actions={[
												[
													{
														label: 'Edit',
														icon: 'lucide:pencil',
														onSelect: () => openBundleEdit(b)
													}
												],
												[
													{
														label: 'Delete',
														icon: 'lucide:trash-2',
														danger: true,
														onSelect: () => deleteBundle(b.id)
													}
												]
											]}
										/>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		{/if}
	{/if}
</div>

<Dialog bind:open={bDlgOpen} title={bEditingId ? 'Edit bundle' : 'Add bundle'}>
	<div class="space-y-3">
		<label class="block"
			><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Name</span
			><Input bind:value={bName} icon="lucide:package-open" class="w-full" /></label
		>
		<label class="block"
			><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
				>Description</span
			><Input bind:value={bDesc} class="w-full" /></label
		>
		<MediaImageInput
			bind:value={bImage}
			purpose="brand"
			preview="wide"
			placeholder="Brand / banner image URL"
		/>
		<div class="grid grid-cols-2 gap-3">
			<div>
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
					>Price Mode</span
				>
				<div class="segmented flex gap-1 p-1">
					<button
						type="button"
						onclick={() => (bPriceMode = 'fixed')}
						class="flex-1 rounded-md px-3 py-1.5 text-[11.5px] font-semibold {bPriceMode === 'fixed'
							? 'bg-[var(--ui-bg-elevated)]'
							: 'text-[var(--ui-text-muted)]'}">Fixed</button
					>
					<button
						type="button"
						onclick={() => (bPriceMode = 'sum_components')}
						class="flex-1 rounded-md px-3 py-1.5 text-[11.5px] font-semibold {bPriceMode ===
						'sum_components'
							? 'bg-[var(--ui-bg-elevated)]'
							: 'text-[var(--ui-text-muted)]'}">Sum</button
					>
					<button
						type="button"
						onclick={() => (bPriceMode = 'discounted')}
						class="flex-1 rounded-md px-3 py-1.5 text-[11.5px] font-semibold {bPriceMode ===
						'discounted'
							? 'bg-[var(--ui-bg-elevated)]'
							: 'text-[var(--ui-text-muted)]'}">Discount</button
					>
				</div>
			</div>
			<label class="block"
				><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
					>Sort order</span
				><Input bind:value={bSortOrder} type="number" min="0" class="w-full" /></label
			>
		</div>
		{#if bPriceMode === 'fixed'}
			<label class="block"
				><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
					>Fixed price ({currency})</span
				><Input bind:value={bFixedPrice} type="number" min="0" step="0.01" class="w-full" /></label
			>
		{/if}
		{#if bPriceMode === 'discounted'}
			<label class="block"
				><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
					>Discount %</span
				><Input
					bind:value={bDiscountPercent}
					type="number"
					min="0"
					max="100"
					step="1"
					class="w-full"
				/></label
			>
		{/if}
		{#if bundleRegularPrice > 0}
			<div class="flex items-center gap-4 rounded-lg bg-[var(--ui-bg-accented)] p-3">
				<div>
					<p class="text-[11px] text-[var(--ui-text-dimmed)]">Regular price</p>
					<p class="font-bold">{formatMoney(bundleRegularPrice, currency)}</p>
				</div>
				{#if bundleFinalPrice < bundleRegularPrice}
					<div>
						<p class="text-[11px] text-[var(--ui-text-dimmed)]">Bundle price</p>
						<p class="font-bold text-emerald-600 dark:text-emerald-400">
							{formatMoney(bundleFinalPrice, currency)}
						</p>
					</div>
					<div>
						<p class="text-[11px] text-[var(--ui-text-dimmed)]">Savings</p>
						<p class="font-bold text-emerald-600 dark:text-emerald-400">
							{formatMoney(bundleRegularPrice - bundleFinalPrice, currency)}
						</p>
					</div>
				{/if}
			</div>
		{/if}

		<!-- Bundle groups -->
		<div>
			<div class="mb-2 flex items-center justify-between">
				<span class="text-[12px] font-semibold text-[var(--ui-text-muted)]">Product groups</span>
				<Button size="sm" variant="ghost" icon="lucide:plus" onclick={addBundleGroup}
					>Add group</Button
				>
			</div>
			<div class="space-y-3">
				{#each bGroups as group, gIdx (group.id)}
					<div
						class="space-y-2 rounded-lg border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] p-3"
					>
						<div class="flex items-center gap-2">
							<Input
								bind:value={group.name}
								placeholder="Group name (e.g. Choose drink)"
								class="flex-1"
							/>
							<button
								type="button"
								class="flex size-7 items-center justify-center rounded text-[var(--tone-error-text)] hover:bg-rose-500/10"
								onclick={() => removeBundleGroup(gIdx)}
								aria-label="Remove group"><Icon name="lucide:trash-2" class="size-3.5" /></button
							>
						</div>
						<div class="grid grid-cols-3 gap-2">
							<Input
								bind:value={group.min}
								type="number"
								min="0"
								placeholder="Min"
								class="w-full"
							/>
							<Input
								bind:value={group.max}
								type="number"
								min="1"
								placeholder="Max"
								class="w-full"
							/>
							<Input
								bind:value={group.includedQuantity}
								type="number"
								min="1"
								placeholder="Included"
								class="w-full"
							/>
						</div>
						<div>
							<span class="mb-1 block text-[11px] font-semibold text-[var(--ui-text-dimmed)]"
								>Products</span
							>
							<div class="flex flex-wrap gap-1">
								{#each products as prod (prod.id)}
									<button
										type="button"
										onclick={() => toggleBundleProduct(group, prod.id)}
										class="rounded-md border px-2 py-1 text-[11px] font-semibold transition {group.productIds.includes(
											prod.id
										)
											? 'border-primary-500 bg-primary-500/10 text-primary-600 dark:text-primary-300'
											: 'border-[var(--ui-border)] text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)]'}"
										>{prod.data.name}</button
									>
								{/each}
								{#if products.length === 0}<span class="text-[11px] text-[var(--ui-text-dimmed)]"
										>No products available</span
									>{/if}
							</div>
						</div>
					</div>
				{/each}
				{#if bGroups.length === 0}<div
						class="py-3 text-center text-[11px] text-[var(--ui-text-dimmed)]"
					>
						Add a group to select products
					</div>{/if}
			</div>
		</div>
	</div>
	{#snippet footer()}<Button color="neutral" variant="ghost" onclick={() => (bDlgOpen = false)}
			>Cancel</Button
		><Button color="primary" icon="lucide:check" onclick={saveBundle}
			>{bEditingId ? 'Update' : 'Create'}</Button
		>{/snippet}
</Dialog>

<!-- Original dialog for other tabs -->
<Dialog bind:open={dlgOpen} title={dlgTitle} size={dlgSize}>
	{#if dlgKind === 'products'}
		<div class="grid gap-5 lg:grid-cols-[19rem_1fr]">
			<div class="space-y-3 lg:sticky lg:top-0 lg:self-start">
				<!-- Images (gallery) -->
				<MediaImageGallery
					bind:value={pImages}
					purpose="product"
					label="Product images"
					hint="The first image is the cover shown on listings & the marketplace."
				/>
			</div>
			<!-- Details -->
			<div class="space-y-3">
			<label class="block"
				><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Name</span
				><Input bind:value={pName} icon="lucide:package" class="w-full" /></label
			>

			<!-- Price / Cost / Compare-at -->
			<div class="grid grid-cols-3 gap-3">
				<label class="block"
					><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>Price ({currency})</span
					><Input
						bind:value={pPrice}
						type="number"
						icon="lucide:banknote"
						min="0"
						step="0.01"
						class="w-full"
					/></label
				>
				<label class="block"
					><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>Cost</span
					><Input
						bind:value={pCostPrice}
						type="number"
						icon="lucide:wallet"
						min="0"
						step="0.01"
						placeholder="0.00"
						class="w-full"
					/></label
				>
				<label class="block"
					><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>Compare-at</span
					><Input
						bind:value={pCompareAtPrice}
						type="number"
						icon="lucide:tag"
						min="0"
						step="0.01"
						placeholder="0.00"
						class="w-full"
					/></label
				>
			</div>

			<!-- Category + Unit -->
			<div class="grid grid-cols-2 gap-3">
				<label class="block"
					><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>Category</span
					><Select
						bind:value={pCat}
						class="w-full"
						options={[
							{ value: '', label: '— None —' },
							...categories.map((c) => ({ value: c.id, label: c.data.name ?? c.id }))
						]}
					/></label
				>
				<label class="block"
					><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>Unit</span
					><Select
						bind:value={pUnitId}
						class="w-full"
						options={[
							{ value: '', label: 'None' },
							...units.map((u) => ({ value: u.id, label: u.data.symbol ?? u.data.name ?? '' }))
						]}
					/></label
				>
			</div>
			<datalist id="cats"
				>{#each categories as c (c.id)}<option value={c.data.name}></option>{/each}</datalist
			>

			<!-- SKU + Barcode -->
			<div class="grid grid-cols-2 gap-3">
				<label class="block"
					><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>SKU</span
					><Input bind:value={pSku} icon="lucide:barcode" class="w-full" /></label
				>
				<label class="block"
					><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>Barcode</span
					><Input
						bind:value={pBarcode}
						icon="lucide:scan-line"
						placeholder="EAN/UPC"
						class="w-full"
					/></label
				>
			</div>

			<!-- Description -->
			<label class="block"
				><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
					>Description</span
				><Input
					bind:value={pDesc}
					textarea
					rows={2}
					placeholder="Product description…"
					class="w-full"
				/></label
			>

			<!-- Toggles: isPublic / available / taxInclusive -->
			<div class="flex flex-wrap gap-3">
				<label class="flex cursor-pointer items-center gap-2"
					><input
						type="checkbox"
						bind:checked={pIsPublic}
						class="size-4 rounded border-[var(--ui-border)]"
					/><span class="text-[12px] font-semibold">Public</span></label
				>
				<label class="flex cursor-pointer items-center gap-2"
					><input
						type="checkbox"
						bind:checked={pAvailable}
						class="size-4 rounded border-[var(--ui-border)]"
					/><span class="text-[12px] font-semibold">Available</span></label
				>
				<label class="flex cursor-pointer items-center gap-2"
					><input
						type="checkbox"
						bind:checked={pTaxInclusive}
						class="size-4 rounded border-[var(--ui-border)]"
					/><span class="text-[12px] font-semibold">Tax inclusive</span></label
				>
			</div>

			<!-- prepTime + sortOrder -->
			<div class="grid grid-cols-2 gap-3">
				<label class="block"
					><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>Prep time (min)</span
					><Input
						bind:value={pPrepTime}
						type="number"
						min="0"
						icon="lucide:timer"
						placeholder="0"
						class="w-full"
					/></label
				>
				<label class="block"
					><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>Sort order</span
					><Input
						bind:value={pSortOrder}
						type="number"
						min="0"
						icon="lucide:arrow-down-up"
						placeholder="0"
						class="w-full"
					/></label
				>
			</div>

			<!-- Variants -->
			<div>
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
					>Variants (sizes)</span
				>
				{#if pVariants.length}
					<ul class="mb-2 space-y-1">
						{#each pVariants as v, i (i)}
							<li
								class="flex items-center gap-2 rounded-lg border border-[var(--ui-border-muted)] px-2.5 py-1.5 text-[12.5px]"
							>
								<span class="flex-1 font-semibold">{v.name}</span><span
									class="text-[var(--ui-text-muted)] tabular-nums"
									>{v.price >= 0 ? '+' : ''}{v.price}</span
								><button
									type="button"
									class="text-[var(--tone-error-text)]"
									onclick={() => removeVariant(i)}
									aria-label="Remove"><Icon name="lucide:x" class="size-3.5" /></button
								>
							</li>
						{/each}
					</ul>
				{/if}
				<div class="flex gap-2">
					<Input bind:value={pVariantName} placeholder="Large" class="flex-1" />
					<Input bind:value={pVariantPrice} type="number" placeholder="price adj." class="w-28" />
					<Button
						color="neutral"
						variant="subtle"
						size="icon"
						icon="lucide:plus"
						onclick={addVariant}
						aria-label="Add variant"
					/>
				</div>
			</div>

			<!-- Modifier groups -->
			{#if modifiers.length}
				<div>
					<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>Modifier groups</span
					>
					<div class="flex flex-wrap gap-1.5">
						{#each modifiers as m (m.id)}
							<button
								type="button"
								onclick={() => toggleModGroup(m.id)}
								class="rounded-full border px-2.5 py-1 text-[11.5px] font-semibold transition-colors {pModGroupIds.includes(
									m.id
								)
									? 'border-primary-500 bg-primary-500/10 text-primary-600 dark:text-primary-300'
									: 'border-[var(--ui-border)] text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)]'}"
								>{m.data.name}</button
							>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Inventory policy -->
			<div>
				<label class="flex cursor-pointer items-center gap-2"
					><input
						type="checkbox"
						bind:checked={pTrackInv}
						class="size-4 rounded border-[var(--ui-border)]"
					/><span class="text-[12.5px] font-semibold">Track inventory & show stock in POS</span
					></label
				>
				{#if pTrackInv}
					<div class="mt-2 grid grid-cols-2 gap-2">
						<Input
							bind:value={pLowStock}
							type="number"
							min="0"
							icon="lucide:alert-triangle"
							placeholder="Low-stock alert at"
							class="w-full"
						/>
						<label
							class="flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--ui-border-muted)] px-2.5 py-2"
							><input
								type="checkbox"
								bind:checked={pDenyOos}
								class="size-4 rounded border-[var(--ui-border)]"
							/><span class="text-[11.5px] font-semibold">Block sale when out of stock</span></label
						>
					</div>
				{/if}
			</div>
			</div>
		</div>
	{:else if dlgKind === 'categories'}
		<div class="space-y-3">
			<label class="block"
				><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Name</span
				><Input bind:value={cName} icon="lucide:folder" class="w-full" /></label
			>
			<label class="block"
				><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
					>Description</span
				><Input bind:value={cDesc} class="w-full" /></label
			>
			<div class="grid grid-cols-2 gap-3">
				<label class="block"
					><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>Icon (lucide or emoji)</span
					><Input
						bind:value={cIcon}
						icon="lucide:star"
						placeholder="lucide:coffee"
						class="w-full"
					/></label
				>
				<label class="block"
					><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>Color</span
					><Input bind:value={cColor} type="color" placeholder="#6366f1" class="w-full" /></label
				>
			</div>
			<div class="grid grid-cols-2 gap-3">
				<label class="block"
					><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>Sort order</span
					><Input bind:value={cOrder} type="number" class="w-full" /></label
				>
				<label class="block"
					><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>Status</span
					><Select
						bind:value={cStatus}
						class="w-full"
						options={[
							{ value: 'active', label: 'Active' },
							{ value: 'inactive', label: 'Inactive' }
						]}
					/></label
				>
			</div>
		</div>
	{:else if dlgKind === 'units'}
		<div class="space-y-3">
			<div class="grid grid-cols-2 gap-3">
				<label class="block"
					><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>Name</span
					><Input bind:value={uName} placeholder="Kilogram" class="w-full" /></label
				>
				<label class="block"
					><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>Symbol</span
					><Input bind:value={uSymbol} placeholder="kg" class="w-full" /></label
				>
			</div>
			<label class="block"
				><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Type</span
				>
				<Select
					bind:value={uType}
					options={[
						{ value: 'count', label: 'Count' },
						{ value: 'weight', label: 'Weight' },
						{ value: 'volume', label: 'Volume' },
						{ value: 'length', label: 'Length' },
						{ value: 'time', label: 'Time' }
					]}
					class="w-full"
				/>
			</label>
			<div class="grid grid-cols-2 gap-3">
				<label class="block"
					><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>Base unit</span
					><Select
						bind:value={uBaseUnitId}
						class="w-full"
						options={[
							{ value: '', label: 'None' },
							...units
								.filter((u2) => u2.id !== editingId)
								.map((u2) => ({ value: u2.id, label: u2.data.name ?? u2.id }))
						]}
					/></label
				>
				<label class="block"
					><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>Conversion factor</span
					><Input
						bind:value={uConversionFactor}
						type="number"
						min="0"
						step="0.0001"
						placeholder="1"
						class="w-full"
					/></label
				>
			</div>
		</div>
	{:else}
		<div class="space-y-3">
			<label class="block"
				><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
					>Group name</span
				><Input bind:value={mName} placeholder="Size" class="w-full" /></label
			>
			<label class="block"
				><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
					>Options (comma separated)</span
				><Input bind:value={mOpt} placeholder="Small, Medium, Large" class="w-full" /></label
			>
		</div>
	{/if}
	{#snippet footer()}
		<Button color="neutral" variant="ghost" onclick={() => (dlgOpen = false)}>Cancel</Button>
		<Button color="primary" icon="lucide:check" onclick={save}
			>{isEditing ? 'Update' : 'Save'}</Button
		>
	{/snippet}
</Dialog>

<RawDataDialog bind:open={rawOpen} data={rawItem} title="Product Raw Data" />

<ProductDetail bind:product={detailProduct} bind:open={detailOpen} />

<!-- Quick stock adjust from catalog -->
<Dialog bind:open={quickAdjustOpen} title="Adjust stock">
	<div class="space-y-3">
		<p class="text-[12.5px] text-[var(--ui-text-muted)]">
			Adjusting stock for <span class="font-semibold">{quickAdjustName}</span>
		</p>
		<div class="segmented flex gap-1 p-1">
			<button
				type="button"
				onclick={() => (quickAdjustDir = 'increase')}
				class="flex-1 rounded-md px-3 py-1.5 text-[11.5px] font-semibold {quickAdjustDir ===
				'increase'
					? 'bg-[var(--ui-bg-elevated)]'
					: 'text-[var(--ui-text-muted)]'}">↑ Stock in</button
			>
			<button
				type="button"
				onclick={() => (quickAdjustDir = 'decrease')}
				class="flex-1 rounded-md px-3 py-1.5 text-[11.5px] font-semibold {quickAdjustDir ===
				'decrease'
					? 'bg-[var(--ui-bg-elevated)]'
					: 'text-[var(--ui-text-muted)]'}">↓ Stock out</button
			>
		</div>
		<label class="block"
			><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
				>Quantity</span
			><Input bind:value={quickAdjustQty} type="number" min="1" class="w-full" /></label
		>
		<label class="block"
			><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Reason</span
			><Input
				bind:value={quickAdjustReason}
				placeholder="Manual adjustment"
				class="w-full"
			/></label
		>
	</div>
	{#snippet footer()}<Button
			color="neutral"
			variant="ghost"
			onclick={() => (quickAdjustOpen = false)}>Cancel</Button
		><Button color="primary" icon="lucide:check" onclick={saveQuickAdjust}>Save</Button>{/snippet}
</Dialog>
