import { describe, expect, it } from 'vitest';
import {
	toPublicListing,
	redactListing,
	hasInternalFields,
	INTERNAL_ECONOMICS_FIELDS
} from './marketplace-publish';
import type { Product } from './types';

const catalogProduct = {
	id: 'prod-1',
	data: {
		name: 'Latte',
		sku: 'LATTE-001',
		barcode: '4006381333931',
		description: 'Single-origin espresso with steamed milk',
		price: 35000,
		currency: 'LAK',
		images: ['https://x/latte.jpg'],
		tags: ['coffee', 'hot'],
		// ── internal economics that MUST NOT leak to a public listing ──
		cost: 12000,
		costPrice: 11500,
		supplierId: 'sup-9',
		preferredSupplierId: 'sup-9',
		supplierSku: 'SUP-LATTE',
		unitCost: 11000,
		taxRate: 7,
		taxable: true,
		taxInclusive: false,
		inventory: {
			lowStockThreshold: 10,
			reorderPoint: 5,
			reorderQuantity: 100,
			unitCost: 11000,
			preferredSupplierId: 'sup-9'
		}
	} as unknown as Product
};

describe('toPublicListing — allowlist projection', () => {
	it('copies only public fields from the catalog product', () => {
		const listing = toPublicListing(catalogProduct, { channelIds: ['tiktok', 'facebook'] });
		expect(listing.productId).toBe('prod-1');
		expect(listing.productName).toBe('Latte');
		expect(listing.sku).toBe('LATTE-001');
		expect(listing.price).toBe(35000);
		expect(listing.channelIds).toEqual(['tiktok', 'facebook']);
		expect(listing.images).toEqual(['https://x/latte.jpg']);
	});

	it('never includes internal economics, even though the source has them', () => {
		const listing = toPublicListing(catalogProduct, {
			channelIds: ['tiktok']
		}) as unknown as Record<string, unknown>;
		for (const field of INTERNAL_ECONOMICS_FIELDS) {
			expect(listing[field], `${field} must not leak`).toBeUndefined();
		}
		// Specifically the high-risk ones:
		expect(listing.cost).toBeUndefined();
		expect(listing.supplierId).toBeUndefined();
		expect(listing.inventory).toBeUndefined();
		expect(listing.taxRate).toBeUndefined();
		expect(hasInternalFields(listing)).toBe(false);
	});

	it('lets the caller override price/description/images/status', () => {
		const listing = toPublicListing(catalogProduct, {
			channelIds: ['website'],
			price: 39000,
			description: 'Promo copy',
			images: ['https://x/promo.jpg'],
			status: 'active',
			publishedAt: '2025-01-01T00:00:00.000Z'
		});
		expect(listing.price).toBe(39000);
		expect(listing.description).toBe('Promo copy');
		expect(listing.images).toEqual(['https://x/promo.jpg']);
		expect(listing.status).toBe('active');
		expect(listing.publishedAt).toBe('2025-01-01T00:00:00.000Z');
	});

	it('falls back to the catalog price when no override is given', () => {
		expect(toPublicListing(catalogProduct, { channelIds: [] }).price).toBe(35000);
	});
});

describe('redactListing — defense-in-depth', () => {
	it('strips internal-economics fields from an already-built object', () => {
		const leaked = {
			productId: 'p1',
			productName: 'Latte',
			price: 35000,
			cost: 12000,
			supplierId: 'sup-9',
			inventory: { reorderPoint: 5 }
		};
		const clean = redactListing(leaked);
		expect(clean.productId).toBe('p1');
		expect(clean.productName).toBe('Latte');
		expect(clean.price).toBe(35000);
		expect(clean.cost).toBeUndefined();
		expect(clean.supplierId).toBeUndefined();
		expect(clean.inventory).toBeUndefined();
	});

	it('is idempotent (redacting a clean listing is a no-op)', () => {
		const clean = { productId: 'p1', price: 10 };
		expect(redactListing(redactListing(clean))).toEqual(clean);
	});

	it('hasInternalFields detects a leak', () => {
		expect(hasInternalFields({ price: 1, cost: 2 })).toBe(true);
		expect(hasInternalFields({ price: 1, productName: 'x' })).toBe(false);
	});
});
