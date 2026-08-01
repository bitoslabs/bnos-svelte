/**
 * Pure POS totals math — mirrors bdgo-os `usePosCart` totals, separated so it
 * is trivially unit-testable and reusable from the cart store and reports.
 *
 * Tax handling matches the bdgo-os rule:
 *  - `taxIncluded` true  → the line prices already include tax; we extract it.
 *  - `taxIncluded` false → tax is added on top of the (discounted) subtotal.
 */
export type DiscountType = 'percent' | 'fixed';

export interface CartDiscount {
	type: DiscountType;
	value: number;
}

export interface TotalsInput {
	/** Sum of all line totals (quantity × unit price + modifiers). */
	subtotal: number;
	discount: CartDiscount;
	/** Tax rate as a percentage, e.g. `10` for 10%. */
	taxRatePct: number;
	/** Whether line prices already include tax. */
	taxIncluded: boolean;
}

export interface Totals {
	subtotal: number;
	discountAmount: number;
	taxableBase: number;
	tax: number;
	total: number;
}

export const NO_DISCOUNT: CartDiscount = { type: 'percent', value: 0 };

/** Compute the discount amount for a subtotal, capped at the subtotal. */
export function discountAmount(subtotal: number, discount: CartDiscount): number {
	if (discount.value <= 0) return 0;
	const raw = discount.type === 'percent' ? subtotal * (discount.value / 100) : discount.value;
	return Math.min(Math.max(raw, 0), subtotal);
}

export function computeTotals(input: TotalsInput): Totals {
	const { subtotal, discount, taxRatePct, taxIncluded } = input;
	const disc = discountAmount(subtotal, discount);
	const taxableBase = Math.max(subtotal - disc, 0);
	const rate = Math.max(taxRatePct, 0) / 100;

	let tax: number;
	let total: number;
	if (taxIncluded) {
		// Prices include tax; extract it from the discounted base.
		total = taxableBase;
		tax = Math.round((taxableBase - taxableBase / (1 + rate)) * 100) / 100;
	} else {
		tax = Math.round(taxableBase * rate * 100) / 100;
		total = taxableBase + tax;
	}

	return {
		subtotal,
		discountAmount: disc,
		taxableBase,
		tax: Math.max(tax, 0),
		total: Math.max(total, 0)
	};
}

/** Line total = quantity × unit price + sum of modifier adjustments. */
export function lineTotal(unitPrice: number, quantity: number, modifierTotal = 0): number {
	return unitPrice * quantity + modifierTotal * quantity;
}
