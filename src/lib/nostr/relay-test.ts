/**
 * Shared relay connectivity test. Used by the reusable <RelayManager /> and any
 * caller that needs to probe whether a Nostr relay is reachable. Opens a single
 * WebSocket, resolves on first `open`/`error`, and always cleans up the socket.
 */
export type RelayTestStatus = 'idle' | 'testing' | 'ok' | 'failed';

export interface RelayTestResult {
	status: RelayTestStatus;
	/** Round-trip latency in ms, only set on success. */
	ms?: number;
	/** Short human label describing the outcome. */
	message?: string;
}

export const RELAY_TEST_IDLE: RelayTestResult = { status: 'idle' };

/**
 * Probe a single relay URL. Resolves to `ok` when the socket connects within
 * `timeoutMs`, otherwise `failed` with a reason.
 */
export function testRelay(url: string, timeoutMs = 6000): Promise<RelayTestResult> {
	const startedAt = performance.now();
	let socket: WebSocket | null = null;
	let settled = false;

	const finish = (result: RelayTestResult): RelayTestResult => {
		if (settled) return result;
		settled = true;
		try {
			socket?.close();
		} catch {
			/* noop */
		}
		return result;
	};

	const timer = new Promise<RelayTestResult>((resolve) =>
		setTimeout(
			() => resolve(finish({ status: 'failed', message: 'Timeout' })),
			timeoutMs
		)
	);

	const connect = new Promise<RelayTestResult>((resolve) => {
		try {
			socket = new WebSocket(url);
			socket.onopen = () =>
				resolve(finish({ status: 'ok', ms: Math.round(performance.now() - startedAt) }));
			socket.onerror = () => resolve(finish({ status: 'failed', message: 'Failed' }));
		} catch {
			resolve(finish({ status: 'failed', message: 'Invalid' }));
		}
	});

	return Promise.race([connect, timer]);
}

/** Human label for a relay test state. */
export function relayTestLabel(state: RelayTestResult | undefined): string {
	if (!state || state.status === 'idle') return 'Not tested';
	if (state.status === 'testing') return 'Testing…';
	if (state.status === 'ok') return `${state.ms ?? 0} ms`;
	return state.message ?? 'Failed';
}
