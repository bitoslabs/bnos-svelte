import { describe, it, expect } from 'vitest';
import { resolveInvoiceMemo } from './invoice-memo';

const ITEMS = [
	{ name: 'Latte', quantity: 2 },
	{ name: 'Croissant', quantity: 1 }
];

describe('resolveInvoiceMemo', () => {
	it('cashier memo wins over everything', () => {
		expect(
			resolveInvoiceMemo({
				cashierMemo: ' Table 4 ',
				settingsMemo: 'Café BNOS',
				customerName: 'Ann',
				items: ITEMS
			})
		).toBe('Table 4');
	});

	it('settings memo is used when the cashier leaves it blank', () => {
		expect(
			resolveInvoiceMemo({ cashierMemo: '   ', settingsMemo: 'Café BNOS · Vientiane', items: ITEMS })
		).toBe('Café BNOS · Vientiane');
	});

	it("the untouched 'Payment' placeholder counts as unset → falls through to sale context", () => {
		expect(resolveInvoiceMemo({ settingsMemo: 'Payment', items: ITEMS })).toBe('Latte × 2, Croissant');
		expect(resolveInvoiceMemo({ settingsMemo: 'payment', items: ITEMS })).toBe(
			'Latte × 2, Croissant'
		);
	});

	it('sale context: customer name beats item list', () => {
		expect(resolveInvoiceMemo({ customerName: 'Ann', items: ITEMS })).toBe('Sale for Ann');
	});

	it('sale context: item list with quantities', () => {
		expect(resolveInvoiceMemo({ items: ITEMS })).toBe('Latte × 2, Croissant');
		expect(resolveInvoiceMemo({ items: [{ name: 'Espresso', quantity: 1 }] })).toBe('Espresso');
	});

	it('final fallback for an empty cart', () => {
		expect(resolveInvoiceMemo({})).toBe('BNOS sale');
	});

	it('caps long memos at 120 chars (BOLT11 description safety)', () => {
		expect(resolveInvoiceMemo({ cashierMemo: 'x'.repeat(300) })).toHaveLength(120);
	});
});
