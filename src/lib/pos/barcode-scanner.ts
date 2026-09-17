/**
 * HID barcode scanner capture.
 *
 * USB / Bluetooth scanners present as keyboards: they emit a rapid burst of
 * characters terminated by Enter (or a configurable suffix). We distinguish a
 * scan from a human typing by **inter-key timing** — scanners fire keys
 * < ~35 ms apart, humans rarely beat ~100 ms — plus a minimum code length.
 *
 * `feedScan` is pure + stateful-by-argument so the detection logic is unit
 * testable; `startBarcodeScanner` wires it to a capture-phase window listener
 * and returns a cleanup function.
 */

export type ScanState = { buffer: string; lastTime: number };

export function createScanState(): ScanState {
	return { buffer: '', lastTime: 0 };
}

export type ScanOptions = {
	/** Minimum code length to accept as a scan (default 3). */
	minLength?: number;
	/** Maximum milliseconds between two keys still considered part of one scan
	 *  burst (default 35). Human typing is almost always slower than this. */
	maxGap?: number;
};

type KeyEventLike = {
	key: string;
	ctrlKey?: boolean;
	metaKey?: boolean;
	altKey?: boolean;
};

/**
 * Feed one keydown. Returns the completed code when a full scan is detected
 * (Enter terminating a fast, long-enough burst), otherwise `null`.
 */
export function feedScan(state: ScanState, e: KeyEventLike, opts: ScanOptions = {}): string | null {
	// Modifier combos are shortcuts, never scans.
	if (e.ctrlKey || e.metaKey || e.altKey) {
		state.buffer = '';
		return null;
	}

	const minLength = opts.minLength ?? 3;
	const maxGap = opts.maxGap ?? 35;
	const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
	const gap = now - state.lastTime;
	state.lastTime = now;

	if (e.key === 'Enter') {
		const code = state.buffer.length >= minLength ? state.buffer : null;
		state.buffer = '';
		return code;
	}

	// Non-printing keys (Esc, arrows, Tab, F-keys…) break any in-progress burst.
	if (e.key.length !== 1) {
		state.buffer = '';
		return null;
	}

	if (state.buffer === '' || gap <= maxGap) {
		state.buffer += e.key;
	} else {
		// Too slow → treat this key as the start of a new burst.
		state.buffer = e.key;
	}
	return null;
}

/**
 * Attach a capture-phase keydown listener that calls `onScan(code)` whenever a
 * barcode is detected. Mid-burst keys are prevented from typing into whatever
 * input currently has focus (the first key may still land — clear the field on
 * scan if relevant). Returns a cleanup function.
 */
export function startBarcodeScanner(
	onScan: (code: string) => void,
	opts: ScanOptions & { enabled?: () => boolean } = {}
): () => void {
	const state = createScanState();
	const handler = (e: KeyboardEvent) => {
		if (opts.enabled && !opts.enabled()) {
			state.buffer = '';
			return;
		}
		const code = feedScan(state, e, opts);
		if (code !== null) {
			e.preventDefault();
			onScan(code);
		} else if (state.buffer.length > 1) {
			// Mid-burst: stop the digits from typing into a focused input.
			e.preventDefault();
		}
	};
	window.addEventListener('keydown', handler, true); // capture
	return () => window.removeEventListener('keydown', handler, true);
}
