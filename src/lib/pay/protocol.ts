/**
 * BitOS Pay workspace-link protocol.
 *
 * BNOS is local-first: the Pay service cannot read a workspace from a relay and
 * trust it. The workspace owner signs a one-time challenge binding the BNOS
 * organization id, and Pay maps it to `subject_ref = bnos:<organizationId>`.
 */

export const BITOS_PAY_PROTOCOL_VERSION = 1;

export const BITOS_PAY_PATHS = {
	challenge: 'v1/onboarding/nostr/challenge',
	bnosSync: 'v1/onboarding/bnos',
	entitlement: 'v1/entitlements/current'
} as const;

export class BitosPayError extends Error {
	readonly code: string;
	readonly status: number | undefined;

	constructor(code: string, message: string, status?: number) {
		super(message);
		this.name = 'BitosPayError';
		this.code = code;
		this.status = status;
	}
}

export interface PayConnection {
	version: number;
	baseUrl: string;
	workspaceId: string;
	workspaceName: string;
	merchantId: string;
	subjectRef: string;
	consoleUrl: string;
	apiKey: string | null;
	connectedAt: number;
	syncedAt: number;
}

export interface PayChallenge {
	challenge: string;
	origin: string;
	expires_at: string;
}

export interface PayWorkspaceSync {
	object: 'bnos_workspace_sync';
	organization_id: string;
	merchant_id: string;
	provider_connection_id: string | null;
	api_key: string | null;
	api_key_id: string | null;
	owner_pubkey: string;
	subject_ref: string;
	created: boolean;
	livemode: boolean;
	console_url: string;
	verification: 'owner_key_only';
	warning: string;
	request_id?: string;
}

export interface PayEntitlement {
	object: 'entitlement';
	organization_id: string;
	plan: string | null;
	features: string[];
	limits: Record<string, number | boolean | string>;
	status: string;
	valid_from?: string | null;
	valid_until?: string | null;
	revision: number;
	source?: string;
}

export interface PayEventTemplate {
	kind: number;
	created_at: number;
	tags: string[][];
	content: string;
}

export function normalizePayUrl(raw: string): string {
	const value = raw.trim();
	if (!value) throw new BitosPayError('missing-url', 'BitOS Pay URL is not configured');
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new BitosPayError('invalid-url', 'BitOS Pay URL is invalid');
	}
	if (url.username || url.password || url.search || url.hash) {
		throw new BitosPayError('invalid-url', 'BitOS Pay URL must not contain credentials or a query');
	}
	if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname))) {
		throw new BitosPayError('insecure-url', 'BitOS Pay must use HTTPS or loopback HTTP');
	}
	return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

export function isLoopback(hostname: string): boolean {
	return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

export function paySubject(workspaceId: string): string {
	return `bnos:${workspaceId}`;
}

export function buildChallengeTemplate(input: {
	challenge: string;
	origin: string;
	workspaceId: string;
	now?: number;
}): PayEventTemplate {
	return {
		kind: 22242,
		created_at: input.now ?? Math.floor(Date.now() / 1000),
		tags: [
			['relay', input.origin],
			['challenge', input.challenge],
			['subject', paySubject(input.workspaceId)]
		],
		content: ''
	};
}

export function parsePayConnection(value: unknown): PayConnection | null {
	if (!value || typeof value !== 'object') return null;
	const record = value as Record<string, unknown>;
	if (
		record.version !== BITOS_PAY_PROTOCOL_VERSION ||
		typeof record.baseUrl !== 'string' ||
		typeof record.workspaceId !== 'string' ||
		typeof record.workspaceName !== 'string' ||
		typeof record.merchantId !== 'string' ||
		typeof record.subjectRef !== 'string' ||
		typeof record.consoleUrl !== 'string' ||
		typeof record.connectedAt !== 'number' ||
		typeof record.syncedAt !== 'number'
	) {
		return null;
	}
	if (record.apiKey !== null && typeof record.apiKey !== 'string') return null;
	return {
		version: BITOS_PAY_PROTOCOL_VERSION,
		baseUrl: record.baseUrl,
		workspaceId: record.workspaceId,
		workspaceName: record.workspaceName,
		merchantId: record.merchantId,
		subjectRef: record.subjectRef,
		consoleUrl: record.consoleUrl,
		apiKey: record.apiKey,
		connectedAt: record.connectedAt,
		syncedAt: record.syncedAt
	};
}
