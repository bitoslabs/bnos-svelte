import {
	BITOS_PAY_PATHS,
	BitosPayError,
	buildChallengeTemplate,
	normalizePayUrl,
	paySubject,
	type PayChallenge,
	type PayEntitlement,
	type PayEventTemplate,
	type PayWorkspaceSync
} from './protocol';

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_CHARS = 1_000_000;

export interface PaySigner {
	signEvent(template: PayEventTemplate): Promise<{
		id: string;
		pubkey: string;
		created_at: number;
		kind: number;
		tags: string[][];
		content: string;
		sig: string;
	}>;
}

export type PayFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

async function readJson<T>(response: Response): Promise<T> {
	const text = await response.text();
	if (text.length > MAX_RESPONSE_CHARS) {
		throw new BitosPayError('invalid-response', 'BitOS Pay response is too large');
	}
	let parsed: unknown;
	try {
		parsed = text ? JSON.parse(text) : null;
	} catch {
		throw new BitosPayError('invalid-response', 'BitOS Pay returned invalid JSON', response.status);
	}
	if (!response.ok) {
		const error = (parsed as { error?: { code?: string; message?: string } } | null)?.error;
		throw new BitosPayError(
			error?.code ?? 'http',
			error?.message ?? `BitOS Pay request failed (${response.status})`,
			response.status
		);
	}
	return parsed as T;
}

async function request<T>(
	url: string,
	init: RequestInit,
	fetchImpl: PayFetch,
	signal?: AbortSignal
): Promise<T> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
	const abort = () => controller.abort();
	signal?.addEventListener('abort', abort);
	try {
		const response = await fetchImpl(url, {
			...init,
			redirect: 'error',
			credentials: 'omit',
			signal: controller.signal,
			headers: { accept: 'application/json', ...(init.headers ?? {}) }
		});
		return await readJson<T>(response);
	} catch (error) {
		if (error instanceof BitosPayError) throw error;
		throw new BitosPayError(
			'network',
			error instanceof Error ? error.message : 'BitOS Pay is unreachable'
		);
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener('abort', abort);
	}
}

export async function syncBitosPayWorkspace(input: {
	baseUrl: string;
	workspaceId: string;
	workspaceName: string;
	merchantName: string;
	country?: string;
	signer: PaySigner;
	existingApiKey?: string | null;
	fetchImpl?: PayFetch;
	signal?: AbortSignal;
}): Promise<{ sync: PayWorkspaceSync; apiKey: string | null }> {
	const baseUrl = normalizePayUrl(input.baseUrl);
	const fetchImpl = input.fetchImpl ?? fetch;
	const challenge = await request<PayChallenge>(
		`${baseUrl}/${BITOS_PAY_PATHS.challenge}`,
		{ method: 'POST' },
		fetchImpl,
		input.signal
	);
	const event = await input.signer.signEvent(
		buildChallengeTemplate({
			challenge: challenge.challenge,
			origin: challenge.origin,
			workspaceId: input.workspaceId
		})
	);
	const sync = await request<PayWorkspaceSync>(
		`${baseUrl}/${BITOS_PAY_PATHS.bnosSync}`,
		{
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				workspace_id: input.workspaceId,
				workspace_name: input.workspaceName,
				merchant_name: input.merchantName,
				country: input.country,
				event
			})
		},
		fetchImpl,
		input.signal
	);
	if (sync.subject_ref !== paySubject(input.workspaceId)) {
		throw new BitosPayError('invalid-response', 'BitOS Pay returned a different workspace');
	}
	return {
		sync,
		apiKey: sync.api_key ?? input.existingApiKey ?? null
	};
}

export async function loadBitosPayEntitlement(input: {
	baseUrl: string;
	apiKey: string;
	fetchImpl?: PayFetch;
	signal?: AbortSignal;
}): Promise<PayEntitlement> {
	const baseUrl = normalizePayUrl(input.baseUrl);
	return request<PayEntitlement>(
		`${baseUrl}/${BITOS_PAY_PATHS.entitlement}`,
		{ method: 'GET', headers: { authorization: `Bearer ${input.apiKey}` } },
		input.fetchImpl ?? fetch,
		input.signal
	);
}
