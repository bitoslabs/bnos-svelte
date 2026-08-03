import { warmRelays } from './client';
import { relays } from './relay.svelte';
import { session } from './session.svelte';
import { glo } from './store.svelte';
import { tenant } from './tenant.svelte';
import { hydrateOrganizationSettingsFromWorkspace } from './organization-settings';

const WORKSPACE_TYPES = ['organization', 'location'] as const;

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

export function restoreTenantFromWorkspace() {
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
	hydrateOrganizationSettingsFromWorkspace({
		activeCompanyId: org.id,
		activeBranchId: locations[0]?.id ?? tenant.state.locationId
	});
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
		// Bootstrap needs the full workspace collections so a fresh device can
		// rebuild the complete company + branch list from relay data.
		await glo.sync('organization');
		await glo.sync('location');
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
