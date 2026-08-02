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
			{ to: '/inventory', icon: 'lucide:warehouse', label: 'Inventory', types: ['inventory.adjustment'] }
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

export function matchesNavItem(path: string, item: NavItem): boolean {
	const current = normalizePath(path);
	const target = normalizePath(item.to);
	return item.exact ? current === target : current === target || current.startsWith(target + '/');
}

export function findNavItem(path: string): NavItem | undefined {
	const norm = normalizePath(path);
	return [...flatNav]
		.filter((item) => matchesNavItem(norm, item))
		.sort((a, b) => normalizePath(b.to).length - normalizePath(a.to).length)[0];
}
