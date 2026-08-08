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
import { t } from '$lib/i18n/i18n.svelte';

export interface NavItem {
	to: string;
	icon: string;
	/** Raw fallback label (used only if `labelKey` is absent). */
	label: string;
	/** i18n key resolved via `t()` for the localised label. */
	labelKey?: string;
	exact?: boolean;
	/** GLO object types this route is backed by (for sync seeding). */
	types?: KnownGloObjectType[];
	/** Nested children render as a collapsible sub-group (module with many
	 *  sub-pages, e.g. Marketplace). The parent navigates to `to`. */
	children?: NavItem[];
}

export interface NavSection {
	label: string;
	/** i18n key for the localised section label. */
	labelKey?: string;
	items: NavItem[];
	feature?: 'restaurant' | 'marketplace';
}

/** Resolve the localised label for a nav item (i18n key, else raw label). */
export function navLabel(item: NavItem): string {
	return item.labelKey ? t(item.labelKey) : item.label;
}

/** Resolve the localised label for a nav section. */
export function navSectionLabel(section: NavSection): string {
	return section.labelKey ? t(section.labelKey) : section.label;
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
	'/activity': { resource: 'reports', action: 'read' },
	'/expenses': { resource: 'accounting', action: 'read' },
	'/staff': { resource: 'staff', action: 'read' },
	'/marketplace': { resource: 'marketplace', action: 'read' },
	'/marketplace/listings': { resource: 'marketplace', action: 'read' },
	'/marketplace/channels': { resource: 'marketplace', action: 'read' },
	'/marketplace/orders': { resource: 'marketplace', action: 'read' },
	'/marketplace/shipping': { resource: 'marketplace', action: 'read' },
	'/marketplace/promotions': { resource: 'marketplace', action: 'read' },
	'/marketplace/reviews': { resource: 'marketplace', action: 'read' },
	'/marketplace/settings': { resource: 'settings', action: 'write' },
	'/marketplace/analytics': { resource: 'reports', action: 'read' },
	'/settings/organization': { resource: 'settings', action: 'write' },
	'/settings/store': { resource: 'settings', action: 'write' },
	'/settings/general': { resource: 'settings', action: 'write' },
	'/settings/features': { resource: 'settings', action: 'write' },
	'/settings/payment-methods': { resource: 'settings', action: 'write' },
	'/settings/receipt': { resource: 'settings', action: 'write' },
	'/settings/media': { resource: 'settings', action: 'write' },
	'/settings/bitcoin': { resource: 'settings', action: 'write' },
	'/settings/pay-qr': { resource: 'settings', action: 'write' },
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
		labelKey: 'nav.sectionOverview',
		items: [
			{ to: '/', icon: 'lucide:layout-dashboard', label: 'Dashboard', labelKey: 'nav.dashboard', exact: true },
			{ to: '/pos', icon: 'lucide:scan-line', label: 'Point of Sale', labelKey: 'nav.pos', types: ['commerce.order'] }
		]
	},
	{
		label: 'Sales',
		labelKey: 'nav.sectionSales',
		items: [
			{ to: '/orders', icon: 'lucide:receipt-text', label: 'Orders', labelKey: 'nav.orders', types: ['commerce.order'] },
			{ to: '/customers', icon: 'lucide:users', label: 'Customers', labelKey: 'nav.customers', types: ['crm.customer'] },
			{ to: '/transactions', icon: 'lucide:arrow-left-right', label: 'Transactions', labelKey: 'nav.transactions' },
			{ to: '/transactions/shifts', icon: 'lucide:lock-open', label: 'Shifts', labelKey: 'nav.shifts' },
			{ to: '/activity', icon: 'lucide:shield-check', label: 'Activity', labelKey: 'nav.activity' }
		]
	},
	{
		label: 'Catalog & Inventory',
		labelKey: 'nav.sectionCatalog',
		items: [
			{ to: '/catalog', icon: 'lucide:package', label: 'Products', labelKey: 'nav.products', types: ['catalog.product'] },
			{
				to: '/inventory',
				icon: 'lucide:warehouse',
				label: 'Inventory',
				labelKey: 'nav.inventory',
				types: ['inventory.adjustment']
			}
		]
	},
	{
		label: 'Marketplace',
		labelKey: 'nav.sectionMarketplace',
		feature: 'marketplace',
		items: [
			{
				to: '/marketplace',
				icon: 'lucide:globe',
				label: 'Marketplace',
				labelKey: 'nav.marketplace',
				children: [
					{ to: '/marketplace/listings', icon: 'lucide:tags', label: 'Listings', labelKey: 'nav.listings' },
					{ to: '/marketplace/channels', icon: 'lucide:radio', label: 'Sales Channels', labelKey: 'nav.salesChannels' },
					{ to: '/marketplace/orders', icon: 'lucide:shopping-bag', label: 'Orders', labelKey: 'nav.marketplaceOrders' },
					{ to: '/marketplace/shipping', icon: 'lucide:truck', label: 'Shipping', labelKey: 'nav.shipping' },
					{ to: '/marketplace/promotions', icon: 'lucide:megaphone', label: 'Promotions', labelKey: 'nav.promotions' },
					{ to: '/marketplace/reviews', icon: 'lucide:star', label: 'Reviews', labelKey: 'nav.reviews' },
					{ to: '/marketplace/analytics', icon: 'lucide:chart-column', label: 'Analytics', labelKey: 'nav.analytics' },
					{ to: '/marketplace/settings', icon: 'lucide:settings', label: 'Store Settings', labelKey: 'nav.storeSettings' }
				]
			}
		]
	},
	{
		label: 'Marketing',
		labelKey: 'nav.sectionMarketing',
		items: [
			{ to: '/promotions', icon: 'lucide:tags', label: 'Promotions', labelKey: 'nav.promotions' },
			{ to: '/memberships', icon: 'lucide:crown', label: 'Memberships', labelKey: 'nav.memberships' }
		]
	},
	{
		label: 'Restaurant',
		labelKey: 'nav.sectionRestaurant',
		feature: 'restaurant',
		items: [
			{ to: '/restaurant/tables', icon: 'lucide:armchair', label: 'Tables', labelKey: 'nav.tables' },
			{ to: '/restaurant/waiter', icon: 'lucide:concierge-bell', label: 'Waiter', labelKey: 'nav.waiter' },
			{ to: '/restaurant/kitchen', icon: 'lucide:chef-hat', label: 'Kitchen', labelKey: 'nav.kitchen' },
			{ to: '/restaurant/queue', icon: 'lucide:clipboard-list', label: 'Order Queue', labelKey: 'nav.orderQueue' }
		]
	},
	{
		label: 'Insights',
		labelKey: 'nav.sectionInsights',
		items: [
			{ to: '/reports', icon: 'lucide:chart-line', label: 'Reports', labelKey: 'nav.reports' },
			{ to: '/expenses', icon: 'lucide:wallet', label: 'Expenses', labelKey: 'nav.expenses' }
		]
	},
	{
		label: 'Administration',
		labelKey: 'nav.sectionAdministration',
		items: [
			{ to: '/staff', icon: 'lucide:users-round', label: 'Staff', labelKey: 'nav.staff', types: ['identity.staff'] },
			{ to: '/settings', icon: 'lucide:settings', label: 'Settings', labelKey: 'nav.settings' }
		]
	}
];

/** Flattened items for search / breadcrumbs (includes nested children). */
export const flatNav: NavItem[] = navSections.flatMap((s) =>
	s.items.flatMap((item) => (item.children ? [item, ...item.children] : [item]))
);

/**
 * Mobile bottom-bar — 5 most-used destinations.
 * Home → POS → Orders → Catalog → More (settings)
 * This mirrors common POS app patterns (Square, Toast, Shopify POS).
 */
export const bottomBarItems: NavItem[] = [
	{ to: '/', icon: 'lucide:layout-dashboard', label: 'Home', labelKey: 'nav.home', exact: true },
	{ to: '/pos', icon: 'lucide:scan-line', label: 'POS', labelKey: 'nav.posShort' },
	{ to: '/orders', icon: 'lucide:receipt-text', label: 'Orders', labelKey: 'nav.orders' },
	{ to: '/catalog', icon: 'lucide:package', label: 'Catalog', labelKey: 'nav.catalog' },
	{ to: '/settings', icon: 'lucide:menu', label: 'More', labelKey: 'nav.more' }
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
