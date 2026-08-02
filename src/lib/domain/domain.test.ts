import { describe, expect, it } from 'vitest';
import {
	TYPE,
	KIND,
	TYPES_FOR_KIND,
	GLO_KIND_BY_TYPE,
	objectFor,
	dataOf,
	bnosExt,
	BNOS_EXT_KEY
} from './index';
import type { Product, Order, Customer } from './index';

describe('domain kind registry', () => {
	it('derives every kind from the authoritative GLO map (no hard-coded numbers)', () => {
		for (const key of Object.keys(TYPE) as (keyof typeof TYPE)[]) {
			const type = TYPE[key];
			const expected = (GLO_KIND_BY_TYPE as Record<string, number>)[type] ?? 30078;
			expect(KIND[key]).toBe(expected);
		}
	});

	it('keeps known domain kinds on their central BNOS kind', () => {
		expect(KIND.product).toBe(30100);
		expect(KIND.category).toBe(30101);
		expect(KIND.unit).toBe(30102);
		expect(KIND.modifierGroup).toBe(30103);
		expect(KIND.order).toBe(30200);
		expect(KIND.payment).toBe(30201);
		expect(KIND.refund).toBe(30202);
		expect(KIND.customer).toBe(30300);
		expect(KIND.staff).toBe(30500);
		expect(KIND.adjustment).toBe(30400);
		expect(KIND.location).toBe(30600);
	});

	it('routes every extension type through the NIP-78 fallback', () => {
		const extensions = [
			'supplier',
			'purchaseOrder',
			'stockTransfer',
			'expense',
			'coupon',
			'promotion',
			'loyaltyPoints',
			'membership',
			'membershipSubscription',
			'membershipCheckIn',
			'shift',
			'cashEvent'
		] as const;
		for (const key of extensions) expect(KIND[key]).toBe(30078);
	});

	it('exposes a reverse kind → types index', () => {
		expect(TYPES_FOR_KIND[30100]).toContain('product');
		expect(TYPES_FOR_KIND[30078].length).toBeGreaterThan(0);
		// `branch` and `location` alias the same GLO type → same kind.
		expect(KIND.branch).toBe(KIND.location);
	});
});

describe('standardized data model field coverage', () => {
	it('Product is canonical GloProduct widened with bdgo-os fields', () => {
		const product: Product = {
			name: 'Coffee',
			price: 35_000,
			currency: 'LAK',
			categoryId: 'drinks',
			trackInventory: true,
			// bdgo-os extension fields:
			available: true,
			type: 'standard',
			prepTime: 4,
			variants: [{ id: 'v1', name: 'Large', priceModifier: 5000 }],
			inventory: { lowStockThreshold: 5, reorderPoint: 10 }
		};
		// canonical names preserved
		expect(product.name).toBe('Coffee');
		expect(product.price).toBe(35_000);
		// bdgo extras carried
		expect(product.prepTime).toBe(4);
		expect(product.inventory?.reorderPoint).toBe(10);
	});

	it('Order keeps canonical lines + bdgo-os snapshot fields', () => {
		const order: Order = {
			number: '1001',
			status: 'completed',
			currency: 'LAK',
			occurredAt: '2026-01-01T00:00:00.000Z',
			subtotal: 70_000,
			total: 70_000,
			lines: [
				{
					id: 'l1',
					productId: 'p1',
					name: 'Coffee',
					quantity: 2,
					unitPrice: 35_000,
					total: 70_000,
					productName: 'Coffee',
					variantName: 'Large'
				}
			],
			cashierPubkey: 'pk',
			branchId: 'br1',
			type: 'dine_in'
		};
		expect(order.lines[0].productName).toBe('Coffee');
		expect(order.lines[0].variantName).toBe('Large');
		expect(order.type).toBe('dine_in');
	});

	it('Customer widens canonical notes (string) to bdgo array', () => {
		const customer: Customer = {
			name: 'Sam',
			segment: 'vip',
			loyaltyPoints: 120,
			totalSpend: 5_000_000,
			notes: ['prefers oat milk', 'allergy: nuts']
		};
		expect(Array.isArray(customer.notes)).toBe(true);
		expect(customer.segment).toBe('vip');
	});
});

describe('GLO object helpers', () => {
	it('builds a GLO object whose data is the full standardized payload', () => {
		const obj = objectFor<Product>(TYPE.product, {
			name: 'Latte',
			price: 38_000,
			currency: 'LAK',
			prepTime: 3
		});
		expect(obj.type).toBe('catalog.product');
		expect(obj.spec).toBe('org.bitos.glo');
		expect(obj.version).toBe(1);
		expect(obj.data.price).toBe(38_000);
		expect(obj.data.prepTime).toBe(3);
		expect(obj.extensions?.[BNOS_EXT_KEY]).toBeDefined();
	});

	it('round-trips data through dataOf / bnosExt', () => {
		const obj = objectFor(TYPE.order, { status: 'open', total: 100 });
		expect(dataOf<Order>(obj).total).toBe(100);
		expect(bnosExt(obj)?.client).toBe('bnos-svelte');
	});
});
