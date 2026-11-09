/**
 * Report snapshot orchestration.
 *
 * Produces a pure aggregate, stores it locally as a GLO object (encrypted on
 * relays), and pushes a separate plaintext copy to the data service. The relay
 * copy and the service copy are deliberately different events: relays only ever
 * receive ciphertext, while the service receives signed plaintext aggregates.
 */
import type { GloOrder, GloPayment, GloProduct } from '@bitos/bnos-core/glo';
import type { GloObject } from '@bitos/bnos-core/glo';
import { glo } from '$nostr/store.svelte';
import { tenant } from '$nostr/tenant.svelte';
import { dataService } from '$lib/data-service/state.svelte';
import { TYPE, type Refund } from '$lib/domain';
import {
	buildReportSnapshot,
	snapshotId,
	type ReportGranularity,
	type ReportSnapshot
} from '$lib/domain/report-snapshot';

const DAY_MS = 86_400_000;

export interface PublishReportSnapshotInput {
	granularity: ReportGranularity;
	periodStart: number;
	periodEnd: number;
	locationId?: string | null;
	now?: number;
}

export interface PublishReportSnapshotResult {
	snapshot: ReportSnapshot;
	id: string;
	object: GloObject<ReportSnapshot, string>;
	pushed: boolean;
}

/** Build, persist (relay ciphertext) and push (service plaintext) one snapshot. */
export async function publishReportSnapshot(
	input: PublishReportSnapshotInput
): Promise<PublishReportSnapshotResult> {
	const locationId = input.locationId ?? tenant.state.locationId ?? undefined;
	const snapshot = buildReportSnapshot({
		periodStart: input.periodStart,
		periodEnd: input.periodEnd,
		granularity: input.granularity,
		orders: glo.all<GloOrder, 'commerce.order'>('commerce.order'),
		payments: glo.all<GloPayment, 'commerce.payment'>('commerce.payment'),
		refunds: glo.all<Refund, typeof TYPE.refund>(TYPE.refund),
		products: glo.all<GloProduct, 'catalog.product'>('catalog.product'),
		currency: tenant.state.currency,
		locationId,
		now: input.now
	});

	const id = snapshotId({
		workspaceId: tenant.state.organizationId,
		locationId,
		granularity: input.granularity,
		periodStart: input.periodStart,
		currency: snapshot.currency
	});

	const object = (await glo.upsert('report.snapshot', snapshot, {
		id,
		visibility: 'organization'
	})) as GloObject<ReportSnapshot, string>;

	// The local + relay snapshot remains authoritative; on failure the service
	// copy stays in its durable outbox and is retried on reconnect.
	const pushed = await dataService.pushReportSnapshot(snapshot, id).catch(() => false);

	return { snapshot, id, object, pushed };
}

/** Local-day bounds `[start, end)` in the device timezone. */
export function dayPeriod(now = Date.now()): { periodStart: number; periodEnd: number } {
	const start = new Date(now);
	start.setHours(0, 0, 0, 0);
	const periodStart = start.getTime();
	const end = new Date(periodStart + DAY_MS);
	end.setHours(0, 0, 0, 0);
	return { periodStart, periodEnd: end.getTime() };
}

function timestampOf(object: GloObject<ReportSnapshot, string>): number {
	const at = Date.parse(object.data.generatedAt);
	if (Number.isFinite(at)) return at;
	const updated = Date.parse(object.data.periodEnd);
	return Number.isFinite(updated) ? updated : 0;
}

/** Newest local snapshot for one logical period, if any. */
export function findSnapshot(input: {
	granularity: ReportGranularity;
	periodStart: number;
	locationId?: string | null;
	currency?: string;
}): GloObject<ReportSnapshot, string> | undefined {
	const currency = (input.currency ?? tenant.state.currency).toUpperCase();
	const locationId = input.locationId ?? tenant.state.locationId ?? undefined;
	let newest: GloObject<ReportSnapshot, string> | undefined;
	for (const object of glo.all<ReportSnapshot, 'report.snapshot'>('report.snapshot')) {
		const data = object.data;
		if (data.granularity !== input.granularity) continue;
		if (Date.parse(data.periodStart) !== input.periodStart) continue;
		if (data.currency.toUpperCase() !== currency) continue;
		if ((data.locationId ?? undefined) !== locationId) continue;
		if (!newest || timestampOf(object) > timestampOf(newest)) newest = object;
	}
	return newest;
}

function hasOrdersInPeriod(
	periodStart: number,
	periodEnd: number,
	currency: string,
	locationId: string | undefined
): boolean {
	const target = currency.toUpperCase();
	return glo.all<GloOrder, 'commerce.order'>('commerce.order').some((object) => {
		const data = object.data;
		if (data.currency?.toUpperCase() !== target) return false;
		const branchId = (data as { branchId?: string }).branchId;
		if (locationId && (branchId ?? object.scope?.locationId) !== locationId) return false;
		const at = Date.parse(data.occurredAt);
		return Number.isFinite(at) && at >= periodStart && at < periodEnd;
	});
}

/**
 * Publish today's daily snapshot when it is missing or older than `staleMs`.
 * Re-publishing the same period replaces the same GLO object. Periods without
 * orders stay gaps instead of being filled with fabricated zeros.
 */
export async function ensureDailySnapshot(
	options: { now?: number; staleMs?: number } = {}
): Promise<PublishReportSnapshotResult | null> {
	if (!tenant.state.organizationId) return null;
	const now = options.now ?? Date.now();
	const { periodStart, periodEnd } = dayPeriod(now);
	if (
		!hasOrdersInPeriod(
			periodStart,
			periodEnd,
			tenant.state.currency,
			tenant.state.locationId ?? undefined
		)
	)
		return null;
	const existing = findSnapshot({ granularity: 'day', periodStart });
	const staleMs = options.staleMs ?? 60 * 60 * 1000;
	if (existing && Math.abs(now - timestampOf(existing)) < staleMs) return null;
	return publishReportSnapshot({ granularity: 'day', periodStart, periodEnd, now });
}
