/**
 * BNOS ↔ OBP adapter — field-level mapping between existing GLO records
 * and OBP documents, plus the stable `obpDocumentId ↔ localRecordId`
 * link store.
 *
 * Contract rules from `docs/OBP_SYSTEM_PLAN.md`:
 * - the adapter **never changes existing GLO kind assignments**;
 * - it maps `supplier`, `purchase-order`, `commerce.payment` and inventory
 *   references to local views/workflows behind the `obp` feature flag;
 * - shadow (read-only) first: these helpers *compose OBP inputs from*
 *   GLO records; they never write back into GLO stores.
 */
import type {
	IssueInput,
	ObpDocumentProjection,
	ObpLineItem,
	ObpOrganization,
	ObpSettlement
} from '$lib/obp';
import { CURRENCY_MINOR_UNITS } from '$lib/obp';
import type { Payment, PurchaseOrder, Supplier } from '$lib/domain/types';

/** Convert a major-unit amount to integer minor units for a currency. */
export function toMinorUnits(amount: number, currency: string): number {
	const digits = CURRENCY_MINOR_UNITS[currency.toUpperCase()];
	if (digits === undefined) {
		throw new Error(`currency ${currency} has no registered minor-unit precision`);
	}
	const scaled = amount * 10 ** digits;
	if (!Number.isSafeInteger(scaled)) {
		throw new Error(`amount ${amount} ${currency} is not representable in minor units`);
	}
	return scaled;
}

/** Convert integer minor units back to a major-unit amount. */
export function toMajorUnits(minor: number, currency: string): number {
	const digits = CURRENCY_MINOR_UNITS[currency.toUpperCase()];
	if (digits === undefined) {
		throw new Error(`currency ${currency} has no registered minor-unit precision`);
	}
	return minor / 10 ** digits;
}

/**
 * Seed an OBP counterparty directory entry from a GLO supplier record.
 * The supplier's `pubkey` (when present) becomes the organization's owner
 * signing key; a supplier without a pubkey cannot be an OBP counterparty
 * yet and is reported as unmapped.
 */
export function counterpartyFromSupplier(
	supplier: Supplier,
	orgId: string
): { org: ObpOrganization } | { unmapped: string } {
	if (!supplier.pubkey) {
		return { unmapped: `supplier "${supplier.name}" has no pubkey for OBP identity` };
	}
	return { org: { orgId, name: supplier.name, ownerPubkey: supplier.pubkey } };
}

/** Compose RFQ lines from a local purchase-order draft. */
export function rfqLinesFromPurchaseOrder(po: PurchaseOrder): ObpLineItem[] {
	return po.lines.map((line) => ({
		description: line.productName ?? line.name ?? line.productId ?? 'item',
		quantity: Math.round(line.quantity),
		unit: 'unit',
		unitPriceMinor: toMinorUnits(line.unitPrice, po.currency)
	}));
}

/**
 * Compose an RFQ issue input from a GLO purchase-order draft. The local
 * PO keeps its own id/kind; the OBP document id is linked separately.
 */
export function rfqInputFromPurchaseOrder(
	po: PurchaseOrder,
	opts: { orgId: string; signerKeyId: string; recipient: string; validityDays?: number }
): IssueInput {
	return {
		documentType: 'rfq',
		signerKeyId: opts.signerKeyId,
		recipient: opts.recipient,
		currency: po.currency.toUpperCase(),
		lines: rfqLinesFromPurchaseOrder(po),
		shippingMinor:
			po.shippingCost !== undefined ? toMinorUnits(po.shippingCost, po.currency) : undefined,
		taxMinor: po.taxAmount !== undefined ? toMinorUnits(po.taxAmount, po.currency) : undefined,
		note: po.notes,
		expiresAt: new Date(
			Date.parse(po.orderedAt ?? new Date().toISOString()) +
				(opts.validityDays ?? 7) * 24 * 3600_000
		).toISOString()
	};
}

/**
 * Map an accepted OBP invoice projection to a local payment-view draft
 * (read-only shadow view — never written back to GLO automatically).
 */
export function paymentViewFromInvoice(
	invoice: ObpDocumentProjection,
	link: { localRecordId?: string }
): {
	obpDocumentId: string;
	counterparty: string;
	currency: string;
	amountMinor: number;
	settlement: string;
	localRecordId?: string;
} {
	return {
		obpDocumentId: invoice.documentId,
		counterparty: invoice.issuer,
		currency: invoice.currency,
		amountMinor: invoice.totalsMinor,
		settlement: invoice.settlement,
		localRecordId: link.localRecordId
	};
}

/** Build OBP settlement proof from a GLO commerce.payment record. */
export function settlementFromPayment(payment: Payment): ObpSettlement {
	const ref = payment.reference ?? payment.paymentHash ?? 'unreferenced';
	switch (payment.method) {
		case 'lightning':
			return {
				method: 'lightning',
				externalId: payment.paymentHash ?? ref,
				detail: payment.preimage ? `preimage:${payment.preimage}` : undefined
			};
		case 'bank_transfer':
		case 'mobile_payment':
			return { method: String(payment.method), externalId: ref };
		case 'cash':
			return { method: 'manual', externalId: ref, detail: 'cash' };
		default:
			return { method: String(payment.method ?? 'other'), externalId: ref };
	}
}

/** Compose payment-evidence input for an accepted OBP invoice. */
export function paymentEvidenceInputFromPayment(
	invoice: ObpDocumentProjection,
	payment: Payment,
	opts: { signerKeyId: string }
): IssueInput {
	return {
		documentType: 'payment_evidence',
		signerKeyId: opts.signerKeyId,
		recipient: invoice.issuer,
		currency: invoice.currency,
		lines: [],
		totalsMinor: toMinorUnits(payment.amount, payment.currency ?? invoice.currency),
		references: [{ documentId: invoice.documentId, documentType: 'invoice' }],
		settlement: settlementFromPayment(payment)
	};
}
