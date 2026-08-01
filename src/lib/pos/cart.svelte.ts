/**
 * POS cart store (Svelte 5 runes). A single reactive sale session: the active
 * cart, discounts, order type / customer / table context, held (parked) orders,
 * and checkout. Persists the active cart + held orders to localStorage so a
 * refresh never loses a sale — mirroring bdgo-os's offline-first POS.
 *
 * Lines are keyed by a composite of product + variant + modifiers + note, so
 * the same product ordered two ways (e.g. "Latte / Large" and "Latte / Small")
 * stays on separate lines, exactly like bdgo-os.
 */
import { browser } from '$app/environment';
import { glo } from '$nostr/store.svelte';
import { tenant } from '$nostr/tenant.svelte';
import { session } from '$nostr/session.svelte';
import { toast } from '$lib/stores/toast.svelte';
import { TYPE, type Order, type OrderType, type Payment, type PaymentMethod } from '$lib/domain';
import { computeTotals, NO_DISCOUNT, type CartDiscount, type Totals } from './totals';
import { buildOrder, buildPayment, type CartLineForReceipt } from './receipt';

const CART_KEY = 'bnos-os:pos:cart';
const HELD_KEY = 'bnos-os:pos:held';
const COUNTER_KEY = 'bnos-os:pos:counter';

export type { OrderType };

export interface CartModifier {
	groupId?: string;
	modifierId?: string;
	name: string;
	priceAdjustment: number;
}

export interface CartLine {
	key: string;
	productId: string;
	name: string;
	unitPrice: number;
	quantity: number;
	variantId?: string;
	variantName?: string;
	note?: string;
	modifiers?: CartModifier[];
}

export interface HeldOrder {
	id: number;
	orderType: OrderType;
	items: CartLine[];
	discount: CartDiscount;
	customerName?: string;
	tableId?: string;
	covers?: number;
	heldAt: string;
}

export interface CompletedSale {
	number: string;
	orderType: OrderType;
	items: CartLine[];
	totals: Totals;
	method: PaymentMethod;
	change: number;
	completedAt: string;
}

function lineKey(
	productId: string,
	variantId?: string,
	modifiers?: CartModifier[],
	note?: string
): string {
	const modSig = (modifiers ?? [])
		.map((m) => `${m.modifierId ?? m.name}:${m.priceAdjustment}`)
		.sort()
		.join(',');
	return [productId, variantId ?? '', modSig, (note ?? '').trim().toLowerCase()].join('|');
}

function readJson<T>(key: string, fallback: T): T {
	if (!browser) return fallback;
	try {
		const raw = localStorage.getItem(key);
		return raw ? (JSON.parse(raw) as T) : fallback;
	} catch {
		return fallback;
	}
}

function writeJson(key: string, value: unknown) {
	if (!browser) return;
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		/* quota / private mode — best effort */
	}
}

function nextOrderNumber(): string {
	let counter = 1000;
	if (browser) {
		counter = Number(localStorage.getItem(COUNTER_KEY) ?? '1000');
		counter += 1;
		localStorage.setItem(COUNTER_KEY, String(counter));
	}
	return `ORD-${counter}`;
}

class PosCart {
	items = $state<CartLine[]>(readJson<CartLine[]>(CART_KEY, []));
	discount = $state<CartDiscount>({ ...NO_DISCOUNT });
	orderType = $state<OrderType>('takeaway');
	customerName = $state('');
	tableId = $state('');
	covers = $state(1);
	held = $state<HeldOrder[]>(readJson<HeldOrder[]>(HELD_KEY, []));
	lastCompleted = $state<CompletedSale | null>(null);

	private heldCounter = readJson<number>(HELD_KEY + ':seq', 0) || 0;

	// ── persistence ──
	private persist() {
		writeJson(CART_KEY, this.items);
	}
	private persistHeld() {
		writeJson(HELD_KEY, this.held);
	}

	// ── derived totals ──
	subtotal = $derived(this.items.reduce((s, l) => s + this.lineAmount(l), 0));
	totals = $derived(
		computeTotals({
			subtotal: this.subtotal,
			discount: this.discount,
			taxRatePct: tenant.state.defaultTaxRate,
			taxIncluded: tenant.state.taxIncludedInPrice
		})
	);
	itemCount = $derived(this.items.reduce((s, l) => s + l.quantity, 0));
	isEmpty = $derived(this.items.length === 0);

	lineAmount(line: CartLine): number {
		const modTotal = (line.modifiers ?? []).reduce((s, m) => s + m.priceAdjustment, 0);
		return (line.unitPrice + modTotal) * line.quantity;
	}

	// ── mutation ──
	add(input: {
		productId: string;
		name: string;
		unitPrice: number;
		quantity?: number;
		variantId?: string;
		variantName?: string;
		note?: string;
		modifiers?: CartModifier[];
	}) {
		const qty = input.quantity ?? 1;
		const key = lineKey(input.productId, input.variantId, input.modifiers, input.note);
		const existing = this.items.find((l) => l.key === key);
		if (existing) {
			existing.quantity += qty;
		} else {
			this.items = [
				...this.items,
				{
					key,
					productId: input.productId,
					name: input.name,
					unitPrice: input.unitPrice,
					quantity: qty,
					variantId: input.variantId,
					variantName: input.variantName,
					note: input.note,
					modifiers: input.modifiers
				}
			];
		}
		this.persist();
	}

	inc(key: string) {
		const l = this.items.find((i) => i.key === key);
		if (l) {
			l.quantity += 1;
			this.persist();
		}
	}
	dec(key: string) {
		const l = this.items.find((i) => i.key === key);
		if (!l) return;
		if (l.quantity <= 1) this.remove(key);
		else {
			l.quantity -= 1;
			this.persist();
		}
	}
	setQty(key: string, qty: number) {
		const l = this.items.find((i) => i.key === key);
		if (!l) return;
		if (qty <= 0) this.remove(key);
		else {
			l.quantity = qty;
			this.persist();
		}
	}
	setNote(key: string, note: string) {
		const l = this.items.find((i) => i.key === key);
		if (l) {
			l.note = note;
			this.persist();
		}
	}
	remove(key: string) {
		this.items = this.items.filter((i) => i.key !== key);
		this.persist();
	}
	clear() {
		this.items = [];
		this.discount = { ...NO_DISCOUNT };
		this.customerName = '';
		this.tableId = '';
		this.covers = 1;
		this.persist();
	}

	setDiscount(discount: CartDiscount) {
		this.discount = discount;
	}
	setOrderType(t: OrderType) {
		this.orderType = t;
		if (t !== 'dine_in') {
			this.tableId = '';
			this.covers = 1;
		}
	}
	setCustomer(name: string) {
		this.customerName = name;
	}
	setTable(id: string) {
		this.tableId = id;
	}
	setCovers(n: number) {
		this.covers = Math.max(1, Math.floor(n) || 1);
	}

	// ── hold / recall ──
	hold() {
		if (this.isEmpty) return;
		this.heldCounter += 1;
		const order: HeldOrder = {
			id: this.heldCounter,
			orderType: this.orderType,
			items: structuredClone($state.snapshot(this.items)) as CartLine[],
			discount: { ...this.discount },
			customerName: this.customerName || undefined,
			tableId: this.orderType === 'dine_in' ? this.tableId || undefined : undefined,
			covers: this.orderType === 'dine_in' ? this.covers : undefined,
			heldAt: new Date().toISOString()
		};
		this.held = [order, ...this.held];
		this.persistHeld();
		this.clear();
	}
	recall(id: number) {
		if (!this.isEmpty) return; // don't clobber an active sale
		const idx = this.held.findIndex((o) => o.id === id);
		if (idx < 0) return;
		const [order] = this.held.splice(idx, 1);
		if (!order) return;
		this.items = order.items;
		this.discount = order.discount;
		this.orderType = order.orderType;
		this.customerName = order.customerName ?? '';
		this.tableId = order.tableId ?? '';
		this.covers = order.covers ?? 1;
		this.persistHeld();
		this.persist();
	}
	deleteHeld(id: number) {
		this.held = this.held.filter((o) => o.id !== id);
		this.persistHeld();
	}

	// ── checkout ──
	async checkout(method: PaymentMethod, tendered = 0): Promise<CompletedSale | null> {
		if (this.isEmpty) return null;
		const number = nextOrderNumber();
		const currency = tenant.state.currency;
		const totals = this.totals;
		const change = Math.max(0, tendered - totals.total);
		const completedAt = new Date().toISOString();

		const lines: CartLineForReceipt[] = this.items.map((l) => ({
			productId: l.productId,
			name: l.name,
			unitPrice: l.unitPrice,
			quantity: l.quantity,
			variantId: l.variantId,
			variantName: l.variantName,
			note: l.note,
			modifiers: l.modifiers
		}));

		const order = buildOrder({
			number,
			currency,
			lines,
			totals,
			orderType: this.orderType,
			customerName: this.customerName || undefined,
			tableId: this.orderType === 'dine_in' ? this.tableId || undefined : undefined,
			covers: this.orderType === 'dine_in' ? this.covers : undefined,
			branchId: tenant.state.locationId ?? undefined,
			cashierPubkey: session.pubkey ?? undefined,
			discount:
				this.discount.value > 0
					? { type: this.discount.type, value: this.discount.value }
					: undefined
		});
		const payment = buildPayment({
			amount: totals.total,
			currency,
			method,
			cashReceived: method === 'cash' ? tendered || totals.total : undefined,
			changeGiven: method === 'cash' ? change : undefined,
			cashierPubkey: session.pubkey ?? undefined,
			branchId: tenant.state.locationId ?? undefined,
			paidAt: completedAt
		});

		try {
			const orderObj = await glo.upsert<Order>(TYPE.order, order);
			await glo.upsert<Payment>(TYPE.payment, { ...payment, orderId: orderObj.id });
		} catch (e) {
			console.warn('[pos] checkout persist failed', e);
			toast.error('Sale saved locally', 'Relay sync will retry.');
		}

		const sale: CompletedSale = {
			number,
			orderType: this.orderType,
			items: structuredClone($state.snapshot(this.items)) as CartLine[],
			totals,
			method,
			change,
			completedAt
		};
		this.lastCompleted = sale;
		this.clear();
		return sale;
	}
}

export const cart = new PosCart();
