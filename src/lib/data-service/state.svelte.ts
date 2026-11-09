/**
 * Data service connection orchestration.
 *
 * This is a rune singleton: it owns the connection state machine, the signed
 * challenge flow, and the independent upload queue. Checkout, local reads and
 * relay sync never await this module; `recordEvent` is synchronous and
 * best-effort, and network work happens in the background.
 */
import { browser } from '$app/environment';
import { env } from '$env/dynamic/public';
import { SvelteURLSearchParams } from 'svelte/reactivity';
import { session } from '$nostr/session.svelte';
import { tenant } from '$nostr/tenant.svelte';
import {
	DATA_SERVICE_PATHS,
	DataServiceError,
	buildAuthEventTemplate,
	normalizeServiceUrl,
	parseCapabilities,
	parseChallenge,
	parseIngestResult,
	parseReportSummary,
	parseSession,
	parseStatus,
	serviceEndpoint,
	type DataServiceBackupStatus,
	type DataServiceCapabilities,
	type DataServiceErrorCode,
	type DataServiceIngestResult,
	type DataServiceStatus,
	type ServiceEvent,
	type ServiceReportSummary
} from './protocol';
import { requestJson } from './transport';
import {
	acknowledgeEvents,
	applyIngestResult,
	encryptedUploadBatch,
	enqueueEvent,
	eventTagValue,
	markAttempts,
	MAX_QUEUE_ITEMS,
	type ServiceQueue
} from './queue';
import {
	clearAllSessions,
	clearConnection,
	clearSession,
	readConnection,
	readQueue,
	readSession,
	readSnapshotQueue,
	writeConnection,
	writeQueue,
	writeSession,
	writeSnapshotQueue,
	type ConnectionMetadata,
	type StoredServiceSession
} from './storage';
import {
	REPORT_SNAPSHOT_KIND,
	type ReportGranularity,
	type ReportSnapshot
} from '$lib/domain/report-snapshot';

/**
 * bdGo Cloud endpoint from the deployment's public configuration. Never
 * hardcoded: when unset (or invalid) the Cloud option stays unavailable.
 */
export const cloudServiceUrl: string | null = (() => {
	const raw = env.PUBLIC_DATA_SERVICE_CLOUD_URL?.trim();
	if (!raw) return null;
	try {
		return normalizeServiceUrl(raw);
	} catch {
		return null;
	}
})();

export type DataServiceConnectionState =
	| 'disconnected'
	| 'connecting'
	| 'connected'
	| 'offline'
	| 'auth-required'
	| 'permission-denied'
	| 'incompatible'
	| 'error';

export interface ConnectInput {
	mode: 'selfHosted' | 'cloud';
	url: string;
	setupCode: string;
}

function asDataServiceError(error: unknown): DataServiceError {
	if (error instanceof DataServiceError) return error;
	const message = error instanceof Error ? error.message : 'The data service request failed';
	return new DataServiceError('unknown', message);
}

function stateForError(error: DataServiceError): DataServiceConnectionState {
	switch (error.code) {
		case 'unauthorized':
		case 'challenge-expired':
			return 'auth-required';
		case 'forbidden':
			return 'permission-denied';
		case 'incompatible':
			return 'incompatible';
		case 'network':
		case 'timeout':
			return 'offline';
		default:
			return 'error';
	}
}

class DataServiceStore {
	metadata = $state<ConnectionMetadata | null>(null);
	sessionInfo = $state<StoredServiceSession | null>(null);
	status = $state<DataServiceConnectionState>('disconnected');
	lastError = $state<string | null>(null);
	lastErrorCode = $state<DataServiceErrorCode | null>(null);
	queueSize = $state<number | null>(0);
	snapshotQueueSize = $state<number | null>(0);
	lastSyncAt = $state<number | null>(null);
	lastRejected = $state<DataServiceIngestResult['rejected']>([]);
	statusReport = $state<DataServiceStatus | null>(null);
	connecting = $state(false);
	draining = $state(false);
	testing = $state(false);

	private organizationId = '';
	private contextKey = '';
	private initialized = false;
	private drainTimer: ReturnType<typeof setTimeout> | null = null;
	private drainPromise: Promise<void> | null = null;
	private snapshotDrainPromise: Promise<void> | null = null;
	private refreshPromise: Promise<StoredServiceSession | null> | null = null;
	/** Short-lived cache for service-computed period summaries. */
	private summaryCache = new Map<string, { at: number; value: ServiceReportSummary }>();

	private readQueueOrFail(organizationId: string): ServiceQueue | null {
		try {
			return readQueue(organizationId);
		} catch {
			this.lastErrorCode = 'queue-unavailable';
			this.lastError =
				'The local data service queue is unreadable or unavailable; existing events were preserved';
			return null;
		}
	}

	private readSnapshotQueueOrFail(organizationId: string): ServiceQueue | null {
		try {
			return readSnapshotQueue(organizationId);
		} catch {
			this.lastErrorCode = 'queue-unavailable';
			this.lastError =
				'The local snapshot queue is unreadable or unavailable; existing snapshots were preserved';
			return null;
		}
	}

	get configured(): boolean {
		return this.metadata !== null;
	}

	get backup(): DataServiceBackupStatus | null {
		return this.statusReport?.backup ?? null;
	}

	/** Install listeners and hydrate the active workspace. Safe to call twice. */
	load(): void {
		if (!browser || this.initialized) return;
		this.initialized = true;

		window.addEventListener('online', () => {
			if (!this.metadata) return;
			this.status = 'connected';
			void this.drain();
			void this.refreshStatus();
		});
		window.addEventListener('offline', () => {
			if (this.metadata) this.status = 'offline';
		});

		this.syncContext(tenant.state.organizationId, session.pubkey ?? '');
	}

	/**
	 * Reload state when the tenant, identity, or token-bearing workspace changes.
	 * Tokens are never allowed to cross workspaces or identities.
	 */
	syncContext(organizationId: string, pubkey: string): void {
		if (!browser) return;
		const key = `${organizationId}:${pubkey}`;
		if (this.contextKey === key) return;
		this.summaryCache.clear();

		if (this.organizationId && this.organizationId !== organizationId) {
			// Switching workspaces drops the previous workspace's browser session.
			clearSession(this.organizationId);
			this.sessionInfo = null;
		}

		this.contextKey = key;
		this.organizationId = organizationId;

		if (!organizationId) {
			this.metadata = null;
			this.sessionInfo = null;
			this.status = 'disconnected';
			this.statusReport = null;
			this.queueSize = 0;
			this.snapshotQueueSize = 0;
			return;
		}

		this.metadata = readConnection(organizationId);
		this.queueSize = this.readQueueOrFail(organizationId)?.items.length ?? null;
		this.snapshotQueueSize = this.readSnapshotQueueOrFail(organizationId)?.items.length ?? null;
		this.lastSyncAt = this.metadata?.lastSyncAt ?? null;
		this.statusReport = null;
		this.lastRejected = [];

		if (!this.metadata) {
			this.sessionInfo = null;
			this.status = 'disconnected';
			return;
		}

		const stored = readSession(organizationId);
		const now = Math.floor(Date.now() / 1000);
		const identityMatches =
			stored && pubkey && stored.pubkey.toLowerCase() === pubkey.toLowerCase();

		if (identityMatches && stored.expiresAt > now) {
			this.sessionInfo = stored;
			this.status = navigator.onLine ? 'connected' : 'offline';
			void this.refreshStatus();
			void this.drain();
			return;
		}

		if (identityMatches && this.hasRefresh(stored)) {
			this.sessionInfo = stored;
			this.status = 'connecting';
			void this.refreshAndResume(stored);
			return;
		}

		if (stored) clearSession(organizationId);
		this.sessionInfo = null;
		this.status = pubkey ? 'auth-required' : 'disconnected';
	}

	/** Exchange a one-time setup code for a short-lived user session. */
	async connect(input: ConnectInput): Promise<void> {
		if (!browser) throw new DataServiceError('network', 'The data service is client-only');
		const workspaceId = tenant.state.organizationId;
		if (!workspaceId) {
			throw new DataServiceError('no-workspace', 'Select a workspace before connecting');
		}
		const pubkey = session.pubkey;
		if (!pubkey) {
			throw new DataServiceError('not-signed-in', 'Sign in before connecting a data service');
		}
		const setupCode = input.setupCode.trim();
		if (!setupCode) {
			throw new DataServiceError('invalid-url', 'Enter the one-time setup code');
		}

		const baseUrl = input.mode === 'cloud' ? cloudServiceUrl : normalizeServiceUrl(input.url);
		if (!baseUrl) {
			throw new DataServiceError(
				'cloud-unavailable',
				'bdGo Cloud is not configured for this deployment'
			);
		}
		this.status = 'connecting';
		this.connecting = true;
		this.lastError = null;
		this.lastErrorCode = null;

		try {
			const capabilities = await this.fetchCapabilities(baseUrl);
			const challenge = await this.requestChallenge(baseUrl, setupCode, pubkey, workspaceId);
			if (challenge.serviceId && challenge.serviceId !== capabilities.service.id) {
				throw new DataServiceError(
					'incompatible',
					'The challenge came from a different service than the advertised identity'
				);
			}

			const template = buildAuthEventTemplate({ baseUrl, challenge, workspaceId });
			let signed;
			try {
				signed = await session.signEvent(template);
			} catch {
				throw new DataServiceError('not-signed-in', 'Could not sign the service challenge');
			}

			const raw = await requestJson({
				url: serviceEndpoint(baseUrl, DATA_SERVICE_PATHS.verify),
				method: 'POST',
				body: { challengeId: challenge.challengeId, event: signed }
			});
			const verified = parseSession(raw, { pubkey, workspaceId });

			const metadata: ConnectionMetadata = {
				version: 1,
				mode: input.mode,
				baseUrl,
				serviceId: capabilities.service.id,
				serviceName: capabilities.service.name,
				workspaceId,
				workspaceName: verified.workspace.name,
				audience: challenge.audience,
				connectedAt: Date.now(),
				lastSyncAt: readConnection(workspaceId)?.lastSyncAt ?? null,
				capabilities: capabilities.capabilities
			};
			const stored: StoredServiceSession = {
				token: verified.token,
				expiresAt: verified.expiresAt,
				pubkey: verified.user.pubkey,
				workspaceId,
				...(verified.refreshToken && verified.refreshExpiresAt
					? {
							refreshToken: verified.refreshToken,
							refreshExpiresAt: verified.refreshExpiresAt
						}
					: {})
			};

			writeConnection(metadata);
			// Tokens are per-tab only and scoped to this workspace.
			writeSession(stored);

			this.organizationId = workspaceId;
			this.contextKey = `${workspaceId}:${pubkey}`;
			this.metadata = metadata;
			this.sessionInfo = stored;
			this.lastSyncAt = metadata.lastSyncAt;
			this.queueSize = this.readQueueOrFail(workspaceId)?.items.length ?? null;
			this.snapshotQueueSize = this.readSnapshotQueueOrFail(workspaceId)?.items.length ?? null;
			this.status = 'connected';

			void this.refreshStatus();
			void this.drain();
		} catch (error) {
			const failure = asDataServiceError(error);
			this.lastError = failure.message;
			this.lastErrorCode = failure.code;
			this.status = stateForError(failure);
			throw failure;
		} finally {
			this.connecting = false;
		}
	}

	/** Stop uploads and remove the browser session. Queued events stay local. */
	async disconnect(): Promise<void> {
		const metadata = this.metadata;
		const token = this.sessionInfo?.token;
		const refreshToken = this.sessionInfo?.refreshToken;
		if (metadata && (token || refreshToken)) {
			try {
				await requestJson({
					url: serviceEndpoint(metadata.baseUrl, DATA_SERVICE_PATHS.logout),
					method: 'POST',
					token,
					body: refreshToken ? { refreshToken } : undefined,
					timeoutMs: 3_000
				});
			} catch {
				/* best effort: local cleanup still happens */
			}
		}

		if (this.organizationId) {
			clearConnection(this.organizationId);
			clearSession(this.organizationId);
		}
		this.metadata = null;
		this.sessionInfo = null;
		this.statusReport = null;
		this.lastRejected = [];
		this.status = 'disconnected';
		this.lastError = null;
		this.lastErrorCode = null;
		this.snapshotQueueSize = 0;
	}

	/** Logout / identity switch: drop every browser session for the service. */
	signOutCleanup(): void {
		clearAllSessions();
		this.summaryCache.clear();
		this.sessionInfo = null;
		this.metadata = null;
		this.statusReport = null;
		this.lastRejected = [];
		this.status = 'disconnected';
		this.queueSize = 0;
		this.snapshotQueueSize = 0;
		this.lastSyncAt = null;
		this.organizationId = '';
		this.contextKey = '';
		if (this.drainTimer !== null) {
			clearTimeout(this.drainTimer);
			this.drainTimer = null;
		}
	}

	/** Validate compatibility and (when connected) authorization. */
	async testConnection(): Promise<void> {
		const metadata = this.metadata;
		if (!metadata) {
			throw new DataServiceError('no-workspace', 'No data service is connected');
		}
		this.testing = true;
		this.lastError = null;
		this.lastErrorCode = null;
		try {
			const capabilities = await this.fetchCapabilities(metadata.baseUrl);
			if (capabilities.service.id !== metadata.serviceId) {
				throw new DataServiceError(
					'incompatible',
					'The service identity changed since this workspace connected'
				);
			}
			await this.refreshStatus();
			if (this.status === 'offline') {
				throw new DataServiceError('network', 'The service is unreachable');
			}
			if (this.status === 'auth-required' || this.status === 'permission-denied') {
				throw new DataServiceError(
					this.status === 'auth-required' ? 'unauthorized' : 'forbidden',
					'The service session is no longer authorized'
				);
			}
		} catch (error) {
			const failure = asDataServiceError(error);
			this.lastError = failure.message;
			this.lastErrorCode = failure.code;
			throw failure;
		} finally {
			this.testing = false;
		}
	}

	private hasRefresh(stored: StoredServiceSession): boolean {
		return Boolean(
			stored.refreshToken &&
			stored.refreshExpiresAt &&
			stored.refreshExpiresAt > Math.floor(Date.now() / 1000)
		);
	}

	/** Rotate nothing: exchange the long-lived reconnect credential for a new access session. */
	private async refreshAccessToken(
		metadata: ConnectionMetadata,
		stored: StoredServiceSession
	): Promise<StoredServiceSession | null> {
		const refreshToken = stored.refreshToken;
		if (!refreshToken || !this.hasRefresh(stored)) return null;
		if (this.refreshPromise) return this.refreshPromise;
		this.refreshPromise = (async () => {
			try {
				const raw = await requestJson({
					url: serviceEndpoint(metadata.baseUrl, DATA_SERVICE_PATHS.refresh),
					method: 'POST',
					body: { refreshToken },
					timeoutMs: 10_000
				});
				const verified = parseSession(raw, {
					pubkey: stored.pubkey,
					workspaceId: metadata.workspaceId
				});
				const next: StoredServiceSession = {
					token: verified.token,
					expiresAt: verified.expiresAt,
					pubkey: verified.user.pubkey,
					workspaceId: metadata.workspaceId,
					...(verified.refreshToken && verified.refreshExpiresAt
						? {
								refreshToken: verified.refreshToken,
								refreshExpiresAt: verified.refreshExpiresAt
							}
						: { refreshToken, refreshExpiresAt: stored.refreshExpiresAt })
				};
				writeSession(next);
				return next;
			} catch {
				return null;
			}
		})().finally(() => {
			this.refreshPromise = null;
		});
		return this.refreshPromise;
	}

	private async refreshAndResume(stored: StoredServiceSession): Promise<void> {
		const metadata = this.metadata;
		if (!metadata) return;
		const next = await this.refreshAccessToken(metadata, stored);
		if (!next) {
			this.sessionInfo = stored;
			this.status = navigator.onLine ? 'auth-required' : 'offline';
			return;
		}
		this.sessionInfo = next;
		this.status = navigator.onLine ? 'connected' : 'offline';
		void this.refreshStatus();
		void this.drain();
	}

	async refreshStatus(): Promise<void> {
		const metadata = this.metadata;
		if (!metadata || !this.sessionInfo || !metadata.capabilities.status) return;
		if (this.sessionInfo.expiresAt <= Math.floor(Date.now() / 1000)) {
			const next = await this.refreshAccessToken(metadata, this.sessionInfo);
			if (!next) {
				this.status = navigator.onLine ? 'auth-required' : 'offline';
				return;
			}
			this.sessionInfo = next;
		}

		try {
			await this.loadStatus(metadata, this.sessionInfo.token);
		} catch (error) {
			const failure = asDataServiceError(error);
			if (failure.code === 'unauthorized') {
				const next = await this.refreshAccessToken(metadata, this.sessionInfo);
				if (next) {
					this.sessionInfo = next;
					try {
						await this.loadStatus(metadata, next.token);
						return;
					} catch (retryError) {
						this.handleFailure(retryError);
						return;
					}
				}
			}
			this.handleFailure(error);
		}
	}

	private async loadStatus(metadata: ConnectionMetadata, token: string): Promise<void> {
		const raw = await requestJson({
			url: serviceEndpoint(metadata.baseUrl, DATA_SERVICE_PATHS.status),
			token,
			timeoutMs: 10_000
		});
		const report = parseStatus(raw);
		if (report.workspace && report.workspace.id !== metadata.workspaceId) {
			clearSession(metadata.workspaceId);
			this.sessionInfo = null;
			this.statusReport = null;
			this.status = 'auth-required';
			return;
		}
		this.statusReport = report;
		this.status = navigator.onLine ? 'connected' : 'offline';
	}

	/** Queue a signed event for the service. Never awaited by checkout. */
	recordEvent(event: ServiceEvent): void {
		if (!browser || !this.metadata || !this.organizationId) return;
		if (!event.id) return;

		const queue = this.readQueueOrFail(this.organizationId);
		if (!queue) return;
		const result = enqueueEvent(queue, event);
		if (result.overflow) {
			this.lastErrorCode = 'queue-full';
			this.lastError = `The local service queue is full (${MAX_QUEUE_ITEMS} events)`;
			return;
		}
		if (!result.added) return;

		try {
			writeQueue(this.organizationId, result.queue);
		} catch {
			this.lastErrorCode = 'queue-unavailable';
			this.lastError = 'This device could not store the event for the data service';
			return;
		}

		this.queueSize = result.queue.items.length;
		if (this.status === 'connected' || this.status === 'offline') this.scheduleDrain();
	}

	/**
	 * Fetch a service-computed aggregate for one period.
	 *
	 * Contract: `GET v1/reports/summary?from&to&granularity[&location][&currency]`
	 * where `from`/`to` are Unix seconds and the response carries buckets
	 * (`gross_minor`, `orders_count`). Missing buckets are gaps. Returns null when
	 * reporting is unavailable; throws on network/auth/parse errors so callers can
	 * fall back to local snapshots and live data.
	 */
	async fetchReportSummary(input: {
		granularity: ReportGranularity;
		periodStart: number;
		periodEnd: number;
		locationId?: string | null;
	}): Promise<ServiceReportSummary | null> {
		const metadata = this.metadata;
		const organizationId = this.organizationId;
		if (!metadata?.capabilities.reporting || !organizationId) return null;

		const currency = tenant.state.currency;
		const locationId = input.locationId ?? tenant.state.locationId ?? undefined;
		const cacheKey = [
			input.granularity,
			input.periodStart,
			input.periodEnd,
			currency,
			locationId ?? 'all'
		].join(':');
		const cached = this.summaryCache.get(cacheKey);
		if (cached && Date.now() - cached.at < 60_000) return cached.value;

		let stored = readSession(organizationId);
		if (!stored || stored.expiresAt <= Math.floor(Date.now() / 1000)) {
			const next = stored ? await this.refreshAccessToken(metadata, stored) : null;
			if (!next) {
				throw new DataServiceError('unauthorized', 'Sign in to read the server report summary');
			}
			stored = next;
			this.sessionInfo = next;
		}

		const params = new SvelteURLSearchParams({
			granularity: input.granularity,
			from: String(Math.floor(input.periodStart / 1000)),
			to: String(Math.floor(input.periodEnd / 1000)),
			currency
		});
		if (locationId) params.set('location', locationId);
		const base = serviceEndpoint(metadata.baseUrl, DATA_SERVICE_PATHS.reportSummary);
		const url = `${base}?${params.toString()}`;

		const fetchSummary = (token: string) => requestJson({ url, token, timeoutMs: 15_000 });
		let raw: unknown;
		try {
			raw = await fetchSummary(stored.token);
		} catch (error) {
			const failure = asDataServiceError(error);
			if (failure.code === 'unauthorized') {
				const next = await this.refreshAccessToken(metadata, stored);
				if (!next) throw failure;
				this.sessionInfo = next;
				raw = await fetchSummary(next.token);
			} else {
				throw failure;
			}
		}

		const payload =
			raw && typeof raw === 'object' && !Array.isArray(raw) && 'summary' in raw
				? (raw as { summary: unknown }).summary
				: raw;
		const summary = parseReportSummary(payload);
		this.summaryCache.set(cacheKey, { at: Date.now(), value: summary });
		return summary;
	}

	/**
	 * Sign and queue a plaintext aggregate snapshot for the service only.
	 *
	 * This event is never relay-published and never routed through
	 * `recordServiceEvent` (that queue is encrypted-backup only).
	 */
	async pushReportSnapshot(snapshot: ReportSnapshot, id: string): Promise<boolean> {
		if (!browser) return false;
		const metadata = this.metadata;
		const organizationId = this.organizationId;
		if (!metadata?.capabilities.reporting || !organizationId) return false;
		if (!session.pubkey) {
			this.lastErrorCode = 'not-signed-in';
			this.lastError = 'Sign in before publishing report snapshots';
			return false;
		}

		let event: ServiceEvent;
		try {
			event = (await session.signEvent({
				kind: REPORT_SNAPSHOT_KIND,
				created_at: Math.floor(Date.now() / 1000),
				tags: [
					['d', `org.bitos.glo:v1:report.snapshot:${id}`],
					['organization', organizationId],
					...(snapshot.locationId ? [['location', snapshot.locationId]] : []),
					['snapshot-id', id],
					['granularity', snapshot.granularity],
					['period-start', String(Math.floor(Date.parse(snapshot.periodStart) / 1000))],
					['period-end', String(Math.floor(Date.parse(snapshot.periodEnd) / 1000))],
					['currency', snapshot.currency]
				],
				content: JSON.stringify(snapshot)
			})) as unknown as ServiceEvent;
		} catch {
			this.lastErrorCode = 'not-signed-in';
			this.lastError = 'Could not sign the report snapshot';
			return false;
		}

		if (!this.enqueueSnapshot(organizationId, event, id)) return false;
		await this.drainSnapshots();
		return true;
	}

	/** Replace the previous outbox copy of the same logical period, then queue. */
	private enqueueSnapshot(organizationId: string, event: ServiceEvent, logicalId: string): boolean {
		const queue = this.readSnapshotQueueOrFail(organizationId);
		if (!queue) return false;
		const stale = queue.items
			.filter((item) => eventTagValue(item.event, 'snapshot-id') === logicalId)
			.map((item) => item.id);
		const result = enqueueEvent(acknowledgeEvents(queue, stale), event);
		if (result.overflow) {
			this.lastErrorCode = 'queue-full';
			this.lastError = `The local snapshot queue is full (${MAX_QUEUE_ITEMS} events)`;
			return false;
		}
		if (!result.added) {
			this.snapshotQueueSize = result.queue.items.length;
			return true;
		}
		try {
			writeSnapshotQueue(organizationId, result.queue);
		} catch {
			this.lastErrorCode = 'queue-unavailable';
			this.lastError = 'This device could not store the report snapshot';
			return false;
		}
		this.snapshotQueueSize = result.queue.items.length;
		if (this.status === 'connected' || this.status === 'offline') this.scheduleDrain();
		return true;
	}

	/** Trigger an immediate retry (UI "Sync now" / "Retry"). */
	async drain(): Promise<void> {
		if (!browser) return;
		if (this.drainPromise) return this.drainPromise;
		this.drainPromise = (async () => {
			await this.drainOnce();
			await this.drainSnapshots();
		})().finally(() => {
			this.drainPromise = null;
		});
		return this.drainPromise;
	}

	/** Drain only the plaintext snapshot outbox. */
	async drainSnapshots(): Promise<void> {
		if (!browser) return;
		if (this.snapshotDrainPromise) return this.snapshotDrainPromise;
		this.snapshotDrainPromise = this.drainSnapshotsOnce().finally(() => {
			this.snapshotDrainPromise = null;
		});
		return this.snapshotDrainPromise;
	}

	private scheduleDrain(): void {
		if (this.drainTimer !== null) return;
		this.drainTimer = setTimeout(() => {
			this.drainTimer = null;
			void this.drain();
		}, 500);
	}

	private async drainOnce(): Promise<void> {
		const organizationId = this.organizationId;
		const metadata = this.metadata;
		if (!organizationId || !metadata) return;

		let stored = readSession(organizationId);
		if (!stored || stored.expiresAt <= Math.floor(Date.now() / 1000)) {
			const next = stored ? await this.refreshAccessToken(metadata, stored) : null;
			if (!next) {
				this.sessionInfo = stored;
				this.status = navigator.onLine ? 'auth-required' : 'offline';
				return;
			}
			stored = next;
			this.sessionInfo = next;
		}
		if (typeof navigator !== 'undefined' && !navigator.onLine) {
			this.status = 'offline';
			return;
		}

		this.draining = true;
		let refreshed = false;
		try {
			// Bound each pass so a large backlog cannot monopolize the tab.
			for (let round = 0; round < 5; round++) {
				const queue = this.readQueueOrFail(organizationId);
				if (!queue) return;
				if (!queue.items.length) {
					this.queueSize = 0;
					return;
				}

				const batch = encryptedUploadBatch(queue, 100);
				if (!batch.length) {
					this.queueSize = queue.items.length;
					this.lastErrorCode = 'rejected';
					this.lastError = 'Events waiting for the data service must be encrypted before upload';
					return;
				}
				const ids = batch.map((item) => item.id);

				try {
					const raw = await requestJson({
						url: serviceEndpoint(metadata.baseUrl, DATA_SERVICE_PATHS.events),
						method: 'POST',
						token: stored.token,
						body: { events: batch.map((item) => item.event) },
						timeoutMs: 15_000
					});
					const result = parseIngestResult(raw);
					const current = this.readQueueOrFail(organizationId);
					if (!current) return;
					const applied = applyIngestResult(current, ids, result);
					const next = applied.queue;
					try {
						writeQueue(organizationId, next);
					} catch {
						this.lastErrorCode = 'queue-unavailable';
						this.lastError = 'This device could not update the data service queue';
						return;
					}
					this.queueSize = next.items.length;
					if (applied.acknowledged) {
						this.lastSyncAt = Date.now();
						const latest = readConnection(organizationId);
						if (latest) {
							latest.lastSyncAt = this.lastSyncAt;
							writeConnection(latest);
							this.metadata = latest;
						}
					}
					if (result.rejected.length) this.lastRejected = result.rejected;
					this.status = 'connected';
					this.lastError = null;
					this.lastErrorCode = null;
					// Avoid immediately retrying a batch the service did not acknowledge.
					if (!applied.acknowledged) return;
				} catch (error) {
					const failure = asDataServiceError(error);
					if (failure.code === 'unauthorized' && !refreshed) {
						const next = await this.refreshAccessToken(metadata, stored);
						if (next) {
							stored = next;
							this.sessionInfo = next;
							refreshed = true;
							continue;
						}
					}
					const current = this.readQueueOrFail(organizationId);
					if (!current) return;
					const failed = markAttempts(current, ids, failure.message);
					try {
						writeQueue(organizationId, failed);
					} catch {
						this.lastErrorCode = 'queue-unavailable';
						this.lastError = 'This device could not update the data service queue';
						return;
					}
					this.queueSize = failed.items.length;
					this.handleFailure(failure);
					return;
				}
			}
		} finally {
			this.draining = false;
		}
	}

	private async drainSnapshotsOnce(): Promise<void> {
		const organizationId = this.organizationId;
		const metadata = this.metadata;
		if (!organizationId || !metadata || !metadata.capabilities.reporting) return;

		let stored = readSession(organizationId);
		if (!stored || stored.expiresAt <= Math.floor(Date.now() / 1000)) {
			const next = stored ? await this.refreshAccessToken(metadata, stored) : null;
			if (!next) {
				this.sessionInfo = stored;
				this.status = navigator.onLine ? 'auth-required' : 'offline';
				return;
			}
			stored = next;
			this.sessionInfo = next;
		}
		if (typeof navigator !== 'undefined' && !navigator.onLine) {
			this.status = 'offline';
			return;
		}

		let refreshed = false;
		// Bound each pass so a large backlog cannot monopolize the tab.
		for (let round = 0; round < 10; round++) {
			const queue = this.readSnapshotQueueOrFail(organizationId);
			if (!queue) return;
			if (!queue.items.length) {
				this.snapshotQueueSize = 0;
				return;
			}

			const item = queue.items[0];
			let raw: unknown;
			try {
				raw = await requestJson({
					url: serviceEndpoint(metadata.baseUrl, DATA_SERVICE_PATHS.reportSnapshots),
					method: 'POST',
					token: stored.token,
					body: { snapshot: item.event },
					timeoutMs: 15_000
				});
			} catch (error) {
				const failure = asDataServiceError(error);
				if (failure.code === 'unauthorized' && !refreshed) {
					const next = await this.refreshAccessToken(metadata, stored);
					if (next) {
						stored = next;
						this.sessionInfo = next;
						refreshed = true;
						continue;
					}
				}
				const current = this.readSnapshotQueueOrFail(organizationId);
				if (!current) return;
				const failed = markAttempts(current, [item.id], failure.message);
				try {
					writeSnapshotQueue(organizationId, failed);
				} catch {
					this.lastErrorCode = 'queue-unavailable';
					this.lastError = 'This device could not update the snapshot queue';
					return;
				}
				this.snapshotQueueSize = failed.items.length;
				this.handleFailure(failure);
				return;
			}

			const result = parseIngestResult(raw);
			const current = this.readSnapshotQueueOrFail(organizationId);
			if (!current) return;
			const applied = applyIngestResult(current, [item.id], result);
			try {
				writeSnapshotQueue(organizationId, applied.queue);
			} catch {
				this.lastErrorCode = 'queue-unavailable';
				this.lastError = 'This device could not update the snapshot queue';
				return;
			}
			this.snapshotQueueSize = applied.queue.items.length;
			if (result.rejected.length) this.lastRejected = result.rejected;
			if (!applied.acknowledged) {
				this.lastErrorCode = 'rejected';
				this.lastError = 'The data service rejected the report snapshot';
				return;
			}

			this.status = 'connected';
			this.lastError = null;
			this.lastErrorCode = null;
			this.lastSyncAt = Date.now();
			const latest = readConnection(organizationId);
			if (latest) {
				latest.lastSyncAt = this.lastSyncAt;
				writeConnection(latest);
				this.metadata = latest;
			}
		}
	}

	private handleFailure(error: unknown): void {
		const failure = asDataServiceError(error);
		this.lastError = failure.message;
		this.lastErrorCode = failure.code;
		this.status = stateForError(failure);
		if (failure.code === 'unauthorized') {
			if (this.organizationId) clearSession(this.organizationId);
			this.sessionInfo = null;
		}
	}

	private async fetchCapabilities(baseUrl: string): Promise<DataServiceCapabilities> {
		const raw = await requestJson({
			url: serviceEndpoint(baseUrl, DATA_SERVICE_PATHS.capabilities)
		});
		return parseCapabilities(raw);
	}

	private async requestChallenge(
		baseUrl: string,
		invite: string,
		pubkey: string,
		workspaceId: string
	) {
		const raw = await requestJson({
			url: serviceEndpoint(baseUrl, DATA_SERVICE_PATHS.challenge),
			method: 'POST',
			body: { invite, pubkey, workspaceId }
		});
		return parseChallenge(raw);
	}
}

export const dataService = new DataServiceStore();

/** Hook used by the GLO publish path; synchronous and failure-free. */
export function recordServiceEvent(event: { id: string }): void {
	dataService.recordEvent(event as ServiceEvent);
}
