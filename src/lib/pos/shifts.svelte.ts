/**
 * Branch-aware shift store — the single source of truth for "is there an open
 * shift on *this* device's branch?" and for shift open/close/cash-event logic.
 *
 * Why this exists
 * ---------------
 * Shifts are GLO objects (`shift` → Nostr kind 30520) carrying a canonical
 * `branchId`. Before this module, both `/pos` and `/transactions/shifts` looked
 * up the active shift with `shifts.find(s => s.status === 'active')` — i.e. the
 * *first* active shift across ALL branches. In a multi-branch tenant that meant
 * branch A's open shift gated branch B, and closing "the" active shift could
 * close another branch's drawer.
 *
 * This store scopes every lookup by `branchId` (falling back to the tenant's
 * active `locationId`), so each branch owns an independent active shift — while
 * still flowing through the same GLO collection + relay sync pipeline that
 * already connects owner devices and staff devices (`memberships`, `glo.sync`).
 *
 * Data model
 * ----------
 * Follows `@bitos/bnos-core/glo` `GloShift` (number, branchId, status,
 * openedAt/closedAt, opening/closing/expected cash, per-tender sales totals,
 * cash-in/out totals, difference). Orders carry `shiftId` (OrderBnosExt) and
 * payments carry `shiftId` (PaymentBnosExt) so a shift summary is self-
 * contained and survives offline.
 */
import { glo } from '$nostr/store.svelte';
import { tenant } from '$nostr/tenant.svelte';
import { session } from '$nostr/session.svelte';
import { toast } from '$lib/stores/toast.svelte';
import {
	TYPE,
	type Shift,
	type CashEvent,
	type Order,
	type Payment,
	type Refund
} from '$lib/domain';
import { logActivity } from '$lib/audit.svelte';
import { newRecordId, nextReadableNumber } from '$lib/utils/record-id';

/** Cash-event types that *add* bills to the drawer (vs. remove). */
const CASH_IN_TYPES = new Set<CashEvent['type']>(['cash_in', 'paid_in']);

/** Payment methods that settle in physical cash. */
const CASH_METHODS = new Set(['cash', 'store_credit']);

export interface ShiftSummary {
	/** Number of completed orders in the shift window. */
	totalOrders: number;
	/** Sum of order totals in the shift window (gross sales). */
	totalSales: number;
	/** Sales tendered as cash. */
	cashSales: number;
	/** Sales tendered by card. */
	cardSales: number;
	/** Sales tendered over Lightning. */
	lightningSales: number;
	/** Sales tendered by QR / static QR. */
	qrSales: number;
	/** Any other tender (coupon, loyalty, ecash, mixed, …). */
	otherSales: number;
	/** Count of refunded orders. */
	totalRefunds: number;
	/** Monetary total of refunds. */
	totalRefundAmount: number;
	/** Cash refunded out of the drawer (reduces expected cash). */
	cashRefunds: number;
	/** Cash added via `cash_in` / `paid_in` events. */
	totalCashIn: number;
	/** Cash removed via `cash_out` / `paid_out` / `bank_deposit` events. */
	totalCashOut: number;
	/** openingCash + cashSales + totalCashIn − totalCashOut − cashRefunds. */
	expectedCash: number;
}

const ZERO_SUMMARY: ShiftSummary = {
	totalOrders: 0,
	totalSales: 0,
	cashSales: 0,
	cardSales: 0,
	lightningSales: 0,
	qrSales: 0,
	otherSales: 0,
	totalRefunds: 0,
	totalRefundAmount: 0,
	cashRefunds: 0,
	totalCashIn: 0,
	totalCashOut: 0,
	expectedCash: 0
};

/** Minimal order/payment/cash-event shapes `computeShiftSummary` reads. Keeping
 *  these structural (not importing the full domain types) makes the helper
 *  unit-testable without dragging in the GLO/rune stores. */
type SummaryOrder = { data: { total?: number; status?: string } };
type SummaryPayment = { data: { amount?: number; method?: string; status?: string } };
type SummaryCashEvent = { data: { amount?: number; type: CashEvent['type'] } };
type SummaryRefund = { data: { totalAmount?: number; refundMethod?: string; status?: string } };

/**
 * Pure shift-summary computation: aggregates orders, tenders, cash flow and
 * derives the expected drawer cash. Branch/store-agnostic so it can be tested
 * in isolation and reused by reports/export flows.
 */
export function computeShiftSummary(input: {
	openingCash: number;
	orders: SummaryOrder[];
	payments: SummaryPayment[];
	cashEvents: SummaryCashEvent[];
	/** Refund records linked to the shift. When provided, refund totals are
	 *  derived accurately from these (per method); otherwise we fall back to the
	 *  order-status heuristic for backward compatibility. */
	refunds?: SummaryRefund[];
}): ShiftSummary {
	const { openingCash } = input;
	const totalOrders = input.orders.length;
	const totalSales = input.orders.reduce((sum, o) => sum + (o.data.total ?? 0), 0);

	// Refunds: prefer accurate per-method totals from refund records; fall back to
	// the legacy order-status estimate when no records are available.
	let totalRefunds: number;
	let totalRefundAmount: number;
	let cashRefunds: number;
	if (input.refunds && input.refunds.length) {
		const completed = input.refunds.filter(
			(r) => (r.data.status ?? 'completed') === 'completed' || r.data.status === 'approved'
		);
		totalRefunds = completed.length;
		totalRefundAmount = completed.reduce((sum, r) => sum + (r.data.totalAmount ?? 0), 0);
		cashRefunds = completed
			.filter((r) => CASH_METHODS.has(r.data.refundMethod ?? 'cash'))
			.reduce((sum, r) => sum + (r.data.totalAmount ?? 0), 0);
	} else {
		totalRefunds = input.orders.filter((o) =>
			['refunded', 'partially_refunded', 'cancelled'].includes(o.data.status ?? '')
		).length;
		totalRefundAmount = input.orders.reduce(
			(sum, o) =>
				['refunded', 'partially_refunded'].includes(o.data.status ?? '')
					? sum + (o.data.total ?? 0)
					: sum,
			0
		);
		// Legacy behaviour: assume all refunds came out of cash.
		cashRefunds = totalRefundAmount;
	}

	let cashSales = 0;
	let cardSales = 0;
	let lightningSales = 0;
	let qrSales = 0;
	let otherSales = 0;
	for (const p of input.payments) {
		const status = p.data.status ?? 'completed';
		if (status !== 'completed' && status !== 'paid') continue;
		const amount = p.data.amount ?? 0;
		const method = p.data.method ?? 'other';
		if (CASH_METHODS.has(method)) cashSales += amount;
		else if (method === 'card') cardSales += amount;
		else if (method === 'lightning') lightningSales += amount;
		else if (method === 'qr' || method === 'qr_static') qrSales += amount;
		else otherSales += amount;
	}

	let totalCashIn = 0;
	let totalCashOut = 0;
	for (const e of input.cashEvents) {
		if (CASH_IN_TYPES.has(e.data.type)) totalCashIn += e.data.amount ?? 0;
		else totalCashOut += e.data.amount ?? 0;
	}

	// Cash refunds reduce expected drawer cash; non-cash refunds don't.
	const expectedCash = openingCash + cashSales + totalCashIn - totalCashOut - cashRefunds;

	return {
		totalOrders,
		totalSales,
		cashSales,
		cardSales,
		lightningSales,
		qrSales,
		otherSales,
		totalRefunds,
		totalRefundAmount,
		cashRefunds,
		totalCashIn,
		totalCashOut,
		expectedCash
	};
}

/**
 * Does a shift belong to the given branch?
 *
 * Both `undefined`/`null` collapse to "no branch" so a single-location tenant
 * (where `locationId` is null) keeps matching its legacy global shifts.
 */
export function shiftMatchesBranch(
	shift: { data: Pick<Shift, 'branchId'> },
	branchId: string | null | undefined
): boolean {
	const target = branchId ?? null;
	const mine = shift.data.branchId ?? null;
	return mine === target;
}

/** Resolve a branch id to its display name (best-effort, offline-safe). */
function branchNameOf(branchId?: string | null): string | undefined {
	if (!branchId) return undefined;
	const loc = glo.get(TYPE.location, branchId);
	const name = (loc?.data as { name?: string } | null)?.name;
	if (name) return name;
	// Fall back to the tenant's active location name when it's the same branch.
	if (branchId === tenant.state.locationId) return tenant.state.locationName || undefined;
	return undefined;
}

class ShiftsStore {
	/** All shifts in the local GLO cache (reactive). */
	get all() {
		return glo.all<Shift, typeof TYPE.shift>(TYPE.shift);
	}

	/** All cash events in the local GLO cache (reactive). */
	get allCashEvents() {
		return glo.all<CashEvent, typeof TYPE.cashEvent>(TYPE.cashEvent);
	}

	/** The active branch for this device (tenant locationId, may be null). */
	get currentBranchId(): string | null {
		return tenant.state.locationId ?? null;
	}

	/** Human label for the active branch (or "All branches" when single-site). */
	get currentBranchLabel(): string {
		return tenant.state.locationName || (this.currentBranchId ? 'Branch' : 'Main');
	}

	/**
	 * The active (open) shift for a branch — defaults to the device's branch.
	 * Returns `undefined` when no shift is open on that branch.
	 */
	activeShiftFor(branchId: string | null | undefined = this.currentBranchId) {
		const target = branchId ?? null;
		return this.all.find((s) => s.data.status === 'active' && shiftMatchesBranch(s, target));
	}

	/** Convenience: the active shift on *this* device's branch (reactive). */
	get activeShift() {
		return this.activeShiftFor(this.currentBranchId);
	}

	/** True when a shift is currently open on the given branch. */
	hasOpenShift(branchId: string | null | undefined = this.currentBranchId): boolean {
		return !!this.activeShiftFor(branchId);
	}

	/** Cash events tied to a shift id (reactive). */
	cashEventsFor(shiftId?: string) {
		if (!shiftId) return [];
		return this.allCashEvents.filter((e) => e.data.shiftId === shiftId);
	}

	/** Orders tied to a shift id (reactive). */
	ordersFor(shiftId?: string) {
		if (!shiftId) return [];
		return glo.all<Order, typeof TYPE.order>(TYPE.order).filter((o) => o.data.shiftId === shiftId);
	}

	/** Payments tied to a shift id (reactive). Prefers `shiftId`; falls back to
	 *  payments whose order belongs to the shift. */
	paymentsFor(shiftId?: string) {
		if (!shiftId) return [];
		const payments = glo.all<Payment, typeof TYPE.payment>(TYPE.payment);
		const direct = payments.filter((p) => p.data.shiftId === shiftId);
		if (direct.length) return direct;
		// Legacy payments without shiftId: join via orderId.
		const orderIds = new Set(this.ordersFor(shiftId).map((o) => o.id));
		return payments.filter((p) => p.data.orderId && orderIds.has(p.data.orderId));
	}

	/** Refunds tied to a shift id (reactive). Refunds carry a `shiftId` when
	 *  processed via POS; legacy ones join via their order's shift. */
	refundsFor(shiftId?: string) {
		if (!shiftId) return [];
		const all = glo.all<Refund, typeof TYPE.refund>(TYPE.refund);
		const direct = all.filter((r) => r.data.shiftId === shiftId);
		if (direct.length) return direct;
		const orderIds = new Set(this.ordersFor(shiftId).map((o) => o.id));
		return all.filter((r) => r.data.orderId && orderIds.has(r.data.orderId));
	}

	/**
	 * Compute a shift summary (orders, per-tender sales, cash in/out, expected
	 * cash) from the linked orders + payments + cash events + refunds. Pure + reactive.
	 */
	summaryFor(shiftId?: string): ShiftSummary {
		if (!shiftId) return { ...ZERO_SUMMARY };
		const shift = this.all.find((s) => s.id === shiftId);
		return computeShiftSummary({
			openingCash: shift?.data.openingCash ?? 0,
			orders: this.ordersFor(shiftId),
			payments: this.paymentsFor(shiftId),
			cashEvents: this.cashEventsFor(shiftId),
			refunds: this.refundsFor(shiftId)
		});
	}

	/**
	 * Open a new shift on a branch. Refuses if a shift is already active there.
	 *
	 * The shift is authored as a GLO object scoped to the branch
	 * (`scope.locationId`) so owner devices and other staff devices on the same
	 * branch see it via the standard `createGloFilter` scope topic.
	 */
	openShift = async (input: {
		openingCash: number;
		staffName?: string;
		branchId?: string | null;
		terminalId?: string;
	}): Promise<{ id: string; number: string } | null> => {
		const branchId = input.branchId ?? this.currentBranchId;
		if (this.hasOpenShift(branchId)) {
			toast.warning(
				'A shift is already open',
				branchId ? `Close it before opening a new one on this branch.` : undefined
			);
			return null;
		}
		const id = newRecordId('shift');
		const number = nextReadableNumber({
			prefix: 'SFT',
			scope: branchId ?? tenant.state.organizationId
		});
		const staffName = input.staffName?.trim() || tenant.state.activeStaffInfo?.name || undefined;
		await glo.upsert<Shift>(
			TYPE.shift,
			{
				number,
				status: 'active',
				openedAt: new Date().toISOString(),
				openingCash: input.openingCash || 0,
				staffId: tenant.state.activeStaffId ?? undefined,
				staffName,
				branchId: branchId ?? undefined,
				branchName: branchNameOf(branchId),
				terminalId: input.terminalId,
				currency: tenant.state.currency
			},
			// Scope the event to the branch so relay filters + cross-device sync
			// stay branch-local. Falls back to org-only scope for single-site.
			{ id, scope: { locationId: branchId ?? undefined } }
		);
		toast.success('Shift opened', number);
		void logActivity({
			action: 'shift_open',
			resource: 'shift',
			resourceId: id,
			summary: `Opened shift ${number}`,
			amount: input.openingCash || 0,
			currency: tenant.state.currency
		});
		return { id, number };
	};

	/**
	 * Close the active shift on a branch. Computes expected cash + variance from
	 * the linked orders/payments/cash events and stamps them onto the record
	 * (canonical GloShift fields: closingCash, expectedCash, difference,
	 * totalSales, totalOrders, per-tender totals, cash in/out).
	 */
	closeShift = async (input: {
		closingCash: number;
		note?: string;
		branchId?: string | null;
		force?: boolean;
	}): Promise<boolean> => {
		const branchId = input.branchId ?? this.currentBranchId;
		const active = this.activeShiftFor(branchId);
		if (!active) {
			toast.warning('No open shift to close', branchId ? this.branchLabel(branchId) : undefined);
			return false;
		}
		const summary = this.summaryFor(active.id);
		const difference = (input.closingCash ?? 0) - summary.expectedCash;
		await glo.upsert<Shift>(
			TYPE.shift,
			{
				...active.data,
				status: input.force ? 'force_closed' : 'closed',
				closedAt: new Date().toISOString(),
				closingCash: input.closingCash ?? 0,
				expectedCash: summary.expectedCash,
				difference,
				varianceNote: input.note?.trim() || undefined,
				totalSales: summary.totalSales,
				totalOrders: summary.totalOrders,
				totalRefunds: summary.totalRefunds,
				totalRefundAmount: summary.totalRefundAmount,
				cashSales: summary.cashSales,
				cardSales: summary.cardSales,
				lightningSales: summary.lightningSales,
				qrSales: summary.qrSales,
				otherSales: summary.otherSales,
				totalCashIn: summary.totalCashIn,
				totalCashOut: summary.totalCashOut
			},
			{ id: active.id, scope: { locationId: branchId ?? undefined } }
		);
		toast.success(
			input.force ? 'Shift force-closed' : 'Shift closed',
			`${active.data.number} · variance ${difference >= 0 ? '+' : ''}${difference.toFixed(2)}`
		);
		return true;
	};

	/**
	 * Cancel (void) the active shift on a branch. Unlike `closeShift` this does
	 * NOT reconcile — it's the escape hatch for a shift opened by mistake (wrong
	 * float, wrong branch, wrong staff). The shift is stamped `cancelled` and
	 * excluded from `activeShiftFor`; it stays in history for auditability.
	 *
	 * Only active shifts can be cancelled — a closed/force-closed shift was
	 * already reconciled and must not be voided.
	 */
	cancelShift = async (input: { branchId?: string | null; reason?: string }): Promise<boolean> => {
		const branchId = input.branchId ?? this.currentBranchId;
		const active = this.activeShiftFor(branchId);
		if (!active) {
			toast.warning('No open shift to cancel', branchId ? this.branchLabel(branchId) : undefined);
			return false;
		}
		await glo.upsert<Shift>(
			TYPE.shift,
			{
				...active.data,
				status: 'cancelled',
				closedAt: new Date().toISOString(),
				varianceNote: input.reason?.trim() || 'Shift cancelled'
			},
			{ id: active.id, scope: { locationId: branchId ?? undefined } }
		);
		toast.success('Shift cancelled', active.data.number);
		return true;
	};

	/**
	 * Record a cash movement (cash in/out, paid in/out, bank deposit) against
	 * the active shift on a branch. Refuses if no shift is open.
	 */
	addCashEvent = async (input: {
		type: CashEvent['type'];
		amount: number;
		reason?: string;
		branchId?: string | null;
	}): Promise<boolean> => {
		const branchId = input.branchId ?? this.currentBranchId;
		const active = this.activeShiftFor(branchId);
		if (!active) {
			toast.warning('Open a shift first', branchId ? this.branchLabel(branchId) : undefined);
			return false;
		}
		await glo.upsert<CashEvent>(
			TYPE.cashEvent,
			{
				shiftId: active.id,
				staffId: tenant.state.activeStaffId ?? undefined,
				type: input.type,
				amount: input.amount || 0,
				currency: tenant.state.currency,
				reason: input.reason?.trim() || undefined,
				approvedBy: session.pubkey ?? undefined,
				occurredAt: new Date().toISOString()
			},
			{ id: newRecordId('cash-event'), scope: { locationId: branchId ?? undefined } }
		);
		toast.success('Cash movement recorded', `${input.type.replace('_', ' ')}`);
		void logActivity({
			action: 'cash_event',
			resource: 'shift',
			resourceId: active?.id,
			summary: `${input.type.replace('_', ' ')} of ${input.amount || 0}`,
			amount: input.amount || 0,
			currency: tenant.state.currency,
			meta: { reason: input.reason }
		});
		return true;
	};

	/** Convenience label for a branch (for toasts / headings). */
	branchLabel(branchId?: string | null): string {
		return branchNameOf(branchId) ?? (branchId ? 'this branch' : 'Main');
	}
}

export const shifts = new ShiftsStore();
