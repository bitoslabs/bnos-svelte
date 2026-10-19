import { tenant, makeOrganizationObject } from './tenant.svelte';
import { glo } from './store.svelte';
import { memberships } from './memberships.svelte';
import { clearBootstrap } from './auth-bootstrap';
import { upsertOrganizationSettingsFromTenant } from './organization-settings';
import { newOrganizationId, newLocationId } from '$lib/utils/record-id';

export async function createSetupWorkspace(): Promise<{ published: boolean }> {
	if (!tenant.state.organizationName.trim()) throw new Error('Company name required');

	const organizationId = tenant.state.organizationId || newOrganizationId();
	const locationId = tenant.state.locationId || newLocationId();
	const org = makeOrganizationObject({
		id: organizationId,
		name: tenant.state.organizationName,
		currency: tenant.state.currency,
		code: tenant.state.organizationCode || tenant.state.organizationName.slice(0, 3).toUpperCase(),
		status: 'active'
	} as unknown as Parameters<typeof makeOrganizationObject>[0]);

	// Persist both IDs before publishing so both events are scoped correctly.
	tenant.configure({ organizationId, locationId });

	// Publish both setup records concurrently. Each upsert saves locally first;
	// sendEvent waits for the primary relay and fans out to secondary relays in
	// the background. Failed writes remain in the publish queue for retry.
	const [orgResult, locationResult] = await Promise.all([
		glo.upsertWithStatus('organization', org.data, {
			id: org.id,
			scope: { organizationId: org.id }
		}),
		glo.upsertWithStatus(
			'location',
			{
				name: tenant.state.locationName || 'Main Branch',
				code: 'main',
				type: 'store',
				status: 'active'
			},
			{
				id: locationId,
				scope: { organizationId: org.id, locationId }
			}
		),
		// Seed the creator's Owner staff record locally so the first dashboard
		// load already has a role and does not need a relay membership lookup.
		memberships.bootstrapOwnerIfMissing()
	]);

	tenant.configure({ organizationId, locationId });
	upsertOrganizationSettingsFromTenant({
		...tenant.state,
		organizationId,
		locationId,
		locationName: tenant.state.locationName || 'Main Branch'
	});
	tenant.completeSetup();
	// Any bootstrap started before this workspace existed is now stale.
	clearBootstrap();

	return { published: orgResult.published && locationResult.published };
}
