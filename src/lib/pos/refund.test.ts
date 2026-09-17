import { describe, expect, it } from 'vitest';
import {
	buildRefund,
	buildRefundLines,
	computeRefundTotal,
	isOrderRefundable,
	orderRefundState,
	refundableLinesFromOrder,
	refundReasonIcon,
	refundReasonLabel
} from './refund';
import type { Order, Refund, RefundLine } from '$lib/domain';

const order = (over: Partial<Order> = {}): { data: Order } => ({
	data: {
		total: 1000,
		lines: [
			{ id: 'l1', productId: 'p1', name: 'Coffee', quantity: 2, unitPrice: 250 },
			{ id: 'l2', productId: 'p2', name: 'Cake', quantity: 1, unitPrice: 500 }
		],
		...over
	} as any
});

describe('refund engine', () => {
	it('normalises order lines into refundable descriptors', () => {
		const lines = refundableLinesFromOrder(order());
		expect(lines).toHaveLength(2);
		expect(lines[0]).toMatchObject({ id: 'l1', name: 'Coffee', quantity: 2, unitPrice: 250 });
	});

	it('builds refund lines from a {lineId → qty} selection', () => {
		const lines = refundableLinesFromOrder(order());
		const refundLines = buildRefundLines(lines, { l1: 1 }); // 1× Coffee @250
		expect(refundLines).toHaveLength(1);
		expect(refundLines[0]).toMatchObject({ quantity: 1, unitRefund: 250, totalRefund: 250 });
	});

	it('computes the refund total across lines', () => {
		expect(computeRefundTotal([{ totalRefund: 250 }, { totalRefund: 500 }] as RefundLine[])).toBe(
			750
		);
	});

	it('builds a completed refund record', () => {
		const lines = refundableLinesFromOrder(order());
		const rl = buildRefundLines(lines, { l1: 2, l2: 1 }); // full order
		const refund = buildRefund({
			orderId: 'o1',
			lines: rl,
			currency: 'USD',
			method: 'cash',
			reason: 'customer_request',
			branchId: 'b1',
			shiftId: 's1'
		});
		expect(refund.status).toBe('completed');
		expect(refund.totalAmount).toBe(1000);
		expect(refund.orderId).toBe('o1');
		expect(refund.shiftId).toBe('s1');
	});

	it('maps reason codes to labels + icons', () => {
		expect(refundReasonLabel('defective')).toBe('Defective / faulty');
		expect(refundReasonLabel('wrong_item')).toBe('Wrong item');
		expect(refundReasonIcon('customer_request')).toBe('lucide:undo-2');
		expect(refundReasonLabel(undefined)).toBe('—');
	});

	describe('order refund state', () => {
		it('no refunds → fully refundable', () => {
			const st = orderRefundState(order(), []);
			expect(st.refundedAmount).toBe(0);
			expect(st.refundableRemaining).toBe(1000);
			expect(st.isFullyRefunded).toBe(false);
			expect(isOrderRefundable(st)).toBe(true);
		});

		it('partial refund → partially refundable', () => {
			const refunds: { id: string; data: Refund }[] = [
				{ id: 'r1', data: { status: 'completed', totalAmount: 300, refundMethod: 'cash' } }
			];
			const st = orderRefundState(order(), refunds);
			expect(st.refundedAmount).toBe(300);
			expect(st.refundableRemaining).toBe(700);
			expect(st.isPartiallyRefunded).toBe(true);
			expect(isOrderRefundable(st)).toBe(true);
		});

		it('full refund → not refundable', () => {
			const refunds: { id: string; data: Refund }[] = [
				{ id: 'r1', data: { status: 'completed', totalAmount: 1000, refundMethod: 'cash' } }
			];
			const st = orderRefundState(order(), refunds);
			expect(st.isFullyRefunded).toBe(true);
			expect(st.refundableRemaining).toBe(0);
			expect(isOrderRefundable(st)).toBe(false);
		});

		it('ignores non-completed refunds', () => {
			const refunds: { id: string; data: Refund }[] = [
				{ id: 'r1', data: { status: 'pending', totalAmount: 1000, refundMethod: 'cash' } }
			];
			const st = orderRefundState(order(), refunds);
			expect(st.refundedAmount).toBe(0);
		});
	});
});
