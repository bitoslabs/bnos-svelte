/**
 * Canonical order-source catalog — single source of truth for the picker,
 * badges, filters and CSV export. Keeps the create/edit/list/detail pages from
 * drifting (the old inline lists only exposed 5 of 14 domain sources).
 */
import type { OrderSource, ShippingStatus } from './types';

export interface OrderSourceOption {
	value: OrderSource;
	label: string;
	icon: string;
	/** Brand-style grouping for badge color + analytics. */
	group: 'social' | 'marketplace' | 'direct' | 'system';
}

export const ORDER_SOURCES: OrderSourceOption[] = [
	{ value: 'orders_page', label: 'Orders Page', icon: 'lucide:clipboard-list', group: 'system' },
	{ value: 'pos', label: 'POS / Counter', icon: 'lucide:scan-line', group: 'system' },
	{ value: 'manual', label: 'Manual', icon: 'lucide:hand', group: 'system' },
	{ value: 'website', label: 'Website', icon: 'lucide:globe', group: 'direct' },
	{ value: 'online', label: 'Online', icon: 'lucide:network', group: 'direct' },
	{ value: 'phone', label: 'Phone', icon: 'lucide:phone', group: 'direct' },
	{ value: 'whatsapp', label: 'WhatsApp', icon: 'lucide:message-circle', group: 'direct' },
	{ value: 'line', label: 'LINE', icon: 'lucide:message-square', group: 'direct' },
	{ value: 'facebook', label: 'Facebook', icon: 'lucide:facebook', group: 'social' },
	{ value: 'instagram', label: 'Instagram', icon: 'lucide:instagram', group: 'social' },
	{ value: 'tiktok', label: 'TikTok', icon: 'lucide:music', group: 'social' },
	{ value: 'marketplace', label: 'Marketplace', icon: 'lucide:store', group: 'marketplace' },
	{ value: 'delivery', label: 'Delivery App', icon: 'lucide:truck', group: 'marketplace' },
	{ value: 'other', label: 'Other', icon: 'lucide:plus-circle', group: 'system' }
];

const SOURCE_MAP = new Map(ORDER_SOURCES.map((s) => [s.value, s]));

export function sourceLabel(src?: string | null): string {
	if (!src) return '—';
	const found = SOURCE_MAP.get(src as OrderSource);
	if (found) return found.label;
	return src
		.replace(/_/g, ' ')
		.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function sourceIcon(src?: string | null): string {
	if (!src) return 'lucide:circle-dot';
	return SOURCE_MAP.get(src as OrderSource)?.icon ?? 'lucide:circle-dot';
}

export function sourceGroup(src?: string | null): OrderSourceOption['group'] | undefined {
	if (!src) return undefined;
	return SOURCE_MAP.get(src as OrderSource)?.group;
}

/** Sources where the customer is remote (social/online/marketplace). */
export const REMOTE_SOURCES: ReadonlySet<OrderSource> = new Set([
	'facebook',
	'instagram',
	'tiktok',
	'whatsapp',
	'line',
	'website',
	'online',
	'marketplace',
	'phone',
	'delivery'
]);

export function isRemoteSource(src?: string | null): boolean {
	return !!src && REMOTE_SOURCES.has(src as OrderSource);
}

/** Delivery lifecycle for shipping tracking (order tracking feature). */
export const SHIPPING_STATUSES: { value: ShippingStatus; label: string; icon: string }[] = [
	{ value: 'pending', label: 'Pending', icon: 'lucide:clock' },
	{ value: 'packed', label: 'Packed', icon: 'lucide:package-check' },
	{ value: 'shipped', label: 'Shipped', icon: 'lucide:truck' },
	{ value: 'in_transit', label: 'In transit', icon: 'lucide:route' },
	{ value: 'delivered', label: 'Delivered', icon: 'lucide:package-check' },
	{ value: 'failed', label: 'Failed', icon: 'lucide:circle-x' },
	{ value: 'returned', label: 'Returned', icon: 'lucide:undo-2' }
];

export function shippingStatusLabel(s?: string | null): string {
	return SHIPPING_STATUSES.find((x) => x.value === s)?.label ?? '—';
}
