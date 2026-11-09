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
import { logActivity } from '$lib/audit.svelte';
import { TYPE, type Refund } from '$lib/domain';
import {
	buildReportSnapshot,
	snapshotId,
	type ReportGranularity,
	type ReportSnapshot
} from '$lib/domain/report-snapshot';

const DAY_MS = 86_400_000;

/** Organization timezone when configured, otherwise undefined (device-local). */
export function businessTimeZone(): string | undefined {
	const organizationId = tenant.state.organizationId;
	const organization =
		(organizationId
			? (glo.get(TYPE.organization, organizationId) as { data?: { timezone?: string } } | undefined)
			: undefined) ??
		glo.all<{ timezone?: string }, typeof TYPE.organization>(TYPE.organization)[0];
	const timezone = organization?.data?.timezone;
	return typeof timezone === 'string' && timezone.trim() ? timezone.trim() : undefined;
}

function timeZoneOffsetMs(timeZone: string, at: number): number {
	const formatter = new Intl.DateTimeFormat('en-US', {
		timeZone,
		hour12: false,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit'
	});
	const parts: Record<string, number> = {};
	for (const part of formatter.formatToParts(new Date(at))) {
		if (part.type !== 'literal') parts[part.type] = Number(part.value);
	}
	const asUtc = Date.UTC(
		parts.year ?? 1970,
		(parts.month ?? 1) - 1,
		parts.day ?? 1,
		(parts.hour ?? 0) % 24,
		parts.minute ?? 0,
		parts.second ?? 0
	);
	return asUtc - at;
}

/** Day bounds `[start, end)` for one IANA timezone. */
export function zonedDayPeriod(
	now: number,
	timeZone: string
): { periodStart: number; periodEnd: number } {
	const formatter = new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	});
	const parts: Record<string, number> = {};
	for (const part of formatter.formatToParts(new Date(now))) {
		if (part.type !== 'literal') parts[part.type] = Number(part.value);
	}
	const year = parts.year ?? 1970;
	const month = (parts.month ?? 1) - 1;
	const day = parts.day ?? 1;

	const startWall = Date.UTC(year, month, day);
	const startOffset = timeZoneOffsetMs(timeZone, startWall);
	const periodStart = startWall - timeZoneOffsetMs(timeZone, startWall - startOffset);

	const endWall = Date.UTC(year, month, day + 1);
	const endOffset = timeZoneOffsetMs(timeZone, endWall);
	const periodEnd = endWall - timeZoneOffsetMs(timeZone, endWall - endOffset);

	return { periodStart, periodEnd };
}

function fallbackDayPeriod(now: number): { periodStart: number; periodEnd: number } {
	const start = new Date(now);
	start.setHours(0, 0, 0, 0);
	const periodStart = start.getTime();
	const end = new Date(periodStart + DAY_MS);
	end.setHours(0, 0, 0, 0);
	return { periodStart, periodEnd: end.getTime() };
}

export interface PublishReportSnapshotInput {
	granularity: ReportGranularity;
	periodStart: number;
	periodEnd: number;
	locationId?: string | null;
	now?: number;
	/** Write an activity-log entry for this publish (manual actions only). */
	audit?: boolean;
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
	const timezone = businessTimeZone();
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
		timezone,
		now: input.now
	});

	const id = snapshotId({
		workspaceId: tenant.state.organizationId,
		locationId,
		granularity: input.granularity,
		periodStart: input.periodStart,
		currency: snapshot.currency,
		timezone
	});

	const object = (await glo.upsert('report.snapshot', snapshot, {
		id,
		visibility: 'organization'
	})) as GloObject<ReportSnapshot, string>;

	// The local + relay snapshot remains authoritative; on failure the service
	// copy stays in its durable outbox and is retried on reconnect.
	const pushed = await dataService.pushReportSnapshot(snapshot, id).catch(() => false);

	if (input.audit) {
		void logActivity({
			action: 'create',
			resource: 'report.snapshot',
			resourceId: id,
			summary: `Saved ${snapshot.granularity} report snapshot`,
			currency: snapshot.currency,
			meta: {
				granularity: snapshot.granularity,
				periodStart: snapshot.periodStart,
				periodEnd: snapshot.periodEnd,
				locationId: snapshot.locationId,
				timezone: snapshot.timezone,
				netMinor: snapshot.netMinor,
				ordersCount: snapshot.ordersCount
			}
		});
	}

	return { snapshot, id, object, pushed };
}

/**
 * Day bounds `[start, end)` in the organization timezone, falling back to the
 * device timezone when the workspace has no timezone configured.
 */
export function dayPeriod(
	now = Date.now(),
	timeZone = businessTimeZone()
): { periodStart: number; periodEnd: number } {
	if (timeZone) {
		try {
			return zonedDayPeriod(now, timeZone);
		} catch {
			/* invalid stored timezone — fall through to device local */
		}
	}
	return fallbackDayPeriod(now);
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
	timezone?: string;
}): GloObject<ReportSnapshot, string> | undefined {
	const currency = (input.currency ?? tenant.state.currency).toUpperCase();
	const locationId = input.locationId ?? tenant.state.locationId ?? undefined;
	const timezone = input.timezone ?? businessTimeZone();
	let newest: GloObject<ReportSnapshot, string> | undefined;
	for (const object of glo.all<ReportSnapshot, 'report.snapshot'>('report.snapshot')) {
		const data = object.data;
		if (data.granularity !== input.granularity) continue;
		if (Date.parse(data.periodStart) !== input.periodStart) continue;
		if (data.currency.toUpperCase() !== currency) continue;
		if ((data.locationId ?? undefined) !== locationId) continue;
		if ((data.timezone ?? undefined) !== timezone) continue;
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
 * Create missing daily snapshots for the last `days` days from local data.
 * Only periods with orders are considered; existing snapshots are skipped
 * unless `onlyMissing` is false.
 */
export async function backfillDailySnapshots(
	options: { days?: number; onlyMissing?: boolean; now?: number } = {}
): Promise<{ created: number; skipped: number }> {
	const days = Math.min(Math.max(options.days ?? 30, 1), 90);
	const now = options.now ?? Date.now();
	const timezone = businessTimeZone();
	const currency = tenant.state.currency;
	const locationId = tenant.state.locationId ?? undefined;
	const seen = new Set<number>();
	let created = 0;
	let skipped = 0;

	for (let offset = days - 1; offset >= 0; offset--) {
		const { periodStart, periodEnd } = dayPeriod(now - offset * DAY_MS, timezone);
		if (seen.has(periodStart)) continue;
		seen.add(periodStart);
		if (!hasOrdersInPeriod(periodStart, periodEnd, currency, locationId)) {
			skipped += 1;
			continue;
		}
		if (options.onlyMissing !== false && findSnapshot({ granularity: 'day', periodStart })) {
			skipped += 1;
			continue;
		}
		await publishReportSnapshot({ granularity: 'day', periodStart, periodEnd, now });
		created += 1;
	}
	return { created, skipped };
}

/**
 * Remove local hourly snapshots older than the cutoff. Relays keep their
 * ciphertext copies; only this device's cached aggregate is pruned.
 */
export function pruneHourlySnapshots(options: { olderThanMs?: number; now?: number } = {}): number {
	const cutoff = (options.now ?? Date.now()) - (options.olderThanMs ?? 90 * DAY_MS);
	let removed = 0;
	for (const object of [...glo.all<ReportSnapshot, 'report.snapshot'>('report.snapshot')]) {
		if (object.data.granularity !== 'hour') continue;
		const endedAt = Date.parse(object.data.periodEnd);
		if (!Number.isFinite(endedAt) || endedAt >= cutoff) continue;
		glo.remove('report.snapshot', object.id);
		removed += 1;
	}
	return removed;
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
