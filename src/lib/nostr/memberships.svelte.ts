/**
 * Memberships resolver — login → staff matching.
 *
 * Ported from bdgo-os-nuxt `app/composables/useMemberships.ts`. After login we
 * look up `identity.staff` (Nostr kind 30500) records whose `p` tag (or
 * `data.pubkey`) equals the logged-in pubkey — i.e. the orgs this user belongs
 * to — and auto-resolve the active staff/role when there's a single option, or
 * surface a destination for the workspace selector / blocked screens.
 */
import { browser } from '$app/environment';
import { fetchEvents } from './client';
import { session } from './session.svelte';
import { glo } from './store.svelte';
import { tenant, type ActiveStaffInfo } from './tenant.svelte';
import { restoreTenantFromWorkspace } from './workspace.svelte';
import { TYPE, type Staff, type UserRole } from '$lib/domain';
import { COMPANY_WIDE_ROLES } from '$lib/domain/permissions';
import { parseGloEvent } from '$lib/domain/helpers';
import { syncKeyGrantsForCurrentUser } from '$lib/crypto/organization-key-grants';

/** A status prevents login / app access. */
const BLOCKING_STATUSES = new Set(['suspended', 'inactive', 'terminated']);

function syncTenantBranchForStaff(member: { id: string; data: Staff }, reason: string) {
	const branchIds = member.data.branchIds ?? [];
	if (branchIds.length === 0) return;

	const currentLocationId = tenant.state.locationId;
	const nextLocationId = branchIds[0];
	const shouldReplace = !currentLocationId || !branchIds.includes(currentLocationId);
	if (!shouldReplace) return;

	tenant.configure({ locationId: nextLocationId });
}

export type ResolveDestination = '/' | '/workspace' | '/setup' | '/blocked' | '/staff';

class MembershipsStore {
	resolving = $state(false);

	/** Pubkeys that authored the staff records found via `#p` (the org owners).
	 *  Used to fetch the org + location records on a staff-member's device. */
	private _ownerPubkeys: string[] = [];

	/** All staff records currently in the local store. */
	private allStaff() {
		return glo.all<Staff, typeof TYPE.staff>(TYPE.staff);
	}

	/** Staff records matching the current user's pubkey. */
	get myStaffRecords(): { id: string; data: Staff }[] {
		const me = session.pubkey;
		if (!me) return [];
		return this.allStaff().filter((s) => (s.data.pubkey ?? '').toLowerCase() === me.toLowerCase());
	}

	/** Active memberships only (status === 'active'). */
	get myActiveRecords() {
		return this.myStaffRecords.filter((s) => (s.data.status ?? 'active') === 'active');
	}

	/** Distinct companies the current user belongs to. */
	get myCompanies(): string[] {
		return [
			...new Set(
				this.myActiveRecords
					.map((s) => s.data.companyId ?? tenant.state.organizationId)
					.filter(Boolean)
			)
		];
	}

	/**
	 * Resolve the current user's staff memberships:
	 *  1. sync staff records authored by this user (the owner case)
	 *  2. query kind 30500 with `#p = <me>` for records authored by others
	 *  3. merge everything into the GLO staff collection
	 */
	resolve = async (): Promise<{ id: string; data: Staff }[]> => {
		if (!browser || !session.pubkey) return [];
		this.resolving = true;
		try {
			// 1. Owner-operated records authored by this device's key.
			await glo.sync(TYPE.staff, { relayStrategy: 'primary-first' });
			// 2. Records authored by other owners where this user is the staff member.
			await this.fetchMembershipsByPTag();
			// 3. Pull NIP-44 company key grants addressed to this user (kind 30512) so
			//    the staff device can decrypt owner-authored records. Best-effort.
			await syncKeyGrantsForCurrentUser().catch(() => ({ imported: 0, failed: 0 }));
			return this.myActiveRecords;
		} finally {
			this.resolving = false;
		}
	};

	/**
	 * Staff-login workspace discovery. A staff member did NOT author the
	 * `organization`/`location` GLO records (the owner did), so the normal
	 * `resolveWorkspace()` finds nothing and would redirect to /setup. This
	 * resolves the workspace THROUGH the staff record instead:
	 *
	 *  1. find the staff record via `#p = <me>` (kind 30500)
	 *  2. fetch the org + locations authored by that org owner
	 *  3. configure the tenant (falling back to the staff record's company
	 *     snapshot when the org record isn't reachable)
	 *  4. set the active role/staff
	 *
	 * Returns true when a workspace + role were resolved.
	 */
	resolveStaffWorkspace = async (): Promise<boolean> => {
		if (!browser || !session.pubkey) return false;
		this.resolving = true;
		try {
			await this.resolve();
			const records = this.myActiveRecords;
			if (records.length === 0) return false;
			const me = records[0];

			// Best-effort: pull the org + locations authored by the org owner so the
			// staff device gets currency, tax, and branch names.
			if (this._ownerPubkeys.length) {
				await this.fetchOrgAndLocations(this._ownerPubkeys);
			}

			// Configure tenant — prefer the full org record, else staff-record fallback.
			if (!restoreTenantFromWorkspace({ organizationId: me.data.companyId })) {
				tenant.configure({
					organizationId: me.data.companyId ?? tenant.state.organizationId,
					organizationName: me.data.companyName ?? tenant.state.organizationName,
					organizationCode: me.data.companyCode ?? tenant.state.organizationCode,
					setupComplete: true
				});
			}
			syncTenantBranchForStaff(me, 'resolveStaffWorkspace');
			tenant.completeSetup();
			tenant.setActiveStaff(toActiveStaffInfo(me));
			return true;
		} finally {
			this.resolving = false;
		}
	};

	/** Fetch org (kind 30078) + locations (kind 30600) authored by the org
	 *  owners and merge them into the GLO store. Best-effort / non-fatal. */
	private async fetchOrgAndLocations(authors: string[]) {
		const me = session.pubkey;
		const owners = [...new Set(authors.filter((a) => !!a && a !== me))];
		if (!owners.length) return;
		try {
			// Workspace configuration is replaceable data. Query every readable relay
			// here so a stale primary cannot hide a newer organization or branch update
			// that has already reached another relay. `batchUpsert` keeps the newest
			// version using the record update timestamp.
			const [orgEvents, locEvents] = await Promise.all([
				fetchEvents({ kinds: [30078], authors: owners }),
				fetchEvents({ kinds: [30600], authors: owners })
			]);
			const parse = (events: { kind: number; content: string; tags: string[][] }[]) =>
				events
					.map((ev) => {
						try {
							return parseGloEvent(ev as never).object;
						} catch {
							return null;
						}
					})
					.filter((obj): obj is NonNullable<typeof obj> => !!obj);
			const orgs = parse(orgEvents).filter((o) => o.type === 'organization');
			const locs = parse(locEvents).filter((o) => o.type === 'location');
			if (orgs.length) glo.batchUpsert('organization', orgs);
			if (locs.length) glo.batchUpsert('location', locs);
		} catch {
			/* best-effort — fall back to staff-record company snapshot */
		}
	}

	/** Query relays for kind-30500 events with `#p = <me>` and merge them. */
	private async fetchMembershipsByPTag() {
		const me = session.pubkey;
		if (!me) return;
		this._ownerPubkeys = [];
		try {
			// Membership updates may also arrive at a non-primary relay first.
			const events = await fetchEvents({ kinds: [30500], '#p': [me] });
			if (!events.length) return;
			// Remember who authored these staff records (the org owners) so a
			// staff-member's device can fetch the org + location records.
			this._ownerPubkeys = [...new Set(events.map((e) => e.pubkey))];
			const incoming = events
				.map((ev) => {
					try {
						return parseGloEvent(ev as never).object;
					} catch {
						return null;
					}
				})
				.filter((obj): obj is NonNullable<typeof obj> => !!obj && obj.type === TYPE.staff);
			if (incoming.length) glo.batchUpsert(TYPE.staff, incoming);
		} catch {
			/* best-effort: offline / no relays → fall back to local records */
		}
	}

	/** Branches accessible to the user within a company. */
	myBranchesForCompany = (companyId: string): string[] => {
		const record = this.myActiveRecords.find(
			(s) => (s.data.companyId ?? tenant.state.organizationId) === companyId
		);
		if (!record) return [];
		const role = record.data.role as UserRole;
		const branchIds = record.data.branchIds ?? [];
		if (COMPANY_WIDE_ROLES.has(role) || branchIds.length === 0) {
			// Company-wide access → all locations.
			return glo.all<Record<string, unknown>, typeof TYPE.location>(TYPE.location).map((b) => b.id);
		}
		return branchIds;
	};

	/** Where should the user go after login? */
	resolveLoginDestination = (): ResolveDestination => {
		const active = this.myActiveRecords;
		if (active.length === 0) {
			// No active memberships: first-run owner → staff setup; otherwise blocked.
			return this.myStaffRecords.length === 0 ? '/staff' : '/blocked';
		}
		const me = active[0];
		const status = me.data.status ?? 'active';
		if (BLOCKING_STATUSES.has(status)) return '/blocked';
		return '/';
	};

	/**
	 * Auto-set the active staff/role when there's a single membership. Returns
	 * `true` when the role context was set.
	 */
	autoResolve = (): boolean => {
		const active = this.myActiveRecords;
		if (active.length === 0) return false;
		const me = active[0];
		const status = me.data.status ?? 'active';
		if (BLOCKING_STATUSES.has(status)) return false;
		syncTenantBranchForStaff(me, 'autoResolve');
		tenant.setActiveStaff(toActiveStaffInfo(me));
		return true;
	};

	/**
	 * First-run bootstrap: if the org creator has no staff record yet, create an
	 * Owner record keyed to their pubkey so the permission system has a role to
	 * evaluate. Mirrors bdgo-os-nuxt's setup flow. No-op once any staff exists.
	 */
	bootstrapOwnerIfMissing = async (): Promise<void> => {
		if (!browser || !session.pubkey || !tenant.state.organizationId) return;
		if (this.allStaff().length > 0) return;
		const me = session.pubkey;
		const owner: Staff = {
			name: tenant.state.organizationName || 'Owner',
			role: 'owner',
			status: 'active',
			pubkey: me,
			npub: session.npub ?? undefined,
			companyId: tenant.state.organizationId,
			companyName: tenant.state.organizationName,
			companyCode: tenant.state.organizationCode,
			branchIds: []
		};
		await glo.upsert<Staff>(TYPE.staff, owner, { id: `owner-${me}` });
		// Re-resolve so the just-created record is picked up.
		const records = this.myStaffRecords;
		if (records[0]) {
			syncTenantBranchForStaff(records[0], 'bootstrapOwnerIfMissing');
			tenant.setActiveStaff(toActiveStaffInfo(records[0]));
		}
	};

	/** Clear cached membership state (on logout). */
	clear = () => {
		this.resolving = false;
	};
}

/** Project a staff GLO record into the lightweight active-staff snapshot. */
export function toActiveStaffInfo(member: { id: string; data: Staff }): ActiveStaffInfo {
	return {
		id: member.id,
		role: member.data.role,
		customPermissions: member.data.customPermissions,
		companyId: member.data.companyId ?? tenant.state.organizationId,
		branchIds: member.data.branchIds,
		status: member.data.status,
		name: member.data.name
	};
}

export const memberships = new MembershipsStore();
