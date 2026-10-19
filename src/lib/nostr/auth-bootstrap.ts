/**
 * Single post-login workspace/role resolver.
 *
 * Login, the root guard, and /resolve can all reach this code at nearly the
 * same time. Keep one in-flight promise per pubkey so they do not repeat the
 * same relay and membership queries.
 */
import { browser } from '$app/environment';
import { session } from './session.svelte';
import { tenant } from './tenant.svelte';
import { memberships } from './memberships.svelte';
import { resolveWorkspace, hasActiveWorkspaceContext } from './workspace.svelte';

export type BootstrapAccess = 'ready' | 'setup' | 'waiting-workspace' | 'blocked';

export interface BootstrapResult {
	access: BootstrapAccess;
	source: 'local' | 'relay' | 'membership' | 'none';
}

let inFlight: Promise<BootstrapResult> | null = null;
let inFlightPubkey = '';

async function runBootstrap(pubkey: string): Promise<BootstrapResult> {
	if (!browser || !pubkey || session.pubkey !== pubkey) return { access: 'setup', source: 'none' };

	let source: BootstrapResult['source'] = 'local';
	let workspaceFound = hasActiveWorkspaceContext();

	if (!workspaceFound) {
		const workspace = await resolveWorkspace({ allowRelaySync: true });
		if (session.pubkey !== pubkey) return { access: 'setup', source: 'none' };
		workspaceFound = workspace.found;
		source = workspace.source;

		if (!workspaceFound) {
			// Staff devices do not author organization/location events. Resolve
			// through the user's #p membership before sending them to setup.
			const staffWorkspace = await memberships.resolveStaffWorkspace();
			if (session.pubkey !== pubkey) return { access: 'setup', source: 'none' };
			if (staffWorkspace) {
				workspaceFound = true;
				source = 'membership';
			} else if (memberships.myStaffRecords.length > 0) {
				return { access: 'waiting-workspace', source: 'none' };
			}
		}
	}

	if (!workspaceFound || !tenant.state.organizationId) {
		return { access: 'setup', source };
	}

	// resolveStaffWorkspace already resolves and activates the staff record.
	// For owner/local workspaces, try the local membership records first so the
	// post-setup dashboard does not wait on relay round trips.
	if (tenant.state.activeStaffId === null && !memberships.autoResolve()) {
		await memberships.resolve();
		if (session.pubkey !== pubkey) return { access: 'setup', source: 'none' };
		if (!memberships.autoResolve()) {
			await memberships.bootstrapOwnerIfMissing();
			memberships.autoResolve();
		}
	}

	if (
		memberships.myStaffRecords.some(
			(record) =>
				(record.data.status ?? 'active') === 'suspended' ||
				(record.data.status ?? 'active') === 'inactive' ||
				(record.data.status ?? 'active') === 'terminated'
		)
	) {
		return { access: 'blocked', source };
	}

	return { access: 'ready', source };
}

export function bootstrapAuth(): Promise<BootstrapResult> {
	const pubkey = session.pubkey ?? '';
	if (inFlight && inFlightPubkey === pubkey) return inFlight;

	inFlightPubkey = pubkey;
	const pending = runBootstrap(pubkey).finally(() => {
		// A slower run for a previous identity must not clear the cache entry of
		// the identity that is currently active.
		if (inFlight !== pending) return;
		inFlight = null;
		inFlightPubkey = '';
	});
	inFlight = pending;
	return pending;
}

export function clearBootstrap() {
	inFlight = null;
	inFlightPubkey = '';
}
