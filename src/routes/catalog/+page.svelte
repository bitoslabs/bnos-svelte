<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { t } from '$lib/i18n/i18n.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import NumberInput from '$lib/components/ui/NumberInput.svelte';
	import Checkbox from '$lib/components/ui/Checkbox.svelte';
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
	import { buildSearchIndex } from '$lib/utils/search';
	import { glo } from '$nostr/store.svelte';
	import { dataSync } from '$nostr/sync.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatMoney } from '$lib/utils/format';
	import { newRecordId } from '$lib/utils/record-id';
	import { mapLimit } from '$lib/utils/async';
	import {
		TYPE,
		parseBrowseCatalog,
		applyCatalogPreset,
		CATALOG_KIT_KIND,
		CATALOG_KIT_TAG,
		latestActiveCatalogKits,
		kitToBrowseItem,
		builtinCatalogItems,
		builtinTemplateForBusinessType,
		type RawNostrEvent,
		type BrowseCatalogItem,
		type Product,
		type ProductVariant,
		type CatalogCategory,
		type CatalogUnit,
		type ModifierGroup
	} from '$lib/domain';
	import { fetchEvents } from '$nostr/client';

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
	let rawItem = $state<unknown>(null);

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
				if (p) total += (p.data.price ?? 0) * g.includedQuantity;
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
			label: t('nav.products'),
			icon: 'lucide:package',
			count: () => glo.all(TYPE.product).length
		},
		{
			id: 'categories',
			label: t('catalog.categories'),
			icon: 'lucide:folder',
			count: () => glo.all(TYPE.category).length
		},
		{
			id: 'units',
			label: t('catalog.units'),
			icon: 'lucide:ruler',
			count: () => glo.all(TYPE.unit).length
		},
		{
			id: 'modifiers',
			label: t('catalog.modifiers'),
			icon: 'lucide:sliders-horizontal',
			count: () => glo.all(TYPE.modifierGroup).length
		},
		{
			id: 'bundles',
			label: t('catalog.bundles'),
			icon: 'lucide:package-open',
			count: () => bundles.length
		}
	];

	// ── Products ──
	type ProductRow = Product & {
		image?: string;
		stockLevel?: number;
		promotionIds?: string[];
		costPrice?: number;
	};
	const products = $derived(glo.all<ProductRow, typeof TYPE.product>(TYPE.product));
	const productSearchIndex = $derived(buildSearchIndex(products, (p) => String(p.data.name ?? '')));
	const prodCtrl = createListControls<{ id: string; data: ProductRow }>({
		items: () => products,
		search: (p, q) => productSearchIndex[p.id]?.includes(q) ?? false,
		sortOptions: () => [
			{ key: 'name', label: t('common.name'), value: (p) => p.data.name ?? '~' },
			{ key: 'price', label: t('common.price'), value: (p) => p.data.price ?? 0 },
			{
				key: 'category',
				label: t('common.category'),
				value: (p) => p.data.categoryId ?? '~'
			}
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
			{ key: 'name', label: t('common.name'), value: (c) => c.data.name },
			{ key: 'order', label: t('common.order'), value: (c) => c.data.sortOrder ?? 0 }
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
			{ key: 'name', label: t('common.name'), value: (u) => u.data.name },
			{ key: 'symbol', label: 'Symbol', value: (u) => u.data.symbol }
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
		sortOptions: () => [{ key: 'name', label: t('common.name'), value: (m) => m.data.name }],
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
		(isEditing ? t('common.edit') : t('common.add')) +
			' ' +
			(dlgKind === 'products'
				? t('common.product')
				: dlgKind === 'categories'
					? t('common.category')
					: dlgKind === 'units'
						? t('common.unit')
						: dlgKind === 'modifiers'
							? t('common.modifierGroup')
							: t('common.item'))
	);

	/** Dynamic dialog width: product editor is wide (gallery + details),
	 *  the lighter forms stay compact. */
	const dlgSize = $derived(dlgKind === 'products' ? 'xl' : dlgKind === 'modifiers' ? 'md' : 'sm');

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
		const d = obj.data as ProductRow;
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
		pImages = Array.isArray(d.images) ? d.images : d.image ? [d.image] : [];
		pUnitId = d.unitId ?? '';
		pVariants = (d.variants ?? []).map((v) => ({
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
		const d = obj.data as CatalogCategory;
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
		const d = obj.data as CatalogUnit;
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
		const d = obj.data as ModifierGroup;
		dlgKind = 'modifiers';
		editingId = id;
		mName = d.name ?? '';
		mOpt = (d.options ?? d.modifiers ?? []).map((o) => o.name).join(', ');
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
				const payload: ProductRow = {
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
			toast.success(isEditing ? t('common.updated') : t('common.saved'));
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
					await mapLimit(data.products, 8, async (p: Record<string, unknown> & { id?: string }) => {
						const { id, ...payload } = p;
						await glo.upsert(TYPE.product, payload, {
							id: typeof id === 'string' ? id : newRecordId('product')
						});
					});
				}
				if (data.categories) {
					await mapLimit(
						data.categories,
						8,
						async (c: Record<string, unknown> & { id?: string }) => {
							const { id, ...payload } = c;
							await glo.upsert(TYPE.category, payload, {
								id: typeof id === 'string' ? id : newRecordId('category')
							});
						}
					);
				}
				toast.success('Catalog imported');
			} catch (e) {
				toast.error('Import failed', e instanceof Error ? e.message : undefined);
			}
		};
		input.click();
	}

	// ── Import from templates (BNOS catalog presets) ──
	// Built-in kits ship with the app so a merchant can seed a catalog offline.
	const BUILTIN_ITEMS = builtinCatalogItems();
	const RECOMMENDED_BUILTIN = $derived(builtinTemplateForBusinessType(tenant.state.businessType));
	const RECOMMENDED_BUILTIN_ID = $derived(RECOMMENDED_BUILTIN?.preset.id ?? null);
	const TEMPLATES_CATALOG_URL =
		import.meta.env.VITE_TEMPLATES_CATALOG_URL ?? 'http://localhost:8080/bnos-presets.json';
	let tmplOpen = $state(false);
	let tmplUrl = $state(TEMPLATES_CATALOG_URL);
	let tmplPaste = $state('');
	let tmplItems = $state<BrowseCatalogItem[]>([]);
	const tmplSelected = new SvelteSet<string>();
	let tmplLoading = $state(false);
	let tmplRelayLoading = $state(false);
	let tmplApplying = $state(false);
	let tmplError = $state('');
	let tmplLoaded = $state(false);

	function openTemplateImport() {
		tmplOpen = true;
		tmplError = '';
		if (!tmplLoaded) {
			// Show native kits instantly; remote kits load on demand.
			mergeTemplateItems(BUILTIN_ITEMS, false);
			if (RECOMMENDED_BUILTIN_ID) tmplSelected.add(RECOMMENDED_BUILTIN_ID);
		}
	}

	function ingestTemplateCatalog(text: string, label: string) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			tmplError = `That is not valid JSON (${label}).`;
			return;
		}
		const result = parseBrowseCatalog(parsed);
		if (!result.ok) {
			tmplError = result.errors.slice(0, 3).join(' ');
			return;
		}
		mergeTemplateItems(result.data.items);
	}

	function mergeTemplateItems(items: BrowseCatalogItem[], select = true) {
		const byId: Record<string, BrowseCatalogItem> = {};
		for (const item of tmplItems) byId[item.presetId] = item;
		for (const item of items) byId[item.presetId] = item;
		tmplItems = Object.values(byId);
		if (select) for (const item of items) tmplSelected.add(item.presetId);
		tmplLoaded = true;
		tmplError = '';
	}

	async function loadTemplateCatalog() {
		tmplLoading = true;
		tmplError = '';
		try {
			const response = await fetch(tmplUrl, { headers: { accept: 'application/json' } });
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			ingestTemplateCatalog(await response.text(), tmplUrl);
		} catch (error) {
			tmplError = `Could not load ${tmplUrl} — ${error instanceof Error ? error.message : 'network error'}. Paste the catalog JSON instead.`;
		} finally {
			tmplLoading = false;
		}
	}

	function loadPastedCatalog() {
		ingestTemplateCatalog(tmplPaste, 'pasted');
	}

	async function loadTemplateCatalogFromRelays() {
		tmplRelayLoading = true;
		tmplError = '';
		try {
			const events = await fetchEvents({
				kinds: [CATALOG_KIT_KIND],
				'#t': [CATALOG_KIT_TAG],
				limit: 50
			});
			const kits = latestActiveCatalogKits(events as RawNostrEvent[]);
			if (!kits.length) {
				tmplError = 'No published kits found on your relays yet.';
				return;
			}
			mergeTemplateItems(kits.map((kit) => kitToBrowseItem(kit)));
		} catch (error) {
			tmplError = `Relay lookup failed — ${error instanceof Error ? error.message : 'offline'}.`;
		} finally {
			tmplRelayLoading = false;
		}
	}

	function toggleTemplateItem(presetId: string) {
		if (tmplSelected.has(presetId)) tmplSelected.delete(presetId);
		else tmplSelected.add(presetId);
	}

	function toggleAllTemplates() {
		if (tmplSelected.size === tmplItems.length) {
			tmplSelected.clear();
			return;
		}
		for (const item of tmplItems) tmplSelected.add(item.presetId);
	}

	async function applySelectedTemplates() {
		const chosen = tmplItems.filter((item) => tmplSelected.has(item.presetId));
		if (!chosen.length) return;
		tmplApplying = true;
		tmplError = '';
		const totals = { categories: 0, units: 0, modifierGroups: 0, products: 0 };
		try {
			for (const item of chosen) {
				const result = await applyCatalogPreset(
					item.preset,
					(type, data, options) => glo.upsert(type as never, data as never, options),
					{ currency }
				);
				if (!result.ok) {
					tmplError = result.errors.join(' ');
					return;
				}
				totals.categories += result.counts.categories;
				totals.units += result.counts.units;
				totals.modifierGroups += result.counts.modifierGroups;
				totals.products += result.counts.products;
			}
			toast.success(
				'Templates applied',
				`${totals.products} products · ${totals.categories} categories · ${totals.units} units · ${totals.modifierGroups} modifiers`
			);
			tmplOpen = false;
			tab = 'products';
		} catch (error) {
			tmplError = error instanceof Error ? error.message : 'Apply failed';
		} finally {
			tmplApplying = false;
		}
	}

	function catName(id: string): string {
		const c = glo.get(TYPE.category, id) as { data: CatalogCategory } | undefined;
		return c?.data.name ?? id;
	}

	// ── Template product preview ──
	let previewOpen = $state(false);
	let previewItem = $state<BrowseCatalogItem | null>(null);

	function openTemplatePreview(item: BrowseCatalogItem) {
		previewItem = item;
		previewOpen = true;
	}

	async function applyPreviewedTemplate() {
		const item = previewItem;
		if (!item) return;
		tmplSelected.clear();
		tmplSelected.add(item.presetId);
		previewOpen = false;
		await applySelectedTemplates();
	}

	function previewCategoryName(item: BrowseCatalogItem, key?: string): string {
		if (!key) return '—';
		return item.preset.categories.find((category) => category.key === key)?.name ?? key;
	}

	function previewProductPrice(
		item: BrowseCatalogItem,
		price?: number,
		currencyCode?: string
	): string {
		return formatMoney(
			price ?? item.preset.defaultPrice ?? 0,
			currencyCode ?? item.preset.currency ?? currency
		);
	}
	async function toggleProductActive(id: string, active: boolean) {
		const obj = glo.get(TYPE.product, id);
		if (!obj) return;
		await glo.upsert(
			TYPE.product,
			{ ...(obj.data as ProductRow), available: active, status: active ? 'active' : 'inactive' },
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
					label: t('common.viewRaw'),
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

<svelte:head><title>{t('common.appName')} · {t('nav.products')}</title></svelte:head>

<div class="space-y-4">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h1 class="font-display text-xl font-bold tracking-tight">{t('nav.products')}</h1>
			<p class="text-[12.5px] text-(--ui-text-muted)">
				Products, categories, units, modifiers & bundles
			</p>
		</div>
		<div class="flex items-center gap-2">
			<!-- More actions dropdown -->
			<Menu id="catalog-header-more" placement="bottom-end" width="md">
				{#snippet trigger()}
					<Button color="neutral" variant="ghost" size="icon-sm" title={t('catalog.moreOptions')}>
						<Icon name="lucide:more-horizontal" class="size-4" />
					</Button>
				{/snippet}
				<MenuItem icon="lucide:download" onclick={exportCatalog}>Export catalog</MenuItem>
				<MenuItem icon="lucide:upload" onclick={importCatalog}>Import catalog</MenuItem>
				<MenuItem icon="lucide:layout-template" onclick={openTemplateImport}
					>From templates…</MenuItem
				>
				<MenuDivider />
				<MenuItem icon="lucide:package-open" onclick={() => openBundleCreate()}
					>Quick add bundle</MenuItem
				>
			</Menu>
			<Button
				color="neutral"
				variant="subtle"
				icon="lucide:layout-template"
				onclick={openTemplateImport}>Starter kits</Button
			>
			<Button
				color="primary"
				icon="lucide:plus"
				title={t('common.add') + ' ' + t('common.item')}
				onclick={() => (tab === 'bundles' ? openBundleCreate() : openCreate(tab))}
				>{t('common.add')}
				{tab === 'products'
					? t('common.product')
					: tab === 'categories'
						? t('common.category')
						: tab === 'units'
							? t('common.unit')
							: tab === 'modifiers'
								? t('common.modifierGroup')
								: t('common.bundle')}</Button
			>
		</div>
	</div>

	<!-- tabs -->
	<div class="segmented flex w-fit max-w-full gap-1 overflow-x-auto p-1">
		{#each tabs as t (t.id)}
			<button
				type="button"
				onclick={() => (tab = t.id)}
				class="inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-semibold transition-colors {tab ===
				t.id
					? 'bg-(--ui-bg-elevated) text-(--ui-text) shadow-sm'
					: 'text-(--ui-text-muted)'}"
			>
				<Icon name={t.icon} class="size-3.5" />{t.label}
				<span class="rounded bg-(--ui-bg-accented) px-1.5 text-[10px] tabular-nums"
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
				title={t('catalog.noProducts')}
				description={t('catalog.noProductsDesc')}
			>
				{#snippet actions()}<div class="flex items-center gap-2">
						<Button
							color="neutral"
							variant="subtle"
							size="sm"
							icon="lucide:layout-template"
							onclick={openTemplateImport}>Starter kits</Button
						>
						<Button
							color="primary"
							size="sm"
							icon="lucide:plus"
							onclick={() => openCreate('products')}>{t('common.add')} {t('common.product')}</Button
						>
					</div>{/snippet}
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
									applySort={prodCtrl.applySort}>{t('common.product')}</SortableTh
								>
								<SortableTh
									column="category"
									active={prodCtrl.sortKey === 'category'}
									direction={prodCtrl.sortDir}
									applySort={prodCtrl.applySort}>{t('common.category')}</SortableTh
								>
								<SortableTh
									column="price"
									active={prodCtrl.sortKey === 'price'}
									direction={prodCtrl.sortDir}
									align="right"
									applySort={prodCtrl.applySort}>{t('common.price')}</SortableTh
								>
								<SortableTh
									column="promotion"
									active={prodCtrl.sortKey === 'promotion'}
									direction={prodCtrl.sortDir}
									applySort={prodCtrl.applySort}>{t('common.promotion')}</SortableTh
								>
								<SortableTh
									column="status"
									active={prodCtrl.sortKey === 'status'}
									direction={prodCtrl.sortDir}
									align="center"
									applySort={prodCtrl.applySort}>{t('common.status')}</SortableTh
								>
								<th class="w-10 px-5 py-2.5"></th>
							</tr></thead
						>
						<tbody class="divide-y divide-(--ui-border-muted) text-[13px]">
							{#each prodCtrl.pagedList as p (p.id)}
								<tr>
									<td class="px-5 py-3">
										<div class="flex items-center gap-3">
											<div
												class="size-10 shrink-0 overflow-hidden rounded-lg bg-(--ui-bg-accented)"
											>
												{#if p.data.image}
													<img
														src={p.data.image}
														alt={String(p.data.name ?? '')}
														loading="lazy"
														decoding="async"
														class="size-full object-cover"
													/>
												{:else}
													<div class="flex size-full items-center justify-center">
														<Icon name="lucide:package" class="size-4 text-(--ui-text-dimmed)" />
													</div>
												{/if}
											</div>
											<div>
												<div class="font-semibold">{p.data.name}</div>
												{#if p.data.sku}<div class="font-mono text-[11px] text-(--ui-text-dimmed)">
														{p.data.sku}
													</div>{/if}
												<div class="mt-0.5 flex flex-wrap gap-1">
													<span
														class="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold {p
															.data.isPublic !== false
															? 'bg-primary-50 text-primary-600 dark:bg-primary-500/10 dark:text-primary-400'
															: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400'}"
													>
														<Icon
															name={p.data.isPublic !== false ? 'lucide:globe' : 'lucide:lock'}
															class="size-2.5"
														/>
														{p.data.isPublic !== false ? 'Public' : 'Private'}
													</span>
													{#if p.data.hasVariants}<Badge color="info"
															>{p.data.variants?.length ?? 0} variants</Badge
														>{/if}
													{#if p.data.modifierGroupIds?.length}<Badge color="info"
															>{p.data.modifierGroupIds.length} mods</Badge
														>{/if}
													{#if p.data.trackInventory}<StockBadge
															level={Number(p.data.stockLevel ?? 0)}
															threshold={Number(p.data.inventory?.lowStockThreshold ?? 5)}
														/>{/if}
												</div>
											</div>
										</div>
									</td>
									<td class="px-5 py-3"
										>{#if p.data.categoryId}<Badge>{catName(p.data.categoryId)}</Badge>{:else}<span
												class="text-(--ui-text-dimmed)">—</span
											>{/if}</td
									>
									<td class="px-5 py-3 text-right">
										<div class="font-semibold tabular-nums">
											{formatMoney(p.data.price ?? 0, p.data.currency ?? currency)}
										</div>
										{#if p.data.compareAtPrice && p.data.compareAtPrice > (p.data.price ?? 0)}
											<div class="text-[11px] text-(--ui-text-dimmed) tabular-nums line-through">
												{formatMoney(p.data.compareAtPrice, p.data.currency ?? currency)}
											</div>
										{/if}
									</td>
									<td class="px-5 py-3">
										{#if p.data.promotionIds?.length || p.data.promotion?.promotionIds?.length}
											<span
												class="inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400"
											>
												On sale
											</span>
										{:else}
											<span class="text-xs text-(--ui-text-dimmed)">—</span>
										{/if}
									</td>
									<td class="px-5 py-3 text-center">
										<button
											class="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold {p
												.data.available !== false
												? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400'
												: 'bg-gray-100 text-gray-400 dark:bg-gray-800'}"
											onclick={() => toggleProductActive(p.id, p.data.available === false)}
										>
											{p.data.available !== false ? 'Active' : 'Inactive'}
										</button>
									</td>
									<td class="px-5 py-3 text-right">
										<div class="flex items-center justify-end gap-1">
											<button
												type="button"
												class="grid size-7 place-items-center rounded-md text-(--ui-text-dimmed) transition-colors hover:bg-(--ui-bg-accented) hover:text-(--ui-text)"
												onclick={() => openEditProduct(p.id)}
												aria-label={t('common.edit')}
												title={t('common.edit')}
											>
												<Icon name="lucide:pencil-line" class="size-3.5" />
											</button>
											<RowActions actions={prodActions(p)} />
										</div>
									</td>
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
				title={t('catalog.noCategories')}
				description="Group your products with categories."
			>
				{#snippet actions()}<Button
						color="primary"
						size="sm"
						icon="lucide:plus"
						onclick={() => openCreate('categories')}
						>{t('common.add')} {t('common.category')}</Button
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
									active={catCtrl.sortKey === 'name'}
									direction={catCtrl.sortDir}
									applySort={catCtrl.applySort}>{t('common.category')}</SortableTh
								>
								<SortableTh
									column="order"
									active={catCtrl.sortKey === 'order'}
									direction={catCtrl.sortDir}
									align="right"
									applySort={catCtrl.applySort}>{t('common.order')}</SortableTh
								>
								<th class="w-10 px-5 py-2.5"></th>
							</tr></thead
						>
						<tbody class="divide-y divide-(--ui-border-muted) text-[13px]">
							{#each catCtrl.pagedList as c (c.id)}
								<tr>
									<td class="px-5 py-3"
										><div class="flex items-center gap-2 font-semibold">
											{#if c.data.icon}<Icon
													name={c.data.icon}
													class="size-4 text-(--ui-text-dimmed)"
												/>{/if}{c.data.name}
										</div>
										{#if c.data.description}<div class="text-[11.5px] text-(--ui-text-dimmed)">
												{c.data.description}
											</div>{/if}</td
									>
									<td class="px-5 py-3 text-right text-(--ui-text-muted) tabular-nums"
										>{c.data.sortOrder ?? 0}</td
									>
									<td class="px-5 py-3 text-right">
										<div class="flex items-center justify-end gap-1">
											<button
												type="button"
												class="grid size-7 place-items-center rounded-md text-(--ui-text-dimmed) transition-colors hover:bg-(--ui-bg-accented) hover:text-(--ui-text)"
												onclick={() => openEditCategory(c.id)}
												aria-label={t('common.edit')}
												title={t('common.edit')}
											>
												<Icon name="lucide:pencil-line" class="size-3.5" />
											</button>
											<RowActions actions={catActions(c)} />
										</div>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
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
				title={t('catalog.noUnits')}
				description="Define units of measure (kg, liter, piece…)."
			>
				{#snippet actions()}<Button
						color="primary"
						size="sm"
						icon="lucide:plus"
						onclick={() => openCreate('units')}>{t('common.add')} {t('common.unit')}</Button
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
									active={unitCtrl.sortKey === 'name'}
									direction={unitCtrl.sortDir}
									applySort={unitCtrl.applySort}>{t('common.unit')}</SortableTh
								>
								<SortableTh
									column="symbol"
									active={unitCtrl.sortKey === 'symbol'}
									direction={unitCtrl.sortDir}
									applySort={unitCtrl.applySort}>{t('common.symbol')}</SortableTh
								>
								<th class="px-5 py-2.5">{t('common.type')}</th>
								<th class="w-10 px-5 py-2.5"></th>
							</tr></thead
						>
						<tbody class="divide-y divide-(--ui-border-muted) text-[13px]">
							{#each unitCtrl.pagedList as u (u.id)}
								<tr>
									<td class="px-5 py-3 font-semibold">{u.data.name}</td>
									<td class="px-5 py-3 font-mono text-(--ui-text-muted)">{u.data.symbol}</td>
									<td class="px-5 py-3 text-(--ui-text-muted) capitalize"
										>{u.data.type ?? 'count'}</td
									>
									<td class="px-5 py-3 text-right">
										<div class="flex items-center justify-end gap-1">
											<button
												type="button"
												class="grid size-7 place-items-center rounded-md text-(--ui-text-dimmed) transition-colors hover:bg-(--ui-bg-accented) hover:text-(--ui-text)"
												onclick={() => openEditUnit(u.id)}
												aria-label={t('common.edit')}
												title={t('common.edit')}
											>
												<Icon name="lucide:pencil-line" class="size-3.5" />
											</button>
											<RowActions actions={unitActions(u)} />
										</div>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
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
				title={t('catalog.noModifierGroups')}
				description="Create modifier groups like sizes or toppings."
			>
				{#snippet actions()}<Button
						color="primary"
						size="sm"
						icon="lucide:plus"
						onclick={() => openCreate('modifiers')}
						>{t('common.add')} {t('common.modifierGroup')}</Button
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
									active={modCtrl.sortKey === 'name'}
									direction={modCtrl.sortDir}
									applySort={modCtrl.applySort}>{t('common.modifierGroup')}</SortableTh
								>
								<th class="px-5 py-2.5">{t('common.options')}</th>
								<th class="w-10 px-5 py-2.5"></th>
							</tr></thead
						>
						<tbody class="divide-y divide-(--ui-border-muted) text-[13px]">
							{#each modCtrl.pagedList as m (m.id)}
								<tr>
									<td class="px-5 py-3 font-semibold"
										>{m.data.name}{#if m.data.singleChoice}<span
												class="ml-2 text-[10px] text-(--ui-text-dimmed)">single</span
											>{/if}</td
									>
									<td class="px-5 py-3 text-(--ui-text-muted)"
										>{m.data.options?.map((o) => o.name).join(', ') || '—'}</td
									>
									<td class="px-5 py-3 text-right"><RowActions actions={modActions(m)} /></td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
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
				title={t('catalog.noBundles')}
				description="Create product bundles to sell items together at a special price."
			>
				{#snippet actions()}<Button
						color="primary"
						size="sm"
						icon="lucide:plus"
						onclick={openBundleCreate}>{t('common.add')} {t('common.bundle')}</Button
					>{/snippet}
			</EmptyState>
		{:else}
			<div class="data-panel">
				<div class="overflow-x-auto">
					<table class="table-surface w-full text-left">
						<thead
							><tr>
								<th class="px-5 py-2.5">{t('common.bundle')}</th>
								<th class="px-5 py-2.5">Price Mode</th>
								<th class="px-5 py-2.5 text-right">{t('common.price')}</th>
								<th class="px-5 py-2.5 text-center">{t('common.groups')}</th>
								<th class="px-5 py-2.5 text-center">{t('common.sort')}</th>
								<th class="px-5 py-2.5 text-center">{t('common.status')}</th>
								<th class="w-10 px-5 py-2.5"></th>
							</tr></thead
						>
						<tbody class="divide-y divide-(--ui-border-muted) text-[13px]">
							{#each filteredBundles as b (b.id)}
								<tr>
									<td class="px-5 py-3">
										<div class="flex items-center gap-2">
											{#if b.image}
												<img
													src={b.image}
													alt=""
													loading="lazy"
													decoding="async"
													class="size-8 rounded-lg object-cover"
												/>
											{/if}
											<div>
												<div class="font-semibold">{b.name}</div>
												{#if b.description}<div class="text-[11.5px] text-(--ui-text-dimmed)">
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
										{:else}<span class="text-[11px] text-(--ui-text-dimmed)">auto</span>{/if}
									</td>
									<td class="px-5 py-3 text-center tabular-nums">{b.groups.length}</td>
									<td class="px-5 py-3 text-center text-(--ui-text-muted) tabular-nums"
										>{b.sortOrder}</td
									>
									<td class="px-5 py-3 text-center">
										<button
											type="button"
											onclick={() => toggleBundleStatus(b.id)}
											class="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold transition {b.status ===
											'active'
												? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
												: 'bg-(--ui-bg-accented) text-(--ui-text-dimmed)'}"
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

<Dialog
	bind:open={bDlgOpen}
	title={bEditingId
		? t('common.edit') + ' ' + t('common.bundle')
		: t('common.add') + ' ' + t('common.bundle')}
>
	<div class="space-y-3">
		<label class="block"
			><span class="mb-1.5 block text-[12px] font-semibold text-(--ui-text-muted)"
				>{t('common.name')}</span
			><Input bind:value={bName} icon="lucide:package-open" class="w-full" /></label
		>
		<label class="block"
			><span class="mb-1.5 block text-[12px] font-semibold text-(--ui-text-muted)"
				>{t('common.description')}</span
			><Input bind:value={bDesc} class="w-full" /></label
		>
		<MediaImageInput
			bind:value={bImage}
			purpose="brand"
			preview="wide"
			placeholder="Brand / banner image URL"
		/>
		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
			<div>
				<span class="mb-1.5 block text-[12px] font-semibold text-(--ui-text-muted)">Price Mode</span
				>
				<div class="segmented flex gap-1 p-1">
					<button
						type="button"
						onclick={() => (bPriceMode = 'fixed')}
						class="flex-1 rounded-md px-3 py-1.5 text-[11.5px] font-semibold {bPriceMode === 'fixed'
							? 'bg-(--ui-bg-elevated)'
							: 'text-(--ui-text-muted)'}">Fixed</button
					>
					<button
						type="button"
						onclick={() => (bPriceMode = 'sum_components')}
						class="flex-1 rounded-md px-3 py-1.5 text-[11.5px] font-semibold {bPriceMode ===
						'sum_components'
							? 'bg-(--ui-bg-elevated)'
							: 'text-(--ui-text-muted)'}">Sum</button
					>
					<button
						type="button"
						onclick={() => (bPriceMode = 'discounted')}
						class="flex-1 rounded-md px-3 py-1.5 text-[11.5px] font-semibold {bPriceMode ===
						'discounted'
							? 'bg-(--ui-bg-elevated)'
							: 'text-(--ui-text-muted)'}">{t('common.discount')}</button
					>
				</div>
			</div>
			<label class="block"
				><span class="mb-1.5 block text-[12px] font-semibold text-(--ui-text-muted)"
					>Sort order</span
				><Input bind:value={bSortOrder} type="number" min="0" class="w-full" /></label
			>
		</div>
		{#if bPriceMode === 'fixed'}
			<label class="block"
				><span class="mb-1.5 block text-[12px] font-semibold text-(--ui-text-muted)"
					>Fixed price ({currency})</span
				><NumberInput bind:value={bFixedPrice} min={0} decimals={2} class="w-full" /></label
			>
		{/if}
		{#if bPriceMode === 'discounted'}
			<label class="block"
				><span class="mb-1.5 block text-[12px] font-semibold text-(--ui-text-muted)"
					>Discount %</span
				><NumberInput
					bind:value={bDiscountPercent}
					min={0}
					max={100}
					maxDecimals={2}
					class="w-full"
				/></label
			>
		{/if}
		{#if bundleRegularPrice > 0}
			<div class="flex items-center gap-4 rounded-lg bg-(--ui-bg-accented) p-3">
				<div>
					<p class="text-[11px] text-(--ui-text-dimmed)">Regular price</p>
					<p class="font-bold">{formatMoney(bundleRegularPrice, currency)}</p>
				</div>
				{#if bundleFinalPrice < bundleRegularPrice}
					<div>
						<p class="text-[11px] text-(--ui-text-dimmed)">Bundle price</p>
						<p class="font-bold text-emerald-600 dark:text-emerald-400">
							{formatMoney(bundleFinalPrice, currency)}
						</p>
					</div>
					<div>
						<p class="text-[11px] text-(--ui-text-dimmed)">Savings</p>
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
				<span class="text-[12px] font-semibold text-(--ui-text-muted)">Product groups</span>
				<Button size="sm" variant="ghost" icon="lucide:plus" onclick={addBundleGroup}
					>Add group</Button
				>
			</div>
			<div class="space-y-3">
				{#each bGroups as group, gIdx (group.id)}
					<div
						class="space-y-2 rounded-lg border border-(--ui-border-muted) bg-(--ui-bg-muted) p-3"
					>
						<div class="flex items-center gap-2">
							<Input
								bind:value={group.name}
								placeholder="Group name (e.g. Choose drink)"
								class="flex-1"
							/>
							<button
								type="button"
								class="flex size-7 items-center justify-center rounded text-(--tone-error-text) hover:bg-rose-500/10"
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
							<span class="mb-1 block text-[11px] font-semibold text-(--ui-text-dimmed)"
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
											: 'border-(--ui-border) text-(--ui-text-muted) hover:bg-(--ui-bg-accented)'}"
										>{prod.data.name}</button
									>
								{/each}
								{#if products.length === 0}<span class="text-[11px] text-(--ui-text-dimmed)"
										>No products available</span
									>{/if}
							</div>
						</div>
					</div>
				{/each}
				{#if bGroups.length === 0}<div class="py-3 text-center text-[11px] text-(--ui-text-dimmed)">
						Add a group to select products
					</div>{/if}
			</div>
		</div>
	</div>
	{#snippet footer()}<Button color="neutral" variant="ghost" onclick={() => (bDlgOpen = false)}
			>{t('common.cancel')}</Button
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
					><span class="mb-1.5 block text-[12px] font-semibold text-(--ui-text-muted)"
						>{t('common.name')}</span
					><Input bind:value={pName} icon="lucide:package" class="w-full" /></label
				>

				<!-- Price / Cost / Compare-at -->
				<div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
					<label class="block"
						><span class="mb-1.5 block text-[12px] font-semibold text-(--ui-text-muted)"
							>Price ({currency})</span
						><NumberInput
							bind:value={pPrice}
							icon="lucide:banknote"
							min={0}
							decimals={2}
							class="w-full"
						/></label
					>
					<label class="block"
						><span class="mb-1.5 block text-[12px] font-semibold text-(--ui-text-muted)"
							>{t('common.cost')}</span
						><NumberInput
							bind:value={pCostPrice}
							icon="lucide:wallet"
							min={0}
							decimals={2}
							placeholder="0.00"
							class="w-full"
						/></label
					>
					<label class="block"
						><span class="mb-1.5 block text-[12px] font-semibold text-(--ui-text-muted)"
							>Compare-at</span
						><NumberInput
							bind:value={pCompareAtPrice}
							icon="lucide:tag"
							min={0}
							decimals={2}
							placeholder="0.00"
							class="w-full"
						/></label
					>
				</div>

				<!-- Category + Unit -->
				<div class="grid grid-cols-2 gap-3">
					<label class="block"
						><span class="mb-1.5 block text-[12px] font-semibold text-(--ui-text-muted)"
							>{t('common.category')}</span
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
						><span class="mb-1.5 block text-[12px] font-semibold text-(--ui-text-muted)"
							>{t('common.unit')}</span
						><Select
							bind:value={pUnitId}
							class="w-full"
							options={[
								{ value: '', label: t('common.none') },
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
						><span class="mb-1.5 block text-[12px] font-semibold text-(--ui-text-muted)"
							>{t('common.sku')}</span
						><Input bind:value={pSku} icon="lucide:barcode" class="w-full" /></label
					>
					<label class="block"
						><span class="mb-1.5 block text-[12px] font-semibold text-(--ui-text-muted)"
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
					><span class="mb-1.5 block text-[12px] font-semibold text-(--ui-text-muted)"
						>{t('common.description')}</span
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
					<Checkbox bind:checked={pIsPublic} size="sm" label="Public" />
					<Checkbox bind:checked={pAvailable} size="sm" label="Available" />
					<Checkbox bind:checked={pTaxInclusive} size="sm" label="Tax inclusive" />
				</div>

				<!-- prepTime + sortOrder -->
				<div class="grid grid-cols-2 gap-3">
					<label class="block"
						><span class="mb-1.5 block text-[12px] font-semibold text-(--ui-text-muted)"
							>Prep time (min)</span
						><NumberInput
							bind:value={pPrepTime}
							min={0}
							maxDecimals={0}
							decimals={0}
							icon="lucide:timer"
							placeholder="0"
							class="w-full"
						/></label
					>
					<label class="block"
						><span class="mb-1.5 block text-[12px] font-semibold text-(--ui-text-muted)"
							>Sort order</span
						><NumberInput
							bind:value={pSortOrder}
							min={0}
							maxDecimals={0}
							decimals={0}
							icon="lucide:arrow-down-up"
							placeholder="0"
							class="w-full"
						/></label
					>
				</div>

				<!-- Variants -->
				<div>
					<span class="mb-1.5 block text-[12px] font-semibold text-(--ui-text-muted)"
						>Variants (sizes)</span
					>
					{#if pVariants.length}
						<ul class="mb-2 space-y-1">
							{#each pVariants as v, i (i)}
								<li
									class="flex items-center gap-2 rounded-lg border border-(--ui-border-muted) px-2.5 py-1.5 text-[12.5px]"
								>
									<span class="flex-1 font-semibold">{v.name}</span><span
										class="text-(--ui-text-muted) tabular-nums"
										>{v.price >= 0 ? '+' : ''}{v.price}</span
									><button
										type="button"
										class="text-(--tone-error-text)"
										onclick={() => removeVariant(i)}
										aria-label={t('common.remove')}
										><Icon name="lucide:x" class="size-3.5" /></button
									>
								</li>
							{/each}
						</ul>
					{/if}
					<div class="flex gap-2">
						<Input bind:value={pVariantName} placeholder="Large" class="flex-1" />
						<NumberInput
							bind:value={pVariantPrice}
							decimals={2}
							placeholder="price adj."
							class="w-28"
						/>
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
						<span class="mb-1.5 block text-[12px] font-semibold text-(--ui-text-muted)"
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
										: 'border-(--ui-border) text-(--ui-text-muted) hover:bg-(--ui-bg-accented)'}"
									>{m.data.name}</button
								>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Inventory policy -->
				<div>
					<Checkbox
						bind:checked={pTrackInv}
						size="sm"
						label="Track inventory & show stock in POS"
					/>
					{#if pTrackInv}
						<div class="mt-2 grid grid-cols-2 gap-2">
							<NumberInput
								bind:value={pLowStock}
								min={0}
								maxDecimals={0}
								decimals={0}
								icon="lucide:alert-triangle"
								placeholder="Low-stock alert at"
								class="w-full"
							/>
							<Checkbox
								bind:checked={pDenyOos}
								size="sm"
								label="Block sale when out of stock"
								class="items-center rounded-lg border border-(--ui-border-muted) px-2.5 py-2"
							/>
						</div>
					{/if}
				</div>
			</div>
		</div>
	{:else if dlgKind === 'categories'}
		<div class="space-y-3">
			<label class="block"
				><span class="mb-1.5 block text-[12px] font-semibold text-(--ui-text-muted)"
					>{t('common.name')}</span
				><Input bind:value={cName} icon="lucide:folder" class="w-full" /></label
			>
			<label class="block"
				><span class="mb-1.5 block text-[12px] font-semibold text-(--ui-text-muted)"
					>{t('common.description')}</span
				><Input bind:value={cDesc} class="w-full" /></label
			>
			<div class="grid grid-cols-2 gap-3">
				<label class="block"
					><span class="mb-1.5 block text-[12px] font-semibold text-(--ui-text-muted)"
						>Icon (lucide or emoji)</span
					><Input
						bind:value={cIcon}
						icon="lucide:star"
						placeholder="lucide:coffee"
						class="w-full"
					/></label
				>
				<label class="block"
					><span class="mb-1.5 block text-[12px] font-semibold text-(--ui-text-muted)">Color</span
					><Input bind:value={cColor} type="color" placeholder="#6366f1" class="w-full" /></label
				>
			</div>
			<div class="grid grid-cols-2 gap-3">
				<label class="block"
					><span class="mb-1.5 block text-[12px] font-semibold text-(--ui-text-muted)"
						>Sort order</span
					><Input bind:value={cOrder} type="number" class="w-full" /></label
				>
				<label class="block"
					><span class="mb-1.5 block text-[12px] font-semibold text-(--ui-text-muted)"
						>{t('common.status')}</span
					><Select
						bind:value={cStatus}
						class="w-full"
						options={[
							{ value: 'active', label: 'Active' },
							{ value: 'inactive', label: t('common.inactive') }
						]}
					/></label
				>
			</div>
		</div>
	{:else if dlgKind === 'units'}
		<div class="space-y-3">
			<div class="grid grid-cols-2 gap-3">
				<label class="block"
					><span class="mb-1.5 block text-[12px] font-semibold text-(--ui-text-muted)"
						>{t('common.name')}</span
					><Input bind:value={uName} placeholder="Kilogram" class="w-full" /></label
				>
				<label class="block"
					><span class="mb-1.5 block text-[12px] font-semibold text-(--ui-text-muted)"
						>{t('common.symbol')}</span
					><Input bind:value={uSymbol} placeholder="kg" class="w-full" /></label
				>
			</div>
			<label class="block"
				><span class="mb-1.5 block text-[12px] font-semibold text-(--ui-text-muted)"
					>{t('common.type')}</span
				>
				<Select
					bind:value={uType}
					options={[
						{ value: 'count', label: t('common.count') },
						{ value: 'weight', label: 'Weight' },
						{ value: 'volume', label: 'Volume' },
						{ value: 'length', label: 'Length' },
						{ value: 'time', label: t('common.time') }
					]}
					class="w-full"
				/>
			</label>
			<div class="grid grid-cols-2 gap-3">
				<label class="block"
					><span class="mb-1.5 block text-[12px] font-semibold text-(--ui-text-muted)"
						>Base unit</span
					><Select
						bind:value={uBaseUnitId}
						class="w-full"
						options={[
							{ value: '', label: t('common.none') },
							...units
								.filter((u2) => u2.id !== editingId)
								.map((u2) => ({ value: u2.id, label: u2.data.name ?? u2.id }))
						]}
					/></label
				>
				<label class="block"
					><span class="mb-1.5 block text-[12px] font-semibold text-(--ui-text-muted)"
						>Conversion factor</span
					><NumberInput
						bind:value={uConversionFactor}
						min={0}
						maxDecimals={4}
						placeholder="1"
						class="w-full"
					/></label
				>
			</div>
		</div>
	{:else}
		<div class="space-y-3">
			<label class="block"
				><span class="mb-1.5 block text-[12px] font-semibold text-(--ui-text-muted)"
					>Group name</span
				><Input bind:value={mName} placeholder="Size" class="w-full" /></label
			>
			<label class="block"
				><span class="mb-1.5 block text-[12px] font-semibold text-(--ui-text-muted)"
					>Options (comma separated)</span
				><Input bind:value={mOpt} placeholder="Small, Medium, Large" class="w-full" /></label
			>
		</div>
	{/if}
	{#snippet footer()}
		<Button color="neutral" variant="ghost" onclick={() => (dlgOpen = false)}
			>{t('common.cancel')}</Button
		>
		<Button color="primary" icon="lucide:check" onclick={save}
			>{isEditing ? t('common.update') : t('common.save')}</Button
		>
	{/snippet}
</Dialog>

<RawDataDialog bind:open={rawOpen} data={rawItem} title={t('common.productRawData')} />

<ProductDetail bind:product={detailProduct} bind:open={detailOpen} />

<!-- Quick stock adjust from catalog -->
<Dialog bind:open={quickAdjustOpen} title={t('inventory.adjustStock')}>
	<div class="space-y-3">
		<p class="text-[12.5px] text-(--ui-text-muted)">
			Adjusting stock for <span class="font-semibold">{quickAdjustName}</span>
		</p>
		<div class="segmented flex gap-1 p-1">
			<button
				type="button"
				onclick={() => (quickAdjustDir = 'increase')}
				class="flex-1 rounded-md px-3 py-1.5 text-[11.5px] font-semibold {quickAdjustDir ===
				'increase'
					? 'bg-(--ui-bg-elevated)'
					: 'text-(--ui-text-muted)'}">↑ Stock in</button
			>
			<button
				type="button"
				onclick={() => (quickAdjustDir = 'decrease')}
				class="flex-1 rounded-md px-3 py-1.5 text-[11.5px] font-semibold {quickAdjustDir ===
				'decrease'
					? 'bg-(--ui-bg-elevated)'
					: 'text-(--ui-text-muted)'}">↓ Stock out</button
			>
		</div>
		<label class="block"
			><span class="mb-1.5 block text-[12px] font-semibold text-(--ui-text-muted)"
				>{t('common.quantity')}</span
			><Input bind:value={quickAdjustQty} type="number" min="1" class="w-full" /></label
		>
		<label class="block"
			><span class="mb-1.5 block text-[12px] font-semibold text-(--ui-text-muted)"
				>{t('common.reason')}</span
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
			onclick={() => (quickAdjustOpen = false)}>{t('common.cancel')}</Button
		><Button color="primary" icon="lucide:check" onclick={saveQuickAdjust}
			>{t('common.save')}</Button
		>{/snippet}
</Dialog>

<!-- Import starter kits from the templates marketplace -->
<Dialog bind:open={tmplOpen} title="From templates — BNOS catalog presets" size="lg">
	<div class="space-y-3">
		<p class="text-[12.5px] text-(--ui-text-muted)">
			Native starter kits for a café, noodle shop, restaurant and mini-mart are included — pick one
			below and hit Apply, no network needed. You can also load the remote
			<span class="font-semibold">templates</span> marketplace catalog by URL, search your relays for
			kits published by creators, or paste JSON. Each kit is namespaced, so re-applying updates its records
			instead of duplicating them.
		</p>
		<div class="flex items-end gap-2">
			<label class="min-w-0 flex-1">
				<span class="mb-1.5 block text-[12px] font-semibold text-(--ui-text-muted)"
					>Preset catalog URL</span
				>
				<Input
					bind:value={tmplUrl}
					placeholder="https://bnos.market/bnos-presets.json"
					class="w-full"
				/>
			</label>
			<Button
				color="neutral"
				variant="subtle"
				icon="lucide:refresh-cw"
				onclick={loadTemplateCatalog}>{tmplLoading ? 'Loading…' : 'Load'}</Button
			>
			<Button
				color="neutral"
				variant="subtle"
				icon="lucide:radio"
				onclick={loadTemplateCatalogFromRelays}
				>{tmplRelayLoading ? 'Searching…' : 'From relays'}</Button
			>
		</div>
		{#if tmplError}
			<p class="rounded-lg bg-(--tone-error-bg) px-3 py-2 text-[12px] text-(--tone-error-text)">
				{tmplError}
			</p>
		{/if}
		{#if tmplItems.length}
			<div class="flex items-center justify-between">
				<span class="text-[12px] text-(--ui-text-muted)"
					>{tmplItems.length} kits · {tmplSelected.size} selected</span
				>
				<button
					type="button"
					class="text-[12px] font-semibold text-(--ui-text) underline"
					onclick={toggleAllTemplates}
					>{tmplSelected.size === tmplItems.length ? 'Clear all' : 'Select all'}</button
				>
			</div>
			<ul class="divide-y divide-(--ui-border-muted) rounded-xl border border-(--ui-border)">
				{#each tmplItems as item (item.presetId)}
					<li class="flex items-start gap-3 p-3">
						<Checkbox
							size="sm"
							checked={tmplSelected.has(item.presetId)}
							onCheckedChange={() => toggleTemplateItem(item.presetId)}
						/>
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2">
								<span class="truncate text-[13px] font-semibold">{item.name}</span>
								{#if item.publisher === 'Built-in'}
									<Badge color="primary">Built-in</Badge>
								{/if}
								{#if item.version}
									<span class="text-[11px] text-(--ui-text-dimmed)">v{item.version}</span>
								{/if}
							</div>
							{#if item.summary}
								<p class="text-[12px] text-(--ui-text-muted)">{item.summary}</p>
							{/if}
							<p class="text-[11px] text-(--ui-text-dimmed)">
								{item.counts.products} products · {item.counts.categories} categories · {item.counts
									.units} units · {item.counts.modifierGroups} modifiers{item.publisher &&
								item.publisher !== 'Built-in'
									? ` · ${item.publisher}`
									: ''}
							</p>
							<button
								type="button"
								class="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-(--ui-text) underline underline-offset-2"
								onclick={() => openTemplatePreview(item)}
							>
								<Icon name="lucide:eye" class="size-3" /> Preview {item.counts.products} products
							</button>
						</div>
					</li>
				{/each}
			</ul>
		{:else}
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-(--ui-text-muted)"
					>…or paste the catalog JSON (bnos-presets.json)</span
				>
				<Input
					textarea
					rows={5}
					bind:value={tmplPaste}
					placeholder="Paste the contents of bnos-presets.json here"
				/>
			</label>
			<Button
				color="neutral"
				variant="subtle"
				size="sm"
				icon="lucide:clipboard-paste"
				onclick={loadPastedCatalog}
				disabled={!tmplPaste.trim()}>Use pasted JSON</Button
			>
		{/if}
	</div>
	{#snippet footer()}
		<Button color="neutral" variant="ghost" onclick={() => (tmplOpen = false)}>Close</Button>
		<Button
			color="primary"
			icon="lucide:download"
			onclick={applySelectedTemplates}
			disabled={tmplApplying || tmplSelected.size === 0}
			>{tmplApplying ? 'Applying…' : `Apply ${tmplSelected.size || ''}`.trim()}</Button
		>
	{/snippet}
</Dialog>

<!-- Preview the products inside a starter kit before applying -->
<Dialog
	bind:open={previewOpen}
	title={previewItem ? `${previewItem.name} · preview` : 'Starter kit preview'}
	size="lg"
>
	{#if previewItem}
		<div class="space-y-4">
			<div>
				{#if previewItem.summary}
					<p class="text-[12.5px] text-(--ui-text-muted)">{previewItem.summary}</p>
				{/if}
				<p class="mt-1 text-[11.5px] text-(--ui-text-dimmed)">
					{previewItem.counts.products} products · {previewItem.counts.categories} categories ·
					{previewItem.counts.units} units · {previewItem.counts.modifierGroups} modifier groups
					{previewItem.publisher && previewItem.publisher !== 'Built-in'
						? ` · ${previewItem.publisher}`
						: ''}
				</p>
			</div>

			{#if previewItem.preset.categories.length}
				<div class="flex flex-wrap gap-1.5">
					{#each previewItem.preset.categories as category (category.key)}
						<Badge color="neutral">{category.name}</Badge>
					{/each}
				</div>
			{/if}

			<div class="overflow-hidden rounded-xl border border-(--ui-border)">
				<div
					class="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-3 border-b border-(--ui-border-muted) bg-(--ui-bg-accented) px-3 py-2 text-[11px] font-semibold tracking-wide text-(--ui-text-muted) uppercase"
				>
					<span>Product</span>
					<span class="text-right">Options</span>
					<span class="text-right">Price</span>
				</div>
				<ul class="max-h-[52vh] divide-y divide-(--ui-border-muted) overflow-y-auto">
					{#each previewItem.preset.products as product (product.key)}
						<li class="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-3 py-2">
							<div class="min-w-0">
								<div class="truncate text-[12.5px] font-medium text-(--ui-text)">
									{product.name}
								</div>
								<div class="truncate text-[11px] text-(--ui-text-dimmed)">
									{previewCategoryName(previewItem, product.categoryKey)}
									{#if product.sku}· {product.sku}{/if}
								</div>
							</div>
							<span class="text-right text-[11px] text-(--ui-text-muted)">
								{product.modifierGroupKeys?.length
									? `${product.modifierGroupKeys.length} groups`
									: '—'}
							</span>
							<span class="text-right font-mono text-[11.5px] whitespace-nowrap text-(--ui-text)"
								>{previewProductPrice(previewItem, product.price, product.currency)}</span
							>
						</li>
					{/each}
				</ul>
			</div>

			{#if previewItem.preset.modifierGroups.length}
				<div>
					<div
						class="mb-1.5 text-[11px] font-semibold tracking-wide text-(--ui-text-muted) uppercase"
					>
						Modifier groups
					</div>
					<ul class="space-y-1">
						{#each previewItem.preset.modifierGroups as group (group.key)}
							<li class="text-[12px] text-(--ui-text-muted)">
								<span class="font-medium text-(--ui-text)">{group.name}</span>
								{group.required ? ' · required' : ''} · {group.modifiers?.length ?? 0}
								options
								<span class="text-(--ui-text-dimmed)"
									>({group.modifiers?.map((m) => m.name).join(', ')})</span
								>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		</div>
	{/if}
	{#snippet footer()}
		<Button color="neutral" variant="ghost" onclick={() => (previewOpen = false)}>Close</Button>
		<Button
			color="primary"
			icon="lucide:download"
			disabled={!previewItem || tmplApplying}
			onclick={applyPreviewedTemplate}>{tmplApplying ? 'Applying…' : 'Apply this kit'}</Button
		>
	{/snippet}
</Dialog>
