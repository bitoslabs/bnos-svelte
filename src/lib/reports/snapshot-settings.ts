/**
 * Local retention settings for report snapshots.
 *
 * Only hourly snapshots are pruned automatically/manually; daily, weekly and
 * monthly snapshots are kept. Relay copies are never deleted by this setting.
 */
const RETENTION_KEY = 'bnos-os:reports:snapshot-retention-days';

export const DEFAULT_HOURLY_RETENTION_DAYS = 90;
export const MIN_HOURLY_RETENTION_DAYS = 1;
export const MAX_HOURLY_RETENTION_DAYS = 3650;

export function normalizeRetentionDays(value: unknown): number {
	if (value === null || value === undefined || value === '') return DEFAULT_HOURLY_RETENTION_DAYS;
	const parsed = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(parsed)) return DEFAULT_HOURLY_RETENTION_DAYS;
	return Math.min(
		MAX_HOURLY_RETENTION_DAYS,
		Math.max(MIN_HOURLY_RETENTION_DAYS, Math.round(parsed))
	);
}

function storageOrDefault(storage: Storage | null | undefined): Storage | null {
	if (storage !== undefined) return storage;
	return typeof localStorage === 'undefined' ? null : localStorage;
}

export function loadHourlyRetentionDays(storage?: Storage | null): number {
	try {
		return normalizeRetentionDays(storageOrDefault(storage)?.getItem(RETENTION_KEY));
	} catch {
		return DEFAULT_HOURLY_RETENTION_DAYS;
	}
}

export function saveHourlyRetentionDays(days: number, storage?: Storage | null): number {
	const normalized = normalizeRetentionDays(days);
	try {
		storageOrDefault(storage)?.setItem(RETENTION_KEY, String(normalized));
	} catch {
		/* storage unavailable — keep the in-memory value */
	}
	return normalized;
}
