/**
 * App navigation structure — UX-ordered for optimal flow.
 *
 * Hierarchy principle (Jakob Nielsen's priority guide):
 *   1. Overview (Dashboard + POS — most frequent daily actions)
 *   2. Sales (Orders, Customers, Transactions, Shifts)
 *   3. Catalog & Inventory (Products, Inventory)
 *   4. Marketing (Promotions, Memberships)
 *   5. Restaurant (feature-gated)
 *   6. Insights (Reports, Expenses)
 *   7. Administration (Staff, Settings)
 *
 * Mobile bottom bar: 5 most-used destinations.
 */
import type { KnownGloObjectType } from '@bitos/bnos-core/glo';
import type { PermissionAction, PermissionResource } from '$lib/domain/permissions';

export interface NavItem {
	to: string;
	icon: string;
	label: string;
	exact?: boolean;
	/** GLO object types this route is backed by (for sync seeding). */
	types?: KnownGloObjectType[];
}

export interface NavSection {
	label: string;
	items: NavItem[];
	feature?: 'restaurant';
}

export interface RoutePermission {
	resource: PermissionResource;
	action: PermissionAction;
}

export const routePermissions: Record<string, RoutePermission> = {
	'/pos': { resource: 'pos', action: 'read' },
	'/orders': { resource: 'orders', action: 'read' },
	'/customers': { resource: 'customers', action: 'read' },
	'/transactions/shifts': { resource: 'payments', action: 'read' },
	'/transactions': { resource: 'payments', action: 'read' },
	'/catalog': { resource: 'products', action: 'read' },
	'/inventory': { resource: 'inventory', action: 'read' },
	'/promotions': { resource: 'discounts', action: 'read' },
	'/memberships': { resource: 'customers', action: 'read' },
	'/restaurant': { resource: 'orders', action: 'read' },
	'/reports': { resource: 'reports', action: 'read' },
	'/expenses': { resource: 'accounting', action: 'read' },
	'/staff': { resource: 'staff', action: 'read' },
	'/settings/organization': { resource: 'settings', action: 'write' },
	'/settings/store': { resource: 'settings', action: 'write' },
	'/settings/general': { resource: 'settings', action: 'write' },
	'/settings/features': { resource: 'settings', action: 'write' },
	'/settings/payment-methods': { resource: 'settings', action: 'write' },
	'/settings/receipt': { resource: 'settings', action: 'write' },
	'/settings/bitcoin': { resource: 'settings', action: 'write' },
	'/settings/hardware': { resource: 'settings', action: 'write' },
	'/settings/printers': { resource: 'settings', action: 'write' },
	'/settings/billing': { resource: 'settings', action: 'write' },
	'/settings/notifications': { resource: 'settings', action: 'write' },
	'/settings/relays': { resource: 'settings', action: 'write' },
	'/settings/data': { resource: 'settings', action: 'write' },
	'/settings': { resource: 'settings', action: 'read' }
};

export const navSections: NavSection[] = [
	{
		label: 'Overview',
		items: [
			{ to: '/', icon: 'lucide:layout-dashboard', label: 'Dashboard', exact: true },
			{ to: '/pos', icon: 'lucide:scan-line', label: 'Point of Sale', types: ['commerce.order'] }
		]
	},
	{
		label: 'Sales',
		items: [
			{ to: '/orders', icon: 'lucide:receipt-text', label: 'Orders', types: ['commerce.order'] },
			{ to: '/customers', icon: 'lucide:users', label: 'Customers', types: ['crm.customer'] },
			{ to: '/transactions', icon: 'lucide:arrow-left-right', label: 'Transactions' },
			{ to: '/transactions/shifts', icon: 'lucide:lock-open', label: 'Shifts' }
		]
	},
	{
		label: 'Catalog & Inventory',
		items: [
			{ to: '/catalog', icon: 'lucide:package', label: 'Products', types: ['catalog.product'] },
			{
				to: '/inventory',
				icon: 'lucide:warehouse',
				label: 'Inventory',
				types: ['inventory.adjustment']
			}
		]
	},
	{
		label: 'Marketing',
		items: [
			{ to: '/promotions', icon: 'lucide:tags', label: 'Promotions' },
			{ to: '/memberships', icon: 'lucide:crown', label: 'Memberships' }
		]
	},
	{
		label: 'Restaurant',
		feature: 'restaurant',
		items: [
			{ to: '/restaurant/tables', icon: 'lucide:armchair', label: 'Tables' },
			{ to: '/restaurant/waiter', icon: 'lucide:concierge-bell', label: 'Waiter' },
			{ to: '/restaurant/kitchen', icon: 'lucide:chef-hat', label: 'Kitchen' },
			{ to: '/restaurant/queue', icon: 'lucide:clipboard-list', label: 'Order Queue' }
		]
	},
	{
		label: 'Insights',
		items: [
			{ to: '/reports', icon: 'lucide:chart-line', label: 'Reports' },
			{ to: '/expenses', icon: 'lucide:wallet', label: 'Expenses' }
		]
	},
	{
		label: 'Administration',
		items: [
			{ to: '/staff', icon: 'lucide:users-round', label: 'Staff', types: ['identity.staff'] },
			{ to: '/settings', icon: 'lucide:settings', label: 'Settings' }
		]
	}
];

/** Flattened items for search / breadcrumbs. */
export const flatNav: NavItem[] = navSections.flatMap((s) => s.items);

/**
 * Mobile bottom-bar — 5 most-used destinations.
 * Home → POS → Orders → Catalog → More (settings)
 * This mirrors common POS app patterns (Square, Toast, Shopify POS).
 */
export const bottomBarItems: NavItem[] = [
	{ to: '/', icon: 'lucide:layout-dashboard', label: 'Home', exact: true },
	{ to: '/pos', icon: 'lucide:scan-line', label: 'POS' },
	{ to: '/orders', icon: 'lucide:receipt-text', label: 'Orders' },
	{ to: '/catalog', icon: 'lucide:package', label: 'Catalog' },
	{ to: '/settings', icon: 'lucide:menu', label: 'More' }
];

function normalizePath(path: string) {
	return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

const rankedNavItems = [...flatNav].sort(
	(a, b) => normalizePath(b.to).length - normalizePath(a.to).length
);
const rankedRoutePermissions = Object.entries(routePermissions).sort(
	([a], [b]) => normalizePath(b).length - normalizePath(a).length
);

export function matchesNavItem(path: string, item: NavItem): boolean {
	const current = normalizePath(path);
	const target = normalizePath(item.to);
	return item.exact ? current === target : current === target || current.startsWith(target + '/');
}

export function findNavItem(path: string): NavItem | undefined {
	const norm = normalizePath(path);
	return rankedNavItems.find((item) => matchesNavItem(norm, item));
}

export function permissionForPath(path: string): RoutePermission | undefined {
	const current = normalizePath(path);
	return rankedRoutePermissions.find(([to]) => current === to || current.startsWith(to + '/'))?.[1];
}

export function permissionForNavItem(item: NavItem): RoutePermission | undefined {
	return permissionForPath(item.to);
}
