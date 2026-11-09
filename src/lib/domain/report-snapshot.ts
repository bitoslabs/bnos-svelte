/**
 * Period-scoped report snapshots — pure aggregation.
 *
 * A snapshot carries totals and counts only. It never includes customer
 * identifiers, names, addresses, free text, or line-item plaintext. Money is
 * always integer minor units for the snapshot's single currency.
 *
 * The builder is a pure function of plain inputs so it can be tested without a
 * browser, relays, or a signer.
 */
import type { GloOrder, GloOrderLine, GloPayment, GloProduct } from '@bitos/bnos-core/glo';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { Refund } from './types';

/** App-side kind until `@bitos/bnos-core` publishes `NOSTR_KINDS.REPORT_SNAPSHOT`. */
export const REPORT_SNAPSHOT_KIND = 30970;

export const REPORT_SNAPSHOT_TOP_PRODUCTS_LIMIT = 50;

export type ReportGranularity = 'hour' | 'day' | 'week' | 'month';

export interface ReportSnapshot {
	type: 'report.snapshot';
	version: 1;
	granularity: ReportGranularity;
	periodStart: string;
	periodEnd: string;
	locationId?: string;
	/** IANA timezone used to compute the period; absent means device-local. */
	timezone?: string;
	currency: string;
	/** All amounts are integer minor units for `currency`. */
	grossMinor: number;
	netMinor: number;
	taxMinor: number;
	discountMinor: number;
	refundMinor: number;
	ordersCount: number;
	itemsCount: number;
	avgTicketMinor: number;
	payments: Record<string, number>;
	orderStatus: Record<string, number>;
	topProducts: { productId: string; qty: number; revenueMinor: number }[];
	generatedAt: string;
}

const MINOR_DIGITS: Record<string, number> = {
	USD: 2,
	THB: 2,
	LAK: 0,
	BTC: 8,
	SAT: 0,
	SATS: 0
};

/** Convert a decimal amount into integer minor units for `currency`. */
export function toMinorUnits(amount: number, currency: string): number {
	const digits = MINOR_DIGITS[currency.toUpperCase()] ?? 2;
	if (!Number.isFinite(amount)) return 0;
	return Math.round(amount * 10 ** digits);
}

/** Convert integer minor units back to a decimal amount for display. */
export function fromMinorUnits(minor: number, currency: string): number {
	const digits = MINOR_DIGITS[currency.toUpperCase()] ?? 2;
	if (!Number.isFinite(minor)) return 0;
	return minor / 10 ** digits;
}

interface ScopedRecord {
	scope?: { locationId?: string | null };
}

export interface SnapshotOrderRecord extends ScopedRecord {
	id: string;
	data: GloOrder & {
		branchId?: string;
		method?: string;
		totalSats?: number;
	};
}

export interface SnapshotPaymentRecord extends ScopedRecord {
	id: string;
	data: GloPayment & { branchId?: string };
}

export interface SnapshotRefundRecord extends ScopedRecord {
	id: string;
	data: Refund;
}

export interface SnapshotProductRecord {
	id: string;
	data: GloProduct;
}

export interface BuildReportSnapshotInput {
	periodStart: number;
	periodEnd: number;
	granularity: ReportGranularity;
	orders: readonly SnapshotOrderRecord[];
	payments?: readonly SnapshotPaymentRecord[];
	refunds?: readonly SnapshotRefundRecord[];
	products?: readonly SnapshotProductRecord[];
	currency: string;
	locationId?: string;
	/** IANA timezone used to compute the period (stored on the snapshot). */
	timezone?: string;
	now?: number;
	topProductsLimit?: number;
}

function timeOf(value: string | undefined | null): number {
	if (!value) return Number.NaN;
	const ms = Date.parse(value);
	return Number.isFinite(ms) ? ms : Number.NaN;
}

function inPeriod(at: number, start: number, end: number): boolean {
	return Number.isFinite(at) && at >= start && at < end;
}

function sameCurrency(value: string | undefined, target: string): boolean {
	return !value || value.toUpperCase() === target;
}

function locationOf(record: ScopedRecord & { data?: { branchId?: string } }): string | undefined {
	return record.data?.branchId ?? record.scope?.locationId ?? undefined;
}

function matchesLocation(
	record: ScopedRecord & { data?: { branchId?: string } },
	locationId: string | undefined
): boolean {
	if (!locationId) return true;
	return locationOf(record) === locationId;
}

function moneyMinor(amount: number | undefined, currency: string, sats?: number): number {
	if (currency.toUpperCase() === 'BTC' && typeof sats === 'number' && Number.isFinite(sats)) {
		return Math.round(sats);
	}
	return toMinorUnits(amount ?? 0, currency);
}

function normalizedName(value: string | undefined): string {
	return (value ?? '').trim().toLowerCase();
}

/**
 * Build one aggregate snapshot for a half-open period `[periodStart, periodEnd)`.
 *
 * Reconciliation rule: `netMinor = grossMinor - discountMinor + taxMinor -
 * refundMinor`, where `grossMinor` is the sum of order subtotals before
 * discounts and tax, and refunds come from completed/approved refund records.
 */
export function buildReportSnapshot(input: BuildReportSnapshotInput): ReportSnapshot {
	const currency = input.currency.toUpperCase();
	const { periodStart, periodEnd, granularity, locationId, timezone, now = Date.now() } = input;

	let grossMinor = 0;
	let discountMinor = 0;
	let taxMinor = 0;
	let ticketMinor = 0;
	let ordersCount = 0;
	let itemsCount = 0;
	const statusCount: Record<string, number> = {};
	const methodTotals: Record<string, number> = {};
	const productTotals = new Map<string, { qty: number; revenueMinor: number }>();

	const productIdByName = new Map<string, string>();
	for (const product of input.products ?? []) {
		const name = normalizedName(product.data?.name);
		if (name) productIdByName.set(name, product.id);
	}

	for (const order of input.orders) {
		const data = order.data;
		if (!sameCurrency(data.currency, currency)) continue;
		if (!matchesLocation(order, locationId)) continue;
		if (!inPeriod(timeOf(data.occurredAt), periodStart, periodEnd)) continue;

		const orderTotalMinor = moneyMinor(data.total, currency, data.totalSats);
		ticketMinor += orderTotalMinor;
		ordersCount += 1;
		grossMinor += moneyMinor(
			data.subtotal ?? (data.total ?? 0) + (data.discount ?? 0) - (data.tax ?? 0),
			currency
		);
		discountMinor += moneyMinor(data.discount, currency);
		taxMinor += moneyMinor(data.tax, currency);

		const status = data.status || 'completed';
		statusCount[status] = (statusCount[status] ?? 0) + 1;

		const method = data.method || 'cash';
		methodTotals[method] = (methodTotals[method] ?? 0) + orderTotalMinor;

		for (const line of data.lines ?? []) {
			itemsCount += Number.isFinite(line.quantity) ? line.quantity : 0;
			const productId = lineProductId(line, productIdByName);
			if (!productId) continue;
			const entry = productTotals.get(productId) ?? { qty: 0, revenueMinor: 0 };
			entry.qty += Number.isFinite(line.quantity) ? line.quantity : 0;
			entry.revenueMinor += moneyMinor(lineRevenue(line), currency);
			productTotals.set(productId, entry);
		}
	}

	const paymentTotals: Record<string, number> = {};
	let paymentCount = 0;
	for (const payment of input.payments ?? []) {
		const data = payment.data;
		if (!sameCurrency(data.currency, currency)) continue;
		if (!matchesLocation(payment, locationId)) continue;
		if (!inPeriod(timeOf(data.paidAt), periodStart, periodEnd)) continue;
		const method = data.method || 'other';
		paymentTotals[method] = (paymentTotals[method] ?? 0) + toMinorUnits(data.amount ?? 0, currency);
		paymentCount += 1;
	}

	let refundMinor = 0;
	for (const refund of input.refunds ?? []) {
		const data = refund.data;
		if (data.status !== 'completed' && data.status !== 'approved') continue;
		if (!sameCurrency(data.currency, currency)) continue;
		if (!matchesLocation(refund, locationId)) continue;
		if (!inPeriod(timeOf(data.completedAt), periodStart, periodEnd)) continue;
		refundMinor += toMinorUnits(data.totalAmount ?? 0, currency);
	}

	const topProducts = [...productTotals.entries()]
		.map(([productId, entry]) => ({ productId, ...entry }))
		.sort(
			(a, b) =>
				b.qty - a.qty || b.revenueMinor - a.revenueMinor || a.productId.localeCompare(b.productId)
		)
		.slice(0, input.topProductsLimit ?? REPORT_SNAPSHOT_TOP_PRODUCTS_LIMIT);

	return {
		type: 'report.snapshot',
		version: 1,
		granularity,
		periodStart: new Date(periodStart).toISOString(),
		periodEnd: new Date(periodEnd).toISOString(),
		...(locationId ? { locationId } : {}),
		...(timezone ? { timezone } : {}),
		currency,
		grossMinor,
		netMinor: grossMinor - discountMinor + taxMinor - refundMinor,
		taxMinor,
		discountMinor,
		refundMinor,
		ordersCount,
		itemsCount,
		avgTicketMinor: ordersCount ? Math.round(ticketMinor / ordersCount) : 0,
		payments: paymentCount ? paymentTotals : methodTotals,
		orderStatus: statusCount,
		topProducts,
		generatedAt: new Date(now).toISOString()
	};
}

function lineProductId(line: GloOrderLine, byName: Map<string, string>): string | undefined {
	if (line.productId) return line.productId;
	return byName.get(normalizedName(line.name));
}

function lineRevenue(line: GloOrderLine): number {
	if (typeof line.total === 'number' && Number.isFinite(line.total)) return line.total;
	const quantity = Number.isFinite(line.quantity) ? line.quantity : 0;
	const unit = Number.isFinite(line.unitPrice) ? line.unitPrice : 0;
	return quantity * unit;
}

function payloadString(value: unknown, label: string): string {
	if (typeof value !== 'string' || !value.trim()) {
		throw new Error(`Report snapshot ${label} must be a non-empty string`);
	}
	return value;
}

function payloadNumber(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new Error(`Report snapshot ${label} must be a number`);
	}
	return Math.round(value);
}

function payloadNumberRecord(value: unknown): Record<string, number> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
	const out: Record<string, number> = {};
	for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
		if (typeof entry === 'number' && Number.isFinite(entry)) out[key] = Math.round(entry);
	}
	return out;
}

/**
 * Validate a snapshot-shaped object received from the data service. Unknown
 * fields are ignored; only aggregate fields are read. Throws on malformed money
 * or period fields so callers can fall back to local data.
 */
export function parseReportSnapshot(raw: unknown): ReportSnapshot {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		throw new Error('Report snapshot must be an object');
	}
	const value = raw as Record<string, unknown>;
	const granularityValue = value.granularity;
	const granularity: ReportGranularity =
		granularityValue === 'hour' ||
		granularityValue === 'day' ||
		granularityValue === 'week' ||
		granularityValue === 'month'
			? granularityValue
			: 'day';

	const topProducts: ReportSnapshot['topProducts'] = [];
	if (Array.isArray(value.topProducts)) {
		for (const entry of value.topProducts) {
			if (!entry || typeof entry !== 'object') continue;
			const row = entry as Record<string, unknown>;
			if (typeof row.productId !== 'string' || !row.productId) continue;
			if (typeof row.qty !== 'number' || !Number.isFinite(row.qty)) continue;
			if (typeof row.revenueMinor !== 'number' || !Number.isFinite(row.revenueMinor)) continue;
			topProducts.push({
				productId: row.productId,
				qty: row.qty,
				revenueMinor: Math.round(row.revenueMinor)
			});
		}
	}

	return {
		type: 'report.snapshot',
		version: 1,
		granularity,
		periodStart: payloadString(value.periodStart, 'periodStart'),
		periodEnd: payloadString(value.periodEnd, 'periodEnd'),
		...(typeof value.locationId === 'string' && value.locationId
			? { locationId: value.locationId }
			: {}),
		...(typeof value.timezone === 'string' && value.timezone ? { timezone: value.timezone } : {}),
		currency: payloadString(value.currency, 'currency').toUpperCase(),
		grossMinor: payloadNumber(value.grossMinor, 'grossMinor'),
		netMinor: payloadNumber(value.netMinor, 'netMinor'),
		taxMinor: payloadNumber(value.taxMinor ?? 0, 'taxMinor'),
		discountMinor: payloadNumber(value.discountMinor ?? 0, 'discountMinor'),
		refundMinor: payloadNumber(value.refundMinor ?? 0, 'refundMinor'),
		ordersCount: payloadNumber(value.ordersCount ?? 0, 'ordersCount'),
		itemsCount: payloadNumber(value.itemsCount ?? 0, 'itemsCount'),
		avgTicketMinor: payloadNumber(value.avgTicketMinor ?? 0, 'avgTicketMinor'),
		payments: payloadNumberRecord(value.payments),
		orderStatus: payloadNumberRecord(value.orderStatus),
		topProducts,
		generatedAt:
			typeof value.generatedAt === 'string' && value.generatedAt
				? value.generatedAt
				: new Date().toISOString()
	};
}

/** Stable logical period key shared by the client id and the service dedupe. */
export function snapshotPeriodKey(input: {
	workspaceId: string;
	locationId?: string | null;
	granularity: ReportGranularity;
	periodStart: number | string;
	currency: string;
	timezone?: string;
}): string {
	const start =
		typeof input.periodStart === 'number' ? input.periodStart : Date.parse(input.periodStart);
	const parts = [
		input.workspaceId,
		input.locationId ?? 'all',
		input.granularity,
		Number.isFinite(start) ? start : 0,
		input.currency.toUpperCase()
	];
	// Keep pre-timezone ids stable; only add the segment when configured.
	if (input.timezone) parts.push(input.timezone);
	return parts.join('|');
}

/** Deterministic GLO id (segment-safe) for one logical snapshot period. */
export function snapshotId(input: {
	workspaceId: string;
	locationId?: string | null;
	granularity: ReportGranularity;
	periodStart: number | string;
	currency: string;
	timezone?: string;
}): string {
	const digest = bytesToHex(sha256(new TextEncoder().encode(snapshotPeriodKey(input))));
	return `snap-${digest.slice(0, 40)}`;
}
