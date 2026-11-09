/**
 * Non-secret connection metadata lives in localStorage (per workspace).
 * Bearer sessions live in sessionStorage only, so closing the tab drops them.
 * Neither is ever written to Nostr events, relay payloads, or backups.
 */
import type { DataServiceCapabilities } from './protocol';
import { parseQueue, serializeQueue, type ServiceQueue } from './queue';

const CONNECTION_PREFIX = 'bnos-os:data-service:connection:';
const SESSION_PREFIX = 'bnos-os:data-service:session:';
const QUEUE_PREFIX = 'bnos-os:data-service:queue:';

export interface ConnectionMetadata {
	version: 1;
	mode: 'selfHosted' | 'cloud';
	baseUrl: string;
	serviceId: string;
	serviceName: string;
	workspaceId: string;
	workspaceName: string;
	audience: string;
	connectedAt: number;
	lastSyncAt: number | null;
	capabilities: DataServiceCapabilities['capabilities'];
}

export interface StoredServiceSession {
	token: string;
	expiresAt: number;
	pubkey: string;
	workspaceId: string;
	refreshToken?: string;
	refreshExpiresAt?: number;
}

function local(): Storage | null {
	return typeof localStorage === 'undefined' ? null : localStorage;
}

function session(): Storage | null {
	return typeof sessionStorage === 'undefined' ? null : sessionStorage;
}

export function connectionKey(organizationId: string): string {
	return `${CONNECTION_PREFIX}${organizationId}`;
}

export function sessionKey(organizationId: string): string {
	return `${SESSION_PREFIX}${organizationId}`;
}

export function queueKey(organizationId: string): string {
	return `${QUEUE_PREFIX}${organizationId}`;
}

export function readConnection(
	organizationId: string,
	storage: Storage | null = local()
): ConnectionMetadata | null {
	if (!organizationId || !storage) return null;
	try {
		const raw = storage.getItem(connectionKey(organizationId));
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<ConnectionMetadata>;
		if (
			parsed.version !== 1 ||
			(parsed.mode !== 'selfHosted' && parsed.mode !== 'cloud') ||
			typeof parsed.baseUrl !== 'string' ||
			typeof parsed.serviceId !== 'string' ||
			typeof parsed.workspaceId !== 'string' ||
			parsed.workspaceId !== organizationId
		) {
			return null;
		}
		return {
			version: 1,
			mode: parsed.mode,
			baseUrl: parsed.baseUrl,
			serviceId: parsed.serviceId,
			serviceName: typeof parsed.serviceName === 'string' ? parsed.serviceName : parsed.serviceId,
			workspaceId: parsed.workspaceId,
			workspaceName:
				typeof parsed.workspaceName === 'string' ? parsed.workspaceName : parsed.workspaceId,
			audience: typeof parsed.audience === 'string' ? parsed.audience : '',
			connectedAt: typeof parsed.connectedAt === 'number' ? parsed.connectedAt : 0,
			lastSyncAt: typeof parsed.lastSyncAt === 'number' ? parsed.lastSyncAt : null,
			capabilities: {
				backup: parsed.capabilities?.backup === true,
				status: parsed.capabilities?.status === true,
				reporting: parsed.capabilities?.reporting === true,
				restoreStatus: parsed.capabilities?.restoreStatus === true
			}
		};
	} catch {
		return null;
	}
}

export function writeConnection(
	metadata: ConnectionMetadata,
	storage: Storage | null = local()
): void {
	if (!storage) return;
	storage.setItem(connectionKey(metadata.workspaceId), JSON.stringify(metadata));
}

export function clearConnection(organizationId: string, storage: Storage | null = local()): void {
	if (!organizationId || !storage) return;
	storage.removeItem(connectionKey(organizationId));
}

export function readSession(
	organizationId: string,
	storage: Storage | null = session()
): StoredServiceSession | null {
	if (!organizationId || !storage) return null;
	try {
		const raw = storage.getItem(sessionKey(organizationId));
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<StoredServiceSession>;
		if (
			typeof parsed.token !== 'string' ||
			!parsed.token ||
			typeof parsed.expiresAt !== 'number' ||
			typeof parsed.pubkey !== 'string' ||
			parsed.workspaceId !== organizationId
		) {
			return null;
		}
		const refreshToken =
			typeof parsed.refreshToken === 'string' && parsed.refreshToken
				? parsed.refreshToken
				: undefined;
		const refreshExpiresAt =
			typeof parsed.refreshExpiresAt === 'number' && Number.isFinite(parsed.refreshExpiresAt)
				? parsed.refreshExpiresAt
				: undefined;
		return {
			token: parsed.token,
			expiresAt: parsed.expiresAt,
			pubkey: parsed.pubkey,
			workspaceId: parsed.workspaceId,
			...(refreshToken && refreshExpiresAt ? { refreshToken, refreshExpiresAt } : {})
		};
	} catch {
		return null;
	}
}

export function writeSession(
	value: StoredServiceSession,
	storage: Storage | null = session()
): void {
	if (!storage) return;
	storage.setItem(sessionKey(value.workspaceId), JSON.stringify(value));
}

export function clearSession(organizationId: string, storage: Storage | null = session()): void {
	if (!organizationId || !storage) return;
	storage.removeItem(sessionKey(organizationId));
}

/** Remove every service session from this browser (logout / identity switch). */
export function clearAllSessions(storage: Storage | null = session()): void {
	if (!storage) return;
	const keys: string[] = [];
	for (let i = 0; i < storage.length; i++) {
		const key = storage.key(i);
		if (key?.startsWith(SESSION_PREFIX)) keys.push(key);
	}
	for (const key of keys) storage.removeItem(key);
}

export function readQueue(organizationId: string, storage: Storage | null = local()): ServiceQueue {
	if (!organizationId || !storage) throw new Error('Service queue storage is unavailable');
	return parseQueue(storage.getItem(queueKey(organizationId)));
}

export function writeQueue(
	organizationId: string,
	queue: ServiceQueue,
	storage: Storage | null = local()
): void {
	if (!organizationId || !storage) throw new Error('Service queue storage is unavailable');
	// Refuse to overwrite data that this version cannot safely read.
	parseQueue(storage.getItem(queueKey(organizationId)));
	if (!queue.items.length) {
		storage.removeItem(queueKey(organizationId));
		return;
	}
	storage.setItem(queueKey(organizationId), serializeQueue(queue));
}

export function clearQueue(organizationId: string, storage: Storage | null = local()): void {
	if (!organizationId || !storage) return;
	storage.removeItem(queueKey(organizationId));
}
