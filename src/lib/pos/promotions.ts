/**
 * POS promotion engine — pure helpers for eligibility, value, and display.
 *
 * Keeps all promo logic out of the component so it is testable and reusable.
 * Works against the loose {@link PromoData} shape (covers both the local
 * PromotionData used in the POS page and the domain `Promotion` type, which
 * spell the same fields slightly differently).
 */
import { formatMoney } from '$lib/utils/format';

/** Structural shape — every field optional because promotions are authored
 *  loosely (some use `value`/`type`, others `discountValue`/`discountType`). */
export type PromoData = {
	name?: string;
	description?: string;
	status?: string;
	isActive?: boolean;
	active?: boolean;
	type?: string;
	discountType?: string;
	value?: number;
	discountValue?: number;
	minimumSpend?: number;
	productIds?: string[];
	categoryIds?: string[];
	maxUsage?: number;
	currentUsage?: number;
	usageLimit?: number;
	startsAt?: string;
	endsAt?: string;
	validFrom?: string;
	validUntil?: string;
	startDate?: string;
	endDate?: string;
	timeRestrictions?: { daysOfWeek?: number[]; startTime?: string; endTime?: string };
	buyQuantity?: number;
	getQuantity?: number;
};

export type PromoCtx = {
	subtotal: number;
	currency: string;
	now: Date;
	/** Product ids currently in the cart. */
	cartProductIds: string[];
	/** Category ids currently in the cart. */
	cartCategoryIds: string[];
};

export type Eligibility = { ok: true } | { ok: false; reason: string };

/** Collapse the many promotion type spellings into 3 buckets the cart can act on. */
export function normalizeType(t?: string): 'percent' | 'fixed' | 'manual' {
	switch (t) {
		case 'percent':
		case 'discount_percent':
		case 'flash_sale':
		case 'happy_hour':
		case 'spend_x_get_y':
			return 'percent';
		case 'fixed':
		case 'discount_fixed':
			return 'fixed';
		default:
			return 'manual'; // bogo, bundle, free_item → cashier handles manually
	}
}

/** Numeric value (percent or amount), tolerating both `value` and `discountValue`. */
export function promoValue(d: PromoData): number {
	return d.value ?? d.discountValue ?? 0;
}

/** Human label for the discount itself, e.g. "10% off" / "$5.00 off" / "Happy Hour". */
export function promoValueLabel(d: PromoData, currency: string): string {
	const kind = normalizeType(d.type ?? d.discountType);
	const v = promoValue(d);
	if (kind === 'percent') return `${v}% off`;
	if (kind === 'fixed') return `${formatMoney(v, currency)} off`;
	// manual types — describe by name
	if (d.type === 'bogo') return `Buy ${d.buyQuantity ?? 1} get ${d.getQuantity ?? 1}`;
	return d.description?.trim() || 'Special offer';
}

/** Lucide icon per promotion type. */
export function promoIcon(d: PromoData): string {
	switch (d.type) {
		case 'flash_sale':
			return 'lucide:zap';
		case 'happy_hour':
			return 'lucide:clock';
		case 'bogo':
		case 'bundle':
			return 'lucide:gift';
		case 'spend_x_get_y':
			return 'lucide:shopping-cart';
		case 'fixed':
		case 'discount_fixed':
			return 'lucide:badge-dollar-sign';
		default:
			return 'lucide:ticket-percent';
	}
}

/** Display name — falls back to the value label. */
export function promoName(d: PromoData, currency: string): string {
	return d.name?.trim() || promoValueLabel(d, currency);
}

/**
 * Discount amount this promotion would apply to the given subtotal.
 * Returns 0 for `manual` types (BOGO/bundle) — those need line-level logic the
 * cart doesn't model, so they are applied as a label only.
 */
export function promoSavings(d: PromoData, subtotal: number): number {
	const kind = normalizeType(d.type ?? d.discountType);
	const v = promoValue(d);
	if (kind === 'percent') return Math.min(subtotal, Math.round(((subtotal * v) / 100) * 100) / 100);
	if (kind === 'fixed') return Math.min(subtotal, v);
	return 0;
}

function parseTimeToMinutes(hhmm?: string): number | null {
	if (!hhmm) return null;
	const [h, m] = hhmm.split(':').map(Number);
	if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
	return h * 60 + m;
}

/** Full eligibility check: status, schedule, time window, min-spend, targeting, usage. */
export function isPromotionEligible(d: PromoData, ctx: PromoCtx): Eligibility {
	// Status
	const active = d.status === 'active' || d.isActive !== false || d.active !== false;
	if (!active) return { ok: false, reason: 'Inactive' };

	const now = ctx.now.getTime();

	// Date window (tolerate all the date-field spellings)
	const start = d.startsAt ?? d.validFrom ?? d.startDate;
	const end = d.endsAt ?? d.validUntil ?? d.endDate;
	if (start && new Date(start).getTime() > now) return { ok: false, reason: 'Starts soon' };
	if (end && new Date(end).getTime() < now) return { ok: false, reason: 'Ended' };

	// Time-of-day + day-of-week restrictions (Happy Hour etc.)
	const tr = d.timeRestrictions;
	if (tr && (tr.startTime || tr.endTime || tr.daysOfWeek?.length)) {
		const day = ctx.now.getDay(); // 0=Sun
		if (tr.daysOfWeek?.length && !tr.daysOfWeek.includes(day))
			return { ok: false, reason: 'Not today' };
		const nowMin = ctx.now.getHours() * 60 + ctx.now.getMinutes();
		const sMin = parseTimeToMinutes(tr.startTime);
		const eMin = parseTimeToMinutes(tr.endTime);
		if (sMin != null && nowMin < sMin) return { ok: false, reason: 'Not yet' };
		if (eMin != null && nowMin > eMin) return { ok: false, reason: 'Over' };
	}

	// Minimum spend
	if (d.minimumSpend && d.minimumSpend > 0 && ctx.subtotal < d.minimumSpend) {
		return {
			ok: false,
			reason: `Spend ${formatMoney(d.minimumSpend - ctx.subtotal, ctx.currency)} more`
		};
	}

	// Product / category targeting (eligible if the cart contains ≥1 target)
	if (d.productIds?.length && !d.productIds.some((id) => ctx.cartProductIds.includes(id))) {
		return { ok: false, reason: 'No qualifying item' };
	}
	if (d.categoryIds?.length && !d.categoryIds.some((id) => ctx.cartCategoryIds.includes(id))) {
		return { ok: false, reason: 'No qualifying item' };
	}

	// Usage limit
	const max = d.maxUsage ?? d.usageLimit;
	const used = d.currentUsage ?? 0;
	if (max && used >= max) return { ok: false, reason: 'Sold out' };

	return { ok: true };
}

/** True when the promotion is structurally applicable by the cart (not manual). */
export function isAutoApplicable(d: PromoData): boolean {
	return normalizeType(d.type ?? d.discountType) !== 'manual';
}

/**
 * Should this promotion be applied AUTOMATICALLY when the cart qualifies?
 *
 * Deterministic offers — time-windowed (happy hour / flash sale), cart-wide
 * percent/fixed, targeted sale prices, spend-threshold — yes: the customer is
 * entitled to them once conditions are met, so silently honoring them is both
 * better service and (for advertised prices) often a legal requirement.
 *
 * Manual types (BOGO / bundle) and coupon-style codes are never auto-applied:
 * they need line logic or a customer action, so they stay suggest-only.
 */
export function shouldAutoApply(d: PromoData): boolean {
	return isAutoApplicable(d);
}

/**
 * "Live right now": active + within date/time window + usage not exhausted.
 * Ignores cart state (subtotal + targeting) so it can be used to decide whether
 * a promotion should be *advertised* on a product card regardless of the cart.
 */
export function isPromoLive(d: PromoData, now: Date): Eligibility {
	const active = d.status === 'active' || d.isActive !== false || d.active !== false;
	if (!active) return { ok: false, reason: 'Inactive' };

	const t = now.getTime();
	const start = d.startsAt ?? d.validFrom ?? d.startDate;
	const end = d.endsAt ?? d.validUntil ?? d.endDate;
	if (start && new Date(start).getTime() > t) return { ok: false, reason: 'Starts soon' };
	if (end && new Date(end).getTime() < t) return { ok: false, reason: 'Ended' };

	const tr = d.timeRestrictions;
	if (tr && (tr.startTime || tr.endTime || tr.daysOfWeek?.length)) {
		const day = now.getDay();
		if (tr.daysOfWeek?.length && !tr.daysOfWeek.includes(day))
			return { ok: false, reason: 'Not today' };
		const nowMin = now.getHours() * 60 + now.getMinutes();
		const sMin = parseTimeToMinutes(tr.startTime);
		const eMin = parseTimeToMinutes(tr.endTime);
		if (sMin != null && nowMin < sMin) return { ok: false, reason: 'Not yet' };
		if (eMin != null && nowMin > eMin) return { ok: false, reason: 'Over' };
	}

	const max = d.maxUsage ?? d.usageLimit;
	const used = d.currentUsage ?? 0;
	if (max && used >= max) return { ok: false, reason: 'Sold out' };

	return { ok: true };
}

/**
 * Does this promotion structurally cover the given product? A promotion with no
 * product/category targeting is cart-wide and therefore covers everything.
 */
export function promoCoversProduct(d: PromoData, productId: string, categoryId?: string): boolean {
	const productMatch = !d.productIds?.length || d.productIds.includes(productId);
	const categoryMatch =
		!d.categoryIds?.length || (categoryId ? d.categoryIds.includes(categoryId) : false);
	return productMatch && categoryMatch;
}
