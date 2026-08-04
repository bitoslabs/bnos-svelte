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
import { newRecordId, nextReadableNumber } from '$lib/utils/record-id';
import { computeTotals, NO_DISCOUNT, type CartDiscount, type Totals } from './totals';
import { buildOrder, buildPayment, type CartLineForReceipt } from './receipt';
import { shifts as shiftStore } from './shifts.svelte';

const CART_KEY = 'bnos-os:pos:cart';
const HELD_KEY = 'bnos-os:pos:held';

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
	customerId?: string | null;
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

class PosCart {
	items = $state<CartLine[]>(readJson<CartLine[]>(CART_KEY, []));
	discount = $state<CartDiscount>({ ...NO_DISCOUNT });
	orderType = $state<OrderType>('takeaway');
	customerName = $state('');
	tableId = $state('');
	covers = $state(1);
	held = $state<HeldOrder[]>(readJson<HeldOrder[]>(HELD_KEY, []));
	customerId: string | null = $state(null);
	appliedPromotionId: string | null = $state(null);
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
		this.customerId = null;
		this.appliedPromotionId = null;
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
	setCustomer(name: string, id?: string) {
		this.customerName = name;
		this.customerId = id ?? null;
	}
	setPromotion(id: string | null) {
		this.appliedPromotionId = id;
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
			customerId: this.customerId ?? undefined,
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
		this.customerId = order.customerId ?? null;
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
		const orderId = newRecordId('order');
		const number = nextReadableNumber({ prefix: 'ORD', scope: tenant.state.locationId });
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
			source: 'pos',
			customerName: this.customerName || undefined,
			customerId: this.customerId ?? undefined,
			tableId: this.orderType === 'dine_in' ? this.tableId || undefined : undefined,
			covers: this.orderType === 'dine_in' ? this.covers : undefined,
			branchId: tenant.state.locationId ?? undefined,
			cashierPubkey: session.pubkey ?? undefined,
			shiftId: shiftStore.activeShift?.id,
			discount:
				this.discount.value > 0
					? { type: this.discount.type, value: this.discount.value }
					: undefined,
			method
		});
		const payment = buildPayment({
			amount: totals.total,
			currency,
			method,
			cashReceived: method === 'cash' ? tendered || totals.total : undefined,
			changeGiven: method === 'cash' ? change : undefined,
			cashierPubkey: session.pubkey ?? undefined,
			branchId: tenant.state.locationId ?? undefined,
			shiftId: shiftStore.activeShift?.id,
			paidAt: completedAt
		});

		try {
			await glo.upsert<Order>(TYPE.order, order, { id: orderId });
			await glo.upsert<Payment>(
				TYPE.payment,
				{ ...payment, orderId },
				{ id: newRecordId('payment') }
			);
		} catch (e) {
			console.warn('[pos] checkout persist failed', e);
			toast.error('Sale saved locally', 'Relay sync will retry.');
		}

		// ── Post-checkout data flows ──

		// A. Decrement stock for each product
		for (const line of lines) {
			if (line.productId) {
				const product = glo.get(TYPE.product, line.productId);
				if (product) {
					const productData = product.data as Record<string, unknown>;
					const currentStock =
						typeof productData.stockLevel === 'number' ? productData.stockLevel : 0;
					try {
						await glo.upsert(
							TYPE.product,
							{
								...productData,
								stockLevel: Math.max(0, currentStock - line.quantity)
							},
							{ id: product.id }
						);
					} catch (e) {
						console.warn('[pos] stock decrement failed for', line.productId, e);
					}
				}
			}
		}

		// B. Update customer spend tracking
		if (this.customerId || this.customerName) {
			try {
				let cust: { id: string; data: Record<string, unknown> } | undefined;
				if (this.customerId) {
					const found = glo.get(TYPE.customer, this.customerId);
					cust = found ? { id: found.id, data: found.data as Record<string, unknown> } : undefined;
				} else {
					const customers = glo.all<Record<string, unknown>, typeof TYPE.customer>(TYPE.customer);
					cust = customers.find((c) => c.data.name === this.customerName);
				}
				if (cust) {
					const totalSpend = typeof cust.data.totalSpend === 'number' ? cust.data.totalSpend : 0;
					const totalOrders = typeof cust.data.totalOrders === 'number' ? cust.data.totalOrders : 0;
					await glo.upsert(
						TYPE.customer,
						{
							...cust.data,
							totalSpend: totalSpend + totals.total,
							totalOrders: totalOrders + 1,
							lastOrderAt: completedAt
						},
						{ id: cust.id }
					);
				}
			} catch (e) {
				console.warn('[pos] customer update failed', e);
			}
		}

		// C. Track promotion usage
		if (this.appliedPromotionId) {
			try {
				const promo = glo.get(TYPE.promotion, this.appliedPromotionId);
				if (promo) {
					const promoData = promo.data as Record<string, unknown>;
					const currentUsage =
						typeof promoData.currentUsage === 'number' ? promoData.currentUsage : 0;
					await glo.upsert(
						TYPE.promotion,
						{
							...promoData,
							currentUsage: currentUsage + 1
						},
						{ id: promo.id }
					);
				}
			} catch (e) {
				console.warn('[pos] promotion usage increment failed', e);
			}
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
