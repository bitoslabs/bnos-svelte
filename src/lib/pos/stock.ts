/**
 * Inventory stock computation for the POS/catalog.
 *
 * Available stock is derived from `inventory.adjustment` records (GLO objects
 * of type `inventory.adjustment`), exactly as bdgo-os reconstructs stock from
 * `StockAdjustment` events. Each adjustment carries a signed `quantity`
 * (positive for increase/restock, negative for sale/decrease).
 *
 * Stock is keyed per product, or per product+variant when a variant is set,
 * and can be scoped to the active branch.
 */
import type { StockAdjustment } from '$lib/domain';

/** Minimal structural view of a stock adjustment used to compute stock. */
interface StockAdjustmentLike {
	productId?: string;
	variantId?: string;
	branchId?: string;
	quantity?: number;
}

export type StockAdjustmentInput = { data: StockAdjustmentLike } | StockAdjustmentLike;

/** Stable stock key: `productId` or `productId:variantId`. */
export function stockKey(productId: string, variantId?: string): string {
	return variantId ? `${productId}:${variantId}` : productId;
}

export type StockMap = Map<string, number>;

/**
 * Build a stock map from adjustment objects.
 *
 * @param adjustments GLO objects whose `data` is a `StockAdjustment`.
 * @param branchId    When set, only adjustments for this branch are counted.
 */
export function computeStock(
	adjustments: StockAdjustmentInput[],
	branchId?: string | null
): StockMap {
	const map: StockMap = new Map();
	for (const raw of adjustments) {
		const data = ('data' in raw ? raw.data : raw) as StockAdjustmentLike;
		if (!data) continue;
		if (branchId && data.branchId && data.branchId !== branchId) continue;
		if (!data.productId) continue;
		const key = stockKey(data.productId, data.variantId);
		map.set(key, (map.get(key) ?? 0) + (data.quantity ?? 0));
	}
	return map;
}

/** Available quantity for a product (or product+variant). Defaults to 0. */
export function availableFor(map: StockMap, productId: string, variantId?: string): number {
	return map.get(stockKey(productId, variantId)) ?? 0;
}

/**
 * Can `quantity` more units be sold?
 *
 * - If the product does not track inventory → always allowed (POS treats it as
 *   unlimited, like bdgo-os `allowBackorder`).
 * - If `denySaleWhenOutOfStock` is set and no backorder is allowed, the sale
 *   is blocked when the requested quantity exceeds available stock.
 */
export function canSell(opts: {
	trackInventory?: boolean;
	denySaleWhenOutOfStock?: boolean;
	allowBackorder?: boolean;
	available: number;
	requested: number;
}): { ok: true } | { ok: false; reason: string } {
	const { trackInventory, denySaleWhenOutOfStock, allowBackorder, available, requested } = opts;
	if (!trackInventory || allowBackorder || !denySaleWhenOutOfStock) return { ok: true };
	if (requested > available) {
		return {
			ok: false,
			reason: `Only ${available} in stock`
		};
	}
	return { ok: true };
}
