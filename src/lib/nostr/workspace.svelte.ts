import { warmRelays } from './client';
import { relays } from './relay.svelte';
import { session } from './session.svelte';
import { glo } from './store.svelte';
import { tenant } from './tenant.svelte';

const WORKSPACE_TYPES = ['organization', 'location'] as const;
const WORKSPACE_SYNC_STAMP_KEY = 'bnos:workspace:last-full-sync-at';
const WORKSPACE_SYNC_COOLDOWN_MS = 90_000;

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(check: () => boolean, attempts: number, delayMs: number) {
	for (let attempt = 0; attempt < attempts; attempt++) {
		if (check()) return true;
		await sleep(delayMs);
	}
	return check();
}

function restoreTenantFromWorkspace() {
	const orgs = glo.all<Record<string, unknown>>('organization');
	if (orgs.length === 0) return false;

	const org = orgs[0];
	const orgData = org.data as Record<string, unknown>;
	tenant.configure({
		organizationId: org.id,
		organizationName: (orgData.name as string) ?? '',
		organizationCode: (orgData.code as string) ?? '',
		currency: (orgData.currency as string) ?? tenant.state.currency
	});

	const locations = glo.all<Record<string, unknown>>('location');
	if (locations.length > 0) {
		const location = locations[0];
		const locationData = location.data as Record<string, unknown>;
		tenant.configure({
			locationId: location.id,
			locationName: ((locationData.name as string) ?? tenant.state.locationName) || 'Main'
		});
	}

	tenant.completeSetup();
	return true;
}

export async function resolveWorkspace(options: { allowRelaySync?: boolean } = {}) {
	const { allowRelaySync = true } = options;

	for (const type of WORKSPACE_TYPES) {
		glo.hydrate(type);
	}

	await waitFor(() => WORKSPACE_TYPES.every((type) => glo.isHydrated(type)), 20, 100);
	if (restoreTenantFromWorkspace()) {
		return { found: true, source: 'local' as const };
	}

	if (!allowRelaySync || !session.pubkey) {
		return { found: false, source: 'none' as const };
	}

	await waitFor(() => relays.hydrated, 50, 100);

	try {
		await warmRelays();
		await sleep(400);
		// Bootstrap only needs the active workspace + one usable branch.
		// A later background sync can fetch the full collections.
		await glo.sync('organization', 1);
		await glo.sync('location', 1);
	} catch {
		// Local-first fallback: treat sync failure as "not found yet".
	}

	if (restoreTenantFromWorkspace()) {
		return { found: true, source: 'relay' as const };
	}

	return { found: false, source: 'none' as const };
}

export function hasActiveWorkspaceContext() {
	return !!tenant.state.setupComplete && !!tenant.state.organizationId;
}

export function shouldRunWorkspaceSync() {
	if (typeof localStorage === 'undefined') return true;
	const raw = localStorage.getItem(WORKSPACE_SYNC_STAMP_KEY);
	const lastRunAt = raw ? Number(raw) || 0 : 0;
	return Date.now() - lastRunAt > WORKSPACE_SYNC_COOLDOWN_MS;
}

export function markWorkspaceSyncAt(timestamp = Date.now()) {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(WORKSPACE_SYNC_STAMP_KEY, String(timestamp));
}
