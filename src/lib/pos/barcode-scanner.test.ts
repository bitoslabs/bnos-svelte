import { describe, expect, it } from 'vitest';
import { createScanState, feedScan } from './barcode-scanner';

/** Feed a sequence of keys with the given inter-key gap (ms). Each key's
 *  `performance.now()` call returns a monotonically increasing time. */
function feedBurst(keys: string[], gap: number): string | null {
	const state = createScanState();
	const orig = performance.now;
	let result: string | null = null;
	let i = 0;
	(performance as any).now = () => i++ * gap;
	try {
		for (const k of keys) {
			const r = feedScan(state, { key: k });
			if (r !== null) result = r;
		}
	} finally {
		(performance as any).now = orig;
	}
	return result;
}

describe('barcode scanner detection', () => {
	it('detects a fast digit burst terminated by Enter', () => {
		// "5012345000019" + Enter, ~10ms apart → scan
		expect(
			feedBurst(['5', '0', '1', '2', '3', '4', '5', '0', '0', '0', '0', '1', '9', 'Enter'], 10)
		).toBe('5012345000019');
	});

	it('rejects a burst shorter than minLength', () => {
		expect(feedBurst(['1', '2', 'Enter'], 10)).toBeNull();
	});

	it('treats slow typing as NOT a scan (gap > maxGap resets the burst)', () => {
		// 200ms gaps → each key restarts the buffer; final Enter has buffer of 1 char
		expect(feedBurst(['5', '0', '1', '2', '3', 'Enter'], 200)).toBeNull();
	});

	it('resets the buffer on non-character keys', () => {
		const state = createScanState();
		feedScan(state, { key: '5' });
		feedScan(state, { key: '0' });
		feedScan(state, { key: 'Escape' }); // breaks the burst
		expect(feedScan(state, { key: 'Enter' })).toBeNull();
	});

	it('ignores modifier combos (shortcuts, not scans)', () => {
		const state = createScanState();
		expect(feedScan(state, { key: 'k', ctrlKey: true })).toBeNull();
		expect(state.buffer).toBe('');
	});

	it('accepts a custom minLength / maxGap', () => {
		// minLength 5, but only 4 chars → reject
		const state = createScanState();
		const opts = { minLength: 5, maxGap: 40 };
		for (const k of ['1', '2', '3', '4']) feedScan(state, { key: k }, opts);
		expect(feedScan(state, { key: 'Enter' }, opts)).toBeNull();
		// 5 chars → accept
		const s2 = createScanState();
		for (const k of ['1', '2', '3', '4', '5']) feedScan(s2, { key: k }, opts);
		expect(feedScan(s2, { key: 'Enter' }, opts)).toBe('12345');
	});
});
