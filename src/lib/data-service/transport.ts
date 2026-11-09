/**
 * Minimal JSON transport for the data service.
 *
 * Requests never follow redirects, never send cookies, and never put
 * credentials in a URL. Every failure becomes a typed `DataServiceError` so the
 * UI can distinguish offline, incompatible, and permission states.
 */
import { DataServiceError } from './protocol';

const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_CHARS = 1_000_000;

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface JsonRequestOptions {
	url: string;
	method?: 'GET' | 'POST';
	body?: unknown;
	token?: string;
	timeoutMs?: number;
	signal?: AbortSignal;
	fetchImpl?: FetchLike;
}

async function readError(response: Response): Promise<string> {
	try {
		const text = await response.text();
		if (!text) return '';
		try {
			const parsed = JSON.parse(text) as unknown;
			if (parsed && typeof parsed === 'object') {
				const record = parsed as Record<string, unknown>;
				const error = record.error;
				if (error && typeof error === 'object') {
					const message = (error as Record<string, unknown>).message;
					if (typeof message === 'string' && message.trim()) return message.trim();
				}
				if (typeof record.message === 'string' && record.message.trim())
					return record.message.trim();
			}
		} catch {
			return text.slice(0, 200);
		}
	} catch {
		/* ignore */
	}
	return '';
}

function errorForStatus(status: number, message: string): DataServiceError {
	const suffix = message || `Request failed (${status})`;
	if (status === 401) return new DataServiceError('unauthorized', suffix, status);
	if (status === 403) return new DataServiceError('forbidden', suffix, status);
	return new DataServiceError('http', suffix, status);
}

export async function requestJson<T>(options: JsonRequestOptions): Promise<T> {
	const {
		url,
		method = 'GET',
		body,
		token,
		timeoutMs = DEFAULT_TIMEOUT_MS,
		signal,
		fetchImpl = fetch
	} = options;

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	const onAbort = () => controller.abort();
	signal?.addEventListener('abort', onAbort);

	const headers: Record<string, string> = { accept: 'application/json' };
	if (body !== undefined) headers['content-type'] = 'application/json';
	if (token) headers.authorization = `Bearer ${token}`;

	let response: Response;
	try {
		response = await fetchImpl(url, {
			method,
			headers,
			body: body === undefined ? undefined : JSON.stringify(body),
			signal: controller.signal,
			credentials: 'omit',
			cache: 'no-store',
			redirect: 'manual'
		});
	} catch (error) {
		if (controller.signal.aborted) {
			throw new DataServiceError('timeout', 'The service did not respond in time');
		}
		throw new DataServiceError(
			'network',
			error instanceof Error ? error.message : 'The service is unreachable'
		);
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener('abort', onAbort);
	}

	if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
		throw new DataServiceError('redirect', 'The service returned a redirect, which is not allowed');
	}

	if (!response.ok) {
		throw errorForStatus(response.status, await readError(response));
	}

	const text = await response.text();
	if (text.length > MAX_RESPONSE_CHARS) {
		throw new DataServiceError('invalid-response', 'The service response is too large');
	}
	if (!text.trim()) return undefined as T;

	const contentType = response.headers.get('content-type') ?? '';
	if (contentType && !contentType.toLowerCase().includes('application/json')) {
		throw new DataServiceError('invalid-response', 'The service did not return JSON');
	}

	try {
		return JSON.parse(text) as T;
	} catch {
		throw new DataServiceError('invalid-response', 'The service returned invalid JSON');
	}
}
