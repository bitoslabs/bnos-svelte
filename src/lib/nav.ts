/**
 * App navigation structure — ported from bdgo-os `AppSidebar` nav sections,
 * with icons resolved to the offline Lucide set (see lib/icons.ts). Routes map
 * 1:1 to bdgo-os UX flows (POS, orders, customers, catalog, dashboard, …).
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
		label: 'Sales',
		items: [
			{ to: '/pos', icon: 'lucide:scan-line', label: 'Point of Sale', types: ['commerce.order'] },
			{ to: '/orders', icon: 'lucide:receipt-text', label: 'Orders', types: ['commerce.order'] },
			{ to: '/customers', icon: 'lucide:users', label: 'Customers', types: ['crm.customer'] },
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
		label: 'Catalog',
		items: [
			{ to: '/catalog', icon: 'lucide:package', label: 'Products', types: ['catalog.product'] },
			{ to: '/inventory', icon: 'lucide:warehouse', label: 'Inventory', types: ['inventory.adjustment'] }
		]
	},
	{
		label: 'Insights',
		items: [
			{ to: '/', icon: 'lucide:layout-dashboard', label: 'Dashboard', exact: true },
			{ to: '/reports', icon: 'lucide:chart-line', label: 'Reports' },
			{ to: '/transactions', icon: 'lucide:arrow-left-right', label: 'Transactions' },
			{ to: '/transactions/shifts', icon: 'lucide:lock-open', label: 'Shifts' },
			{ to: '/expenses', icon: 'lucide:wallet', label: 'Expenses' }
		]
	},
	{
		label: 'General',
		items: [
			{ to: '/staff', icon: 'lucide:users-round', label: 'Staff', types: ['identity.staff'] },
			{ to: '/settings', icon: 'lucide:settings', label: 'Settings' }
		]
	}
];

/** Flattened items for search / breadcrumbs. */
export const flatNav: NavItem[] = navSections.flatMap((s) => s.items);

/** Mobile bottom-bar primary destinations (mirrors bdgo-os AppBottomBar). */
export const bottomBarItems: NavItem[] = [
	{ to: '/', icon: 'lucide:layout-dashboard', label: 'Home', exact: true },
	{ to: '/pos', icon: 'lucide:scan-line', label: 'POS' },
	{ to: '/orders', icon: 'lucide:receipt-text', label: 'Orders' },
	{ to: '/catalog', icon: 'lucide:package', label: 'Catalog' },
	{ to: '/settings', icon: 'lucide:settings', label: 'Settings' }
];

export function findNavItem(path: string): NavItem | undefined {
	const norm = path.length > 1 ? path.replace(/\/+$/, '') : path;
	return flatNav.find((i) => (i.exact ? norm === i.to : norm === i.to || norm.startsWith(i.to + '/')));
}
