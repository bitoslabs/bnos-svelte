/**
 * BNOS ↔ OBP adapter tests: minor-unit conversion, supplier→counterparty
 * seeding, purchase-order→RFQ composition, payment→settlement mapping and
 * the `obpDocumentId ↔ localRecordId` link store.
 */
import { describe, expect, it } from 'vitest';
import {
	counterpartyFromSupplier,
	paymentEvidenceInputFromPayment,
	paymentViewFromInvoice,
	rfqInputFromPurchaseOrder,
	settlementFromPayment,
	toMajorUnits,
	toMinorUnits
} from './mapping';
import { MemoryObpLinkStore } from './links';
import type { Payment, PurchaseOrder, Supplier } from '$lib/domain/types';

describe('minor units', () => {
	it('converts LAK with 0 digits and THB with 2 digits', () => {
		expect(toMinorUnits(850_000, 'LAK')).toBe(850_000);
		expect(toMinorUnits(89.5, 'THB')).toBe(8950);
		expect(toMajorUnits(8950, 'THB')).toBe(89.5);
	});

	it('refuses unregistered currencies and sub-unit amounts in 0-digit currencies', () => {
		expect(() => toMinorUnits(1, 'XYZ')).toThrow();
		// LAK has no minor units: fractional kip is not representable.
		expect(() => toMinorUnits(0.1, 'LAK')).toThrow();
		// THB has 2 digits: fractional baht is fine.
		expect(() => toMinorUnits(0.5, 'THB')).not.toThrow();
	});
});

describe('supplier → counterparty directory', () => {
	const supplier: Supplier = { name: 'Thai Beans Co', pubkey: 'ab'.repeat(32) };

	it('maps suppliers with a pubkey', () => {
		const result = counterpartyFromSupplier(supplier, 'org:thai-beans');
		expect('org' in result && result.org).toMatchObject({
			orgId: 'org:thai-beans',
			name: 'Thai Beans Co',
			ownerPubkey: 'ab'.repeat(32)
		});
	});

	it('reports suppliers without a pubkey as unmapped', () => {
		const result = counterpartyFromSupplier({ name: 'NoKey' }, 'org:x');
		expect('unmapped' in result).toBe(true);
	});
});

describe('purchase order → RFQ', () => {
	const po: PurchaseOrder = {
		number: 'PO-1',
		status: 'draft',
		currency: 'LAK',
		total: 850_000,
		lines: [
			{ productName: 'Arabica 1kg', quantity: 10, unitPrice: 85_000 },
			{ productName: 'Robusta 1kg', quantity: 5, unitPrice: 60_000 }
		]
	};

	it('composes a valid RFQ input with line math preserved', () => {
		const input = rfqInputFromPurchaseOrder(po, {
			orgId: 'org:buyer',
			signerKeyId: 'buyer:owner',
			recipient: 'org:thai-beans'
		});
		expect(input.documentType).toBe('rfq');
		expect(input.currency).toBe('LAK');
		expect(input.lines).toHaveLength(2);
		const total = input.lines!.reduce((s, l) => s + l.quantity * l.unitPriceMinor, 0);
		expect(total).toBe(1_150_000);
		expect(input.recipient).toBe('org:thai-beans');
	});
});

describe('payment → settlement evidence', () => {
	it('maps lightning payments with preimage detail', () => {
		const payment = {
			amount: 850_000,
			currency: 'LAK',
			method: 'lightning',
			status: 'paid',
			paymentHash: 'hash-1',
			preimage: 'pre-1'
		} as Payment;
		expect(settlementFromPayment(payment)).toEqual({
			method: 'lightning',
			externalId: 'hash-1',
			detail: 'preimage:pre-1'
		});
	});

	it('maps manual cash payments honestly', () => {
		const payment = {
			amount: 1000,
			currency: 'LAK',
			method: 'cash',
			status: 'paid',
			reference: 'rcpt-7'
		} as Payment;
		expect(settlementFromPayment(payment).method).toBe('manual');
	});

	it('composes payment evidence for an accepted invoice', () => {
		const invoice = {
			documentId: 'doc:inv1',
			documentType: 'invoice',
			issuer: 'org:thai-beans',
			recipient: 'org:buyer',
			state: 'accepted',
			issueHash: 'h',
			expiresAt: '2026-10-14T00:00:00Z',
			createdAt: '2026-10-07T00:00:00Z',
			updatedAt: '2026-10-07T00:00:00Z',
			currency: 'LAK',
			totalsMinor: 850_000,
			settlement: 'unpaid'
		} as const;
		const payment = {
			amount: 850_000,
			currency: 'LAK',
			method: 'lightning',
			status: 'paid',
			paymentHash: 'hash-2'
		} as Payment;
		const input = paymentEvidenceInputFromPayment(invoice, payment, { signerKeyId: 'buyer:owner' });
		expect(input.totalsMinor).toBe(850_000);
		expect(input.settlement?.externalId).toBe('hash-2');
		expect(input.references).toEqual([{ documentId: 'doc:inv1', documentType: 'invoice' }]);

		const view = paymentViewFromInvoice({ ...invoice, settlement: 'pending' }, {
			localRecordId: 'po-local-1'
		});
		expect(view).toMatchObject({
			obpDocumentId: 'doc:inv1',
			settlement: 'pending',
			localRecordId: 'po-local-1'
		});
	});
});

describe('link store', () => {
	it('keeps a stable obpDocumentId ↔ localRecordId mapping', async () => {
		const links = new MemoryObpLinkStore();
		await links.link({
			obpDocumentId: 'doc:rfq-9',
			localRecordId: 'po-local-1',
			localType: 'purchase-order',
			linkedAt: '2026-10-07T00:00:00Z'
		});
		expect((await links.byObpDocument('doc:rfq-9'))?.localRecordId).toBe('po-local-1');
		expect(
			(await links.byLocalRecord('purchase-order', 'po-local-1'))?.obpDocumentId
		).toBe('doc:rfq-9');
		expect(await links.byLocalRecord('purchase-order', 'other')).toBeUndefined();
	});
});
