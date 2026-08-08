<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { t } from '$lib/i18n/i18n.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Menu from '$lib/components/ui/Menu.svelte';
	import MenuItem from '$lib/components/ui/MenuItem.svelte';
	import MenuDivider from '$lib/components/ui/MenuDivider.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Popover from '$lib/components/ui/Popover.svelte';
	import { glo } from '$nostr/store.svelte';
	import { dataSync } from '$nostr/sync.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { WORKSPACE_SETTINGS_SYNC_EVENT } from '$nostr/workspace-settings';
	import { toast } from '$lib/stores/toast.svelte';
	import { confirm } from '$lib/stores/confirm.svelte';
	import { formatInt, formatMoney } from '$lib/utils/format';
	import {
		TYPE,
		statusColor,
		type Product,
		type ProductVariant,
		type ModifierGroup,
		type GloObject,
		type Order,
		type Customer,
		type LoyaltyPoints,
		type PaymentMethod
	} from '$lib/domain';
	import { newRecordId } from '$lib/utils/record-id';
	import CustomerPicker from '$lib/components/pos/CustomerPicker.svelte';
	import { loadLoyaltySettings, type LoyaltySettings } from '$lib/settings/local';
	import { pointsForSpend, maxRedeem, buildLoyaltyTx } from '$lib/pos/loyalty';
	import { logActivity } from '$lib/audit.svelte';
	import { permissions } from '$lib/permissions.svelte';
	import {
		cart,
		type OrderType,
		type CartModifier,
		type CompletedSale
	} from '$lib/pos/cart.svelte';
	import PaymentSuccessHeader from '$lib/pos/PaymentSuccessHeader.svelte';
	import {
		isAutoApplicable,
		isPromotionEligible,
		isPromoLive,
		promoCoversProduct,
		shouldAutoApply,
		normalizeType,
		promoValue,
		promoName,
		promoValueLabel,
		promoIcon,
		promoSavings,
		type PromoCtx,
		type PromoData
	} from '$lib/pos/promotions';
	import { shifts as shiftStore } from '$lib/pos/shifts.svelte';
	import { startBarcodeScanner } from '$lib/pos/barcode-scanner';
	import { computeStock, availableFor, canSell } from '$lib/pos/stock';
	import { printPosReceipt } from '$lib/pos/pos-receipt';
	import { btcRate } from '$lib/bitcoin/rate.svelte';
	import { buildPaymentQr, isQrMethod, type PaymentQrResult } from '$lib/pos/payment-qr';
	import { loadPayConfig } from '$lib/pos/pay-config';
	import { getMerchantLightning } from '$lib/pos/lightning';
	import { getActiveLightningProvider, type LightningProvider } from '$lib/pos/lightning-providers';
	import QrCode from '$lib/components/ui/QrCode.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import {
		loadGeneralSettings,
		loadHardwareSettings,
		loadReceiptSettings,
		type GeneralSettings,
		type HardwareSettings,
		type ReceiptSettings
	} from '$lib/settings/local';

	interface PromotionData {
		status?: string;
		isActive?: boolean;
		active?: boolean;
		startDate?: string;
		endDate?: string;
		usageLimit?: number;
		currentUsage?: number;
		type?: 'percent' | 'fixed';
		discountType?: 'percent' | 'fixed';
		value?: number;
		discountValue?: number;
		name?: string;
		description?: string;
	}

	let now = $state(new Date());
	let generalSettings = $state<GeneralSettings>(loadGeneralSettings());
	let hardwareSettings = $state<HardwareSettings>(loadHardwareSettings());
	let receiptSettings = $state<ReceiptSettings>(loadReceiptSettings());
	let loyaltySettings = $state<LoyaltySettings>(loadLoyaltySettings());

	function refreshLocalSettings() {
		generalSettings = loadGeneralSettings();
		hardwareSettings = loadHardwareSettings();
		receiptSettings = loadReceiptSettings(tenant.state.organizationName || 'BNOS');
		loyaltySettings = loadLoyaltySettings();
	}

	onMount(() => {
		refreshLocalSettings();
		method = payMethods.includes(generalSettings.defaultPayment)
			? generalSettings.defaultPayment
			: 'cash';
		splitMethod = method;
		// Auto-focus the scan/search field when a scanner is enabled so the cashier
		// can start scanning immediately without reaching for the mouse.
		if (loadHardwareSettings().barcodeScanner) focusSearch();

		dataSync.pageSync(
			[
				TYPE.product,
				TYPE.category,
				TYPE.modifierGroup,
				TYPE.adjustment,
				TYPE.shift,
				TYPE.order,
				TYPE.promotion,
				TYPE.refund,
				TYPE.loyaltyPoints
			],
			{ scope: 'pos' }
		);

		const timer = window.setInterval(() => {
			now = new Date();
		}, 60_000);

		const onWorkspaceSettingsSync = () => {
			refreshLocalSettings();
			if (payMethods.includes(generalSettings.defaultPayment)) {
				method = generalSettings.defaultPayment;
				if (splitPayments.length === 0) splitMethod = generalSettings.defaultPayment;
			}
		};
		window.addEventListener(WORKSPACE_SETTINGS_SYNC_EVENT, onWorkspaceSettingsSync);

		return () => {
			window.clearInterval(timer);
			window.removeEventListener(WORKSPACE_SETTINGS_SYNC_EVENT, onWorkspaceSettingsSync);
		};
	});

	// ── Promotions ──
	// All broadly-active promotions (status check only). Per-cart eligibility
	// (date / time window / min-spend / targeting / usage) is evaluated by the
	// promo engine so the cart rail can auto-suggest offers the current sale
	// actually qualifies for. See ./promotions.ts.
	const allPromotions = $derived(
		glo
			.all<PromotionData, typeof TYPE.promotion>(TYPE.promotion)
			.filter(
				(p) => p.data.status === 'active' || p.data.isActive !== false || p.data.active !== false
			)
	);

	let promoOpen = $state(false);
	// Pause auto-apply after a manual removal (cashier intent wins) + remember
	// the id of the promo most recently auto-applied (drives the "Auto" tag).
	let autoApplySuppressed = $state(false);
	let autoAppliedId = $state<string | null>(null);

	function applyPromotion(promoId: string | null) {
		if (promoId) {
			const promo = allPromotions.find((p) => p.id === promoId);
			if (promo) {
				const d = promo.data;
				const kind = normalizeType(d.type ?? d.discountType);
				if (kind === 'percent') cart.setDiscount({ type: 'percent', value: promoValue(d) });
				else if (kind === 'fixed') cart.setDiscount({ type: 'fixed', value: promoValue(d) });
				// manual types (BOGO / bundle) → tag the order only, no auto discount
				cart.setPromotion(promoId);
				autoAppliedId = null; // cashier chose this manually → no longer “auto”
				toast.success('Promotion applied', promoName(d, currency));
				void logActivity({
					action: 'promotion',
					resource: 'promotion',
					resourceId: promoId,
					summary: `Applied promotion ${promoName(d, currency)}`
				});
			}
		} else {
			// Manual removal → pause auto-apply for the rest of this sale so we don't
			// immediately re-apply (or swap in a different one) against the cashier's intent.
			if (cart.appliedPromotionId) autoApplySuppressed = true;
			cart.setDiscount({ type: 'percent', value: 0 });
			cart.setPromotion(null);
			autoAppliedId = null;
			toast.info('Promotion removed');
			void logActivity({
				action: 'promotion',
				resource: 'promotion',
				summary: 'Removed promotion'
			});
		}
		promoOpen = false;
	}

	const currency = $derived(tenant.state.currency);
	const products = $derived(glo.all<Product, typeof TYPE.product>(TYPE.product));
	const modifiers = $derived(glo.all<ModifierGroup, typeof TYPE.modifierGroup>(TYPE.modifierGroup));
	const branchId = $derived(tenant.state.locationId ?? undefined);
	const stockMap = $derived(computeStock(glo.all(TYPE.adjustment), branchId));

	// Promotion eligibility context for the live cart (product/category targeting
	// + subtotal for minimum-spend checks).
	const productCategoryMap = $derived(
		new Map(products.map((p) => [p.id, (p.data.categoryId as string | undefined) ?? undefined]))
	);
	const cartProductIds = $derived(cart.items.map((i) => i.productId));
	const cartCategoryIds = $derived(
		Array.from(
			new Set(
				cart.items.map((i) => productCategoryMap.get(i.productId)).filter((v): v is string => !!v)
			)
		)
	);
	const promoCtx = $derived<PromoCtx>({
		subtotal: cart.totals.subtotal,
		currency,
		now,
		cartProductIds,
		cartCategoryIds
	});
	// Offers the current cart qualifies for AND the cart can apply automatically.
	const eligiblePromotions = $derived(
		allPromotions.filter(
			(p) => isAutoApplicable(p.data) && isPromotionEligible(p.data, promoCtx).ok
		)
	);
	// The promotion currently linked to the cart (drives the "applied" banner).
	const appliedPromoObj = $derived(
		cart.appliedPromotionId
			? (allPromotions.find((p) => p.id === cart.appliedPromotionId) ?? null)
			: null
	);
	// Auto-release a promotion that is no longer valid for this cart — e.g. the
	// customer removed items and the subtotal dropped below the minimum spend, or
	// a happy-hour window just ended.
	$effect(() => {
		const id = cart.appliedPromotionId;
		if (!id) return;
		const promo = allPromotions.find((p) => p.id === id);
		if (!promo) return;
		const elig = isPromotionEligible(promo.data, promoCtx);
		if (!elig.ok) {
			cart.setPromotion(null);
			cart.setDiscount({ type: 'percent', value: 0 });
			toast.info(
				'Promotion removed',
				`${promoName(promo.data, currency)} — ${elig.reason.toLowerCase()}`
			);
		}
	});

	// Was the currently-applied promo applied automatically? (drives the “Auto” tag)
	const isAutoApplied = $derived(
		cart.appliedPromotionId !== null && cart.appliedPromotionId === autoAppliedId
	);

	// Auto-apply the best eligible offer when the cart qualifies — but only when:
	//  • the merchant enabled it (General settings)
	//  • no promo is applied yet
	//  • the cashier hasn't set a manual discount (their intent wins)
	//  • the offer wasn't dismissed this sale
	// Picks the highest-saving qualifying offer; manual types never auto-apply.
	$effect(() => {
		if (!generalSettings.autoApplyPromotions) return;
		if (autoApplySuppressed) return;
		if (cart.appliedPromotionId || cart.isEmpty) return;
		if (cart.discount.value > 0) return; // a manual discount is active
		let best: { id: string; data: PromoData; savings: number } | null = null;
		for (const promo of eligiblePromotions) {
			if (!shouldAutoApply(promo.data)) continue;
			const savings = promoSavings(promo.data, cart.totals.subtotal);
			if (savings <= 0) continue;
			if (!best || savings > best.savings) best = { id: promo.id, data: promo.data, savings };
		}
		if (best) {
			const kind = normalizeType(best.data.type ?? best.data.discountType);
			if (kind === 'percent') cart.setDiscount({ type: 'percent', value: promoValue(best.data) });
			else if (kind === 'fixed') cart.setDiscount({ type: 'fixed', value: promoValue(best.data) });
			cart.setPromotion(best.id);
			autoAppliedId = best.id;
		}
	});

	// Fresh sale (empty cart) → forget dismissal + auto-apply state.
	$effect(() => {
		if (cart.isEmpty) {
			autoApplySuppressed = false;
			autoAppliedId = null;
		}
	});

	// Best live promotion per product — drives the "on offer" badge + effective
	// (discounted) price on each product card. Ignores cart state so the badge is
	// stable; the cart rail handles actual eligibility + apply.
	type ProductPromo = { data: PromoData; savings: number; newPrice: number; label: string };
	const productPromoMap = $derived.by(() => {
		const map: Record<string, ProductPromo> = {};
		if (allPromotions.length === 0) return map;
		for (const prod of products) {
			const price = prod.data.price ?? 0;
			if (price <= 0) continue;
			const cat = prod.data.categoryId as string | undefined;
			let best: { data: PromoData; savings: number } | null = null;
			for (const promo of allPromotions) {
				const d = promo.data;
				if (!isAutoApplicable(d) || !isPromoLive(d, now).ok) continue;
				if (!promoCoversProduct(d, prod.id, cat)) continue;
				const savings = promoSavings(d, price);
				if (savings <= 0) continue;
				if (!best || savings > best.savings) best = { data: d, savings };
			}
			if (best) {
				map[prod.id] = {
					data: best.data,
					savings: best.savings,
					newPrice: Math.max(0, price - best.savings),
					label: promoValueLabel(best.data, currency)
				};
			}
		}
		return map;
	});
	const offersCount = $derived(Object.keys(productPromoMap).length);
	let offersOnly = $state(false);

	let query = $state('');

	// ── Scan-or-search ──
	// The product search field doubles as a barcode scanner target: an exact
	// barcode/SKU match is the "scan to add" target. Typing a code + Enter (or a
	// USB scanner that types into the focused field + sends Enter) adds the
	// product instantly. Scanners firing while the field isn't focused are still
	// caught by the global HID capture (`barcode-scanner.ts`).
	const scanMatch = $derived.by(() => {
		const code = query.trim();
		if (code.length < 2) return null;
		return products.find((p) => p.data.barcode === code || p.data.sku === code) ?? null;
	});

	function focusSearch() {
		requestAnimationFrame(() => document.getElementById('pos-search')?.focus());
	}

	function onSearchKeydown(e: KeyboardEvent) {
		if (e.key !== 'Enter') return;
		const match = scanMatch;
		if (match) {
			e.preventDefault();
			query = '';
			tapProduct(match); // opens variant/modifier picker if needed, else adds
			toast.success('Added', (match.data.name as string) ?? 'Item');
			focusSearch();
		}
	}

	// ── Auto-add on exact code match after a brief typing pause ──
	// Tier-3 of the scan UX: type a full barcode/SKU on the keyboard and pause
	// (~600ms) → the product is added automatically, no Enter needed. Safe because
	// it only fires on an EXACT match against a product's barcode/SKU field (never
	// a name search). Enter still adds instantly; scanner bursts are caught
	// globally. Re-checks the input before adding so it never double-adds with
	// the Enter handler.
	let scanDebounce: ReturnType<typeof setTimeout> | null = null;
	$effect(() => {
		const code = query.trim();
		const match =
			code.length >= 4
				? (products.find((p) => p.data.barcode === code || p.data.sku === code) ?? null)
				: null;
		if (scanDebounce) clearTimeout(scanDebounce);
		if (match) {
			scanDebounce = setTimeout(() => {
				if (query.trim() !== code) return; // input changed → abort
				query = '';
				tapProduct(match);
				toast.success('Added', (match.data.name as string) ?? 'Item');
				focusSearch();
			}, 600);
		}
		return () => {
			if (scanDebounce) clearTimeout(scanDebounce);
		};
	});

	let activeCat = $state<string>('all');
	const categories = $derived.by(() => {
		const categories: string[] = [];
		for (const p of products) {
			const categoryId = p.data.categoryId as string | undefined;
			if (categoryId && !categories.includes(categoryId)) categories.push(categoryId);
		}
		return ['all', ...categories];
	});
	const filtered = $derived(
		products.filter((p) => {
			const matchesCat = activeCat === 'all' || p.data.categoryId === activeCat;
			const q = query.trim().toLowerCase();
			const matchesQuery = !q || (p.data.name ?? '').toLowerCase().includes(q);
			const sellable = p.data.status !== 'inactive' && p.data.status !== 'archived';
			const matchesOffers = !offersOnly || !!productPromoMap[p.id];
			return matchesCat && matchesQuery && sellable && matchesOffers;
		})
	);
	const trackedProducts = $derived(products.filter((p) => p.data.trackInventory).length);
	const lowStockCount = $derived(
		products.filter((p) => {
			const threshold = p.data.inventory?.lowStockThreshold ?? 0;
			return p.data.trackInventory && threshold > 0 && availableFor(stockMap, p.id) <= threshold;
		}).length
	);
	const lowStockItems = $derived(
		products
			.filter((p) => {
				const threshold = p.data.inventory?.lowStockThreshold ?? 0;
				return p.data.trackInventory && threshold > 0 && availableFor(stockMap, p.id) <= threshold;
			})
			.slice(0, 6)
	);
	const clockLabel = $derived(
		new Intl.DateTimeFormat('en-US', {
			hour: 'numeric',
			minute: '2-digit'
		}).format(now)
	);
	const dateLabel = $derived(
		new Intl.DateTimeFormat('en-US', {
			weekday: 'short',
			month: 'short',
			day: 'numeric'
		}).format(now)
	);

	// ── product → modifier groups resolver ──
	function groupsFor(p: Product): ModifierGroup[] {
		const ids = p.modifierGroupIds ?? [];
		if (!ids.length) return [];
		return modifiers.filter((m) => m.data && ids.includes(m.id)).map((m) => m.data);
	}
	function variants(p: Product) {
		return p.variants ?? [];
	}

	// ── selection modals ──
	type SelProduct = { obj: GloObject<Product, typeof TYPE.product>; data: Product };
	let sizeSel = $state<SelProduct | null>(null);
	let modSel = $state<SelProduct | null>(null);
	// Open state is tracked separately from the data so that closing the dialog
	// (backdrop / X / Esc) reliably reopens it on the next tap. Binding
	// `open={!!sizeSel}` one-way left the Dialog's internal open stuck `false`
	// after a close because `sizeSel` was never cleared.
	let sizeOpen = $state(false);
	let modOpen = $state(false);
	$effect(() => {
		if (!sizeOpen) sizeSel = null;
		if (!modOpen) modSel = null;
	});
	let chosenVariant = $state<string>('');
	let chosenMods = $state<Record<string, string[]>>({});
	let pendingNote = $state('');
	let pendingModVariant: { variantId: string; variantName: string; unitPrice: number } | null =
		null;

	function variantPrice(base: number, v: ProductVariant): number {
		if (!v) return base;
		return v.priceModifierType === 'relative'
			? base * (1 + (v.priceModifier ?? 0) / 100)
			: base + (v.priceModifier ?? 0);
	}

	function tapProduct(p: GloObject<Product, typeof TYPE.product>) {
		const data = p.data;
		if (variants(data).length) {
			sizeSel = { obj: p, data };
			chosenVariant = '';
			pendingNote = '';
			sizeOpen = true;
			return;
		}
		if (groupsFor(data).length) {
			modSel = { obj: p, data };
			chosenMods = {};
			pendingNote = '';
			modOpen = true;
			return;
		}
		addPlain(p);
	}

	function addPlain(p: GloObject<Product, typeof TYPE.product>) {
		const d = p.data;
		const available = availableFor(stockMap, p.id);
		const check = canSell({
			trackInventory: d.trackInventory as boolean | undefined,
			denySaleWhenOutOfStock: d.inventory?.denySaleWhenOutOfStock,
			allowBackorder: d.inventory?.allowBackorder,
			available,
			requested: 1
		});
		if (!check.ok) return toast.warning(check.reason);
		cart.add({ productId: p.id, name: d.name as string, unitPrice: (d.price as number) ?? 0 });
	}

	function confirmVariant() {
		if (!sizeSel) return;
		const v = variants(sizeSel.data).find((x) => x.id === chosenVariant);
		if (!v) return toast.warning('Pick a size');
		const price = variantPrice(sizeSel.data.price ?? 0, v);
		const available = availableFor(stockMap, sizeSel.obj.id, v.id);
		const check = canSell({
			trackInventory: sizeSel.data.trackInventory as boolean | undefined,
			denySaleWhenOutOfStock: sizeSel.data.inventory?.denySaleWhenOutOfStock,
			allowBackorder: sizeSel.data.inventory?.allowBackorder,
			available,
			requested: 1
		});
		if (!check.ok) return toast.warning(check.reason);
		const obj = sizeSel.obj;
		const variantId = v.id;
		const variantName = v.name;
		sizeOpen = false;
		if (groupsFor(obj.data).length) {
			modSel = { obj, data: obj.data };
			chosenMods = {};
			pendingModVariant = { variantId, variantName, unitPrice: price };
			modOpen = true;
			return;
		}
		cart.add({ productId: obj.id, name: obj.data.name, unitPrice: price, variantId, variantName });
	}

	function selectedModifierList(): CartModifier[] {
		if (!modSel) return [];
		const out: CartModifier[] = [];
		for (const g of groupsFor(modSel.data)) {
			const picked = chosenMods[g.name ?? ''] ?? [];
			for (const opt of g.modifiers ?? g.options ?? []) {
				if (picked.includes(opt.name)) {
					out.push({
						groupId: g.name,
						modifierId: opt.id ?? opt.name,
						name: opt.name,
						priceAdjustment: opt.priceAdjustment ?? opt.price ?? 0
					});
				}
			}
		}
		return out;
	}

	function toggleMod(group: string, name: string, single: boolean) {
		const current = chosenMods[group] ?? [];
		const next = current.includes(name)
			? current.filter((item) => item !== name)
			: single
				? [name]
				: [...current, name];
		chosenMods = { ...chosenMods, [group]: next };
	}

	function confirmModifiers() {
		if (!modSel) return;
		const mods = selectedModifierList();
		const ctx = pendingModVariant;
		pendingModVariant = null;
		const obj = modSel.obj;
		modOpen = false;
		cart.add({
			productId: obj.id,
			name: obj.data.name,
			unitPrice: ctx?.unitPrice ?? obj.data.price ?? 0,
			variantId: ctx?.variantId,
			variantName: ctx?.variantName,
			modifiers: mods.length ? mods : undefined,
			note: pendingNote.trim() || undefined
		});
		pendingNote = '';
	}

	// ── checkout ──
	let method = $state<string>('cash');
	let tendered = $state<number | ''>('');
	let processing = $state(false);

	// Tip
	let tipAmount = $state(0);
	function quickTip(pct: number) {
		tipAmount = Math.round((cart.totals.subtotal * pct) / 100);
	}

	// Grand total includes tip
	const grandTotal = $derived(cart.totals.total + tipAmount);

	// ── Loyalty ──
	const customers = $derived(glo.all<Customer, typeof TYPE.customer>(TYPE.customer));
	const cartCustomer = $derived(
		cart.customerId ? (customers.find((c) => c.id === cart.customerId) ?? null) : null
	);
	const customerPoints = $derived(cartCustomer?.data.loyaltyPoints ?? 0);
	// Largest redemption possible for this cart (capped at the subtotal).
	const loyaltyRedeem = $derived(
		loyaltySettings.enabled &&
			loyaltySettings.redeemEnabled &&
			cartCustomer &&
			cart.discount.value <= 0
			? maxRedeem(customerPoints, loyaltySettings.pointValue, cart.totals.subtotal)
			: { credit: 0, points: 0, remainderPoints: 0 }
	);
	const loyaltyEarnPreview = $derived(
		loyaltySettings.enabled && cartCustomer
			? pointsForSpend(grandTotal, loyaltySettings.pointsPerCurrency)
			: 0
	);
	let loyaltyRedeemOn = $state(false);

	function toggleLoyaltyRedeem() {
		if (!loyaltyRedeemOn) {
			if (cart.totals.discountAmount > 0) {
				toast.warning('Cannot combine loyalty with another discount');
				return;
			}
			if (loyaltyRedeem.credit <= 0) {
				toast.info('No points to redeem yet');
				return;
			}
			cart.setDiscount({ type: 'fixed', value: loyaltyRedeem.credit });
			loyaltyRedeemOn = true;
		} else {
			cart.setDiscount({ type: 'percent', value: 0 });
			loyaltyRedeemOn = false;
		}
	}

	// Award / deduct loyalty points after a completed sale.
	async function processLoyalty(sale: CompletedSale) {
		if (!loyaltySettings.enabled) return;
		const custId = sale.customerId ?? cart.customerId;
		if (!custId) return;
		const cust = glo.get(TYPE.customer, custId) as
			GloObject<Customer, typeof TYPE.customer> | undefined;
		if (!cust) return;
		const balanceBefore = cust.data.loyaltyPoints ?? 0;
		const redeemed = loyaltyRedeemOn ? loyaltyRedeem.points : 0;
		const earned = pointsForSpend(sale.totals.total, loyaltySettings.pointsPerCurrency);
		if (redeemed === 0 && earned === 0) return;
		const afterRedeem = Math.max(0, balanceBefore - redeemed);
		const balanceAfter = afterRedeem + earned;
		try {
			await glo.upsert(
				TYPE.customer,
				{ ...cust.data, loyaltyPoints: balanceAfter },
				{ id: cust.id }
			);
			if (redeemed > 0) {
				await glo.upsert<LoyaltyPoints>(
					TYPE.loyaltyPoints,
					buildLoyaltyTx({
						customerId: custId,
						type: 'redeem',
						points: redeemed,
						balanceAfter: afterRedeem,
						reason: 'Checkout redemption',
						orderId: sale.number
					}),
					{ id: newRecordId('loyalty') }
				);
			}
			if (earned > 0) {
				await glo.upsert<LoyaltyPoints>(
					TYPE.loyaltyPoints,
					buildLoyaltyTx({
						customerId: custId,
						type: 'earn',
						points: earned,
						balanceAfter,
						reason: 'Sale reward',
						orderId: sale.number
					}),
					{ id: newRecordId('loyalty') }
				);
			}
			loyaltyRedeemOn = false;
			const net = earned - redeemed;
			if (redeemed > 0) {
				void logActivity({
					action: 'loyalty_redeem',
					resource: 'customer',
					resourceId: custId,
					summary: `Redeemed ${redeemed} pts (${cust.data.name ?? 'Customer'})`,
					amount: loyaltyRedeem.credit,
					currency
				});
			}
			if (earned > 0) {
				void logActivity({
					action: 'loyalty_earn',
					resource: 'customer',
					resourceId: custId,
					summary: `Awarded ${earned} pts (${cust.data.name ?? 'Customer'})`
				});
			}
			toast.success(
				net >= 0 ? `+${earned} points` : `−${redeemed} points`,
				`${cust.data.name ?? 'Customer'} · balance ${balanceAfter}`
			);
		} catch (e) {
			console.warn('[pos] loyalty update failed', e);
		}
	}
	const change = $derived(Math.max(0, (typeof tendered === 'number' ? tendered : 0) - grandTotal));
	const underPayment = $derived(
		typeof tendered === 'number' && tendered > 0 && tendered < grandTotal
	);

	// Bitcoin: live sats preview of the cart + grand total. Only shown when a
	// rate exists and the merchant currency matches the rate currency (USD).
	const showSats = $derived(btcRate.canConvert(currency));
	const totalSats = $derived(
		(showSats && btcRate.satsFromAmount(cart.totals.total, currency)) || 0
	);
	const grandTotalSats = $derived((showSats && btcRate.satsFromAmount(grandTotal, currency)) || 0);

	// Keep a BTC rate for the merchant currency loaded. Reactive (not onMount) so
	// a fresh page load — where tenant.currency hydrates AFTER mount — still
	// fetches the right pair once the real currency arrives (USD → LAK, etc.).
	$effect(() => {
		if (!tenant.hydrated) return; // don't fetch for the default 'USD' pre-hydration
		const cur = currency;
		if (cur) untrack(() => void btcRate.ensureRate(cur));
	});

	// Quick cash denominations (de-duplicated, sorted)
	const quickAmounts = $derived.by(() => {
		const t = grandTotal;
		const candidates = [
			t, // exact
			Math.ceil(t / 1000) * 1000, // next 1000 up
			Math.ceil(t / 5000) * 5000, // next 5000 up
			Math.ceil(t / 10000) * 10000, // next 10000 up
			20000,
			50000,
			100000 // common denominations
		];
		return candidates
			.filter((v, index) => v > 0 && candidates.indexOf(v) === index)
			.sort((a, b) => a - b)
			.slice(0, 8);
	});

	// Split payment state
	let splitMode = $state(false);
	let splitPayments = $state<{ method: string; amount: number }[]>([]);
	let splitMethod = $state<string>('cash');
	let splitAmount = $state<number | ''>('');
	const splitRemaining = $derived(grandTotal - splitPayments.reduce((s, p) => s + p.amount, 0));
	function addSplitPayment() {
		const amt = typeof splitAmount === 'number' ? splitAmount : Number(splitAmount) || 0;
		if (amt <= 0 || amt > splitRemaining + 0.01) {
			toast.warning('Invalid amount', 'Must be between 0 and remaining balance');
			return;
		}
		splitPayments.push({ method: splitMethod, amount: Math.min(amt, splitRemaining) });
		splitAmount = '';
	}
	function removeSplitPayment(idx: number) {
		splitPayments.splice(idx, 1);
	}
	function resetSplit() {
		splitPayments = [];
		splitAmount = '';
		splitMode = false;
	}

	// Payment success visual feedback — holds the just-completed sale + context
	// so the celebration overlay can show amount, change due, tip, method, etc.
	let successTip = $state(0);
	let successTendered = $state(0);

	// ── QR / Lightning checkout flow ──
	// When the cashier taps Charge on a QR/Lightning method we open a payment-QR
	// dialog (shown on POS + pushed to the customer display) instead of completing
	// instantly. The sale completes when the cashier taps "Mark paid".
	let payQrOpen = $state(false);
	let payQrResult = $state<PaymentQrResult | null>(null);
	let payQrAmount = $state(0);
	let payQrMethod = $state('');
	let payQrNote = $state('');
	let payQrExpiresAt = $state(0);
	let payQrSecondsLeft = $state(0);
	let payQrTimer: ReturnType<typeof setInterval> | null = null;
	let payQrLoading = $state(false);
	// True while fetching a real Lightning invoice (LNURL-pay).
	let payQrFetching = $state(false);
	// Holds the live BOLT11 invoice so we can regenerate on expiry.
	let payQrInvoice = $state<{ pr: string; amountSats: number } | null>(null);
	// Whether the shown QR is a real amount-locked invoice vs a static fallback.
	let payQrIsInvoice = $state(false);
	// The active Lightning provider (for header label + auto-confirm polling).
	let payQrProvider = $state<LightningProvider | null>(null);
	// Auto-confirm polling.
	let payQrPaid = $state(false);
	let payQrPollTimer: ReturnType<typeof setInterval> | null = null;

	async function openQrCheckout() {
		if (cart.isEmpty) return;
		if (!ensureShift()) {
			toast.info('Open a shift first to process sales.');
			return;
		}
		const cfg = loadPayConfig();
		const amount = grandTotal;

		// Lightning path: fetch a real amount-locked BOLT11 invoice (LNURL-pay).
		if (method === 'lightning') {
			await openLightningCheckout(amount, cfg);
			return;
		}

		// QR path (PromptPay / VietQR / bank): instant, offline.
		const result = buildPaymentQr({
			method,
			amount,
			currency,
			note: cart.customerName || undefined,
			config: cfg
		});
		if (!result.configured) {
			toast.warning('Pay QR not configured', result.hint ?? 'Set it up in Settings → Pay QR.');
			return;
		}
		showQrDialog(result, amount, method, 'qr-static');
	}

	async function openLightningCheckout(amount: number, cfg: ReturnType<typeof loadPayConfig>) {
		const provider = getActiveLightningProvider();
		if (!provider) {
			toast.warning(
				'No Lightning provider',
				'Select & configure a Lightning provider in Settings → Bitcoin (Lightning Address, Blink, NWC, …).'
			);
			return;
		}
		payQrProvider = provider;
		// Pre-open the dialog in a fetching state so the UI feels instant.
		payQrResult = {
			payload: '',
			kind: 'lightning',
			configured: true,
			badge: 'lightning'
		};
		payQrAmount = amount;
		payQrMethod = 'lightning';
		payQrNote = cart.customerName || '';
		payQrInvoice = null;
		payQrIsInvoice = false;
		payQrPaid = false;
		payQrFetching = true;
		payQrExpiresAt = Date.now() + 15 * 60 * 1000;
		payQrSecondsLeft = Math.floor((payQrExpiresAt - Date.now()) / 1000);
		payQrOpen = true;
		startQrCountdown();
		await fetchLightningInvoice(amount, provider);
	}

	async function fetchLightningInvoice(amount: number, provider: LightningProvider) {
		payQrFetching = true;
		try {
			const sats = btcRate.satsFromAmount(amount, currency);
			if (sats <= 0) throw new Error('No BTC rate available for ' + currency);
			const invoice = await provider.makeInvoice(sats * 1000, cart.customerName || 'BNOS sale');
			payQrInvoice = { pr: invoice.pr, amountSats: invoice.amountSats };
			payQrIsInvoice = true;
			payQrResult = {
				payload: invoice.pr,
				kind: 'lightning',
				configured: true,
				badge: 'lightning'
			};
			// Re-broadcast the real invoice to the customer display.
			if (loadPayConfig().showOnCustomerDisplay) {
				broadcastPayQr(invoice.pr, amount, 'lightning', 'lightning', 'lightning');
			}
			// Auto-confirm: poll the provider for payment status (NWC/Blink/Alby).
			startPaymentPolling(provider, invoice.pr);
		} catch (e) {
			// Graceful fallback: static address QR (only for the Lightning Address path).
			const wallet = getMerchantLightning();
			if (wallet) {
				const fallback = `lightning:${wallet.address}`;
				payQrIsInvoice = false;
				payQrResult = {
					payload: fallback,
					kind: 'lightning',
					configured: true,
					badge: 'lightning'
				};
				toast.warning(
					'Live invoice unavailable',
					`Showing static address. ${e instanceof Error ? e.message : ''}`.trim()
				);
				if (loadPayConfig().showOnCustomerDisplay) {
					broadcastPayQr(fallback, amount, 'lightning', 'lightning', 'lightning');
				}
			} else {
				// No static fallback for node providers — surface the real error.
				payQrIsInvoice = false;
				payQrResult = {
					payload: '',
					kind: 'lightning',
					configured: true,
					badge: 'lightning'
				};
				toast.error('Invoice request failed', e instanceof Error ? e.message : undefined);
			}
		} finally {
			payQrFetching = false;
		}
	}

	function startPaymentPolling(provider: LightningProvider, pr: string) {
		stopPaymentPolling();
		if (!provider.getPaymentStatus || !provider.autoConfirms) return;
		let cancelled = false;
		payQrPollTimer = setInterval(async () => {
			if (cancelled || !payQrOpen) {
				stopPaymentPolling();
				return;
			}
			const status = await provider.getPaymentStatus!(pr).catch(() => 'unknown' as const);
			if (status === 'paid') {
				payQrPaid = true;
				stopPaymentPolling();
				toast.success('Lightning payment received', 'Auto-confirming the sale…');
				setTimeout(() => confirmQrPaid(), 600);
			}
		}, 4000);
	}
	function stopPaymentPolling() {
		if (payQrPollTimer) {
			clearInterval(payQrPollTimer);
			payQrPollTimer = null;
		}
	}

	function regenerateInvoice() {
		if (!payQrOpen || payQrMethod !== 'lightning' || !payQrProvider) return;
		void fetchLightningInvoice(payQrAmount, payQrProvider);
	}

	function showQrDialog(
		result: PaymentQrResult,
		amount: number,
		payMethod: string,
		_source: string
	) {
		payQrResult = result;
		payQrAmount = amount;
		payQrMethod = payMethod;
		payQrNote = cart.customerName || '';
		payQrIsInvoice = false;
		payQrInvoice = null;
		payQrExpiresAt = Date.now() + 15 * 60 * 1000;
		payQrSecondsLeft = Math.floor((payQrExpiresAt - Date.now()) / 1000);
		payQrOpen = true;
		if (loadPayConfig().showOnCustomerDisplay) {
			broadcastPayQr(result.payload, amount, payMethod, result.kind, result.badge);
		}
		startQrCountdown();
	}

	function startQrCountdown() {
		if (payQrTimer) clearInterval(payQrTimer);
		payQrTimer = setInterval(() => {
			payQrSecondsLeft = Math.max(0, Math.floor((payQrExpiresAt - Date.now()) / 1000));
			if (payQrSecondsLeft <= 0) {
				clearInterval(payQrTimer!);
				payQrTimer = null;
			}
		}, 1000);
	}

	function closeQrCheckout() {
		payQrOpen = false;
		payQrResult = null;
		stopPaymentPolling();
		if (payQrTimer) {
			clearInterval(payQrTimer);
			payQrTimer = null;
		}
		broadcastClearPayQr();
	}

	async function confirmQrPaid() {
		if (payQrLoading) return;
		payQrLoading = true;
		const paidMethod = payQrMethod as PaymentMethod;
		const paidAmount = payQrAmount;
		closeQrCheckout();
		processing = true;
		try {
			const sale = await cart.checkout(paidMethod, 0);
			if (sale) {
				playSuccessChime();
				successTip = tipAmount;
				successTendered = 0;
				broadcastCheckoutSuccess(paidAmount, paidMethod);
				await processLoyalty(sale);
				toast.success('Payment received', `${formatMoney(paidAmount, currency)} · ${sale.number}`);
				tendered = '';
				tipAmount = 0;
				resetSplit();
				cartOpen = false;
				receiptOpen = true;
				if (generalSettings.autoPrint && hardwareSettings.printerType !== 'none') printReceipt();
			}
		} catch (e) {
			toast.error(t('pos.checkoutFailed'), e instanceof Error ? e.message : undefined);
		} finally {
			processing = false;
			payQrLoading = false;
		}
	}

	function fmtQrCountdown(s: number): string {
		const m = Math.floor(s / 60);
		const sec = s % 60;
		return `${m}:${sec.toString().padStart(2, '0')}`;
	}

	async function checkout() {
		if (cart.isEmpty) return;
		if (!ensureShift()) {
			toast.info('Open a shift first to process sales.');
			return;
		}
		processing = true;
		try {
			const sale = await cart.checkout(
				method as PaymentMethod,
				typeof tendered === 'number' ? tendered : 0
			);
			if (sale) {
				playSuccessChime();
				successTip = tipAmount;
				successTendered = typeof tendered === 'number' ? tendered : 0;
				broadcastCheckoutSuccess(grandTotal, method);
				await processLoyalty(sale);
				toast.success('Sale complete', `${formatMoney(grandTotal, currency)} · ${sale.number}`);
				tendered = '';
				tipAmount = 0;
				resetSplit();
				cartOpen = false;
				receiptOpen = true;
				if (generalSettings.autoPrint && hardwareSettings.printerType !== 'none') printReceipt();
			}
		} catch (e) {
			toast.error('Checkout failed', e instanceof Error ? e.message : undefined);
		} finally {
			processing = false;
		}
	}

	async function completeSplitCheckout() {
		if (splitRemaining > 0.01) {
			toast.warning('Balance not fully paid', `${formatMoney(splitRemaining, currency)} remaining`);
			return;
		}
		if (cart.isEmpty) return;
		if (!ensureShift()) {
			toast.info('Open a shift first to process sales.');
			return;
		}
		processing = true;
		try {
			const primary = splitPayments[0];
			const sale = await cart.checkout(primary.method as PaymentMethod, primary.amount);
			if (sale) {
				playSuccessChime();
				successTip = tipAmount;
				successTendered = splitPayments.reduce((s, p) => s + p.amount, 0);
				broadcastCheckoutSuccess(grandTotal, splitPayments[0].method);
				await processLoyalty(sale);
				toast.success(
					'Sale complete',
					`${formatMoney(grandTotal, currency)} · ${sale.number} · ${splitPayments.length} payments`
				);
				resetSplit();
				tipAmount = 0;
				tendered = '';
				cartOpen = false;
				receiptOpen = true;
				if (generalSettings.autoPrint && hardwareSettings.printerType !== 'none') printReceipt();
			}
		} catch (e) {
			toast.error('Checkout failed', e instanceof Error ? e.message : undefined);
		} finally {
			processing = false;
		}
	}

	function printReceipt() {
		refreshLocalSettings();
		const sale = cart.lastCompleted;
		if (!sale) return;
		if (hardwareSettings.printerType === 'none') {
			toast.warning('Receipt printer is disabled in Hardware settings');
			return;
		}
		printPosReceipt(sale, {
			receipt: receiptSettings,
			currency,
			cashier: tenant.state.activeStaffInfo?.name ?? shiftStaffName.trim() ?? '',
			customerName: sale.customerName,
			satsTotal:
				sale.totalSats ??
				(btcRate.receiptShowSats && btcRate.canConvert(currency)
					? btcRate.satsFromAmount(sale.totals.total, currency)
					: undefined)
		});
	}

	function recordValue<T>(value: T): T & Record<string, unknown> {
		return value as T & Record<string, unknown>;
	}

	// ── mobile cart panel + line note ──
	let cartOpen = $state(false);
	let orderContextOpen = $state(false);
	let noteOpen = $state(false);
	let noteKey = $state<string | null>(null);
	let noteText = $state('');
	// Auto-close the mobile panel when the cart empties (checkout / hold / clear).
	$effect(() => {
		if (cart.isEmpty) cartOpen = false;
	});
	function openNote(key: string) {
		const l = cart.items.find((i) => i.key === key);
		noteKey = key;
		noteText = l?.note ?? '';
		noteOpen = true;
	}
	function saveNote() {
		if (noteKey) cart.setNote(noteKey, noteText.trim());
		noteOpen = false;
		noteKey = null;
	}

	// ── discount modal ──
	let discountOpen = $state(false);
	let dType = $state<'percent' | 'fixed'>('percent');
	let dValue = $state<number | ''>('');
	const canDiscount = $derived(permissions.can('discounts', 'write'));
	function applyDiscount() {
		const value = typeof dValue === 'number' ? dValue : Number(dValue) || 0;
		cart.setDiscount({ type: dType, value });
		discountOpen = false;
		if (value > 0) {
			void logActivity({
				action: 'discount',
				resource: 'cart',
				summary: `Manual ${dType} discount of ${dType === 'percent' ? value + '%' : formatMoney(value, currency)}`
			});
		}
	}

	// ── held orders + receipt modals ──
	let heldOpen = $state(false);
	let receiptOpen = $state(false);

	const orderTypes: { value: OrderType; label: string; icon: string }[] = [
		{ value: 'takeaway', label: 'Takeaway', icon: 'lucide:shopping-bag' },
		{ value: 'dine_in', label: 'Dine-in', icon: 'lucide:utensils' },
		{ value: 'delivery', label: 'Delivery', icon: 'lucide:bike' },
		{ value: 'pickup', label: 'Pickup', icon: 'lucide:package' }
	];
	// Payment methods — check localStorage settings, fall back to defaults
	const payMethods = $derived.by(() => {
		try {
			const stored = localStorage.getItem('bnos-os:payment-methods');
			if (stored) {
				const parsed = JSON.parse(stored);
				if (Array.isArray(parsed) && parsed.length > 0) {
					return parsed
						.map((p: unknown) =>
							typeof p === 'string'
								? p
								: ((p as { id?: string; name?: string })?.id ?? (p as { name?: string })?.name)
						)
						.filter((v): v is string => !!v);
				}
			}
		} catch {
			/* ignore */
		}
		return ['cash', 'card', 'qr', 'lightning'];
	});
	const payIcon: Record<string, string> = {
		cash: 'lucide:banknote',
		card: 'lucide:credit-card',
		qr: 'lucide:qr-code',
		lightning: 'lucide:zap'
	};
	const payColor: Record<string, string> = {
		cash: 'text-green-600 dark:text-green-400',
		card: 'text-blue-600 dark:text-blue-400',
		qr: 'text-purple-600 dark:text-purple-400',
		lightning: 'text-yellow-600 dark:text-yellow-400'
	};
	const payActiveColor: Record<string, string> = {
		cash: 'border-green-500/50 bg-green-500/10 text-green-600 dark:text-green-400',
		card: 'border-blue-500/50 bg-blue-500/10 text-blue-600 dark:text-blue-400',
		qr: 'border-purple-500/50 bg-purple-500/10 text-purple-600 dark:text-purple-400',
		lightning: 'border-yellow-500/50 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400'
	};

	async function startNewSale() {
		if (cart.isEmpty) return;
		await clearCart();
		if (!cart.isEmpty) return; // user cancelled the clear
		tipAmount = 0;
		resetSplit();
		toast.info('Started a new sale');
	}

	async function clearCart() {
		refreshLocalSettings();
		if (
			generalSettings.confirmClear &&
			!(await confirm({
				title: t('pos.confirmClearCart'),
				message: t('pos.confirmClearCartMsg'),
				tone: 'danger',
				icon: 'lucide:cart-x',
				confirmText: t('pos.clearCart')
			}))
		)
			return;
		cart.clear();
	}

	// ── A) Custom Item Modal ──
	let customOpen = $state(false);
	let customName = $state('');
	let customPrice = $state<number | ''>('');
	let customQty = $state(1);

	function openCustom() {
		customName = '';
		customPrice = '';
		customQty = 1;
		customOpen = true;
	}
	function addCustomItem() {
		if (!customName.trim()) return toast.warning('Item name required');
		const price = typeof customPrice === 'number' ? customPrice : Number(customPrice) || 0;
		if (price <= 0) return toast.warning('Price must be greater than 0');
		const id = 'custom-' + Date.now();
		cart.add({
			productId: id,
			name: customName.trim(),
			unitPrice: price,
			quantity: customQty
		});
		toast.success('Custom item added', `${customName.trim()} × ${customQty}`);
		customOpen = false;
	}

	// ── B) Shift Gate (branch-scoped) ──
	// A shift is only "open" for POS purposes if it is active on THIS device's
	// branch. Other branches' open shifts no longer gate this terminal.
	const openShift = $derived(shiftStore.activeShift ?? null);
	let shiftModalOpen = $state(false);
	// Track whether shifts have been hydrated from IndexedDB.
	// glo.version is $state — it bumps when hydration completes.
	let shiftsLoaded = $state(false);
	$effect(() => {
		const trackedVersion = glo.version;
		const trackedShiftCount = shiftStore.all.length;
		void trackedVersion;
		void trackedShiftCount;
		// Mark loaded once the type has been hydrated (data arrived from IDB).
		if (glo.isHydrated(TYPE.shift)) {
			shiftsLoaded = true;
		} else {
			// Not hydrated yet — kick off hydration.
			glo.hydrate(TYPE.shift);
		}
	});
	let shiftOpeningCash = $state<number | ''>('');
	let shiftStaffName = $state('');

	function ensureShift(): boolean {
		if (!openShift) {
			shiftModalOpen = true;
			return false;
		}
		return true;
	}
	async function openShiftAction() {
		const openingCash =
			typeof shiftOpeningCash === 'number' ? shiftOpeningCash : Number(shiftOpeningCash) || 0;
		await shiftStore.openShift({
			openingCash,
			staffName: shiftStaffName.trim() || undefined
		});
		shiftModalOpen = false;
		shiftOpeningCash = '';
		shiftStaffName = '';
	}
	async function closeShift() {
		if (!openShift) return;
		const closingCash =
			typeof shiftOpeningCash === 'number' ? shiftOpeningCash : Number(shiftOpeningCash) || 0;
		const ok = await shiftStore.closeShift({ closingCash });
		if (ok) {
			shiftModalOpen = false;
			shiftOpeningCash = '';
		}
	}
	// ── B2) Shift & Stock quick-view (header popovers) ──
	function formatDuration(ms: number): string {
		const s = Math.floor(ms / 1000);
		if (s < 60) return 'just now';
		const m = Math.floor(s / 60);
		if (m < 60) return `${m}m`;
		const h = Math.floor(m / 60);
		if (h < 24) return `${h}h ${m % 60}m`;
		const d = Math.floor(h / 24);
		return `${d}d ${h % 24}h`;
	}
	let shiftPopoverOpen = $state(false);
	let stockPopoverOpen = $state(false);
	const shiftSummary = $derived(shiftStore.summaryFor(openShift?.id));
	const shiftElapsedLabel = $derived.by(() => {
		if (!openShift) return '';
		const ms = Math.max(0, now.getTime() - new Date(openShift.data.openedAt).getTime());
		return formatDuration(ms);
	});
	const openedTimeLabel = $derived(
		openShift
			? new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(
					new Date(openShift.data.openedAt)
				)
			: '—'
	);
	const tenderRows = $derived.by(() => {
		const s = shiftSummary;
		const rows = [
			{
				label: 'Cash',
				value: s.cashSales,
				icon: 'lucide:banknote',
				color: 'text-emerald-600 dark:text-emerald-400'
			},
			{
				label: 'Card',
				value: s.cardSales,
				icon: 'lucide:credit-card',
				color: 'text-blue-600 dark:text-blue-400'
			},
			{
				label: 'QR',
				value: s.qrSales,
				icon: 'lucide:qr-code',
				color: 'text-purple-600 dark:text-purple-400'
			},
			{
				label: 'Lightning',
				value: s.lightningSales,
				icon: 'lucide:zap',
				color: 'text-yellow-600 dark:text-yellow-400'
			}
		];
		return rows.filter((t) => t.value > 0);
	});
	const shiftTriggerClass = $derived(
		openShift
			? 'inline-flex h-8 items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 text-[12px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-500/15 dark:text-emerald-300'
			: 'inline-flex h-8 items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 text-[12px] font-semibold text-amber-700 transition-colors hover:bg-amber-500/15 dark:text-amber-300'
	);
	const stockTriggerClass = $derived(
		lowStockCount > 0
			? 'inline-flex h-8 items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 text-[12px] font-semibold text-amber-700 transition-colors hover:bg-amber-500/15 dark:text-amber-300'
			: 'inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-2.5 text-[12px] font-semibold text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]'
	);
	function closeShiftFromPopover() {
		shiftPopoverOpen = false;
		shiftModalOpen = true;
		shiftOpeningCash = '';
	}
	function openShiftFromPopover() {
		shiftPopoverOpen = false;
		shiftModalOpen = true;
		shiftOpeningCash = '';
		shiftStaffName = '';
	}

	// ── C) Payment Success Sound ──
	function playSuccessChime() {
		refreshLocalSettings();
		if (!generalSettings.paymentSound) return;
		try {
			const AudioContextCtor =
				window.AudioContext ??
				(window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
			if (!AudioContextCtor) return;
			const ctx = new AudioContextCtor();
			const notes = [800, 1000, 1200];
			notes.forEach((freq, i) => {
				const osc = ctx.createOscillator();
				const gain = ctx.createGain();
				osc.connect(gain);
				gain.connect(ctx.destination);
				osc.frequency.value = freq;
				osc.type = 'sine';
				const t0 = ctx.currentTime + i * 0.1;
				gain.gain.setValueAtTime(0.001, t0);
				gain.gain.exponentialRampToValueAtTime(0.15, t0 + 0.01);
				gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.09);
				osc.start(t0);
				osc.stop(t0 + 0.1);
			});
			setTimeout(() => ctx.close(), 500);
		} catch {
			/* audio not available */
		}
	}

	// ── D) History Quick Access ──
	let historyOpen = $state(false);
	const recentOrders = $derived.by(() => {
		const all = glo.all<Order, typeof TYPE.order>(TYPE.order);
		return all
			.slice()
			.sort((a, b) => {
				const aCreatedAt = recordValue(a.data).createdAt;
				const bCreatedAt = recordValue(b.data).createdAt;
				const aTime = typeof aCreatedAt === 'string' ? aCreatedAt : '';
				const bTime = typeof bCreatedAt === 'string' ? bCreatedAt : '';
				return bTime.localeCompare(aTime);
			})
			.slice(0, 10);
	});
	function openHistory() {
		historyOpen = true;
	}
	function gotoOrder(id: string) {
		historyOpen = false;
		goto(resolve('/orders/[id]', { id }));
	}

	// ── E) More menu (header dropdown) ──

	// ── E2) Keyboard shortcuts + HID barcode scanner ──
	// True when any modal/dialog is open (suppresses shortcuts + scanning so they
	// don't fight with typing inside a dialog). Popovers + the mobile cart panel
	// are intentionally excluded (scanning while the cart is open is fine).
	let shortcutsOpen = $state(false);
	const anyDialogOpen = $derived(
		!!sizeSel ||
			!!modSel ||
			discountOpen ||
			promoOpen ||
			customOpen ||
			receiptOpen ||
			payQrOpen ||
			heldOpen ||
			historyOpen ||
			shiftModalOpen ||
			noteOpen ||
			orderContextOpen ||
			shortcutsOpen
	);

	const POS_SHORTCUTS: { key: string; label: string; icon: string }[] = [
		{ key: '/', label: t('pos.searchProducts'), icon: 'lucide:search' },
		{ key: 'F2', label: t('common.new') + ' ' + t('common.sale'), icon: 'lucide:plus' },
		{ key: 'F3', label: 'Custom item', icon: 'lucide:plus-circle' },
		{ key: 'F4', label: 'Discount', icon: 'lucide:tag' },
		{ key: 'F6', label: t('orders.heldOrders'), icon: 'lucide:pause' },
		{ key: 'F7', label: 'Last receipt', icon: 'lucide:receipt' },
		{ key: 'F9', label: 'Charge', icon: 'lucide:zap' },
		{ key: 'Esc', label: 'Close / clear', icon: 'lucide:x' }
	];

	function isTyping(): boolean {
		const el = document.activeElement as HTMLElement | null;
		return (
			!!el &&
			(el instanceof HTMLInputElement ||
				el instanceof HTMLTextAreaElement ||
				el instanceof HTMLSelectElement ||
				el.isContentEditable)
		);
	}

	function onKeydown(e: KeyboardEvent) {
		// Escape: let an open Dialog close itself; otherwise blur/clear search.
		if (e.key === 'Escape') {
			if (anyDialogOpen) return;
			const el = document.activeElement as HTMLElement | null;
			if (el && isTyping()) el.blur();
			else if (query) query = '';
			return;
		}
		// '/' focuses search (only when idle).
		if (e.key === '/' && !isTyping() && !anyDialogOpen) {
			e.preventDefault();
			document.getElementById('pos-search')?.focus();
			return;
		}
		// Help
		if (e.key === '?' && !isTyping() && !anyDialogOpen) {
			e.preventDefault();
			shortcutsOpen = true;
			return;
		}
		if (isTyping() || anyDialogOpen || e.ctrlKey || e.metaKey || e.altKey) return;

		switch (e.key) {
			case 'F2':
				e.preventDefault();
				void startNewSale();
				break;
			case 'F3':
				e.preventDefault();
				openCustom();
				break;
			case 'F4':
				e.preventDefault();
				dType = cart.discount.type;
				dValue = cart.discount.value || '';
				discountOpen = true;
				break;
			case 'F6':
				e.preventDefault();
				heldOpen = true;
				break;
			case 'F7':
				e.preventDefault();
				if (cart.lastCompleted) receiptOpen = true;
				break;
			case 'F9':
				e.preventDefault();
				if (!cart.isEmpty) {
					if (isQrMethod(method)) openQrCheckout();
					else checkout();
				}
				break;
		}
	}

	// HID barcode scanner → look up product by barcode/SKU and add to the cart.
	function handleScan(code: string) {
		const match = products.find((p) => p.data.barcode === code || p.data.sku === code);
		if (query) query = ''; // clear any scanner text that landed in search
		if (match) {
			tapProduct(match); // opens variant/modifier picker if needed, else adds
			toast.success('Scanned', (match.data.name as string) ?? code);
		} else {
			toast.warning('No product for barcode', code);
		}
	}

	// Attach the scanner only when the hardware setting is on; re-evaluated if it
	// changes. Gated by `anyDialogOpen` so scans don't interfere with dialog input.
	$effect(() => {
		if (!hardwareSettings.barcodeScanner) return;
		const stop = startBarcodeScanner(handleScan, { enabled: () => !anyDialogOpen });
		return stop;
	});

	// ── F) BroadcastChannel for customer display ──
	let displayChannel: BroadcastChannel | null = null;
	$effect(() => {
		if (typeof BroadcastChannel !== 'undefined') {
			displayChannel = new BroadcastChannel('bnos-customer-display');
		}
		return () => {
			displayChannel?.close();
		};
	});
	// Broadcast cart state whenever it changes
	$effect(() => {
		const items = cart.items;
		const total = cart.totals.total;
		const itemCount = cart.itemCount;
		const customerName = cart.customerName;
		const orderType = cart.orderType;
		displayChannel?.postMessage({
			type: 'cart',
			items: items.map((l) => ({
				name: l.name,
				quantity: l.quantity,
				unitPrice: l.unitPrice,
				variantName: l.variantName,
				lineTotal: cart.lineAmount(l)
			})),
			total,
			itemCount,
			customerName,
			orderType,
			currency
		});
	});
	function broadcastCheckoutSuccess(total: number, payMethod: string) {
		const s = cart.lastCompleted;
		displayChannel?.postMessage({
			type: 'checkout-success',
			total,
			method: payMethod,
			currency,
			number: s?.number,
			change: s?.change ?? 0,
			itemCount: s?.items.reduce((n, i) => n + i.quantity, 0) ?? 0,
			orderType: s?.orderType,
			totalSats: s?.totalSats,
			tip: successTip
		});
	}
	function broadcastPayQr(
		payload: string,
		total: number,
		payMethod: string,
		kind: string,
		badge: string
	) {
		displayChannel?.postMessage({
			type: 'pay-qr',
			payload,
			total,
			method: payMethod,
			currency,
			kind,
			badge
		});
	}
	function broadcastClearPayQr() {
		displayChannel?.postMessage({ type: 'pay-qr-clear' });
	}
</script>

<svelte:head><title>{t('common.appName')} · {t('nav.pos')}</title></svelte:head>
<svelte:window onkeydown={onKeydown} />

<div class="flex h-dvh min-h-0 flex-col overflow-hidden bg-[var(--ui-bg)]">
	<header class="app-chrome border-b border-[var(--glass-border)] px-4 py-3 sm:px-5 lg:px-6">
		<div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
			<div class="flex min-w-0 items-center gap-3">
				<a
					href={resolve('/')}
					aria-label="Back to dashboard"
					class="grid size-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-primary-400 to-primary-600 text-white shadow-sm shadow-primary-500/25"
				>
					<Icon name="lucide:scan-line" class="size-5" />
				</a>
				<div class="min-w-0">
					<div class="flex items-center gap-2">
						<h1 class="font-display text-lg font-bold tracking-tight sm:text-xl">{t('pos.terminal')}</h1>
						<Badge color={cart.isEmpty ? 'neutral' : 'primary'}>
							{cart.isEmpty ? 'Ready' : `${cart.itemCount} items`}
						</Badge>
					</div>
					<p class="truncate text-[12.5px] text-[var(--ui-text-muted)]">
						{tenant.state.organizationName || 'BNOS'} · {tenant.state.locationName || 'Main branch'} ·
						{dateLabel} · {clockLabel}
					</p>
				</div>
			</div>

			<div class="flex flex-wrap items-center gap-2">
				<!-- Shift status → quick-view popover (sales, drawer, close) -->
				<Popover
					bind:open={shiftPopoverOpen}
					align="end"
					side="bottom"
					triggerClass={shiftTriggerClass}
					triggerActiveClass="ring-2 ring-primary-500/20"
					class="w-80 p-0"
				>
					{#snippet trigger()}
						{#if openShift}
							<span class="relative flex size-2">
								<span
									class="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75"
								></span>
								<span class="relative inline-flex size-2 rounded-full bg-emerald-500"></span>
							</span>
							<span>Shift · {shiftElapsedLabel}</span>
						{:else}
							<Icon name="lucide:unlock" class="size-3.5" />
							<span>No shift</span>
						{/if}
						<Icon name="lucide:chevron-down" class="size-3 opacity-60" />
					{/snippet}
					{#snippet content()}
						<div class="w-80">
							{#if openShift}
								<div
									class="flex items-center justify-between border-b border-[var(--ui-border-muted)] px-3.5 py-3"
								>
									<div class="flex min-w-0 items-center gap-2">
										<span class="relative flex size-2.5 shrink-0">
											<span
												class="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75"
											></span>
											<span class="relative inline-flex size-2.5 rounded-full bg-emerald-500"
											></span>
										</span>
										<div class="min-w-0">
											<div class="truncate text-[13px] leading-tight font-bold">
												{openShift.data.number}
											</div>
											<div class="text-[10.5px] text-[var(--ui-text-dimmed)]">
												Open · {shiftElapsedLabel}
											</div>
										</div>
									</div>
									<Badge color="success">Live</Badge>
								</div>
								<div class="space-y-3 px-3.5 py-3">
									<div class="grid grid-cols-2 gap-2 text-[11px]">
										<div class="min-w-0">
											<div class="text-[var(--ui-text-dimmed)]">{t('staff.roleCashier')}</div>
											<div class="truncate font-semibold">
												{openShift.data.staffName || tenant.state.activeStaffInfo?.name || '—'}
											</div>
										</div>
										<div>
											<div class="text-[var(--ui-text-dimmed)]">Opened</div>
											<div class="font-semibold">{openedTimeLabel}</div>
										</div>
									</div>

									<div class="rounded-xl bg-[var(--ui-bg-muted)] p-3">
										<div class="flex items-center justify-between">
											<span
												class="text-[10.5px] font-semibold tracking-wide text-[var(--ui-text-dimmed)] uppercase"
												>Total sales</span
											>
											<Badge color="primary">{formatInt(shiftSummary.totalOrders)} orders</Badge>
										</div>
										<div class="mt-1 font-display text-2xl font-bold tabular-nums">
											{formatMoney(shiftSummary.totalSales, currency)}
										</div>
									</div>

									<div class="space-y-1">
										<div
											class="text-[10.5px] font-semibold tracking-wide text-[var(--ui-text-dimmed)] uppercase"
										>
											Tenders
										</div>
										{#if tenderRows.length === 0}
											<p class="py-1 text-center text-[11.5px] text-[var(--ui-text-dimmed)]">
												No sales recorded yet
											</p>
										{:else}
											{#each tenderRows as t (t.label)}
												<div class="flex items-center justify-between text-[12px]">
													<span class="flex items-center gap-1.5 text-[var(--ui-text-muted)]"
														><Icon name={t.icon} class="size-3.5 {t.color}" />{t.label}</span
													>
													<span class="font-semibold tabular-nums"
														>{formatMoney(t.value, currency)}</span
													>
												</div>
											{/each}
										{/if}
									</div>

									<div class="space-y-1 rounded-xl border border-[var(--ui-border-muted)] p-3">
										<div class="flex items-center justify-between text-[12px]">
											<span class="text-[var(--ui-text-muted)]">Opening cash</span><span
												class="tabular-nums"
												>{formatMoney(openShift.data.openingCash ?? 0, currency)}</span
											>
										</div>
										{#if shiftSummary.totalCashIn > 0}
											<div class="flex items-center justify-between text-[12px]">
												<span class="text-[var(--ui-text-muted)]">{t('shifts.cashIn')}</span><span
													class="text-[var(--tone-success-text)] tabular-nums"
													>+{formatMoney(shiftSummary.totalCashIn, currency)}</span
												>
											</div>
										{/if}
										{#if shiftSummary.totalCashOut > 0}
											<div class="flex items-center justify-between text-[12px]">
												<span class="text-[var(--ui-text-muted)]">{t('shifts.cashOut')}</span><span
													class="text-[var(--tone-error-text)] tabular-nums"
													>−{formatMoney(shiftSummary.totalCashOut, currency)}</span
												>
											</div>
										{/if}
										<div
											class="flex items-center justify-between border-t border-[var(--ui-border-muted)] pt-1.5 text-[12.5px] font-bold"
										>
											<span>Expected drawer</span><span
												class="text-primary-600 tabular-nums dark:text-primary-400"
												>{formatMoney(shiftSummary.expectedCash, currency)}</span
											>
										</div>
									</div>
								</div>
								<div
									class="grid grid-cols-2 gap-1.5 border-t border-[var(--ui-border-muted)] px-3.5 py-3"
								>
									<Button
										size="sm"
										color="neutral"
										variant="subtle"
										icon="lucide:line-chart"
										href={resolve('/transactions/shifts')}
										onclick={() => (shiftPopoverOpen = false)}>Report</Button
									>
									<Button
										size="sm"
										color="neutral"
										variant="soft"
										icon="lucide:lock"
										onclick={closeShiftFromPopover}>{t('shifts.closeShift')}</Button
									>
								</div>
							{:else}
								<div class="px-4 py-5 text-center">
									<div
										class="mx-auto mb-2 grid size-11 place-items-center rounded-full bg-[var(--tone-warning-bg)] text-[var(--tone-warning-text)]"
									>
										<Icon name="lucide:lock" class="size-5" />
									</div>
									<div class="text-[13px] font-bold">{t('pos.noActiveShift')}</div>
									<p class="mt-1 text-[11.5px] text-[var(--ui-text-muted)]">
										Open a shift to start processing sales and track the drawer.
									</p>
									<Button
										class="mt-3"
										color="primary"
										size="sm"
										block
										icon="lucide:unlock"
										onclick={openShiftFromPopover}>{t('shifts.openShift')}</Button
									>
								</div>
							{/if}
						</div>
					{/snippet}
				</Popover>
				<!-- Stock / inventory → quick-view popover (low-stock list) -->
				<Popover
					bind:open={stockPopoverOpen}
					align="end"
					side="bottom"
					triggerClass={stockTriggerClass}
					triggerActiveClass="ring-2 ring-primary-500/20"
					class="w-72 p-0"
				>
					{#snippet trigger()}
						<Icon name="lucide:boxes" class="size-3.5" />
						{#if lowStockCount > 0}
							<span>{formatInt(lowStockCount)} low</span>
						{:else}
							<span>{formatInt(trackedProducts)} tracked</span>
						{/if}
						<Icon name="lucide:chevron-down" class="size-3 opacity-60" />
					{/snippet}
					{#snippet content()}
						<div class="w-72">
							<div
								class="flex items-center justify-between border-b border-[var(--ui-border-muted)] px-3.5 py-3"
							>
								<div class="flex items-center gap-2">
									<Icon name="lucide:boxes" class="size-4 text-[var(--ui-text-muted)]" />
									<span class="text-[13px] font-bold">Inventory</span>
								</div>
								<a
									href={resolve('/catalog')}
									onclick={() => (stockPopoverOpen = false)}
									class="text-[11.5px] font-semibold text-primary-600 hover:underline dark:text-primary-400"
									>Manage</a
								>
							</div>
							<div class="px-3.5 py-3">
								{#if lowStockItems.length === 0}
									<div
										class="flex items-center gap-2.5 rounded-xl bg-[var(--tone-success-bg)] px-3 py-2.5 text-[var(--tone-success-text)]"
									>
										<Icon name="lucide:check-circle-2" class="size-4 shrink-0" />
										<span class="text-[12px] font-semibold">All tracked items stocked</span>
									</div>
									<p class="mt-2 text-center text-[10.5px] text-[var(--ui-text-dimmed)]">
										{formatInt(trackedProducts)} products tracked
									</p>
								{:else}
									<div
										class="mb-2 text-[10.5px] font-semibold tracking-wide text-[var(--ui-text-dimmed)] uppercase"
									>
										{formatInt(lowStockCount)} low · {formatInt(trackedProducts)} tracked
									</div>
									<ul class="space-y-1">
										{#each lowStockItems as p (p.id)}
											{@const avail = availableFor(stockMap, p.id)}
											{@const threshold = p.data.inventory?.lowStockThreshold ?? 0}
											<li
												class="flex items-center justify-between rounded-lg bg-[var(--ui-bg-muted)] px-2.5 py-1.5"
											>
												<span class="min-w-0 truncate text-[12px] font-semibold">{p.data.name}</span
												>
												<span
													class="ml-2 shrink-0 rounded-md px-1.5 py-0.5 text-[10.5px] font-bold tabular-nums {avail <=
													0
														? 'bg-[var(--tone-error-bg)] text-[var(--tone-error-text)]'
														: 'bg-[var(--tone-warning-bg)] text-[var(--tone-warning-text)]'}"
													>{formatInt(avail)}{threshold ? ` / ${formatInt(threshold)}` : ''}</span
												>
											</li>
										{/each}
									</ul>
									{#if lowStockCount > lowStockItems.length}
										<p class="mt-2 text-center text-[10.5px] text-[var(--ui-text-dimmed)]">
											+{formatInt(lowStockCount - lowStockItems.length)} more
										</p>
									{/if}
								{/if}
							</div>
						</div>
					{/snippet}
				</Popover>

				<!-- Primary actions -->
				<Button
					color="neutral"
					variant="soft"
					size="sm"
					icon="lucide:badge-plus"
					disabled={cart.isEmpty}
					onclick={startNewSale}
					title={t('common.new') + ' ' + t('common.sale')}
				>
					New sale
				</Button>
				<Button
					color="neutral"
					variant="soft"
					size="sm"
					icon="lucide:plus-circle"
					onclick={openCustom}
					title={t('common.add') + ' ' + t('common.customItem')}
				>
					Custom
				</Button>
				{#if cart.held.length > 0}
					<button
						type="button"
						onclick={() => (heldOpen = true)}
						class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--ui-border)] px-2.5 text-[12px] font-semibold text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]"
						title={t('orders.heldOrders')}
					>
						<Icon name="lucide:pause" class="size-3.5" />
						{formatInt(cart.held.length)}
					</button>
				{/if}
				<a
					href={resolve('/pos/customer-display')}
					target="_blank"
					title={t('pos.customerDisplay')}
					class="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] font-semibold text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)]"
				>
					<Icon name="lucide:monitor" class="size-3.5" />
					Display
				</a>

				<!-- Scanner status + keyboard shortcuts -->
				{#if hardwareSettings.barcodeScanner}
					<span
						title="Barcode scanner ready — scan to add items"
						class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 text-[11.5px] font-semibold text-emerald-700 dark:text-emerald-300"
					>
						<Icon name="lucide:scan-barcode" class="size-3.5" />
						<span class="hidden sm:inline">Scanner</span>
					</span>
				{/if}
				<button
					type="button"
					onclick={() => (shortcutsOpen = true)}
					title="Keyboard shortcuts (Shift+/)"
					class="inline-flex h-8 items-center justify-center rounded-lg border border-[var(--ui-border)] px-2 text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]"
				>
					<Icon name="lucide:keyboard" class="size-4" />
				</button>

				<!-- More options dropdown -->
				<Menu id="pos-header-more" placement="bottom-end" width="md">
					{#snippet trigger()}<Icon name="lucide:more-horizontal" class="size-4" />{/snippet}
					<MenuItem icon="lucide:history" onclick={openHistory}>Recent orders</MenuItem>
					<MenuItem
						icon="lucide:pause"
						onclick={() => {
							heldOpen = true;
						}}>Held orders ({formatInt(cart.held.length)})</MenuItem
					>
					{#if cart.lastCompleted}
						<MenuItem
							icon="lucide:receipt"
							onclick={() => {
								receiptOpen = true;
							}}>Last receipt</MenuItem
						>
					{/if}
					<MenuDivider />
					<MenuItem icon="lucide:list-ordered" href={resolve('/orders')}>All orders</MenuItem>
					<MenuItem icon="lucide:package" href={resolve('/catalog')}>Catalog</MenuItem>
				</Menu>
			</div>
		</div>
	</header>

	<div class="min-h-0 flex-1 overflow-hidden">
		<div
			class="grid h-full min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_26rem]"
		>
			<!-- Product browser -->
			<section class="flex min-h-0 min-w-0 flex-col overflow-hidden">
				<div class="px-4 py-4 sm:px-5 lg:px-6">
					<div class="flex flex-wrap items-center gap-2">
						<Input
							bind:value={query}
							id="pos-search"
							icon={hardwareSettings.barcodeScanner ? 'lucide:scan-barcode' : 'lucide:search'}
							placeholder={hardwareSettings.barcodeScanner
								? t('pos.searchScan')
								: t('pos.searchProducts')+'…'}
							onkeydown={onSearchKeydown}
							class="min-w-[12rem] flex-1"
						>
							{#snippet trailing()}
								{#if scanMatch}
									<span
										class="inline-flex items-center gap-1 rounded-md bg-[var(--tone-success-bg)] px-1.5 py-0.5 text-[10.5px] font-bold text-[var(--tone-success-text)]"
										title={t('pos.exactMatch')}
									>
										<Icon name="lucide:corner-down-left" class="size-3" />{t('common.add')}
									</span>
								{:else if hardwareSettings.barcodeScanner}
									<span class="text-[10px] font-semibold text-[var(--ui-text-dimmed)]">↵ add</span>
								{/if}
							{/snippet}
						</Input>
						<Button
							color="neutral"
							variant="soft"
							size="sm"
							icon="lucide:funnel"
							onclick={() => (activeCat = 'all')}
						>
							All items
						</Button>
					</div>
					<div class="mt-3 flex flex-wrap items-center justify-between gap-2">
						<div class="no-scrollbar flex gap-1.5 overflow-x-auto pb-1">
							{#each categories as cat (cat)}
								<button
									type="button"
									onclick={() => (activeCat = cat)}
									class="shrink-0 rounded-full px-3 py-1.5 text-[12.5px] font-semibold capitalize transition-colors {activeCat ===
									cat
										? 'bg-primary-500 text-white'
										: 'bg-[var(--ui-bg-muted)] text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)]'}"
								>
									{cat}
								</button>
							{/each}
							{#if offersCount > 0}
								<button
									type="button"
									onclick={() => (offersOnly = !offersOnly)}
									class="flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition-colors {offersOnly
										? 'bg-primary-500 text-white'
										: 'bg-primary-500/10 text-primary-700 hover:bg-primary-500/15 dark:text-primary-300'}"
								>
									<Icon name="lucide:ticket-percent" class="size-3.5" />
									Offers
									<span
										class="rounded-full bg-black/10 px-1.5 text-[10px] tabular-nums dark:bg-white/25"
										>{formatInt(offersCount)}</span
									>
								</button>
							{/if}
						</div>
						<div class="flex items-center gap-2 text-[12px] text-[var(--ui-text-dimmed)]">
							<span>{formatInt(filtered.length)} visible</span>
							<span class="h-1 w-1 rounded-full bg-[var(--ui-text-dimmed)]"></span>
							<span>{formatMoney(cart.totals.total, currency)} cart</span>
						</div>
					</div>
				</div>

				<div class="min-h-0 flex-1 overflow-y-auto px-4 pt-1 pb-4 sm:px-5 sm:pb-5 lg:px-6 lg:pb-6">
					{#if filtered.length === 0}
						<EmptyState
							icon="lucide:package"
							title="No products"
							description="Add products in Catalog, or seed samples from Setup -> Catalog to start selling."
						>
							{#snippet actions()}
								<Button color="primary" size="sm" icon="lucide:plus" href={resolve('/catalog')}
									>{t('common.add') + ' ' + t('common.product')}</Button
								>
							{/snippet}
						</EmptyState>
					{:else}
						<div
							class="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-5"
							class:pb-24={!cart.isEmpty}
						>
							{#each filtered as p (p.id)}
								{@const avail = availableFor(stockMap, p.id)}
								{@const lowStock =
									p.data.trackInventory && p.data.inventory?.lowStockThreshold
										? avail <= (p.data.inventory.lowStockThreshold ?? 0)
										: false}
								{@const outOfStock =
									p.data.trackInventory &&
									p.data.inventory?.denySaleWhenOutOfStock &&
									!p.data.inventory.allowBackorder &&
									avail <= 0}
								{@const promo = productPromoMap[p.id]}
								<button
									type="button"
									onclick={() => tapProduct(p)}
									disabled={outOfStock as boolean}
									class="surface-card group relative flex flex-col gap-2 p-2.5 text-left transition-all enabled:hover:-translate-y-0.5 enabled:hover:border-primary-500/40 enabled:active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40 {promo
										? 'ring-1 ring-primary-500/40'
										: ''}"
								>
									<div
										class="relative grid aspect-square w-full place-items-center rounded-xl bg-[var(--ui-bg-accented)] text-[var(--ui-text-dimmed)]"
									>
										<Icon name="lucide:cup-soda" class="size-6 sm:size-7" />
										{#if promo}
											<span
												class="absolute top-1.5 left-1.5 inline-flex items-center gap-0.5 rounded-full bg-primary-500 px-1.5 py-0.5 text-[8.5px] font-bold text-white shadow-sm"
											>
												<Icon name={promoIcon(promo.data)} class="size-2.5" />{promo.label}
											</span>
										{/if}
										{#if p.data.variants?.length}
											<span
												class="absolute top-1.5 right-1.5 rounded-full bg-black/45 px-1.5 py-0.5 text-[8.5px] font-bold text-white"
												>{formatInt(p.data.variants.length)} sizes</span
											>
										{:else if groupsFor(p.data).length}
											<span
												class="absolute top-1.5 right-1.5 grid size-4.5 place-items-center rounded-full bg-black/45 text-white"
												><Icon name="lucide:sliders-horizontal" class="size-2.5" /></span
											>
										{/if}
										{#if outOfStock}
											<span
												class="absolute inset-0 grid place-items-center rounded-xl bg-black/40 text-[9px] font-bold tracking-wide text-white uppercase"
												>Sold out</span
											>
										{/if}
									</div>
									<div class="min-w-0">
										<div class="truncate text-[12.5px] font-semibold">{p.data.name}</div>
										{#if promo && promo.savings > 0}
											<div class="flex items-baseline gap-1">
												<span
													class="text-[10.5px] font-medium text-[var(--ui-text-dimmed)] line-through"
													>{formatMoney(p.data.price ?? 0, p.data.currency ?? currency)}</span
												>
												<span class="text-[12.5px] font-bold text-[var(--tone-success-text)]"
													>{formatMoney(promo.newPrice, p.data.currency ?? currency)}</span
												>
											</div>
										{:else}
											<div class="text-[12.5px] font-bold text-primary-600 dark:text-primary-400">
												{formatMoney(p.data.price ?? 0, p.data.currency ?? currency)}
											</div>
										{/if}
										{#if showSats && (p.data.price ?? 0) > 0}
											<div
												class="flex items-center gap-0.5 text-[10px] font-semibold text-[var(--tone-warning-text)] tabular-nums"
											>
												<Icon name="lucide:zap" class="size-2.5" />{formatInt(
													btcRate.satsFromAmount(
														promo?.newPrice ?? p.data.price ?? 0,
														p.data.currency ?? currency
													)
												)} sats
											</div>
										{/if}
										{#if p.data.trackInventory}
											<div
												class="mt-0.5 text-[10px] {lowStock
													? 'text-[var(--tone-warning-text)]'
													: 'text-[var(--ui-text-dimmed)]'}"
											>
												{avail} in stock
											</div>
										{/if}
									</div>
								</button>
							{/each}
						</div>
						{#if !cart.isEmpty}<div class="h-24 lg:hidden"></div>{/if}
					{/if}
				</div>
			</section>

			<!-- Desktop cart sidebar (lg+) — always present; empty-state when no items -->
			<aside
				class="hidden min-h-0 flex-col overflow-hidden border-l border-[var(--ui-border-muted)] bg-[var(--surface-bg)] lg:flex"
			>
				<header
					class="flex items-center justify-between border-b border-[var(--ui-border-muted)] px-4 py-3"
				>
					<div class="flex items-center gap-2">
						<Icon name="lucide:shopping-cart" class="size-4 text-primary-500" />
						<h2 class="font-display text-[15px] font-semibold tracking-tight">Current sale</h2>
						{#if cart.itemCount}<Badge color="primary">{cart.itemCount}</Badge>{/if}
					</div>
					{#if !cart.isEmpty}
						<button
							type="button"
							class="text-[11.5px] font-semibold text-[var(--tone-error-text)] hover:underline"
							onclick={clearCart}>{t('common.clear')}</button
						>
					{/if}
				</header>
				{#if cart.isEmpty}
					<div
						class="animate-fade flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center"
					>
						<div
							class="grid size-14 place-items-center rounded-2xl bg-[var(--ui-bg-muted)] text-[var(--ui-text-dimmed)]"
						>
							<Icon name="lucide:shopping-cart" class="size-7" />
						</div>
						<div>
							<p class="text-[13.5px] font-bold text-[var(--ui-text)]">{t('pos.emptyCart')}</p>
							<p class="mt-1 text-[12px] text-[var(--ui-text-muted)]">
								Tap a product to start a new sale.
							</p>
						</div>
						<button
							type="button"
							onclick={openCustom}
							class="inline-flex items-center gap-1.5 rounded-lg bg-[var(--ui-bg-muted)] px-3 py-1.5 text-[12px] font-semibold text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]"
						>
							<Icon name="lucide:plus-circle" class="size-3.5" /> Custom item
						</button>
					</div>
				{:else}
					<div class="min-h-0 flex-1 overflow-y-auto">
						{@render cartContent()}
					</div>
					{@render tenderBlock()}
				{/if}
			</aside>
		</div>
	</div>

	<!-- Shift Gate Overlay (only after hydration — avoids flash on refresh) -->
	{#if shiftsLoaded && !openShift && !shiftModalOpen}
		<div
			class="fixed inset-0 z-30 flex items-center justify-center bg-[var(--ui-bg)]/80 backdrop-blur-sm"
		>
			<div
				class="mx-4 max-w-sm rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-bg)] p-6 text-center shadow-xl"
			>
				<div
					class="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-[var(--tone-warning-bg)] text-[var(--tone-warning-text)]"
				>
					<Icon name="lucide:lock" class="size-6" />
				</div>
				<h3 class="font-display text-lg font-bold">{t('pos.noActiveShift')}</h3>
				<p class="mt-1 text-[12.5px] text-[var(--ui-text-muted)]">
					Open a shift to start processing sales.
				</p>
				<Button
					color="primary"
					class="mt-4"
					icon="lucide:unlock"
					onclick={() => {
						shiftModalOpen = true;
						shiftOpeningCash = '';
						shiftStaffName = '';
					}}
				>
					{t('shifts.openShift')}
				</Button>
			</div>
		</div>
	{/if}
</div>

<!-- Mobile floating "view cart" bar (sits above the bottom tab bar) -->
{#if !cart.isEmpty}
	<div
		class="pointer-events-none fixed inset-x-0 z-40 px-4 lg:hidden"
		style="bottom: calc(1rem + env(safe-area-inset-bottom))"
	>
		<button
			type="button"
			onclick={() => (cartOpen = true)}
			class="pointer-events-auto flex w-full items-center gap-3 rounded-full bg-primary-500 px-4 py-3 text-white shadow-lg shadow-primary-500/30 transition-transform active:scale-[0.98]"
		>
			<span
				class="grid size-6 place-items-center rounded-full bg-white/25 text-[12px] font-bold tabular-nums"
				>{cart.itemCount}</span
			>
			<span class="text-[13px] font-semibold">View cart</span>
			<span class="ml-auto font-display text-[15px] font-bold tabular-nums"
				>{formatMoney(cart.totals.total, currency)}</span
			>
			<Icon name="lucide:chevron-up" class="size-4 opacity-80" />
		</button>
	</div>
{/if}

<!-- Mobile full-page cart panel -->
{#if cartOpen}
	<button
		type="button"
		aria-label="Close cart"
		tabindex="-1"
		class="animate-fade fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px] lg:hidden"
		onclick={() => (cartOpen = false)}
	></button>
	<div
		class="fixed inset-0 z-50 flex flex-col bg-[var(--ui-bg)] lg:hidden"
		role="dialog"
		aria-modal="true"
	>
		<header
			class="app-chrome flex items-center justify-between border-b border-[var(--ui-border-muted)] px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-top))]"
		>
			<div class="flex items-center gap-2">
				<button
					type="button"
					onclick={() => (cartOpen = false)}
					class="grid size-8 place-items-center rounded-lg text-[var(--ui-text-dimmed)] hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]"
					aria-label={t('common.close')}
				>
					<Icon name="lucide:x" class="size-4" />
				</button>
				<h2 class="font-display text-[15px] font-semibold tracking-tight">Current sale</h2>
				{#if cart.itemCount}<Badge color="primary">{cart.itemCount}</Badge>{/if}
			</div>
			{#if !cart.isEmpty}
				<button
					type="button"
					class="text-[11.5px] font-semibold text-[var(--tone-error-text)] hover:underline"
					onclick={clearCart}>{t('common.clear')}</button
				>
			{/if}
		</header>
		<div class="min-h-0 flex-1 overflow-y-auto">
			{@render cartContent()}
		</div>
		<div class="border-t border-[var(--ui-border-muted)] pb-[env(safe-area-inset-bottom)]">
			{@render tenderBlock()}
		</div>
	</div>
{/if}

<!-- ───────────────────────── Snippets (shared by desktop sidebar + mobile panel) ───────────────────────── -->

{#snippet cartContent()}
	<div class="space-y-3 px-4 py-3">
		<ul class="divide-y divide-[var(--ui-border-muted)]">
			{#each cart.items as line (line.key)}
				<li class="py-2.5">
					<div class="flex items-center gap-2">
						<div class="min-w-0 flex-1">
							<div class="truncate text-[13px] font-semibold">
								{line.name}{#if line.variantName}
									<span class="font-normal text-[var(--ui-text-dimmed)]">· {line.variantName}</span
									>{/if}
							</div>
							<div class="text-[11.5px] text-[var(--ui-text-dimmed)]">
								{formatMoney(line.unitPrice, currency)} each{#if line.modifiers?.length}
									· +{formatMoney(
										line.modifiers.reduce((s, m) => s + m.priceAdjustment, 0),
										currency
									)}{/if}
							</div>
							{#if line.note}
								<div class="mt-0.5 text-[11px] text-[var(--ui-text-muted)] italic">
									“{line.note}”
								</div>
							{/if}
						</div>
						<div class="flex items-center gap-1">
							<button
								type="button"
								onclick={() => cart.dec(line.key)}
								class="grid size-7 place-items-center rounded-md bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]"
								aria-label={t('common.decrease')}><Icon name="lucide:minus" class="size-3.5" /></button
							>
							<span class="w-6 text-center text-[13px] font-semibold tabular-nums"
								>{line.quantity}</span
							>
							<button
								type="button"
								onclick={() => cart.inc(line.key)}
								class="grid size-7 place-items-center rounded-md bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]"
								aria-label={t('common.increase')}><Icon name="lucide:plus" class="size-3.5" /></button
							>
						</div>
						<div class="flex items-center gap-1">
							<span class="w-16 text-right text-[13px] font-semibold tabular-nums">
								{formatMoney(cart.lineAmount(line), currency)}
							</span>
							<button
								type="button"
								onclick={() => cart.remove(line.key)}
								class="grid size-6 place-items-center rounded-md text-[var(--ui-text-dimmed)] transition-colors hover:bg-[var(--tone-error-bg)] hover:text-[var(--tone-error-text)]"
								aria-label={t('common.remove')}><Icon name="lucide:x" class="size-3.5" /></button
							>
							<Menu
								id={`cart-line-${line.key}`}
								label="Line actions"
								placement="bottom-end"
								triggerClass="grid size-6 place-items-center rounded-md text-[var(--ui-text-dimmed)] transition-colors hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]"
								triggerActiveClass="bg-[var(--ui-bg-accented)] text-[var(--ui-text)]"
							>
								{#snippet trigger()}<Icon name="lucide:ellipsis" class="size-3.5" />{/snippet}
								<MenuItem icon="lucide:pencil-line" onclick={() => openNote(line.key)}
									>Edit note</MenuItem
								>
							</Menu>
						</div>
					</div>
				</li>
			{/each}
		</ul>

		<!-- order context (collapsible) -->
		<div class="border-t border-[var(--ui-border-muted)] pt-2">
			<button
				type="button"
				onclick={() => (orderContextOpen = !orderContextOpen)}
				class="flex w-full items-center justify-between text-[11px] font-semibold tracking-wider text-[var(--ui-text-dimmed)] uppercase hover:text-[var(--ui-text-muted)]"
			>
				<span>Order details</span>
				<div class="flex items-center gap-2">
					{#if cart.totals.discountAmount > 0}
						<span class="text-[var(--tone-success-text)]"
							>−{formatMoney(cart.totals.discountAmount, currency)}</span
						>
					{/if}
					{#if cart.customerName}
						<span class="text-[var(--ui-text-muted)] normal-case">{cart.customerName}</span>
					{/if}
					<Icon
						name="lucide:chevron-down"
						class="size-3.5 transition-transform {orderContextOpen ? 'rotate-180' : ''}"
					/>
				</div>
			</button>
			{#if orderContextOpen}
				<div class="mt-2 space-y-2">
					<div class="grid grid-cols-4 gap-1">
						{#each orderTypes as ot (ot.value)}
							<button
								type="button"
								onclick={() => cart.setOrderType(ot.value)}
								class="flex flex-col items-center gap-0.5 rounded-lg border py-1.5 text-[10px] font-semibold capitalize transition-colors {cart.orderType ===
								ot.value
									? 'border-primary-500 bg-primary-500/10 text-primary-600 dark:text-primary-300'
									: 'border-[var(--ui-border)] text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)]'}"
								><Icon name={ot.icon} class="size-4" />{ot.label.replace('-', ' ')}</button
							>
						{/each}
					</div>
					<CustomerPicker
						selected={cartCustomer
							? {
									id: cartCustomer.id,
									name: (cartCustomer.data.name as string) || cart.customerName || 'Customer',
									segment: cartCustomer.data.segment,
									points: customerPoints
								}
							: cart.customerName
								? { id: '', name: cart.customerName }
								: null}
						{customers}
						onPick={(id, name) => cart.setCustomer(name, id || undefined)}
						onClear={() => cart.setCustomer('')}
					/>
					{#if loyaltySettings.enabled && cartCustomer}
						<!-- Loyalty: earn preview + redeem toggle -->
						<div
							class="flex items-center justify-between rounded-lg bg-[var(--tone-warning-bg)] px-2.5 py-1.5"
						>
							<div
								class="flex min-w-0 items-center gap-1.5 text-[11.5px] font-semibold text-[var(--tone-warning-text)]"
							>
								<Icon name="lucide:award" class="size-4 shrink-0" />
								<span class="truncate">{formatInt(customerPoints)} pts</span>
								{#if loyaltyEarnPreview > 0}
									<span class="font-normal text-[var(--ui-text-muted)]"
										>· earn ~{formatInt(loyaltyEarnPreview)}</span
									>
								{/if}
							</div>
							{#if loyaltyRedeem.credit > 0}
								<button
									type="button"
									onclick={toggleLoyaltyRedeem}
									class="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-[10.5px] font-bold transition-colors {loyaltyRedeemOn
										? 'bg-[var(--tone-warning-text)] text-white'
										: 'bg-[var(--tone-warning-text)]/15 text-[var(--tone-warning-text)] hover:bg-[var(--tone-warning-text)]/25'}"
								>
									<Icon
										name={loyaltyRedeemOn ? 'lucide:check' : 'lucide:sparkles'}
										class="size-3"
									/>{loyaltyRedeemOn
										? '−' + formatMoney(loyaltyRedeem.credit, currency)
										: 'Use ' + formatInt(loyaltyRedeem.points) + ' pts'}
								</button>
							{/if}
						</div>
					{/if}
					{#if cart.orderType === 'dine_in'}
						<div class="grid grid-cols-2 gap-2">
							<Input
								bind:value={cart.tableId}
								icon="lucide:layout-grid"
								placeholder={t('common.table')}
								class="w-full"
							/>
							<Input
								type="number"
								min="1"
								value={cart.covers}
								oninput={(e) => cart.setCovers(Number((e.target as HTMLInputElement).value))}
								icon="lucide:users"
								placeholder="Covers"
								class="w-full"
							/>
						</div>
					{/if}
					<button
						type="button"
						disabled={!canDiscount}
						title={canDiscount ? 'Cart discount' : 'Requires discount permission (manager+)'}
						onclick={() => {
							if (!canDiscount) return;
							dType = cart.discount.type;
							dValue = cart.discount.value || '';
							discountOpen = true;
						}}
						class="flex w-full items-center justify-between rounded-lg border border-dashed border-[var(--ui-border)] px-3 py-1.5 text-[12px] font-semibold text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--ui-bg-accented)] disabled:cursor-not-allowed disabled:opacity-50"
					>
						<span><Icon name="lucide:tag" class="mr-1 inline size-3.5" />{t('common.discount')}</span>
						{#if cart.totals.discountAmount > 0}<span class="text-[var(--tone-success-text)]"
								>−{formatMoney(cart.totals.discountAmount, currency)}</span
							>{:else}<span class="text-[var(--ui-text-dimmed)]">{t('common.none')}</span>{/if}
					</button>
					{#if allPromotions.length > 0}
						<div class="space-y-1.5">
							{#if appliedPromoObj}
								{@const pd = appliedPromoObj.data}
								{@const savings = promoSavings(pd, cart.totals.subtotal)}
								<div
									class="flex items-center gap-2 rounded-lg border border-[var(--tone-success-text)]/30 bg-[var(--tone-success-bg)] px-2.5 py-1.5"
								>
									<Icon
										name={promoIcon(pd)}
										class="size-4 shrink-0 text-[var(--tone-success-text)]"
									/>
									<button
										type="button"
										onclick={() => (promoOpen = true)}
										class="min-w-0 flex-1 text-left"
									>
										<div class="flex min-w-0 items-center gap-1">
											<span class="truncate text-[12px] font-bold text-[var(--tone-success-text)]"
												>{promoName(pd, currency)}</span
											>
											{#if isAutoApplied}
												<span
													class="shrink-0 rounded bg-[var(--tone-success-text)]/15 px-1 py-0.5 text-[8.5px] font-bold text-[var(--tone-success-text)]"
													>AUTO</span
												>
											{/if}
										</div>
										<div
											class="truncate text-[10.5px] font-semibold text-[var(--tone-success-text)]/80"
										>
											{#if savings > 0}−{formatMoney(savings, currency)} · {promoValueLabel(
													pd,
													currency
												)}{:else}{promoValueLabel(pd, currency)}{/if}
										</div>
									</button>
									<button
										type="button"
										onclick={() => applyPromotion(null)}
										aria-label="Remove promotion"
										class="grid size-6 shrink-0 place-items-center rounded-md text-[var(--tone-success-text)] transition-colors hover:bg-[var(--tone-success-text)]/10"
									>
										<Icon name="lucide:x" class="size-3.5" />
									</button>
								</div>
							{:else if eligiblePromotions.length > 0}
								<div
									class="flex items-center gap-1 px-0.5 text-[9.5px] font-bold tracking-wide text-[var(--ui-text-dimmed)] uppercase"
								>
									<Icon name="lucide:sparkles" class="size-3 text-primary-500" />
									<span>Available offers</span>
								</div>
								{#each eligiblePromotions.slice(0, 3) as promo (promo.id)}
									{@const pd = promo.data}
									{@const savings = promoSavings(pd, cart.totals.subtotal)}
									<button
										type="button"
										onclick={() => applyPromotion(promo.id)}
										class="flex w-full items-center gap-2 rounded-lg border border-primary-500/25 bg-primary-500/5 px-2.5 py-1.5 text-left transition-colors hover:border-primary-500/50 hover:bg-primary-500/10"
									>
										<Icon
											name={promoIcon(pd)}
											class="size-4 shrink-0 text-primary-600 dark:text-primary-400"
										/>
										<div class="min-w-0 flex-1">
											<div class="truncate text-[12px] font-bold text-[var(--ui-text)]">
												{promoName(pd, currency)}
											</div>
											<div
												class="truncate text-[10.5px] font-semibold text-primary-600 dark:text-primary-400"
											>
												{#if savings > 0}Save {formatMoney(
														savings,
														currency
													)}{:else}{promoValueLabel(pd, currency)}{/if}
											</div>
										</div>
										<span
											class="inline-flex shrink-0 items-center gap-0.5 rounded-md bg-primary-500/15 px-1.5 py-0.5 text-[10px] font-bold text-primary-700 dark:text-primary-300"
										>
											<Icon name="lucide:plus" class="size-3" />Apply
										</span>
									</button>
								{/each}
							{/if}
							<button
								type="button"
								onclick={() => (promoOpen = true)}
								class="flex w-full items-center justify-center gap-1 pt-0.5 text-[10.5px] font-semibold text-[var(--ui-text-dimmed)] transition-colors hover:text-[var(--ui-text-muted)]"
							>
								<Icon name="lucide:ticket" class="size-3" />
								{appliedPromoObj ? 'Change promotion' : 'View all'}
								<span class="rounded-full bg-[var(--ui-bg-muted)] px-1.5 text-[9.5px]"
									>{formatInt(allPromotions.length)}</span
								>
							</button>
						</div>
					{/if}
				</div>
			{/if}
		</div>

		<!-- totals -->
		<div class="space-y-1.5 border-t border-[var(--ui-border-muted)] pt-3 text-[13px]">
			<div class="flex justify-between text-[var(--ui-text-muted)]">
				<span>{t('common.subtotal')}</span><span class="tabular-nums"
					>{formatMoney(cart.totals.subtotal, currency)}</span
				>
			</div>
			{#if cart.totals.discountAmount > 0}
				<div class="flex justify-between text-[var(--tone-success-text)]">
					<span>{t('common.discount')}</span><span class="tabular-nums"
						>−{formatMoney(cart.totals.discountAmount, currency)}</span
					>
				</div>
			{/if}
			<div class="flex justify-between text-[var(--ui-text-muted)]">
				<span
					>Tax ({tenant.state.defaultTaxRate}%{tenant.state.taxIncludedInPrice
						? ', incl.'
						: ''})</span
				><span class="tabular-nums">{formatMoney(cart.totals.tax, currency)}</span>
			</div>
			<div class="flex justify-between pt-1 font-display text-[17px] font-bold">
				<span>{t('common.total')}</span><span class="text-primary-600 tabular-nums dark:text-primary-400"
					>{formatMoney(cart.totals.total, currency)}</span
				>
			</div>
			{#if showSats}
				<div
					class="flex items-center justify-end gap-1 pt-0.5 text-[11px] font-semibold text-[var(--tone-warning-text)]"
					title="Live sats estimate (BTC/{currency} {btcRate.ageLabelFor(currency) || 'cached'})"
				>
					<Icon name="lucide:zap" class="size-3" />
					≈ {formatInt(totalSats)} sats
				</div>
			{/if}
		</div>
	</div>
{/snippet}

{#snippet tenderBlock()}
	<div class="space-y-2 border-t border-[var(--ui-border-muted)] px-4 py-3">
		<!-- Payment method selector with colors -->
		<div class="grid grid-cols-4 gap-1.5">
			{#each payMethods as m (m)}
				<button
					type="button"
					onclick={() => (method = m)}
					class="flex flex-col items-center gap-0.5 rounded-lg border py-1.5 text-[10.5px] font-semibold capitalize transition-colors {method ===
					m
						? (payActiveColor[m] ??
							'border-primary-500 bg-primary-500/10 text-primary-600 dark:text-primary-300')
						: 'border-[var(--ui-border)] text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)]'}"
				>
					<span class={payColor[m] ?? ''}
						><Icon name={payIcon[m] ?? 'lucide:wallet'} class="size-4" /></span
					>
					{m}
				</button>
			{/each}
		</div>

		<!-- Split payment toggle -->
		<button
			type="button"
			onclick={() => {
				splitMode = !splitMode;
				if (!splitMode) resetSplit();
			}}
			class="flex w-full items-center justify-between rounded-lg border border-dashed border-[var(--ui-border)] px-3 py-1.5 text-[11.5px] font-semibold text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)]"
		>
			<span><Icon name="lucide:split" class="mr-1 inline size-3.5" />Split payment</span>
			{#if splitMode}<Badge color="primary">ON</Badge>{/if}
		</button>

		{#if splitMode}
			<!-- Split payment mode -->
			{#if splitPayments.length > 0}
				<ul
					class="divide-y divide-[var(--ui-border-muted)] rounded-lg border border-[var(--ui-border)]"
				>
					{#each splitPayments as sp, i (i)}
						<li class="flex items-center justify-between px-2.5 py-1.5 text-[12px]">
							<span class="flex items-center gap-1.5 capitalize">
								<span class={payColor[sp.method] ?? ''}
									><Icon name={payIcon[sp.method] ?? 'lucide:wallet'} class="size-3.5" /></span
								>
								{sp.method}
							</span>
							<span class="flex items-center gap-2">
								<span class="font-semibold tabular-nums">{formatMoney(sp.amount, currency)}</span>
								<button
									type="button"
									onclick={() => removeSplitPayment(i)}
									class="text-[var(--tone-error-text)] hover:underline"
								>
									<Icon name="lucide:x" class="size-3.5" />
								</button>
							</span>
						</li>
					{/each}
				</ul>
			{/if}

			<!-- Remaining balance -->
			<div
				class="rounded-lg px-3 py-2 text-center {splitRemaining <= 0.01
					? 'bg-[var(--tone-success-bg)] text-[var(--tone-success-text)]'
					: 'bg-[var(--ui-bg-accented)]'}"
			>
				<span class="text-[11px] font-semibold tracking-wide uppercase opacity-70">Remaining</span>
				<div class="font-display text-xl font-bold tabular-nums">
					{formatMoney(Math.max(0, splitRemaining), currency)}
				</div>
			</div>

			<!-- Add partial payment -->
			{#if splitRemaining > 0.01}
				<div class="mb-1 grid grid-cols-4 gap-1">
					{#each payMethods as m (m)}
						<button
							type="button"
							onclick={() => (splitMethod = m)}
							class="flex items-center justify-center gap-1 rounded-lg border py-1 text-[10.5px] font-semibold capitalize transition-colors {splitMethod ===
							m
								? (payActiveColor[m] ?? 'border-primary-500 bg-primary-500/10')
								: 'border-[var(--ui-border)] text-[var(--ui-text-muted)]'}"
						>
							<span class={payColor[m] ?? ''}
								><Icon name={payIcon[m] ?? 'lucide:wallet'} class="size-3" /></span
							>
							{m}
						</button>
					{/each}
				</div>
				<div class="flex gap-1.5">
					<Input
						bind:value={splitAmount}
						type="number"
						min="0"
						step="0.01"
						icon="lucide:banknote"
						placeholder={t('common.amount')}
						class="flex-1"
					/>
					<button
						type="button"
						onclick={() => {
							splitAmount = Math.ceil(splitRemaining);
						}}
						class="shrink-0 rounded-lg border border-[var(--ui-border)] px-2 text-[10.5px] font-semibold text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)]"
						>Exact</button
					>
					<Button
						color="primary"
						variant="subtle"
						size="sm"
						icon="lucide:plus"
						onclick={addSplitPayment}>{t('common.add')}</Button
					>
				</div>
			{/if}

			<!-- Complete split checkout -->
			<div class="grid grid-cols-2 gap-2">
				<Button color="neutral" variant="subtle" icon="lucide:x" onclick={resetSplit}>{t('common.cancel')}</Button
				>
				<Button
					color="primary"
					disabled={processing || splitRemaining > 0.01}
					onclick={completeSplitCheckout}
				>
					{#if processing}<Icon
							name="lucide:loader-circle"
							class="size-4 animate-spin"
						/>…{:else}<Icon name="lucide:check-circle" class="size-4" />Complete{/if}
				</Button>
			</div>
		{:else}
			<!-- Tip field (card payments) -->
			{#if method === 'card'}
				<div class="flex items-center gap-1.5">
					<Input
						bind:value={tipAmount}
						type="number"
						min="0"
						step="100"
						icon="lucide:heart"
						placeholder="Tip"
						class="flex-1"
					/>
					<button
						type="button"
						onclick={() => quickTip(10)}
						class="shrink-0 rounded-lg border border-[var(--ui-border)] px-2 py-1.5 text-[10.5px] font-semibold text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)]"
						>10%</button
					>
					<button
						type="button"
						onclick={() => quickTip(15)}
						class="shrink-0 rounded-lg border border-[var(--ui-border)] px-2 py-1.5 text-[10.5px] font-semibold text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)]"
						>15%</button
					>
					{#if tipAmount > 0}
						<button
							type="button"
							onclick={() => (tipAmount = 0)}
							class="shrink-0 rounded-lg border border-[var(--ui-border)] px-2 py-1.5 text-[10.5px] font-semibold text-[var(--tone-error-text)] hover:bg-[var(--ui-bg-accented)]"
						>
							<Icon name="lucide:x" class="size-3.5" />
						</button>
					{/if}
				</div>
			{/if}

			<!-- Grand total with tip -->
			{#if tipAmount > 0}
				<div class="flex justify-between text-[12.5px] text-[var(--ui-text-muted)]">
					<span>Tip</span><span class="tabular-nums">+{formatMoney(tipAmount, currency)}</span>
				</div>
				<div class="flex justify-between font-display text-[15px] font-bold">
					<span>Total + Tip</span><span class="text-primary-600 tabular-nums dark:text-primary-400"
						>{formatMoney(grandTotal, currency)}</span
					>
				</div>
				{#if showSats}
					<div
						class="flex items-center justify-end gap-1 text-[11px] font-semibold text-[var(--tone-warning-text)]"
						title="Live sats estimate (BTC/{currency})"
					>
						<Icon name="lucide:zap" class="size-3" />
						≈ {formatInt(grandTotalSats)} sats
					</div>
				{/if}
			{/if}

			{#if method === 'cash'}
				<Input
					bind:value={tendered}
					type="number"
					icon="lucide:banknote"
					placeholder="Cash tendered"
					min="0"
					step="0.01"
				/>
				<!-- Prominent change display -->
				{#if typeof tendered === 'number' && tendered > 0}
					{#if underPayment}
						<div
							class="rounded-lg bg-[var(--tone-warning-bg)] px-3 py-2 text-center text-[var(--tone-warning-text)]"
						>
							<Icon name="lucide:triangle-alert" class="mb-0.5 inline size-4" />
							<div class="text-[11px] font-semibold tracking-wide uppercase">Insufficient cash</div>
							<div class="text-[13px] font-bold tabular-nums">
								Short by {formatMoney(grandTotal - tendered, currency)}
							</div>
						</div>
					{:else}
						<div
							class="rounded-lg bg-[var(--tone-success-bg)] px-3 py-2 text-center text-[var(--tone-success-text)]"
						>
							<span class="text-[11px] font-semibold tracking-wide uppercase opacity-70"
								>{t('pos.change')}</span
							>
							<div class="font-display text-2xl font-bold tabular-nums">
								{formatMoney(change, currency)}
							</div>
						</div>
					{/if}
				{/if}
				<!-- Quick cash buttons -->
				<div class="grid grid-cols-4 gap-1.5">
					{#each quickAmounts as quick, i (i)}
						<button
							type="button"
							onclick={() => (tendered = quick)}
							class="rounded-lg border border-[var(--ui-border)] py-1.5 text-[11px] font-semibold text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)]"
							>{formatMoney(quick, currency).replace(/\.00$/, '')}</button
						>
					{/each}
				</div>
				<!-- Custom cash amount input -->
				<div class="flex items-center gap-1.5">
					<Input
						bind:value={tendered}
						type="number"
						icon="lucide:pencil-line"
						placeholder="Enter custom amount"
						min="0"
						step="0.01"
						class="flex-1"
					/>
					<button
						type="button"
						onclick={() => (tendered = grandTotal)}
						class="shrink-0 rounded-lg border border-[var(--ui-border)] px-2.5 py-1.5 text-[10.5px] font-semibold text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)]"
						title={t('common.setExactAmount')}>Exact</button
					>
				</div>
			{/if}

			<div class="grid grid-cols-2 gap-2">
				<Button
					color="neutral"
					variant="subtle"
					icon="lucide:pause"
					disabled={processing}
					onclick={() => cart.hold()}>{t('pos.hold')}</Button
				>
				<Button
					color="primary"
					disabled={processing}
					onclick={() => (isQrMethod(method) ? openQrCheckout() : checkout())}
					>{#if processing}<Icon
							name="lucide:loader-circle"
							class="size-4 animate-spin"
						/>…{:else if isQrMethod(method)}<Icon name="lucide:qr-code" class="size-4" />{method ===
						'lightning'
							? 'Invoice'
							: 'Show QR'}{:else}<Icon
							name="lucide:check-circle"
							class="size-4"
						/>Charge{/if}</Button
				>
			</div>
		{/if}
	</div>
{/snippet}

<!-- Size / variant selector -->
<Dialog bind:open={sizeOpen} title={sizeSel?.data.name ?? 'Select'} size="sm">
	{#if sizeSel}
		<div class="space-y-2">
			{#each variants(sizeSel.data) as v (v.id)}
				<button
					type="button"
					onclick={() => (chosenVariant = v.id)}
					class="flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left text-[13px] transition-colors {chosenVariant ===
					v.id
						? 'border-primary-500 bg-primary-500/10'
						: 'border-[var(--ui-border)] hover:bg-[var(--ui-bg-accented)]'}"
				>
					<span class="font-semibold">{v.name}</span>
					<span class="font-bold tabular-nums"
						>{formatMoney(variantPrice(sizeSel.data.price ?? 0, v), currency)}</span
					>
				</button>
			{/each}
		</div>
	{/if}
	{#snippet footer()}
		<Button color="neutral" variant="ghost" onclick={() => (sizeOpen = false)}>{t('common.cancel')}</Button>
		<Button color="primary" icon="lucide:check" onclick={confirmVariant}>{t('common.add')}</Button>
	{/snippet}
</Dialog>

<!-- Modifier selector -->
<Dialog bind:open={modOpen} title={modSel?.data.name ?? 'Options'} size="md">
	{#if modSel}
		<div class="space-y-4">
			{#each groupsFor(modSel.data) as g (g.name)}
				<div>
					<div class="mb-1.5 flex items-center justify-between">
						<span class="text-[12.5px] font-semibold">{g.name}</span>
						<span class="text-[10.5px] tracking-wide text-[var(--ui-text-dimmed)] uppercase"
							>{g.selectionType === 'single' || g.singleChoice ? 'pick one' : 'pick any'}{g.required
								? ' · required'
								: ''}</span
						>
					</div>
					<div class="space-y-1.5">
						{#each g.modifiers ?? g.options ?? [] as opt (opt.name)}
							{@const picked = (chosenMods[g.name ?? ''] ?? []).includes(opt.name)}
							<button
								type="button"
								onclick={() =>
									toggleMod(
										g.name ?? '',
										opt.name,
										g.selectionType === 'single' || !!g.singleChoice
									)}
								class="flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-[13px] transition-colors {picked
									? 'border-primary-500 bg-primary-500/10'
									: 'border-[var(--ui-border)] hover:bg-[var(--ui-bg-accented)]'}"
							>
								<span class="flex items-center gap-2"
									><span
										class="grid size-4 place-items-center rounded-full border {picked
											? 'border-primary-500 bg-primary-500 text-white'
											: 'border-[var(--ui-border-muted)]'}"
										>{#if picked}<Icon name="lucide:check" class="size-2.5" />{/if}</span
									>{opt.name}</span
								>
								{#if (opt.priceAdjustment ?? opt.price ?? 0) > 0}<span
										class="text-[11.5px] text-[var(--ui-text-muted)]"
										>+{formatMoney(opt.priceAdjustment ?? opt.price ?? 0, currency)}</span
									>{/if}
							</button>
						{/each}
					</div>
				</div>
			{/each}
			<Input
				bind:value={pendingNote}
				icon="lucide:pencil-line"
				placeholder="Line note (e.g. no ice)"
				class="w-full"
			/>
		</div>
	{/if}
	{#snippet footer()}
		<Button
			color="neutral"
			variant="ghost"
			onclick={() => {
				modOpen = false;
				pendingModVariant = null;
			}}>{t('common.cancel')}</Button
		>
		<Button color="primary" icon="lucide:check" onclick={confirmModifiers}>Add to sale</Button>
	{/snippet}
</Dialog>

<!-- Line note -->
<Dialog bind:open={noteOpen} title={t('pos.lineNote')} size="sm">
	<Input bind:value={noteText} placeholder="e.g. extra hot, no onions" class="w-full" />
	{#snippet footer()}
		<Button color="neutral" variant="ghost" onclick={() => (noteOpen = false)}>{t('common.cancel')}</Button>
		<Button color="primary" icon="lucide:check" onclick={saveNote}>{t('common.save')}</Button>
	{/snippet}
</Dialog>

<!-- Discount -->
<Dialog bind:open={discountOpen} title={t('pos.cartDiscount')} size="sm">
	<div class="space-y-3">
		<div class="grid grid-cols-2 gap-2">
			{#each [['percent', 'Percent'], ['fixed', 'Fixed']] as [v, lbl] (v)}
				<button
					type="button"
					onclick={() => (dType = v as 'percent' | 'fixed')}
					class="rounded-lg border py-2 text-[12.5px] font-semibold transition-colors {dType === v
						? 'border-primary-500 bg-primary-500/10 text-primary-600 dark:text-primary-300'
						: 'border-[var(--ui-border)] text-[var(--ui-text-muted)]'}">{lbl}</button
				>
			{/each}
		</div>
		{#if dType === 'percent'}
			<div class="grid grid-cols-4 gap-1.5">
				{#each [5, 10, 15, 20] as pct (pct)}
					<button
						type="button"
						onclick={() => (dValue = pct)}
						class="rounded-lg border border-[var(--ui-border)] py-1.5 text-[11px] font-semibold text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)]"
						>{pct}%</button
					>
				{/each}
			</div>
		{/if}
		<Input
			bind:value={dValue}
			type="number"
			min="0"
			step="0.01"
			icon="lucide:tag"
			placeholder={dType === 'percent' ? 'Percentage (e.g. 10)' : `Amount in ${currency}`}
			class="w-full"
		/>
		{#if cart.totals.discountAmount > 0}
			<button
				type="button"
				class="text-[11.5px] font-semibold text-[var(--tone-error-text)] hover:underline"
				onclick={() => {
					cart.setDiscount({ type: 'percent', value: 0 });
					discountOpen = false;
				}}>Remove discount</button
			>
		{/if}
	</div>
	{#snippet footer()}
		<Button color="neutral" variant="ghost" onclick={() => (discountOpen = false)}>{t('common.cancel')}</Button>
		<Button color="primary" icon="lucide:check" onclick={applyDiscount}>{t('common.apply')}</Button>
	{/snippet}
</Dialog>

<!-- Promotion picker -->
<Dialog bind:open={promoOpen} title={t('nav.promotions')} size="md">
	<div class="space-y-2">
		{#if cart.appliedPromotionId}
			<button
				type="button"
				onclick={() => applyPromotion(null)}
				class="flex w-full items-center gap-3 rounded-lg border border-[var(--tone-error-bg)] bg-[var(--tone-error-bg)]/50 p-3 text-left transition-colors hover:bg-[var(--tone-error-bg)]"
			>
				<Icon name="lucide:x-circle" class="size-5 shrink-0 text-[var(--tone-error-text)]" />
				<div class="min-w-0">
					<p class="text-[13px] font-semibold text-[var(--tone-error-text)]">Remove promotion</p>
					<p class="truncate text-[11px] text-[var(--ui-text-muted)]">
						{#if appliedPromoObj}{promoName(appliedPromoObj.data, currency)} — clears the discount too{/if}
					</p>
				</div>
			</button>
		{/if}
		{#each allPromotions as promo (promo.id)}
			{@const d = promo.data}
			{@const elig = isPromotionEligible(d, promoCtx)}
			{@const savings = promoSavings(d, cart.totals.subtotal)}
			{@const applied = cart.appliedPromotionId === promo.id}
			{@const auto = isAutoApplicable(d)}
			<button
				type="button"
				disabled={!applied && !elig.ok}
				onclick={() => applyPromotion(applied ? null : promo.id)}
				class="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors {applied
					? 'border-primary-500 bg-primary-500/10'
					: elig.ok
						? 'border-[var(--ui-border)] bg-[var(--ui-bg-muted)] hover:bg-[var(--ui-bg-accented)]'
						: 'cursor-not-allowed border-dashed border-[var(--ui-border-muted)] opacity-55'}"
			>
				<div
					class="grid size-10 shrink-0 place-items-center rounded-lg text-white {applied
						? 'bg-gradient-to-br from-primary-400 to-primary-600'
						: 'bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)]'}"
				>
					<Icon name={promoIcon(d)} class="size-5" />
				</div>
				<div class="min-w-0 flex-1">
					<div class="flex items-center gap-1.5">
						<p class="truncate text-[13px] font-bold">{promoName(d, currency)}</p>
						{#if applied}
							<span
								class="rounded-full px-1.5 py-0.5 text-[9.5px] font-bold {isAutoApplied
									? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
									: 'bg-primary-500/15 text-primary-700 dark:text-primary-300'}"
								>{isAutoApplied ? 'AUTO' : 'APPLIED'}</span
							>
						{/if}
					</div>
					<p class="truncate text-[11.5px] text-[var(--ui-text-muted)]">
						{promoValueLabel(d, currency)}{#if savings > 0}
							· save {formatMoney(savings, currency)}{/if}
					</p>
				</div>
				{#if applied}
					<Icon name="lucide:check-circle-2" class="size-5 shrink-0 text-primary-500" />
				{:else if !elig.ok}
					<span
						class="shrink-0 rounded-full bg-[var(--tone-warning-bg)] px-2 py-0.5 text-[10px] font-semibold text-[var(--tone-warning-text)]"
						>{elig.reason}</span
					>
				{:else if !auto}
					<span
						class="shrink-0 rounded-full bg-[var(--ui-bg-accented)] px-2 py-0.5 text-[10px] font-semibold text-[var(--ui-text-muted)]"
						>Manual</span
					>
				{:else}
					<Icon name="lucide:plus-circle" class="size-5 shrink-0 text-primary-500" />
				{/if}
			</button>
		{/each}
		{#if allPromotions.length === 0}
			<p class="py-6 text-center text-[12.5px] text-[var(--ui-text-muted)]">
				No active promotions. Create some in
				<a
					class="font-semibold text-primary-600 hover:underline dark:text-primary-400"
					href={resolve('/promotions')}>{t('nav.promotions')}</a
				>.
			</p>
		{/if}
	</div>
	{#snippet footer()}
		<Button color="neutral" variant="ghost" onclick={() => (promoOpen = false)}>{t('common.close')}</Button>
	{/snippet}
</Dialog>

<!-- Held orders -->
<Dialog bind:open={heldOpen} title={t('orders.heldOrders')} size="md">
	{#if cart.held.length === 0}
		<EmptyState
			icon="lucide:pause"
			title={t('orders.noHeldOrders')}
			description={t('orders.parkSale')}
		/>
	{:else}
		<ul class="divide-y divide-[var(--ui-border-muted)]">
			{#each cart.held as h (h.id)}
				{@const heldTotal = h.items.reduce(
					(s, l) =>
						s +
						(l.unitPrice + (l.modifiers?.reduce((a, m) => a + m.priceAdjustment, 0) ?? 0)) *
							l.quantity,
					0
				)}
				<li class="flex items-center justify-between py-2.5">
					<div class="min-w-0">
						<div class="text-[13px] font-semibold capitalize">
							{h.orderType.replace('_', '-')} · {formatInt(h.items.length)} items
						</div>
						<div class="text-[11.5px] text-[var(--ui-text-dimmed)]">
							{h.customerName ?? t('pos.walkIn')} · {formatMoney(heldTotal, currency)}
						</div>
					</div>
					<div class="flex gap-1.5">
						<Button
							size="sm"
							color="primary"
							variant="subtle"
							disabled={!cart.isEmpty}
							onclick={() => {
								cart.recall(h.id);
								heldOpen = false;
							}}>Recall</Button
						>
						<Button
							size="icon-sm"
							color="neutral"
							variant="ghost"
							icon="lucide:trash-2"
							onclick={() => cart.deleteHeld(h.id)}
							aria-label={t('common.delete')}
						/>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</Dialog>

<!-- Receipt -->
<Dialog bind:open={receiptOpen} size="sm">
	{#if cart.lastCompleted}
		{@const s = cart.lastCompleted}
		<PaymentSuccessHeader
			sale={s}
			{currency}
			tip={successTip}
			tendered={successTendered}
			onClose={() => (receiptOpen = false)}
		/>
		<ul
			class="mt-4 divide-y divide-[var(--ui-border-muted)] border-t border-[var(--ui-border-muted)] pt-3 text-[12.5px]"
		>
			{#each s.items as it (it.key)}
				<li class="flex justify-between py-1.5">
					<span class="min-w-0 truncate"
						>{it.quantity}× {it.name}{#if it.variantName}
							({it.variantName}){/if}</span
					><span class="tabular-nums"
						>{formatMoney(
							(it.unitPrice + (it.modifiers?.reduce((a, m) => a + m.priceAdjustment, 0) ?? 0)) *
								it.quantity,
							currency
						)}</span
					>
				</li>
			{/each}
		</ul>
		<dl class="mt-2 space-y-1 border-t border-[var(--ui-border-muted)] pt-2 text-[12px]">
			<div class="flex justify-between text-[var(--ui-text-muted)]">
				<span>{t('common.subtotal')}</span><span class="tabular-nums"
					>{formatMoney(s.totals.subtotal, currency)}</span
				>
			</div>
			{#if s.totals.discountAmount > 0}
				<div class="flex justify-between text-[var(--tone-success-text)]">
					<span class="truncate"
						>Discount{#if s.promotion?.name}
							· {s.promotion.name}{/if}</span
					>
					<span class="tabular-nums">−{formatMoney(s.totals.discountAmount, currency)}</span>
				</div>
			{:else if s.promotion?.name}
				<div class="flex items-center gap-1.5 text-[var(--ui-text-muted)]">
					<Icon name="lucide:ticket-percent" class="size-3.5 shrink-0" />
					<span class="truncate">{s.promotion.name}</span>
				</div>
			{/if}
			<div class="flex justify-between text-[var(--ui-text-muted)]">
				<span>{t('common.tax')}</span><span class="tabular-nums">{formatMoney(s.totals.tax, currency)}</span>
			</div>
			{#if s.totalSats}
				<div
					class="flex items-center justify-between border-t border-[var(--ui-border-muted)] pt-1.5 text-[12px] font-semibold text-[var(--tone-warning-text)]"
				>
					<span class="flex items-center gap-1"
						><Icon name="lucide:zap" class="size-3.5" />Sats</span
					><span class="tabular-nums">≈ {formatInt(s.totalSats)}</span>
				</div>
			{/if}
		</dl>
	{/if}
	{#snippet footer()}
		<div class="flex gap-2">
			<Button color="neutral" variant="subtle" icon="lucide:printer" onclick={printReceipt}
				>{t('common.print')}</Button
			>
			<Button color="primary" block onclick={() => (receiptOpen = false)}>{t('common.new') + ' ' + t('common.sale')}</Button>
		</div>
	{/snippet}
</Dialog>

<!-- Custom Item Modal -->
<Dialog bind:open={customOpen} title="Custom item" size="sm">
	<div class="space-y-3">
		<label class="block">
			<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
				>Item name</span
			>
			<Input
				bind:value={customName}
				icon="lucide:pencil-line"
				placeholder="e.g. Special coffee"
				class="w-full"
			/>
		</label>
		<div class="grid grid-cols-2 gap-3">
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">{t('common.price')}</span
				>
				<Input
					bind:value={customPrice}
					type="number"
					min="0"
					step="0.01"
					icon="lucide:banknote"
					placeholder="0"
					class="w-full"
				/>
			</label>
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
					>{t('common.quantity')}</span
				>
				<Input
					bind:value={customQty}
					type="number"
					min="1"
					step="1"
					icon="lucide:hash"
					class="w-full"
				/>
			</label>
		</div>
	</div>
	{#snippet footer()}
		<Button color="neutral" variant="ghost" onclick={() => (customOpen = false)}>{t('common.cancel')}</Button>
		<Button color="primary" icon="lucide:plus" onclick={addCustomItem}>Add to sale</Button>
	{/snippet}
</Dialog>

<!-- Shift Gate Modal -->
<Dialog open={shiftModalOpen} title={openShift ? 'Close shift' : 'Open shift'} size="sm">
	{#if openShift}
		<div class="space-y-3">
			<div class="rounded-lg bg-[var(--ui-bg-muted)] px-3 py-2 text-[12.5px]">
				<div class="font-semibold">{openShift.data.number}</div>
				<div class="text-[var(--ui-text-muted)]">
					Opened: {new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(
						new Date(openShift.data.openedAt)
					)}
				</div>
				<div class="text-[var(--ui-text-muted)]">
					Opening cash: {formatMoney(openShift.data.openingCash ?? 0, currency)}
				</div>
			</div>
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
					>Counted closing cash</span
				>
				<Input
					bind:value={shiftOpeningCash}
					type="number"
					min="0"
					step="0.01"
					icon="lucide:banknote"
					placeholder="0"
					class="w-full"
				/>
			</label>
		</div>
	{:else}
		<div class="space-y-3">
			<div
				class="rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-3 py-2.5 text-[12.5px] text-[var(--ui-text-muted)]"
			>
				<Icon name="lucide:info" class="mr-1 inline size-3.5" />
				{t('pos.noActiveShift')}.
			</div>
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
					>Opening cash (optional)</span
				>
				<Input
					bind:value={shiftOpeningCash}
					type="number"
					min="0"
					step="0.01"
					icon="lucide:banknote"
					placeholder="0"
					class="w-full"
				/>
			</label>
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
					>Cashier name (optional)</span
				>
				<Input bind:value={shiftStaffName} icon="lucide:user" placeholder={t('common.name')} class="w-full" />
			</label>
		</div>
	{/if}
	{#snippet footer()}
		<Button color="neutral" variant="ghost" onclick={() => (shiftModalOpen = false)}>{t('common.cancel')}</Button>
		{#if openShift}
			<Button color="neutral" icon="lucide:lock" onclick={closeShift}>{t('shifts.closeShift')}</Button>
		{:else}
			<Button color="primary" icon="lucide:unlock" onclick={openShiftAction}>{t('shifts.openShift')}</Button>
		{/if}
	{/snippet}
</Dialog>

<!-- History Quick Access Modal -->
<Dialog bind:open={historyOpen} title={t('dashboard.recentOrders')} size="md">
	{#if recentOrders.length === 0}
		<EmptyState
			icon="lucide:receipt"
			title="No orders yet"
			description="Completed sales will appear here."
		/>
	{:else}
		<ul class="divide-y divide-[var(--ui-border-muted)]">
			{#each recentOrders as o (o.id)}
				{@const orderData = recordValue(o.data)}
				{@const total =
					(orderData.totals as { total?: number } | undefined)?.total ??
					(typeof orderData.amount === 'number' ? orderData.amount : 0)}
				{@const rawDate = typeof orderData.createdAt === 'string' ? orderData.createdAt : ''}
				{@const orderTime = rawDate
					? new Intl.DateTimeFormat('en-US', {
							hour: 'numeric',
							minute: '2-digit',
							day: 'numeric',
							month: 'short'
						}).format(new Date(rawDate))
					: '—'}
				<li>
					<button
						type="button"
						onclick={() => gotoOrder(o.id)}
						class="flex w-full items-center justify-between py-2.5 text-left transition-colors hover:bg-[var(--ui-bg-accented)]"
					>
						<div class="min-w-0">
							<div class="text-[13px] font-semibold">
								{(o.data as { orderNumber?: string; number?: string }).orderNumber ??
									(o.data as { number?: string }).number ??
									o.id.slice(0, 8)}
							</div>
							<div class="text-[11.5px] text-[var(--ui-text-dimmed)]">{orderTime}</div>
						</div>
						<div class="flex items-center gap-2">
							<span class="text-[13px] font-bold tabular-nums"
								>{formatMoney(total, (o.data as { currency?: string }).currency ?? currency)}</span
							>
							<Badge color={statusColor((o.data as { status?: string }).status ?? 'pending')}
								>{(o.data as { status?: string }).status ?? 'pending'}</Badge
							>
							<Icon name="lucide:chevron-right" class="size-4 text-[var(--ui-text-dimmed)]" />
						</div>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</Dialog>

<!-- Payment QR checkout (QR / Lightning / bank methods) -->
<Dialog bind:open={payQrOpen} title={t('common.scanToPay')} size="md">
	{#if payQrResult}
		<div class="flex flex-col items-center gap-4 py-2">
			<div class="flex items-center gap-2">
				<Icon
					name={payQrResult.badge === 'lightning' ? 'lucide:zap' : 'lucide:qr-code'}
					class="size-4 {payQrResult.badge === 'lightning' ? 'text-amber-500' : 'text-primary-500'}"
				/>
				<span class="text-[12px] font-bold text-[var(--ui-text-muted)] capitalize">
					{payQrResult.kind}
				</span>
				{#if payQrIsInvoice}
					<span
						class="rounded-full bg-amber-500/10 px-2 py-0.5 text-[9.5px] font-bold text-amber-600 dark:text-amber-400"
						>amount-locked invoice</span
					>
				{/if}
				{#if payQrProvider?.label}
					<span
						class="rounded-full bg-[var(--ui-bg-accented)] px-2 py-0.5 text-[9.5px] font-bold text-[var(--ui-text-muted)]"
						>{payQrProvider.label}</span
					>
				{/if}
			</div>

			<div class="rounded-2xl border border-[var(--ui-border)] bg-white p-3 shadow-sm">
				{#if payQrFetching}
					<div
						class="flex size-[224px] flex-col items-center justify-center gap-3 text-[var(--ui-text-dimmed)]"
					>
						<Icon name="lucide:loader-circle" class="size-8 animate-spin text-amber-500" />
						<span class="text-[11.5px] font-semibold">Generating Lightning invoice…</span>
						<span class="text-[10px] text-[var(--ui-text-dimmed)]">Contacting wallet provider</span>
					</div>
				{:else if payQrResult.payload}
					<QrCode value={payQrResult.payload} size={224} badge={payQrResult.badge} />
				{:else}
					<div class="flex size-[224px] items-center justify-center text-[var(--ui-text-dimmed)]">
						<Icon name="lucide:qr-code" class="size-8" />
					</div>
				{/if}
			</div>

			{#if payQrMethod === 'lightning' && !payQrFetching}
				<button
					type="button"
					onclick={regenerateInvoice}
					class="flex items-center gap-1 text-[11px] font-semibold text-amber-600 hover:underline dark:text-amber-400"
				>
					<Icon name="lucide:refresh-cw" class="size-3.5" />{payQrIsInvoice
						? 'New invoice'
						: 'Try live invoice again'}
				</button>
			{/if}

			<div class="text-center">
				<p
					class="text-[10.5px] font-semibold tracking-wider text-[var(--ui-text-dimmed)] uppercase"
				>
					{t('pos.amountDue')}
				</p>
				<p class="font-display text-3xl font-black tabular-nums">
					{formatMoney(payQrAmount, currency)}
				</p>
				{#if showSats && payQrMethod !== 'lightning'}
					<p
						class="mt-0.5 flex items-center justify-center gap-1 text-[11px] font-semibold text-[var(--tone-warning-text)]"
					>
						<Icon name="lucide:zap" class="size-3" />≈ {formatInt(
							btcRate.satsFromAmount(payQrAmount, currency)
						)} sats
					</p>
				{/if}
			</div>

			<div
				class="flex items-center gap-1.5 text-[11.5px] font-semibold {payQrSecondsLeft < 60
					? 'text-[var(--tone-error-text)]'
					: 'text-[var(--ui-text-muted)]'}"
			>
				<Icon name="lucide:clock" class="size-3.5" />
				{payQrSecondsLeft > 0
					? `Expires in ${fmtQrCountdown(payQrSecondsLeft)}`
					: 'Expired — regenerate'}
			</div>

			{#if payQrIsInvoice && payQrProvider?.autoConfirms}
				<div
					class="flex items-center gap-2 rounded-lg px-3 py-1.5 text-[11px] font-semibold {payQrPaid
						? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
						: 'bg-amber-500/5 text-amber-700 dark:text-amber-300'}"
				>
					{#if payQrPaid}
						<Icon name="lucide:check-circle-2" class="size-3.5" />Payment received — completing…
					{:else}
						<span class="relative flex size-2">
							<span
								class="absolute inline-flex size-full animate-ping rounded-full bg-amber-400 opacity-75"
							></span>
							<span class="relative inline-flex size-2 rounded-full bg-amber-500"></span>
						</span>
						Watching wallet — will auto-complete on payment
					{/if}
				</div>
			{/if}

			<div
				class="mt-1 flex items-center gap-2 rounded-lg bg-[var(--ui-bg-muted)] px-3 py-2 text-[11px] text-[var(--ui-text-muted)]"
			>
				<Icon name="lucide:info" class="size-3.5 shrink-0" />
				<span>
					Ask the customer to scan with their wallet. When payment is received, tap
					<span class="font-semibold text-[var(--ui-text)]">Mark paid</span> to complete.
				</span>
			</div>

			<div class="flex w-full items-center justify-center gap-2">
				<button
					type="button"
					class="flex items-center gap-1 text-[11px] font-semibold text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]"
					onclick={() =>
						navigator.clipboard
							?.writeText(payQrResult?.payload ?? '')
							.then(() => toast.success('Payment link copied'))}
				>
					<Icon name="lucide:copy" class="size-3.5" />Copy link
				</button>
				{#if payQrResult.payload.startsWith('lightning:')}
					<a
						href={payQrResult.payload}
						class="flex items-center gap-1 text-[11px] font-semibold text-amber-600 hover:underline dark:text-amber-400"
					>
						<Icon name="lucide:external-link" class="size-3.5" />Open in wallet
					</a>
				{/if}
			</div>
		</div>
	{/if}
	{#snippet footer()}
		<Button color="neutral" variant="subtle" icon="lucide:x" onclick={closeQrCheckout}
			>{t('common.cancel')}</Button
		>
		<Button
			color="primary"
			icon="lucide:check"
			onclick={confirmQrPaid}
			disabled={payQrLoading || payQrFetching}
			>{#if payQrLoading}<Icon name="lucide:loader-circle" class="size-4 animate-spin" />…{:else}
				Mark paid
			{/if}</Button
		>
	{/snippet}
</Dialog>

<!-- Keyboard shortcuts help -->
<Dialog bind:open={shortcutsOpen} title="Keyboard shortcuts" size="sm">
	<div class="space-y-1.5">
		{#each POS_SHORTCUTS as s (s.key)}
			<div
				class="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-[var(--ui-bg-accented)]"
			>
				<span class="flex items-center gap-2 text-[12.5px] font-medium">
					<Icon name={s.icon} class="size-4 text-[var(--ui-text-dimmed)]" />
					{s.label}
				</span>
				<kbd
					class="rounded-md border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-2 py-0.5 font-mono text-[11px] font-semibold text-[var(--ui-text-muted)]"
					>{s.key}</kbd
				>
			</div>
		{/each}
		{#if hardwareSettings.barcodeScanner}
			<div
				class="mt-2 flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-[11.5px] font-medium text-emerald-700 dark:text-emerald-300"
			>
				<Icon name="lucide:scan-barcode" class="size-4 shrink-0" />
				Barcode scanner is on — scan any product barcode to add it instantly.
			</div>
		{/if}
	</div>
	{#snippet footer()}
		<Button color="primary" block onclick={() => (shortcutsOpen = false)}>Got it</Button>
	{/snippet}
</Dialog>
