/**
 * Reactive permission checks (`can()` / `canAccessBranch()` / `requirePermission`).
 *
 * Ported from bdgo-os-nuxt `app/composables/usePermissions.ts`, adapted to
 * Svelte 5 runes + the bnos-svelte GLO store. Reads the active role + staff
 * from the tenant context, with custom-permission overrides looked up from the
 * GLO `identity.staff` collection.
 *
 * Call `can(...)` inside a `$derived` / `$effect` for live reactivity; reads of
 * `tenant.state` and `glo` collections are tracked automatically.
 */
import { tenant } from '$nostr/tenant.svelte';
import { glo } from '$nostr/store.svelte';
import { TYPE, type Staff } from '$lib/domain';
import {
	ROLE_DEFAULTS,
	customPermissionsAllow,
	getRoleDefaultPermissions,
	getRolePermissionStrings,
	roleHasPermission
} from '$lib/domain/permissions';
import type {
	Permission,
	PermissionAction,
	PermissionResource
} from '$lib/domain/permissions';

/** Read the active staff record (from the snapshot or the GLO collection). */
function activeStaff(): { customPermissions?: string[]; branchIds?: string[]; status?: string } | null {
	const id = tenant.state.activeStaffId;
	if (!id) return null;
	const info = tenant.state.activeStaffInfo;
	if (info) return info;
	const obj = glo.get(TYPE.staff, id);
	return (obj?.data as Staff | undefined) ?? null;
}

/** Resolve custom-permission strings into structured permissions. */
function customPermissionsToPermissions(strings: string[]): Permission[] {
	const byResource = new Map<PermissionResource, Set<PermissionAction>>();
	for (const entry of strings) {
		const [resource, action] = entry.split(':') as [PermissionResource, PermissionAction | 'all'];
		if (!resource) continue;
		const set = byResource.get(resource) ?? new Set<PermissionAction>();
		if (!action || action === 'all') {
			for (const a of ['read', 'write', 'delete', 'approve', 'export'] as const) set.add(a);
		} else {
			set.add(action);
		}
		byResource.set(resource, set);
	}
	return [...byResource.entries()].map(([resource, actions]) => ({
		resource,
		actions: [...actions],
		scope: 'branch'
	}));
}

/** Effective permissions for the active user (role defaults, or the override). */
export function activePermissions(): Permission[] | null {
	const role = tenant.state.activeRole;
	if (!role) return null;
	const member = activeStaff();
	if (member && member.customPermissions !== undefined) {
		return customPermissionsToPermissions(member.customPermissions as string[]);
	}
	return getRoleDefaultPermissions(role);
}

class PermissionsApi {
	/** Can the active user perform `action` on `resource`? */
	can = (
		resource: PermissionResource,
		action: PermissionAction,
		scopeContext?: { branchId?: string }
	): boolean => {
		const role = tenant.state.activeRole;
		if (!role) return false;

		// 1) Custom-permission override on the active staff record.
		const member = activeStaff();
		if (tenant.state.activeStaffId && member && member.customPermissions !== undefined) {
			return customPermissionsAllow(member.customPermissions as string[], resource, action);
		}

		// 2) Role defaults.
		return (ROLE_DEFAULTS[role] ?? []).some((perm) => {
			if (perm.resource !== 'all' && perm.resource !== resource) return false;
			if (!perm.actions.includes(action)) return false;
			if (perm.scope === 'global') return true;
			if (perm.scope === 'branch') {
				return !!(scopeContext?.branchId || tenant.state.locationId);
			}
			return false;
		});
	};

	/** Can the active user access a specific branch? */
	canAccessBranch = (branchId: string): boolean => {
		const role = tenant.state.activeRole;
		if (!role) return false;
		if (role === 'owner' || role === 'admin') return true;
		const member = activeStaff();
		if (!member) return false;
		if (member.status && member.status !== 'active') return false;
		const branchIds = member.branchIds ?? [];
		// Empty branchIds ⇒ company-wide access for this staff record.
		return branchIds.length === 0 || branchIds.includes(branchId);
	};

	/** Throw if the active user lacks the permission. */
	requirePermission = (resource: PermissionResource, action: PermissionAction) => {
		if (!this.can(resource, action)) {
			throw new Error(`Permission denied: ${action} ${resource}`);
		}
	};

	/** Default permissions for the active role (or `[]`). */
	currentRolePermissions = (): Permission[] => {
		const role = tenant.state.activeRole;
		return role ? getRoleDefaultPermissions(role) : [];
	};
}

export const permissions = new PermissionsApi();

export { ROLE_DEFAULTS, getRoleDefaultPermissions, getRolePermissionStrings, roleHasPermission };
