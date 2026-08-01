/**
 * Build standardized GLO `commerce.order` + `commerce.payment` payloads from a
 * POS cart. Uses the widened domain types so every bdgo-os field the POS cares
 * about (order type, customer snapshot, table/covers, discount, variant +
 * modifier lines, payment method) is carried on the wire.
 */
import type { Order, OrderLine, Payment, PaymentMethod } from '$lib/domain';
import type { Totals } from './totals';

export interface CartLineForReceipt {
	productId: string;
	name: string;
	unitPrice: number;
	quantity: number;
	variantId?: string;
	variantName?: string;
	note?: string;
	modifiers?: {
		groupId?: string;
		modifierId?: string;
		name: string;
		priceAdjustment: number;
	}[];
}

export interface BuildOrderInput {
	number: string;
	currency: string;
	lines: CartLineForReceipt[];
	totals: Totals;
	orderType?: Order['type'];
	customerName?: string;
	customerId?: string;
	tableId?: string;
	covers?: number;
	branchId?: string;
	cashierPubkey?: string;
	discount?: { type: 'percent' | 'fixed'; value: number };
	note?: string;
	occurredAt?: string;
}

export function buildOrder(input: BuildOrderInput): Order {
	const occurredAt = input.occurredAt ?? new Date().toISOString();
	const lines: OrderLine[] = input.lines.map((l, i) => {
		const modifierTotal = (l.modifiers ?? []).reduce((s, m) => s + m.priceAdjustment, 0);
		return {
			id: `${l.productId}${l.variantId ? `-${l.variantId}` : ''}-${i + 1}`,
			productId: l.productId,
			name: l.variantName ? `${l.name} (${l.variantName})` : l.name,
			productName: l.name,
			sku: undefined,
			quantity: l.quantity,
			unitPrice: l.unitPrice,
			modifiers: l.modifiers,
			variantId: l.variantId,
			variantName: l.variantName,
			discount: undefined,
			tax: undefined,
			notes: l.note,
			total: (l.unitPrice + modifierTotal) * l.quantity
		};
	});

	return {
		number: input.number,
		status: 'completed',
		currency: input.currency,
		lines,
		subtotal: input.totals.subtotal,
		discount: input.totals.discountAmount || undefined,
		tax: input.totals.tax || undefined,
		tip: undefined,
		total: input.totals.total,
		paymentStatus: 'paid',
		fulfillmentType: input.orderType ?? 'pos',
		notes: input.note,
		occurredAt,
		// bdgo-os extension fields:
		type: input.orderType,
		customerName: input.customerName,
		customerId: input.customerId,
		tableId: input.tableId,
		covers: input.covers,
		branchId: input.branchId,
		cashierPubkey: input.cashierPubkey,
		orderDiscount: input.discount
			? {
					type: input.discount.type,
					value: input.discount.value,
					amount: input.totals.discountAmount
				}
			: undefined
	};
}

export interface BuildPaymentInput {
	orderId?: string;
	amount: number;
	currency: string;
	method: PaymentMethod;
	cashReceived?: number;
	changeGiven?: number;
	reference?: string;
	cashierPubkey?: string;
	branchId?: string;
	paidAt?: string;
}

export function buildPayment(input: BuildPaymentInput): Payment {
	return {
		orderId: input.orderId,
		amount: input.amount,
		currency: input.currency,
		method: input.method,
		status: 'completed',
		reference: input.reference,
		paidAt: input.paidAt ?? new Date().toISOString(),
		cashReceived: input.cashReceived,
		changeGiven: input.changeGiven,
		cashierPubkey: input.cashierPubkey,
		branchId: input.branchId
	};
}
