import { describe, expect, it } from 'vitest';
import {
	DEFAULT_HOURLY_RETENTION_DAYS,
	loadHourlyRetentionDays,
	normalizeRetentionDays,
	saveHourlyRetentionDays
} from './snapshot-settings';

function memoryStorage(): Storage {
	const values = new Map<string, string>();
	return {
		get length() {
			return values.size;
		},
		clear: () => values.clear(),
		getItem: (key: string) => values.get(key) ?? null,
		key: (index: number) => [...values.keys()][index] ?? null,
		removeItem: (key: string) => values.delete(key),
		setItem: (key: string, value: string) => values.set(key, value)
	};
}

describe('snapshot retention settings', () => {
	it('normalizes, clamps and defaults retention days', () => {
		expect(normalizeRetentionDays(90)).toBe(90);
		expect(normalizeRetentionDays('30')).toBe(30);
		expect(normalizeRetentionDays(0)).toBe(1);
		expect(normalizeRetentionDays(10_000)).toBe(3650);
		expect(normalizeRetentionDays('nope')).toBe(DEFAULT_HOURLY_RETENTION_DAYS);
		expect(normalizeRetentionDays(undefined)).toBe(DEFAULT_HOURLY_RETENTION_DAYS);
	});

	it('persists and reloads the per-device retention setting', () => {
		const storage = memoryStorage();
		expect(loadHourlyRetentionDays(storage)).toBe(DEFAULT_HOURLY_RETENTION_DAYS);
		expect(saveHourlyRetentionDays(45, storage)).toBe(45);
		expect(loadHourlyRetentionDays(storage)).toBe(45);
		expect(saveHourlyRetentionDays(9999, storage)).toBe(3650);
		expect(loadHourlyRetentionDays(storage)).toBe(3650);
	});
});
