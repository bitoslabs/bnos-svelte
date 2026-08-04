<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Menu from '$lib/components/ui/Menu.svelte';
	import MenuItem from '$lib/components/ui/MenuItem.svelte';
	import MenuDivider from '$lib/components/ui/MenuDivider.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { glo } from '$nostr/store.svelte';
	import { dataSync } from '$nostr/sync.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { WORKSPACE_SETTINGS_SYNC_EVENT } from '$nostr/workspace-settings';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatInt, formatMoney } from '$lib/utils/format';
	import { newRecordId, nextReadableNumber } from '$lib/utils/record-id';
	import {
		TYPE,
		statusColor,
		type Product,
		type ProductVariant,
		type ModifierGroup,
		type GloObject,
		type Shift,
		type Order,
		type PaymentMethod
	} from '$lib/domain';
	import { cart, type OrderType, type CartModifier } from '$lib/pos/cart.svelte';
	import { computeStock, availableFor, canSell } from '$lib/pos/stock';
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

	function refreshLocalSettings() {
		generalSettings = loadGeneralSettings();
		hardwareSettings = loadHardwareSettings();
		receiptSettings = loadReceiptSettings(tenant.state.organizationName || 'BNOS');
	}

	onMount(() => {
		refreshLocalSettings();
		method = payMethods.includes(generalSettings.defaultPayment)
			? generalSettings.defaultPayment
			: 'cash';
		splitMethod = method;

		dataSync.pageSync(
			[
				TYPE.product,
				TYPE.category,
				TYPE.modifierGroup,
				TYPE.adjustment,
				TYPE.shift,
				TYPE.order,
				TYPE.promotion
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

	// Active promotions
	const activePromotions = $derived(
		glo.all<PromotionData, typeof TYPE.promotion>(TYPE.promotion).filter((p) => {
			const d = p.data;
			const now = new Date();
			const active = d.status === 'active' || d.isActive !== false;
			const notExpired = !d.endDate || new Date(d.endDate) >= now;
			const started = !d.startDate || new Date(d.startDate) <= now;
			const notExhausted = !d.usageLimit || (d.currentUsage ?? 0) < d.usageLimit;
			return active && notExpired && started && notExhausted;
		})
	);

	let promoOpen = $state(false);
	let selectedPromoId = $state<string | null>(null);

	function applyPromotion(promoId: string | null) {
		selectedPromoId = promoId;
		if (promoId) {
			const promo = activePromotions.find((p) => p.id === promoId);
			if (promo) {
				const d = promo.data;
				if (d.type === 'percent' || d.discountType === 'percent') {
					cart.setDiscount({ type: 'percent', value: d.value ?? d.discountValue ?? 0 });
				} else if (d.type === 'fixed' || d.discountType === 'fixed') {
					cart.setDiscount({ type: 'fixed', value: d.value ?? d.discountValue ?? 0 });
				}
				cart.setPromotion(promoId);
				toast.success('Promotion applied: ' + (d.name ?? 'Discount'));
			}
		} else {
			cart.setDiscount({ type: 'percent', value: 0 });
			cart.setPromotion(null);
			selectedPromoId = null;
		}
		promoOpen = false;
	}

	const currency = $derived(tenant.state.currency);
	const products = $derived(glo.all<Product, typeof TYPE.product>(TYPE.product));
	const modifiers = $derived(glo.all<ModifierGroup, typeof TYPE.modifierGroup>(TYPE.modifierGroup));
	const branchId = $derived(tenant.state.locationId ?? undefined);
	const stockMap = $derived(computeStock(glo.all(TYPE.adjustment), branchId));

	let query = $state('');
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
			return matchesCat && matchesQuery && sellable;
		})
	);
	const trackedProducts = $derived(products.filter((p) => p.data.trackInventory).length);
	const lowStockCount = $derived(
		products.filter((p) => {
			const threshold = p.data.inventory?.lowStockThreshold ?? 0;
			return p.data.trackInventory && threshold > 0 && availableFor(stockMap, p.id) <= threshold;
		}).length
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
			return;
		}
		if (groupsFor(data).length) {
			modSel = { obj: p, data };
			chosenMods = {};
			pendingNote = '';
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
		sizeSel = null;
		if (groupsFor(obj.data).length) {
			modSel = { obj, data: obj.data };
			chosenMods = {};
			pendingModVariant = { variantId, variantName, unitPrice: price };
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
		modSel = null;
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
	const change = $derived(Math.max(0, (typeof tendered === 'number' ? tendered : 0) - grandTotal));
	const underPayment = $derived(
		typeof tendered === 'number' && tendered > 0 && tendered < grandTotal
	);

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

	// Payment success visual feedback
	let showSuccessOverlay = $state(false);

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
				showSuccessOverlay = true;
				setTimeout(() => (showSuccessOverlay = false), 1500);
				broadcastCheckoutSuccess(grandTotal, method);
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
				showSuccessOverlay = true;
				setTimeout(() => (showSuccessOverlay = false), 1500);
				broadcastCheckoutSuccess(grandTotal, splitPayments[0].method);
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
		if (!cart.lastCompleted) return;
		if (hardwareSettings.printerType === 'none') {
			toast.warning('Receipt printer is disabled in Hardware settings');
			return;
		}
		const width = receiptSettings.paperSize === '58mm' ? 320 : 420;
		const w = window.open('', '_blank', `width=${width},height=700`);
		if (!w) return;
		w.document.write(buildReceiptHtml());
		w.document.close();
		w.print();
	}

	function escapeHtml(value: unknown) {
		return String(value ?? '')
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#039;');
	}

	function recordValue<T>(value: T): T & Record<string, unknown> {
		return value as T & Record<string, unknown>;
	}

	function buildReceiptHtml() {
		const s = cart.lastCompleted!;
		const receipt = receiptSettings;
		const paperWidth = receipt.paperSize === '58mm' ? '58mm' : '80mm';
		const cashier = tenant.state.activeStaffInfo?.name ?? shiftStaffName.trim() ?? '';
		const lineTotal = (it: (typeof s.items)[number]) =>
			(it.unitPrice + (it.modifiers?.reduce((a, m) => a + m.priceAdjustment, 0) ?? 0)) *
			it.quantity;
		const itemsHtml = s.items
			.map((it) => {
				const name = `${it.quantity}x ${it.name}${it.variantName ? ` (${it.variantName})` : ''}`;
				return `<tr><td>${escapeHtml(name)}</td><td class="right">${escapeHtml(formatMoney(lineTotal(it), currency))}</td></tr>`;
			})
			.join('');
		const headerHtml = [
			receipt.showLogo && receipt.logoUrl
				? `<div class="center logo"><img src="${escapeHtml(receipt.logoUrl)}" alt="Logo"></div>`
				: '',
			receipt.header ? `<div class="center muted">${escapeHtml(receipt.header)}</div>` : '',
			receipt.showStoreName
				? `<h2>${escapeHtml(receipt.storeName || tenant.state.organizationName || 'BNOS')}</h2>`
				: '',
			receipt.showPhone && receipt.phone
				? `<div class="center muted">Tel: ${escapeHtml(receipt.phone)}</div>`
				: '',
			receipt.showAddress && receipt.address
				? `<div class="center muted">${escapeHtml(receipt.address)}</div>`
				: '',
			receipt.showTaxId && receipt.taxId
				? `<div class="center muted">Tax ID: ${escapeHtml(receipt.taxId)}</div>`
				: ''
		].join('');
		const metaHtml = [
			receipt.showDate
				? `<tr><td>Date</td><td class="right">${escapeHtml(new Date().toLocaleString())}</td></tr>`
				: '',
			receipt.showOrderNumber
				? `<tr><td>Order</td><td class="right">${escapeHtml(s.number)}</td></tr>`
				: '',
			receipt.showCashierName && cashier
				? `<tr><td>Cashier</td><td class="right">${escapeHtml(cashier)}</td></tr>`
				: ''
		].join('');
		const optionalHtml = [
			receipt.showBarcode ? `<div class="barcode">${escapeHtml(s.number)}</div>` : '',
			receipt.showQr && receipt.qrData
				? `<div class="qr"><div>QR</div><small>${escapeHtml(receipt.qrData)}</small></div>`
				: ''
		].join('');

		return `<!doctype html>
<html>
<head>
	<title>Receipt ${escapeHtml(s.number)}</title>
	<style>
		@page { size: ${paperWidth} auto; margin: 4mm; }
		* { box-sizing: border-box; }
		body { width: ${paperWidth}; margin: 0 auto; padding: 8px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: ${receipt.paperSize === '58mm' ? '10px' : '12px'}; color: #111; }
		h2 { margin: 4px 0; text-align: center; font-size: 1.25em; }
		table { width: 100%; border-collapse: collapse; }
		td { padding: 2px 0; vertical-align: top; }
		hr { border: 0; border-top: 1px dashed #111; margin: 8px 0; }
		.right { text-align: right; white-space: nowrap; }
		.center { text-align: center; }
		.muted { color: #444; }
		.total { font-weight: 700; font-size: 1.15em; }
		.logo img { max-width: 42mm; max-height: 18mm; object-fit: contain; }
		.barcode { margin: 10px 0 4px; text-align: center; letter-spacing: 3px; font-size: 18px; }
		.qr { margin: 10px auto 4px; display: grid; min-height: 64px; place-items: center; border: 1px solid #999; text-align: center; }
		.footer { margin-top: 10px; text-align: center; white-space: pre-wrap; }
	</style>
</head>
<body>
	${headerHtml}
	<hr>
	<table>${metaHtml}</table>
	<hr>
	<table>${itemsHtml}</table>
	<hr>
	<table>
		<tr class="total"><td>TOTAL</td><td class="right">${escapeHtml(formatMoney(s.totals.total, currency))}</td></tr>
		<tr><td>Method</td><td class="right">${escapeHtml(s.method)}</td></tr>
		${s.change > 0 ? `<tr><td>Change</td><td class="right">${escapeHtml(formatMoney(s.change, currency))}</td></tr>` : ''}
	</table>
	${optionalHtml}
	<hr>
	<div class="footer">${escapeHtml(receipt.footer)}</div>
</body>
</html>`;
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
	function applyDiscount() {
		cart.setDiscount({
			type: dType,
			value: typeof dValue === 'number' ? dValue : Number(dValue) || 0
		});
		discountOpen = false;
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

	function startNewSale() {
		if (cart.isEmpty) return;
		clearCart();
		tipAmount = 0;
		resetSplit();
		toast.info('Started a new sale');
	}

	function clearCart() {
		refreshLocalSettings();
		if (generalSettings.confirmClear && !confirm('Clear the current cart?')) return;
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

	// ── B) Shift Gate ──
	const shifts = $derived(glo.all<Shift, typeof TYPE.shift>(TYPE.shift));
	const openShift = $derived(
		shifts.find((s) => !s.data.closedAt && s.data.status !== 'closed') ?? null
	);
	let shiftModalOpen = $state(false);
	// Track whether shifts have been hydrated from IndexedDB.
	// glo.version is $state — it bumps when hydration completes.
	let shiftsLoaded = $state(false);
	$effect(() => {
		const trackedVersion = glo.version;
		const trackedShiftCount = shifts.length;
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
		const number = nextReadableNumber({ prefix: 'SFT', scope: tenant.state.locationId });
		const openingCash =
			typeof shiftOpeningCash === 'number' ? shiftOpeningCash : Number(shiftOpeningCash) || 0;
		await glo.upsert<Shift>(
			TYPE.shift,
			{
				number,
				status: 'active',
				openedAt: new Date().toISOString(),
				openingCash,
				staffName: shiftStaffName.trim() || undefined,
				branchId: tenant.state.locationId ?? undefined,
				currency
			},
			{ id: newRecordId('shift') }
		);
		toast.success('Shift opened', number);
		shiftModalOpen = false;
		shiftOpeningCash = '';
		shiftStaffName = '';
	}
	async function closeShift() {
		if (!openShift) return;
		const closingCash =
			typeof shiftOpeningCash === 'number' ? shiftOpeningCash : Number(shiftOpeningCash) || 0;
		await glo.upsert<Shift>(
			TYPE.shift,
			{
				...openShift.data,
				status: 'closed',
				closedAt: new Date().toISOString(),
				closingCash
			},
			{ id: openShift.id }
		);
		toast.success('Shift closed', openShift.data.number);
		shiftModalOpen = false;
	}
	const shiftLabel = $derived.by(() => {
		if (!openShift) return null;
		const d = new Date(openShift.data.openedAt);
		const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(d);
		return `Shift ${openShift.data.number} · Started ${time}`;
	});

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
		displayChannel?.postMessage({ type: 'checkout-success', total, method: payMethod, currency });
	}
</script>

<svelte:head><title>BNOS · Point of Sale</title></svelte:head>

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
						<h1 class="font-display text-lg font-bold tracking-tight sm:text-xl">POS Terminal</h1>
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
				{#if shiftLabel}
					<Badge color="success">
						<Icon name="lucide:clock" class="size-3.5" />
						{shiftLabel}
					</Badge>
					<button
						type="button"
						onclick={() => {
							shiftModalOpen = true;
							shiftOpeningCash = '';
						}}
						class="text-[11px] font-semibold text-[var(--tone-error-text)] hover:underline"
						>Close shift</button
					>
				{/if}
				<Badge color={lowStockCount > 0 ? 'warning' : 'success'}>
					<Icon name="lucide:boxes" class="size-3.5" />
					{formatInt(trackedProducts)} tracked
				</Badge>
				{#if lowStockCount > 0}
					<Badge color="warning">
						<Icon name="lucide:triangle-alert" class="size-3.5" />
						{formatInt(lowStockCount)} low stock
					</Badge>
				{/if}

				<!-- Primary actions -->
				<Button
					color="neutral"
					variant="soft"
					size="sm"
					icon="lucide:badge-plus"
					disabled={cart.isEmpty}
					onclick={startNewSale}
					title="Start new sale"
				>
					New sale
				</Button>
				<Button
					color="neutral"
					variant="soft"
					size="sm"
					icon="lucide:plus-circle"
					onclick={openCustom}
					title="Add custom item"
				>
					Custom
				</Button>
				<a
					href={resolve('/pos/customer-display')}
					target="_blank"
					title="Open customer display"
					class="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] font-semibold text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)]"
				>
					<Icon name="lucide:monitor" class="size-3.5" />
					Display
				</a>

				<!-- More options dropdown -->
				<Menu id="pos-header-more" placement="bottom-end" width="md">
					{#snippet trigger()}<Icon name="lucide:more-horizontal" class="size-4" />{/snippet}
					<MenuItem icon="lucide:list-ordered" onclick={openHistory}>History</MenuItem>
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
			class="grid h-full min-h-0 gap-4 {cart.isEmpty
				? 'lg:grid-cols-1'
				: 'lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_26rem]'}"
		>
			<!-- Product browser -->
			<section class="flex min-h-0 min-w-0 flex-col overflow-hidden">
				<div class="px-4 py-4 sm:px-5 lg:px-6">
					<div class="flex flex-wrap items-center gap-2">
						<Input
							bind:value={query}
							icon="lucide:search"
							placeholder="Search products..."
							class="min-w-[12rem] flex-1"
						/>
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
						</div>
						<div class="flex items-center gap-2 text-[12px] text-[var(--ui-text-dimmed)]">
							<span>{formatInt(filtered.length)} visible</span>
							<span class="h-1 w-1 rounded-full bg-[var(--ui-text-dimmed)]"></span>
							<span>{formatMoney(cart.totals.total, currency)} cart</span>
						</div>
					</div>
				</div>

				<div class="min-h-0 flex-1 overflow-y-auto px-4 pb-4 sm:px-5 sm:pb-5 lg:px-6 lg:pb-6">
					{#if filtered.length === 0}
						<EmptyState
							icon="lucide:package"
							title="No products"
							description="Add products in Catalog, or seed samples from Setup -> Catalog to start selling."
						>
							{#snippet actions()}
								<Button color="primary" size="sm" icon="lucide:plus" href={resolve('/catalog')}
									>Add product</Button
								>
							{/snippet}
						</EmptyState>
					{:else}
						<div
							class="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-5 {cart.isEmpty
								? 'lg:grid-cols-6 xl:grid-cols-7'
								: ''}"
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
								<button
									type="button"
									onclick={() => tapProduct(p)}
									disabled={outOfStock as boolean}
									class="surface-card group relative flex flex-col gap-2 p-2.5 text-left transition-all enabled:hover:-translate-y-0.5 enabled:hover:border-primary-500/40 enabled:active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40"
								>
									<div
										class="relative grid aspect-square w-full place-items-center rounded-xl bg-[var(--ui-bg-accented)] text-[var(--ui-text-dimmed)]"
									>
										<Icon name="lucide:cup-soda" class="size-6 sm:size-7" />
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
										<div class="text-[12.5px] font-bold text-primary-600 dark:text-primary-400">
											{formatMoney(p.data.price ?? 0, p.data.currency ?? currency)}
										</div>
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

			<!-- Desktop cart sidebar (lg+) — hidden when empty for full-width browsing -->
			{#if !cart.isEmpty}
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
								onclick={clearCart}>Clear</button
							>
						{/if}
					</header>
					{#if cart.isEmpty}
						<!-- sidebar is hidden when empty; this never shows -->
					{:else}
						<div class="min-h-0 flex-1 overflow-y-auto">
							{@render cartContent()}
						</div>
						{@render tenderBlock()}
					{/if}
				</aside>
			{/if}
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
				<h3 class="font-display text-lg font-bold">No active shift</h3>
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
					Open shift
				</Button>
			</div>
		</div>
	{/if}
</div>

<!-- Payment success overlay -->
{#if showSuccessOverlay}
	<div class="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center">
		<div class="rounded-full bg-green-500/20 p-6">
			<div
				class="grid size-20 place-items-center rounded-full bg-green-500 text-white shadow-lg shadow-green-500/50"
			>
				<Icon name="lucide:check" class="size-10" />
			</div>
		</div>
	</div>
{/if}

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
					aria-label="Close"
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
					onclick={clearCart}>Clear</button
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
								aria-label="Decrease"><Icon name="lucide:minus" class="size-3.5" /></button
							>
							<span class="w-6 text-center text-[13px] font-semibold tabular-nums"
								>{line.quantity}</span
							>
							<button
								type="button"
								onclick={() => cart.inc(line.key)}
								class="grid size-7 place-items-center rounded-md bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]"
								aria-label="Increase"><Icon name="lucide:plus" class="size-3.5" /></button
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
								aria-label="Remove"><Icon name="lucide:x" class="size-3.5" /></button
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
					<Input
						bind:value={cart.customerName}
						icon="lucide:user"
						placeholder="Customer name (optional)"
						class="w-full"
					/>
					{#if cart.orderType === 'dine_in'}
						<div class="grid grid-cols-2 gap-2">
							<Input
								bind:value={cart.tableId}
								icon="lucide:layout-grid"
								placeholder="Table"
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
						onclick={() => {
							dType = cart.discount.type;
							dValue = cart.discount.value || '';
							discountOpen = true;
						}}
						class="flex w-full items-center justify-between rounded-lg border border-dashed border-[var(--ui-border)] px-3 py-1.5 text-[12px] font-semibold text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)]"
					>
						<span><Icon name="lucide:tag" class="mr-1 inline size-3.5" />Discount</span>
						{#if cart.totals.discountAmount > 0}<span class="text-[var(--tone-success-text)]"
								>−{formatMoney(cart.totals.discountAmount, currency)}</span
							>{:else}<span class="text-[var(--ui-text-dimmed)]">None</span>{/if}
					</button>
					{#if activePromotions.length > 0}
						<button
							type="button"
							onclick={() => (promoOpen = true)}
							class="flex items-center gap-1.5 rounded-lg border border-primary-200 bg-primary-50 px-3 py-1.5 text-[12px] font-semibold text-primary-700 transition-colors hover:bg-primary-100 dark:border-primary-800 dark:bg-primary-950 dark:text-primary-300 dark:hover:bg-primary-900"
						>
							<Icon name="lucide:ticket-percent" class="size-3.5" />
							{selectedPromoId ? 'Promo applied' : 'Promotions'}
							{#if activePromotions.length > 1}
								<span class="rounded-full bg-primary-200 px-1.5 text-[10px] dark:bg-primary-800"
									>{formatInt(activePromotions.length)}</span
								>
							{/if}
						</button>
					{/if}
				</div>
			{/if}
		</div>

		<!-- totals -->
		<div class="space-y-1.5 border-t border-[var(--ui-border-muted)] pt-3 text-[13px]">
			<div class="flex justify-between text-[var(--ui-text-muted)]">
				<span>Subtotal</span><span class="tabular-nums"
					>{formatMoney(cart.totals.subtotal, currency)}</span
				>
			</div>
			{#if cart.totals.discountAmount > 0}
				<div class="flex justify-between text-[var(--tone-success-text)]">
					<span>Discount</span><span class="tabular-nums"
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
				<span>Total</span><span class="text-primary-600 tabular-nums dark:text-primary-400"
					>{formatMoney(cart.totals.total, currency)}</span
				>
			</div>
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
						placeholder="Amount"
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
						onclick={addSplitPayment}>Add</Button
					>
				</div>
			{/if}

			<!-- Complete split checkout -->
			<div class="grid grid-cols-2 gap-2">
				<Button color="neutral" variant="subtle" icon="lucide:x" onclick={resetSplit}>Cancel</Button
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
								>Change</span
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
						title="Set exact amount">Exact</button
					>
				</div>
			{/if}

			<div class="grid grid-cols-2 gap-2">
				<Button
					color="neutral"
					variant="subtle"
					icon="lucide:pause"
					disabled={processing}
					onclick={() => cart.hold()}>Hold</Button
				>
				<Button color="primary" disabled={processing} onclick={checkout}
					>{#if processing}<Icon
							name="lucide:loader-circle"
							class="size-4 animate-spin"
						/>…{:else}<Icon name="lucide:check-circle" class="size-4" />Charge{/if}</Button
				>
			</div>
		{/if}
	</div>
{/snippet}

<!-- Size / variant selector -->
<Dialog open={!!sizeSel} title={sizeSel?.data.name ?? 'Select'} size="sm">
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
		<Button color="neutral" variant="ghost" onclick={() => (sizeSel = null)}>Cancel</Button>
		<Button color="primary" icon="lucide:check" onclick={confirmVariant}>Add</Button>
	{/snippet}
</Dialog>

<!-- Modifier selector -->
<Dialog open={!!modSel} title={modSel?.data.name ?? 'Options'} size="md">
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
				modSel = null;
				pendingModVariant = null;
			}}>Cancel</Button
		>
		<Button color="primary" icon="lucide:check" onclick={confirmModifiers}>Add to sale</Button>
	{/snippet}
</Dialog>

<!-- Line note -->
<Dialog bind:open={noteOpen} title="Line note" size="sm">
	<Input bind:value={noteText} placeholder="e.g. extra hot, no onions" class="w-full" />
	{#snippet footer()}
		<Button color="neutral" variant="ghost" onclick={() => (noteOpen = false)}>Cancel</Button>
		<Button color="primary" icon="lucide:check" onclick={saveNote}>Save</Button>
	{/snippet}
</Dialog>

<!-- Discount -->
<Dialog bind:open={discountOpen} title="Cart discount" size="sm">
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
		<Button color="neutral" variant="ghost" onclick={() => (discountOpen = false)}>Cancel</Button>
		<Button color="primary" icon="lucide:check" onclick={applyDiscount}>Apply</Button>
	{/snippet}
</Dialog>

<!-- Promotion picker -->
<Dialog bind:open={promoOpen} title="Active promotions" size="md">
	<div class="space-y-2">
		{#if selectedPromoId}
			<button
				type="button"
				onclick={() => applyPromotion(null)}
				class="flex w-full items-center gap-3 rounded-lg border border-[var(--tone-error-bg)] bg-[var(--tone-error-bg)]/50 p-3 text-left transition-colors hover:bg-[var(--tone-error-bg)]"
			>
				<Icon name="lucide:x-circle" class="size-5 text-[var(--tone-error-text)]" />
				<div>
					<p class="text-[13px] font-semibold text-[var(--tone-error-text)]">Remove promotion</p>
					<p class="text-[11px] text-[var(--ui-text-muted)]">Clear active promotion & discount</p>
				</div>
			</button>
		{/if}
		{#each activePromotions as promo (promo.id)}
			{@const d = promo.data}
			<button
				type="button"
				onclick={() => applyPromotion(promo.id)}
				class="flex w-full items-center gap-3 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] p-3 text-left transition-colors hover:bg-[var(--ui-bg-accented)]"
			>
				<div
					class="grid size-10 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-primary-400 to-primary-600 text-white"
				>
					<Icon name="lucide:ticket-percent" class="size-5" />
				</div>
				<div class="min-w-0 flex-1">
					<p class="truncate text-[13px] font-bold">{d.name ?? 'Unnamed promotion'}</p>
					<p class="truncate text-[11.5px] text-[var(--ui-text-muted)]">
						{d.type === 'percent' || d.discountType === 'percent'
							? `${d.value ?? d.discountValue ?? 0}% off`
							: d.type === 'fixed' || d.discountType === 'fixed'
								? formatMoney(d.value ?? d.discountValue ?? 0, currency)
								: (d.description ?? 'Special offer')}
					</p>
				</div>
				{#if selectedPromoId === promo.id}
					<Icon name="lucide:check-circle-2" class="size-5 text-primary-500" />
				{/if}
			</button>
		{/each}
	</div>
	{#snippet footer()}
		<Button color="neutral" variant="ghost" onclick={() => (promoOpen = false)}>Close</Button>
	{/snippet}
</Dialog>

<!-- Held orders -->
<Dialog bind:open={heldOpen} title="Held orders" size="md">
	{#if cart.held.length === 0}
		<EmptyState
			icon="lucide:pause"
			title="No held orders"
			description="Park a sale with Hold to finish it later."
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
							{h.customerName ?? 'Walk-in'} · {formatMoney(heldTotal, currency)}
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
							aria-label="Delete"
						/>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</Dialog>

<!-- Receipt -->
<Dialog bind:open={receiptOpen} title="Sale complete" size="sm">
	{#if cart.lastCompleted}
		{@const s = cart.lastCompleted}
		<div class="text-center">
			<div
				class="mx-auto grid size-12 place-items-center rounded-full bg-[var(--tone-success-bg)] text-[var(--tone-success-text)]"
			>
				<Icon name="lucide:check" class="size-6" />
			</div>
			<div class="mt-2 font-mono text-[14px] font-bold">{s.number}</div>
			<div class="font-display text-2xl font-bold tabular-nums">
				{formatMoney(s.totals.total, currency)}
			</div>
			<div class="text-[11.5px] text-[var(--ui-text-muted)] capitalize">
				{s.method} · {s.orderType.replace('_', '-')}{#if s.change > 0}
					· change {formatMoney(s.change, currency)}{/if}
			</div>
		</div>
		<ul class="mt-3 divide-y divide-[var(--ui-border-muted)] text-[12.5px]">
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
	{/if}
	{#snippet footer()}
		<div class="flex gap-2">
			<Button color="neutral" variant="subtle" icon="lucide:printer" onclick={printReceipt}
				>Print</Button
			>
			<Button color="primary" block onclick={() => (receiptOpen = false)}>New sale</Button>
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
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Price</span
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
					>Quantity</span
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
		<Button color="neutral" variant="ghost" onclick={() => (customOpen = false)}>Cancel</Button>
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
				No active shift. Open one to start processing sales.
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
				<Input bind:value={shiftStaffName} icon="lucide:user" placeholder="Name" class="w-full" />
			</label>
		</div>
	{/if}
	{#snippet footer()}
		<Button color="neutral" variant="ghost" onclick={() => (shiftModalOpen = false)}>Cancel</Button>
		{#if openShift}
			<Button color="neutral" icon="lucide:lock" onclick={closeShift}>Close shift</Button>
		{:else}
			<Button color="primary" icon="lucide:unlock" onclick={openShiftAction}>Open shift</Button>
		{/if}
	{/snippet}
</Dialog>

<!-- History Quick Access Modal -->
<Dialog bind:open={historyOpen} title="Recent orders" size="md">
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
