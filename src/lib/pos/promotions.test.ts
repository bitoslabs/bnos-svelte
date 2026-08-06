import { describe, expect, it } from 'vitest';
import {
	isAutoApplicable,
	isPromoLive,
	isPromotionEligible,
	promoCoversProduct,
	normalizeType,
	promoIcon,
	promoSavings,
	promoValueLabel,
	type PromoCtx
} from './promotions';

const ctx = (over: Partial<PromoCtx> = {}): PromoCtx => ({
	subtotal: 10000,
	currency: 'USD',
	now: new Date('2024-06-15T12:00:00'), // Saturday
	cartProductIds: ['p1', 'p2'],
	cartCategoryIds: ['coffee'],
	...over
});

describe('promotion engine', () => {
	it('normalises the many type spellings into 3 buckets', () => {
		expect(normalizeType('percent')).toBe('percent');
		expect(normalizeType('flash_sale')).toBe('percent');
		expect(normalizeType('happy_hour')).toBe('percent');
		expect(normalizeType('spend_x_get_y')).toBe('percent');
		expect(normalizeType('discount_fixed')).toBe('fixed');
		expect(normalizeType('bogo')).toBe('manual');
		expect(normalizeType('bundle')).toBe('manual');
	});

	it('computes savings for percent and fixed, capping at subtotal', () => {
		expect(promoSavings({ type: 'percent', value: 10 }, 10000)).toBe(1000);
		expect(promoSavings({ type: 'fixed', value: 500 }, 10000)).toBe(500);
		// fixed cannot exceed subtotal
		expect(promoSavings({ type: 'fixed', value: 99999 }, 1000)).toBe(1000);
		// manual types yield no auto discount
		expect(promoSavings({ type: 'bogo', value: 100 }, 10000)).toBe(0);
	});

	it('formats a friendly value label', () => {
		expect(promoValueLabel({ type: 'percent', value: 10 }, 'USD')).toBe('10% off');
		expect(promoValueLabel({ type: 'fixed', value: 500 }, 'USD')).toBe('$500 off');
		expect(promoValueLabel({ type: 'bogo', buyQuantity: 1, getQuantity: 1 }, 'USD')).toBe(
			'Buy 1 get 1'
		);
	});

	it('picks a sensible icon per type', () => {
		expect(promoIcon({ type: 'flash_sale' })).toBe('lucide:zap');
		expect(promoIcon({ type: 'happy_hour' })).toBe('lucide:clock');
		expect(promoIcon({ type: 'percent' })).toBe('lucide:ticket-percent');
	});

	it('flags auto-applicable vs manual promotions', () => {
		expect(isAutoApplicable({ type: 'percent' })).toBe(true);
		expect(isAutoApplicable({ type: 'bogo' })).toBe(false);
	});

	describe('eligibility', () => {
		it('passes a basic active percent promo', () => {
			expect(isPromotionEligible({ status: 'active', type: 'percent', value: 10 }, ctx()).ok).toBe(
				true
			);
		});

		it('fails when below the minimum spend and reports the gap', () => {
			const r = isPromotionEligible(
				{ status: 'active', type: 'percent', value: 10, minimumSpend: 15000 },
				ctx({ subtotal: 10000 })
			);
			expect(r.ok).toBe(false);
			if (!r.ok) expect(r.reason).toMatch(/more/);
		});

		it('fails outside a time-of-day window (happy hour)', () => {
			const r = isPromotionEligible(
				{
					status: 'active',
					type: 'happy_hour',
					value: 20,
					timeRestrictions: { startTime: '14:00', endTime: '16:00' }
				},
				ctx({ now: new Date('2024-06-15T10:00:00') })
			);
			expect(r.ok).toBe(false);
		});

		it('passes inside a time-of-day window', () => {
			const r = isPromotionEligible(
				{
					status: 'active',
					type: 'happy_hour',
					value: 20,
					timeRestrictions: { startTime: '14:00', endTime: '16:00' }
				},
				ctx({ now: new Date('2024-06-15T15:00:00') })
			);
			expect(r.ok).toBe(true);
		});

		it('fails on day-of-week mismatch', () => {
			// Sunday (0) only, but ctx is Saturday (6)
			const r = isPromotionEligible(
				{
					status: 'active',
					type: 'percent',
					value: 10,
					timeRestrictions: { daysOfWeek: [0] }
				},
				ctx({ now: new Date('2024-06-15T12:00:00') }) // Saturday
			);
			expect(r.ok).toBe(false);
		});

		it('fails when the cart has no targeted product/category', () => {
			const r = isPromotionEligible(
				{ status: 'active', type: 'percent', value: 10, productIds: ['pX'] },
				ctx({ cartProductIds: ['p1'] })
			);
			expect(r.ok).toBe(false);
		});

		it('passes when the cart contains a targeted category', () => {
			const r = isPromotionEligible(
				{ status: 'active', type: 'percent', value: 10, categoryIds: ['coffee'] },
				ctx({ cartCategoryIds: ['coffee', 'food'] })
			);
			expect(r.ok).toBe(true);
		});

		it('fails when the usage limit is reached', () => {
			const r = isPromotionEligible(
				{ status: 'active', type: 'percent', value: 10, maxUsage: 100, currentUsage: 100 },
				ctx()
			);
			expect(r.ok).toBe(false);
		});

		it('fails for an expired date window', () => {
			const r = isPromotionEligible(
				{ status: 'active', type: 'percent', value: 10, endsAt: '2024-01-01' },
				ctx({ now: new Date('2024-06-15T12:00:00') })
			);
			expect(r.ok).toBe(false);
		});
	});

	describe('product-card helpers', () => {
		it('isPromoLive checks date/time/usage but ignores cart state', () => {
			// Live regardless of subtotal / targeting.
			expect(
				isPromoLive(
					{ status: 'active', type: 'percent', value: 10, minimumSpend: 99999, productIds: ['x'] },
					new Date('2024-06-15T12:00:00')
				).ok
			).toBe(true);
			// Expired.
			expect(
				isPromoLive(
					{ status: 'active', type: 'percent', value: 10, endsAt: '2024-01-01' },
					new Date('2024-06-15T12:00:00')
				).ok
			).toBe(false);
			// Outside happy-hour window.
			expect(
				isPromoLive(
					{
						status: 'active',
						type: 'happy_hour',
						value: 20,
						timeRestrictions: { startTime: '14:00', endTime: '16:00' }
					},
					new Date('2024-06-15T10:00:00')
				).ok
			).toBe(false);
		});

		it('promoCoversProduct respects product + category targeting', () => {
			// cart-wide (no targeting) covers everything
			expect(promoCoversProduct({ type: 'percent', value: 10 }, 'p1')).toBe(true);
			// product-targeted
			expect(promoCoversProduct({ type: 'percent', value: 10, productIds: ['p1'] }, 'p1')).toBe(
				true
			);
			expect(promoCoversProduct({ type: 'percent', value: 10, productIds: ['p2'] }, 'p1')).toBe(
				false
			);
			// category-targeted
			expect(
				promoCoversProduct({ type: 'percent', value: 10, categoryIds: ['coffee'] }, 'p1', 'coffee')
			).toBe(true);
			expect(
				promoCoversProduct({ type: 'percent', value: 10, categoryIds: ['food'] }, 'p1', 'coffee')
			).toBe(false);
			// product matches but category doesn't → not covered
			expect(
				promoCoversProduct(
					{ type: 'percent', value: 10, productIds: ['p1'], categoryIds: ['food'] },
					'p1',
					'coffee'
				)
			).toBe(false);
		});
	});
});
