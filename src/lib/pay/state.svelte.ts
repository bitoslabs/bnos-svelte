import { browser } from '$app/environment';
import { env } from '$env/dynamic/public';
import { session } from '$nostr/session.svelte';
import { tenant } from '$nostr/tenant.svelte';
import { loadBitosPayEntitlement, syncBitosPayWorkspace, type PaySigner } from './client';
import {
	BITOS_PAY_PROTOCOL_VERSION,
	normalizePayUrl,
	parsePayConnection,
	type PayConnection,
	type PayEntitlement
} from './protocol';

const CONNECTION_PREFIX = 'bnos-os:pay:connection:';

export const bitosPayUrl: string | null = (() => {
	const raw = env.PUBLIC_BITOS_PAY_URL?.trim();
	if (!raw) return null;
	try {
		return normalizePayUrl(raw);
	} catch {
		return null;
	}
})();

function storage(): Storage | null {
	return typeof localStorage === 'undefined' ? null : localStorage;
}

function connectionKey(workspaceId: string): string {
	return `${CONNECTION_PREFIX}${workspaceId}`;
}

export function readPayConnection(
	workspaceId: string,
	target: Storage | null = storage()
): PayConnection | null {
	if (!workspaceId || !target) return null;
	try {
		const raw = target.getItem(connectionKey(workspaceId));
		return raw ? parsePayConnection(JSON.parse(raw)) : null;
	} catch {
		return null;
	}
}

function writePayConnection(connection: PayConnection, target: Storage | null = storage()): void {
	if (!target) return;
	target.setItem(connectionKey(connection.workspaceId), JSON.stringify(connection));
}

function clearPayConnection(workspaceId: string, target: Storage | null = storage()): void {
	if (!target) return;
	target.removeItem(connectionKey(workspaceId));
}

function activeSigner(): PaySigner {
	const signer = session.activeSigner;
	if (!signer) throw new Error('Sign in with a Nostr signer before connecting BitOS Pay');
	return signer as unknown as PaySigner;
}

class BitosPayState {
	connection = $state<PayConnection | null>(null);
	entitlement = $state<PayEntitlement | null>(null);
	busy = $state(false);
	error = $state<string | null>(null);

	get configured() {
		return bitosPayUrl !== null;
	}

	load(): void {
		if (!browser) return;
		const workspaceId = tenant.state.organizationId;
		this.connection = readPayConnection(workspaceId);
		this.entitlement = null;
		if (this.connection?.apiKey) void this.refreshEntitlement();
	}

	async connect(): Promise<PayConnection> {
		if (!bitosPayUrl) throw new Error('BitOS Pay is not configured');
		const workspaceId = tenant.state.organizationId;
		if (!workspaceId) throw new Error('No active BNOS workspace');
		const existing = readPayConnection(workspaceId);
		this.busy = true;
		this.error = null;
		try {
			const result = await syncBitosPayWorkspace({
				baseUrl: bitosPayUrl,
				workspaceId,
				workspaceName: tenant.state.organizationName || existing?.workspaceName || 'Workspace',
				merchantName: tenant.state.organizationName || 'Merchant',
				country: 'LA',
				signer: activeSigner(),
				existingApiKey: existing?.apiKey ?? null
			});
			const now = Date.now();
			const connection: PayConnection = {
				version: BITOS_PAY_PROTOCOL_VERSION,
				baseUrl: bitosPayUrl,
				workspaceId,
				workspaceName: tenant.state.organizationName || existing?.workspaceName || 'Workspace',
				merchantId: result.sync.merchant_id,
				subjectRef: result.sync.subject_ref,
				consoleUrl: `${bitosPayUrl}${result.sync.console_url}`,
				apiKey: result.apiKey,
				connectedAt: existing?.connectedAt ?? now,
				syncedAt: now
			};
			writePayConnection(connection);
			this.connection = connection;
			if (connection.apiKey) await this.refreshEntitlement();
			return connection;
		} catch (error) {
			this.error = error instanceof Error ? error.message : 'Could not connect BitOS Pay';
			throw error;
		} finally {
			this.busy = false;
		}
	}

	async sync(): Promise<PayConnection> {
		if (!this.connection) throw new Error('Connect BitOS Pay first');
		this.busy = true;
		this.error = null;
		try {
			const result = await syncBitosPayWorkspace({
				baseUrl: this.connection.baseUrl,
				workspaceId: this.connection.workspaceId,
				workspaceName: tenant.state.organizationName || this.connection.workspaceName,
				merchantName: tenant.state.organizationName || this.connection.workspaceName,
				country: 'LA',
				signer: activeSigner(),
				existingApiKey: this.connection.apiKey
			});
			const connection: PayConnection = {
				...this.connection,
				workspaceName: tenant.state.organizationName || this.connection.workspaceName,
				merchantId: result.sync.merchant_id,
				subjectRef: result.sync.subject_ref,
				consoleUrl: `${this.connection.baseUrl}${result.sync.console_url}`,
				apiKey: result.apiKey,
				syncedAt: Date.now()
			};
			writePayConnection(connection);
			this.connection = connection;
			if (connection.apiKey) await this.refreshEntitlement();
			return connection;
		} catch (error) {
			this.error = error instanceof Error ? error.message : 'Could not sync BitOS Pay';
			throw error;
		} finally {
			this.busy = false;
		}
	}

	async refreshEntitlement(): Promise<void> {
		if (!this.connection?.apiKey) return;
		try {
			this.entitlement = await loadBitosPayEntitlement({
				baseUrl: this.connection.baseUrl,
				apiKey: this.connection.apiKey
			});
		} catch {
			this.entitlement = null;
		}
	}

	disconnect(): void {
		if (this.connection) clearPayConnection(this.connection.workspaceId);
		this.connection = null;
		this.entitlement = null;
		this.error = null;
	}
}

export const bitosPay = new BitosPayState();

let autoSyncAttempted = false;

/** Refresh an existing link after login. Never creates a link without consent. */
export async function autoSyncBitosPayWorkspace(): Promise<void> {
	if (!browser || autoSyncAttempted) return;
	const workspaceId = tenant.state.organizationId;
	if (!workspaceId) return;
	const connection = readPayConnection(workspaceId);
	if (!connection || connection.workspaceId !== workspaceId) return;
	autoSyncAttempted = true;
	bitosPay.connection = connection;
	try {
		await bitosPay.sync();
	} catch {
		/* offline or signer unavailable: the stored link stays usable */
	}
}
