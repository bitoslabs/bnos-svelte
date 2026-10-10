/**
 * OBP HTTP transport binding (spec §8).
 *
 * Sending side: `HttpTransport` POSTs the canonical signed envelope as
 * JSON to the counterparty's `/obp/inbox` endpoint. Transport metadata
 * (HTTP status, headers) stays outside the signed payload. Confidential
 * documents require HTTPS unless `allowInsecureHttp` is explicitly set
 * for local pilots — fail closed otherwise.
 *
 * Receiving side: `handleObpInboxRequest` adapts a standard `Request`
 * (SvelteKit `+server.ts`, Node undici, workers) to a BusinessNode's
 * verification pipeline and answers with the business decision JSON,
 * carrying the `messageId` as the correlation id.
 */
import type { ObpTransport, ObpTransportResult } from './transport';
import type { BusinessNode } from './business-node';

export interface HttpTransportOptions {
	/** Counterparty inbox URL, e.g. `https://node.example.com/obp/inbox`. */
	endpoint: string;
	/** Fetch implementation (injectable for tests). */
	fetchImpl?: typeof fetch;
	timeoutMs?: number;
	/** Local pilots only: allow plain-HTTP confidential delivery. */
	allowInsecureHttp?: boolean;
}

export class HttpTransport implements ObpTransport {
	readonly kind = 'http';
	private readonly endpoint: string;
	private readonly fetchImpl: typeof fetch;
	private readonly timeoutMs: number;
	private readonly allowInsecureHttp: boolean;

	constructor(opts: HttpTransportOptions) {
		this.endpoint = opts.endpoint;
		this.fetchImpl = opts.fetchImpl ?? fetch;
		this.timeoutMs = opts.timeoutMs ?? 10_000;
		this.allowInsecureHttp = opts.allowInsecureHttp ?? false;
	}

	get canEncrypt(): boolean {
		return this.endpoint.startsWith('https://') || this.allowInsecureHttp;
	}

	async deliver(
		envelope: unknown,
		opts: { confidential: boolean; recipient: string }
	): Promise<ObpTransportResult> {
		if (opts.confidential && !this.canEncrypt) {
			return { ok: false, error: 'encryption-unavailable', retryable: false };
		}
		try {
			const response = await this.fetchImpl(this.endpoint, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'x-obp-recipient': opts.recipient
				},
				body: JSON.stringify(envelope),
				signal: AbortSignal.timeout(this.timeoutMs)
			});
			if (response.ok) {
				return { ok: true, transportId: response.headers.get('x-obp-transport-id') ?? undefined };
			}
			const retryable = response.status === 429 || response.status >= 500;
			return { ok: false, error: `http-${response.status}`, retryable };
		} catch (err) {
			return {
				ok: false,
				error: err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'network',
				retryable: true
			};
		}
	}
}

/** JSON shape answered by `handleObpInboxRequest`. */
export interface ObpInboxResponse {
	correlationId: string;
	decision: 'accepted' | 'rejected';
	duplicate: boolean;
	error?: { code: string; message: string };
}

/**
 * Adapt an HTTP request to the node's inbound pipeline. Malformed bodies
 * answer 400; verified messages answer 200 with the business decision —
 * transport acceptance (HTTP 200) is explicitly NOT business acceptance;
 * read the `decision` field.
 */
export async function handleObpInboxRequest(
	node: BusinessNode,
	request: Request
): Promise<Response> {
	let envelope: unknown;
	try {
		envelope = await request.json();
	} catch {
		return Response.json({ error: 'invalid-json' }, { status: 400 });
	}
	if (typeof envelope !== 'object' || envelope === null) {
		return Response.json({ error: 'invalid-envelope' }, { status: 400 });
	}

	const result = await node.receive(envelope);
	const body: ObpInboxResponse = {
		correlationId: (envelope as { messageId?: string }).messageId ?? '',
		decision: result.decision,
		duplicate: result.duplicate,
		error: result.error
	};
	return Response.json(body, { status: 200 });
}
