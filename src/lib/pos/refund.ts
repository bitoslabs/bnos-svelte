/**
 * Refund / return engine — pure helpers + record builder.
 *
 * A refund is authored as a `commerce.refund` (TYPE.refund) record that links
 * back to the original order + payment. Partial refunds are first-class: each
 * refund carries its own line list + amount, and the order accumulates a
 * `refundedAmount` so the UI can show "refunded $X of $Y".
 *
 * Side effects (persistence, stock restock, shift netting) live in the
 * component; this module stays pure so the math is testable.
 */
import type { Order, OrderLine, Refund, RefundLine, RefundReason } from '$lib/domain';

export type RefundableLine = {
	id: string;
	productId?: string;
	name: string;
	variantId?: string;
	variantName?: string;
	/** Unit price actually paid (incl. modifiers), used to value the refund. */
	unitPrice: number;
	quantity: number;
};

export const REFUND_REASONS: { value: RefundReason; label: string; icon: string }[] = [
	{ value: 'customer_request', label: 'Customer changed mind', icon: 'lucide:undo-2' },
	{ value: 'defective', label: 'Defective / faulty', icon: 'lucide:bug' },
	{ value: 'wrong_item', label: 'Wrong item', icon: 'lucide:package-x' },
	{ value: 'quality_issue', label: 'Quality issue', icon: 'lucide:thumbs-down' },
	{ value: 'overcharge', label: 'Price / overcharge', icon: 'lucide:badge-dollar-sign' },
	{ value: 'other', label: 'Other', icon: 'lucide:more-horizontal' }
];

export function refundReasonLabel(reason?: RefundReason): string {
	return REFUND_REASONS.find((r) => r.value === reason)?.label ?? reason ?? '—';
}

export function refundReasonIcon(reason?: RefundReason): string {
	return REFUND_REASONS.find((r) => r.value === reason)?.icon ?? 'lucide:undo-2';
}

/** Normalise an order's lines into a refundable descriptor list. */
export function refundableLinesFromOrder(order: { data: Order }): RefundableLine[] {
	const lines = (order.data.lines ?? []) as OrderLine[];
	return lines.map((l) => {
		const ext = l as {
			unitPrice?: number;
			price?: number;
			modifiers?: { priceAdjustment?: number }[];
		};
		const unit =
			(ext.unitPrice ?? ext.price ?? 0) +
			(ext.modifiers ?? []).reduce((a, m) => a + (m.priceAdjustment ?? 0), 0);
		return {
			id:
				(l as { id?: string }).id ??
				(l.productId ?? '') + ':' + Math.random().toString(36).slice(2),
			productId: l.productId,
			name: l.name ?? l.productName ?? 'Item',
			variantId: l.variantId,
			variantName: (l as { variantName?: string }).variantName,
			unitPrice: unit,
			quantity: l.quantity
		};
	});
}

/** Sum the monetary value of a set of refund lines (qty × unit). */
export function computeRefundTotal(lines: RefundLine[]): number {
	return Math.round(lines.reduce((s, l) => s + (l.totalRefund ?? 0), 0) * 100) / 100;
}

/** Build RefundLine[] from a selection map { lineId → quantity }. */
export function buildRefundLines(
	lines: RefundableLine[],
	selection: Record<string, number>
): RefundLine[] {
	const out: RefundLine[] = [];
	for (const l of lines) {
		const qty = selection[l.id] ?? 0;
		if (qty <= 0) continue;
		const total = Math.round(l.unitPrice * qty * 100) / 100;
		out.push({
			orderLineItemId: l.id,
			productId: l.productId,
			productName: l.name,
			quantity: qty,
			unitRefund: l.unitPrice,
			totalRefund: total
		});
	}
	return out;
}

type BuildRefundInput = {
	orderId: string;
	paymentId?: string;
	lines: RefundLine[];
	currency: string;
	method: Refund['refundMethod'];
	reason?: RefundReason;
	note?: string;
	approvedBy?: string;
	branchId?: string;
	shiftId?: string;
};

/** Construct a completed Refund record ready to persist. */
export function buildRefund(input: BuildRefundInput): Refund {
	return {
		orderId: input.orderId,
		paymentId: input.paymentId,
		status: 'completed',
		reason: input.reason,
		note: input.note?.trim() || undefined,
		items: input.lines,
		totalAmount: computeRefundTotal(input.lines),
		currency: input.currency,
		refundMethod: input.method,
		approvedBy: input.approvedBy,
		completedAt: new Date().toISOString(),
		branchId: input.branchId,
		shiftId: input.shiftId
	};
}

/** Aggregate refund state for an order from its refund records. */
export type OrderRefundState = {
	refunds: { id: string; data: Refund }[];
	refundedAmount: number;
	/** Largest possible refund still available (order total − already refunded). */
	refundableRemaining: number;
	isFullyRefunded: boolean;
	isPartiallyRefunded: boolean;
};

export function orderRefundState(
	order: { data: Order },
	refunds: { id: string; data: Refund }[]
): OrderRefundState {
	const orderTotal = order.data.total ?? 0;
	const completed = refunds.filter(
		(r) => r.data.status === 'completed' || r.data.status === 'approved'
	);
	const refundedAmount =
		Math.round(completed.reduce((s, r) => s + (r.data.totalAmount ?? 0), 0) * 100) / 100;
	const refundableRemaining = Math.max(0, Math.round((orderTotal - refundedAmount) * 100) / 100);
	return {
		refunds: completed,
		refundedAmount,
		refundableRemaining,
		isFullyRefunded: refundedAmount > 0 && refundableRemaining <= 0.001,
		isPartiallyRefunded: refundedAmount > 0 && refundableRemaining > 0.001
	};
}

/** May this order still be refunded? (completed/paid and not fully refunded). */
export function isOrderRefundable(state: OrderRefundState): boolean {
	return state.refundableRemaining > 0.001;
}
