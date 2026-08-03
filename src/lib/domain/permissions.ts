/**
 * Role-Based Access Control — role default permissions + pure helpers.
 *
 * Ported from bdgo-os-nuxt `app/composables/usePermissions.ts`. The reactive
 * `can()` / `canAccessBranch()` runtime lives in `$lib/permissions.svelte`
 * (it reads the tenant + GLO stores); this module is framework-free and
 * unit-testable.
 */
import type { UserRole } from './types';

// ── Permission model ────────────────────────────────────────────────

export type PermissionScope = 'global' | 'branch' | 'department' | 'own';

export type PermissionResource =
	| 'pos'
	| 'orders'
	| 'products'
	| 'customers'
	| 'inventory'
	| 'staff'
	| 'reports'
	| 'settings'
	| 'payments'
	| 'refunds'
	| 'discounts'
	| 'accounting'
	| 'marketplace'
	| 'suppliers'
	| 'purchase_orders'
	| 'all';

export type PermissionAction = 'read' | 'write' | 'delete' | 'approve' | 'export';

export interface Permission {
	resource: PermissionResource;
	actions: PermissionAction[];
	scope: PermissionScope;
	branchIds?: string[];
}

/** Resources surfaced in the custom-permissions checklist (bdgo-os-nuxt set). */
export const PERMISSION_RESOURCES: {
	id: PermissionResource;
	name: string;
	actions: PermissionAction[];
}[] = [
	{ id: 'pos', name: 'POS', actions: ['read', 'write'] },
	{ id: 'orders', name: 'Orders', actions: ['read', 'write', 'delete'] },
	{ id: 'products', name: 'Products', actions: ['read', 'write', 'delete'] },
	{ id: 'customers', name: 'Customers', actions: ['read', 'write', 'delete'] },
	{ id: 'inventory', name: 'Inventory', actions: ['read', 'write'] },
	{ id: 'staff', name: 'Staff', actions: ['read', 'write', 'delete'] },
	{ id: 'reports', name: 'Reports', actions: ['read', 'export'] },
	{ id: 'settings', name: 'Settings', actions: ['read', 'write'] },
	{ id: 'payments', name: 'Payments', actions: ['read', 'write'] },
	{ id: 'refunds', name: 'Refunds', actions: ['read', 'write', 'approve'] },
	{ id: 'discounts', name: 'Discounts', actions: ['read', 'write', 'approve'] }
];

export const PERMISSION_ACTIONS: PermissionAction[] = ['read', 'write', 'delete', 'approve', 'export'];

/** Roles that grant company-wide (all-branch) access (bnos-core convention). */
export const COMPANY_WIDE_ROLES = new Set<UserRole>(['owner', 'admin']);

// ── Role default permissions ────────────────────────────────────────

/** Default permissions granted by each role. */
export const ROLE_DEFAULTS: Record<UserRole, Permission[]> = {
	owner: [{ resource: 'all', actions: ['read', 'write', 'delete', 'approve', 'export'], scope: 'global' }],
	admin: [{ resource: 'all', actions: ['read', 'write', 'delete', 'approve', 'export'], scope: 'global' }],
	manager: [
		{ resource: 'pos', actions: ['read', 'write'], scope: 'branch' },
		{ resource: 'orders', actions: ['read', 'write', 'delete'], scope: 'branch' },
		{ resource: 'products', actions: ['read', 'write'], scope: 'branch' },
		{ resource: 'inventory', actions: ['read', 'write'], scope: 'branch' },
		{ resource: 'staff', actions: ['read', 'write'], scope: 'branch' },
		{ resource: 'reports', actions: ['read'], scope: 'branch' },
		{ resource: 'payments', actions: ['read', 'write'], scope: 'branch' },
		{ resource: 'refunds', actions: ['read', 'write'], scope: 'branch' },
		{ resource: 'discounts', actions: ['read', 'write'], scope: 'branch' },
		{ resource: 'suppliers', actions: ['read', 'write'], scope: 'branch' },
		{ resource: 'purchase_orders', actions: ['read', 'write', 'delete', 'approve'], scope: 'branch' }
	],
	cashier: [
		{ resource: 'pos', actions: ['read', 'write'], scope: 'branch' },
		{ resource: 'orders', actions: ['read', 'write'], scope: 'branch' },
		{ resource: 'payments', actions: ['read', 'write'], scope: 'branch' }
	],
	waiter: [
		{ resource: 'pos', actions: ['read', 'write'], scope: 'branch' },
		{ resource: 'orders', actions: ['read', 'write'], scope: 'branch' }
	],
	chef: [{ resource: 'orders', actions: ['read'], scope: 'branch' }],
	stock: [
		{ resource: 'inventory', actions: ['read', 'write'], scope: 'branch' },
		{ resource: 'products', actions: ['read'], scope: 'branch' }
	],
	warehouse: [
		{ resource: 'inventory', actions: ['read', 'write'], scope: 'branch' },
		{ resource: 'products', actions: ['read'], scope: 'branch' },
		{ resource: 'suppliers', actions: ['read'], scope: 'branch' },
		{ resource: 'purchase_orders', actions: ['read', 'write'], scope: 'branch' }
	],
	viewer: [
		{ resource: 'reports', actions: ['read'], scope: 'global' },
		{ resource: 'orders', actions: ['read'], scope: 'global' },
		{ resource: 'products', actions: ['read'], scope: 'global' }
	],
	franchise_owner: [
		{ resource: 'reports', actions: ['read'], scope: 'branch' },
		{ resource: 'settings', actions: ['read'], scope: 'branch' },
		{ resource: 'pos', actions: ['read', 'write'], scope: 'branch' }
	],
	customer: [],
	supplier: [],
	delivery: []
};

/** Default permissions for a role (empty array for unknown roles). */
export function getRoleDefaultPermissions(role: UserRole): Permission[] {
	return ROLE_DEFAULTS[role] ?? [];
}

/** Flatten a role's permissions to `resource:action` strings (e.g. `pos:read`). */
export function getRolePermissionStrings(role: UserRole): string[] {
	const strings: string[] = [];
	for (const perm of getRoleDefaultPermissions(role)) {
		for (const action of perm.actions) strings.push(`${perm.resource}:${action}`);
	}
	return strings;
}

/** Does a role grant a given resource/action purely from its defaults? */
export function roleHasPermission(
	role: UserRole,
	resource: PermissionResource,
	action: PermissionAction
): boolean {
	return getRoleDefaultPermissions(role).some((perm) => {
		if (perm.resource !== 'all' && perm.resource !== resource) return false;
		return perm.actions.includes(action);
	});
}

/** Does a custom-permission override list grant the resource/action? */
export function customPermissionsAllow(
	customPermissions: string[] | undefined,
	resource: PermissionResource,
	action: PermissionAction
): boolean {
	if (!customPermissions) return false;
	return (
		customPermissions.includes('all:all') ||
		customPermissions.includes(`${resource}:all`) ||
		customPermissions.includes(`${resource}:${action}`)
	);
}

/** Human-readable label for a role. */
export const ROLE_LABELS: Record<UserRole, string> = {
	owner: 'Owner',
	admin: 'Admin',
	manager: 'Manager',
	cashier: 'Cashier',
	waiter: 'Waiter',
	chef: 'Chef',
	stock: 'Stock',
	warehouse: 'Warehouse',
	viewer: 'Viewer',
	franchise_owner: 'Franchise Owner',
	customer: 'Customer',
	supplier: 'Supplier',
	delivery: 'Delivery'
};

/** The roles selectable in the staff form (excludes non-staff personas). */
export const STAFF_ROLES: UserRole[] = [
	'owner',
	'admin',
	'manager',
	'cashier',
	'waiter',
	'chef',
	'warehouse',
	'stock',
	'viewer'
];

/** Badge color for a role (matches the app's `Badge` tones). */
export function roleBadgeColor(role: UserRole): 'success' | 'info' | 'warning' | 'neutral' {
	switch (role) {
		case 'owner':
		case 'franchise_owner':
			return 'warning';
		case 'admin':
		case 'manager':
			return 'info';
		case 'cashier':
			return 'success';
		default:
			return 'neutral';
	}
}
