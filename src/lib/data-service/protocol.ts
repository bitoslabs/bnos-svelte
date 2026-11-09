/**
 * BNOS data service protocol v1 — client-side contract.
 *
 * The service is optional and never required for checkout. Everything here is
 * pure so it can be unit-tested without a browser, network, or signer.
 */
import type { EventTemplate } from 'nostr-tools/pure';

export const DATA_SERVICE_PROTOCOL_VERSION = 1;

/** NIP-98 HTTP auth event kind, reused for the signed service challenge. */
export const DATA_SERVICE_AUTH_KIND = 27235;

export const DATA_SERVICE_PATHS = {
	capabilities: 'v1/capabilities',
	challenge: 'v1/auth/challenge',
	verify: 'v1/auth/verify',
	refresh: 'v1/auth/refresh',
	logout: 'v1/auth/logout',
	events: 'v1/events',
	status: 'v1/status'
} as const;

export type DataServiceErrorCode =
	| 'invalid-url'
	| 'insecure-url'
	| 'invalid-response'
	| 'incompatible'
	| 'challenge-expired'
	| 'network'
	| 'timeout'
	| 'redirect'
	| 'http'
	| 'unauthorized'
	| 'forbidden'
	| 'workspace-mismatch'
	| 'no-workspace'
	| 'not-signed-in'
	| 'cloud-unavailable'
	| 'queue-full'
	| 'queue-unavailable'
	| 'rejected'
	| 'unknown';

export class DataServiceError extends Error {
	readonly code: DataServiceErrorCode;
	readonly status: number | undefined;

	constructor(code: DataServiceErrorCode, message: string, status?: number) {
		super(message);
		this.name = 'DataServiceError';
		this.code = code;
		this.status = status;
	}
}

export interface DataServiceCapabilities {
	protocol: number;
	service: { id: string; name: string };
	auth: { challenge: 'nostr-event'; kind: number; audience: string };
	capabilities: {
		backup: boolean;
		status: boolean;
		reporting: boolean;
		restoreStatus: boolean;
	};
}

export interface DataServiceChallenge {
	challengeId: string;
	nonce: string;
	audience: string;
	expiresAt: number;
	serviceId: string | null;
	kind: number;
}

export interface DataServiceSession {
	token: string;
	expiresAt: number;
	user: { pubkey: string };
	workspace: { id: string; name: string };
	permissions: string[];
	refreshToken?: string;
	refreshExpiresAt?: number;
}

export type BackupState = 'unknown' | 'current' | 'stale' | 'failed';

export interface DataServiceBackupStatus {
	lastBackupAt: number | null;
	lastVerifiedRestoreAt: number | null;
	state: BackupState;
}

export interface DataServiceStatus {
	workspace: { id: string; name: string } | null;
	serverTime: number | null;
	backup: DataServiceBackupStatus;
}

export interface DataServiceIngestResult {
	accepted: string[];
	duplicates: string[];
	rejected: { id: string; reason: string }[];
}

export interface ServiceEvent {
	id: string;
	[k: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
	if (!isRecord(value)) {
		throw new DataServiceError('invalid-response', `${label} must be an object`);
	}
	return value;
}

function asString(value: unknown, label: string): string {
	if (typeof value !== 'string' || !value.trim()) {
		throw new DataServiceError('invalid-response', `${label} must be a non-empty string`);
	}
	return value;
}

function asNumber(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new DataServiceError('invalid-response', `${label} must be a number`);
	}
	return value;
}

function asStringArray(value: unknown, label: string): string[] {
	if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
		throw new DataServiceError('invalid-response', `${label} must be a string array`);
	}
	return value as string[];
}

function asBoolean(value: unknown): boolean {
	return value === true;
}

/** Loopback hosts may use plain HTTP during development. */
export function isLoopbackHost(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
	return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0';
}

/**
 * Validate and canonicalise a self-hosted service URL.
 *
 * - HTTPS is required for remote hosts; HTTP is accepted only on loopback.
 * - Credentials, query strings and fragments are rejected so secrets never end
 *   up in URLs, logs, or relay events.
 * - A path prefix is preserved (e.g. https://host/bnos).
 */
export function normalizeServiceUrl(input: string): string {
	const trimmed = input.trim();
	if (!trimmed) throw new DataServiceError('invalid-url', 'Enter a service URL');

	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		throw new DataServiceError('invalid-url', 'Enter a valid service URL');
	}

	if (url.protocol !== 'https:' && url.protocol !== 'http:') {
		throw new DataServiceError('invalid-url', 'The service URL must use HTTPS');
	}
	if (url.username || url.password) {
		throw new DataServiceError('invalid-url', 'The service URL must not contain credentials');
	}
	if (url.search || url.hash) {
		throw new DataServiceError(
			'invalid-url',
			'The service URL must not contain a query or fragment'
		);
	}
	if (url.protocol === 'http:' && !isLoopbackHost(url.hostname)) {
		throw new DataServiceError(
			'insecure-url',
			'Use HTTPS for remote services. HTTP is allowed only on localhost'
		);
	}

	const path = url.pathname.replace(/\/+$/, '');
	return `${url.protocol}//${url.host}${path}`;
}

/** Resolve a protocol path against the service base URL, preserving any prefix. */
export function serviceEndpoint(baseUrl: string, path: string): string {
	const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
	return new URL(path.replace(/^\/+/, ''), base).toString();
}

export function parseCapabilities(raw: unknown): DataServiceCapabilities {
	const root = asRecord(raw, 'Capabilities');
	const protocol = asNumber(root.protocol, 'protocol');
	if (protocol !== DATA_SERVICE_PROTOCOL_VERSION) {
		throw new DataServiceError(
			'incompatible',
			`Unsupported protocol version ${protocol}; this app supports ${DATA_SERVICE_PROTOCOL_VERSION}`
		);
	}

	const service = asRecord(root.service, 'service');
	const auth = asRecord(root.auth, 'auth');
	if (auth.challenge !== 'nostr-event') {
		throw new DataServiceError('incompatible', 'The service does not offer Nostr challenge auth');
	}
	const kind = auth.kind === undefined ? DATA_SERVICE_AUTH_KIND : asNumber(auth.kind, 'auth.kind');
	const caps = isRecord(root.capabilities) ? root.capabilities : {};

	return {
		protocol,
		service: {
			id: asString(service.id, 'service.id'),
			name: asString(service.name, 'service.name')
		},
		auth: {
			challenge: 'nostr-event',
			kind,
			audience: asString(auth.audience, 'auth.audience')
		},
		capabilities: {
			backup: asBoolean(caps.backup),
			status: asBoolean(caps.status),
			reporting: asBoolean(caps.reporting),
			restoreStatus: asBoolean(caps.restoreStatus)
		}
	};
}

export function parseChallenge(raw: unknown, now = Date.now()): DataServiceChallenge {
	const root = asRecord(raw, 'Challenge');
	const expiresAt = asNumber(root.expiresAt, 'expiresAt');
	if (expiresAt <= Math.floor(now / 1000)) {
		throw new DataServiceError('challenge-expired', 'The setup challenge expired');
	}
	return {
		challengeId: asString(root.challengeId, 'challengeId'),
		nonce: asString(root.nonce, 'nonce'),
		audience: asString(root.audience, 'audience'),
		expiresAt,
		serviceId: typeof root.serviceId === 'string' ? root.serviceId : null,
		kind: root.kind === undefined ? DATA_SERVICE_AUTH_KIND : asNumber(root.kind, 'kind')
	};
}

export function parseSession(
	raw: unknown,
	expected: { pubkey: string; workspaceId: string },
	now = Date.now()
): DataServiceSession {
	const root = asRecord(raw, 'Session');
	const token = asString(root.token, 'token');
	const expiresAt = asNumber(root.expiresAt, 'expiresAt');
	if (expiresAt <= Math.floor(now / 1000)) {
		throw new DataServiceError('unauthorized', 'The service session expired');
	}

	const user = asRecord(root.user, 'user');
	const pubkey = asString(user.pubkey, 'user.pubkey').toLowerCase();
	if (pubkey !== expected.pubkey.toLowerCase()) {
		throw new DataServiceError('unauthorized', 'The service authorized a different Nostr identity');
	}

	const workspace = asRecord(root.workspace, 'workspace');
	const workspaceId = asString(workspace.id, 'workspace.id');
	if (workspaceId !== expected.workspaceId) {
		throw new DataServiceError(
			'workspace-mismatch',
			'The service authorized a different workspace'
		);
	}

	const refreshToken =
		typeof root.refreshToken === 'string' && root.refreshToken ? root.refreshToken : undefined;
	const refreshExpiresAt =
		typeof root.refreshExpiresAt === 'number' && Number.isFinite(root.refreshExpiresAt)
			? root.refreshExpiresAt
			: undefined;

	return {
		token,
		expiresAt,
		user: { pubkey },
		workspace: { id: workspaceId, name: asString(workspace.name, 'workspace.name') },
		permissions: Array.isArray(root.permissions)
			? asStringArray(root.permissions, 'permissions')
			: [],
		...(refreshToken && refreshExpiresAt ? { refreshToken, refreshExpiresAt } : {})
	};
}

export function parseStatus(raw: unknown): DataServiceStatus {
	const root = asRecord(raw, 'Status');
	const workspace = isRecord(root.workspace) ? root.workspace : null;
	const connection = isRecord(root.connection) ? root.connection : {};
	const backup = isRecord(root.backup) ? root.backup : {};

	const state = backup.state;
	const backupState: BackupState =
		state === 'current' || state === 'stale' || state === 'failed' ? state : 'unknown';

	return {
		workspace:
			workspace && typeof workspace.id === 'string'
				? {
						id: workspace.id,
						name: typeof workspace.name === 'string' ? workspace.name : workspace.id
					}
				: null,
		serverTime:
			typeof connection.serverTime === 'number' && Number.isFinite(connection.serverTime)
				? connection.serverTime
				: null,
		backup: {
			lastBackupAt:
				typeof backup.lastBackupAt === 'number' && Number.isFinite(backup.lastBackupAt)
					? backup.lastBackupAt
					: null,
			lastVerifiedRestoreAt:
				typeof backup.lastVerifiedRestoreAt === 'number' &&
				Number.isFinite(backup.lastVerifiedRestoreAt)
					? backup.lastVerifiedRestoreAt
					: null,
			state: backupState
		}
	};
}

export function parseIngestResult(raw: unknown): DataServiceIngestResult {
	const root = asRecord(raw, 'Ingest result');
	const rejectedRaw = Array.isArray(root.rejected) ? root.rejected : [];
	const rejected = rejectedRaw.map((item) => {
		const entry = asRecord(item, 'rejected item');
		return {
			id: asString(entry.id, 'rejected.id'),
			reason: typeof entry.reason === 'string' ? entry.reason : 'rejected'
		};
	});

	return {
		accepted: Array.isArray(root.accepted) ? asStringArray(root.accepted, 'accepted') : [],
		duplicates: Array.isArray(root.duplicates) ? asStringArray(root.duplicates, 'duplicates') : [],
		rejected
	};
}

export function buildAuthEventTemplate(input: {
	baseUrl: string;
	challenge: DataServiceChallenge;
	workspaceId: string;
	now?: number;
}): EventTemplate {
	const { baseUrl, challenge, workspaceId, now = Date.now() } = input;
	return {
		kind: challenge.kind,
		created_at: Math.floor(now / 1000),
		tags: [
			['u', serviceEndpoint(baseUrl, DATA_SERVICE_PATHS.verify)],
			['method', 'POST'],
			['challenge', challenge.nonce],
			['audience', challenge.audience],
			['workspace', workspaceId]
		],
		content: ''
	};
}
