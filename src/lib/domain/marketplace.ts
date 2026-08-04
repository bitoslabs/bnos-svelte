/**
 * Marketplace domain helpers — channel catalog, listing status, review
 * presentation. Mirrors the `order-sources.ts` pattern: a single source of
 * truth so badges, filters, pickers and analytics never drift.
 */
import type { MarketplaceChannelType, MarketplaceProductStatus, MarketplaceConnectionStatus, MarketplaceReviewStatus, MarketplaceConnection } from './types';

// ── Channels ────────────────────────────────────────────────────────────────

export interface ChannelMeta {
	value: MarketplaceChannelType;
	label: string;
	icon: string;
	/** Tailwind color classes used for brand chips/badges. */
	color: string;
	/** Short marketing blurb shown on connect cards. */
	blurb: string;
}

export const CHANNEL_TYPES: ChannelMeta[] = [
	{ value: 'tiktok', label: 'TikTok Shop', icon: 'lucide:music', color: 'bg-pink-500/10 text-pink-500', blurb: 'Short-video commerce, live selling' },
	{ value: 'facebook', label: 'Facebook Shop', icon: 'lucide:facebook', color: 'bg-blue-500/10 text-blue-500', blurb: 'Meta storefront + Messenger orders' },
	{ value: 'instagram', label: 'Instagram', icon: 'lucide:instagram', color: 'bg-fuchsia-500/10 text-fuchsia-500', blurb: 'Shoppable posts & DM checkout' },
	{ value: 'website', label: 'Own Website', icon: 'lucide:globe', color: 'bg-emerald-500/10 text-emerald-500', blurb: 'Your branded storefront (DTC)' },
	{ value: 'shopee', label: 'Shopee', icon: 'lucide:shopping-bag', color: 'bg-orange-500/10 text-orange-500', blurb: 'Southeast-Asia marketplace' },
	{ value: 'lazada', label: 'Lazada', icon: 'lucide:shopping-cart', color: 'bg-sky-500/10 text-sky-500', blurb: 'Regional marketplace reach' },
	{ value: 'tokopedia', label: 'Tokopedia', icon: 'lucide:store', color: 'bg-green-500/10 text-green-500', blurb: 'Indonesia marketplace' },
	{ value: 'amazon', label: 'Amazon', icon: 'lucide:package', color: 'bg-amber-500/10 text-amber-500', blurb: 'Global marketplace fulfillment' },
	{ value: 'whatsapp', label: 'WhatsApp Catalog', icon: 'lucide:message-circle', color: 'bg-green-500/10 text-green-500', blurb: 'Chat commerce & catalog' },
	{ value: 'shopify', label: 'Shopify', icon: 'lucide:shopping-bag', color: 'bg-lime-500/10 text-lime-600', blurb: 'Sync with a Shopify store' },
	{ value: 'custom', label: 'Custom', icon: 'lucide:plug', color: 'bg-violet-500/10 text-violet-500', blurb: 'API / webhook integration' }
];

const CHANNEL_MAP = new Map(CHANNEL_TYPES.map((c) => [c.value, c]));

export function channelMeta(t?: string | null): ChannelMeta {
	return (
		CHANNEL_MAP.get(t as MarketplaceChannelType) ?? {
			value: 'custom',
			label: t ? String(t) : 'Custom',
			icon: 'lucide:plug',
			color: 'bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)]',
			blurb: ''
		}
	);
}

export function channelLabel(t?: string | null): string {
	return t ? channelMeta(t).label : '—';
}

export function channelIcon(t?: string | null): string {
	return channelMeta(t).icon;
}

// ── Listing status ──────────────────────────────────────────────────────────

export interface ListingStatusMeta {
	value: MarketplaceProductStatus;
	label: string;
	icon: string;
}

export const LISTING_STATUSES: ListingStatusMeta[] = [
	{ value: 'draft', label: 'Draft', icon: 'lucide:file-edit' },
	{ value: 'active', label: 'Active', icon: 'lucide:circle-check' },
	{ value: 'paused', label: 'Paused', icon: 'lucide:pause' },
	{ value: 'out_of_stock', label: 'Out of stock', icon: 'lucide:package-x' },
	{ value: 'archived', label: 'Archived', icon: 'lucide:archive' }
];

export function listingStatusLabel(s?: string | null): string {
	return LISTING_STATUSES.find((x) => x.value === s)?.label ?? '—';
}

export function listingStatusIcon(s?: string | null): string {
	return LISTING_STATUSES.find((x) => x.value === s)?.icon ?? 'lucide:circle-dot';
}

// ── Channel connection status (live sync state) ─────────────────────────────

export interface ConnectionStatusMeta {
	value: MarketplaceConnectionStatus;
	label: string;
	tone: 'success' | 'warning' | 'neutral' | 'error';
}

export const CONNECTION_STATUSES: ConnectionStatusMeta[] = [
	{ value: 'connected', label: 'Connected', tone: 'success' },
	{ value: 'pending', label: 'Connecting', tone: 'warning' },
	{ value: 'error', label: 'Error', tone: 'error' },
	{ value: 'disconnected', label: 'Disconnected', tone: 'neutral' }
];

export function connectionStatusMeta(
	s?: string | null
): ConnectionStatusMeta {
	return (
		CONNECTION_STATUSES.find((x) => x.value === s) ?? CONNECTION_STATUSES[3]
	);
}

// `MarketplaceConnection` is referenced above; imported lazily to keep helpers tidy.

// ── Reviews ─────────────────────────────────────────────────────────────────

export interface ReviewStatusMeta {
	value: MarketplaceReviewStatus;
	label: string;
}

export const REVIEW_STATUSES: ReviewStatusMeta[] = [
	{ value: 'published', label: 'Published' },
	{ value: 'pending', label: 'Pending' },
	{ value: 'flagged', label: 'Flagged' },
	{ value: 'replied', label: 'Replied' },
	{ value: 'hidden', label: 'Hidden' }
];

export function reviewStatusLabel(s?: string | null): string {
	return REVIEW_STATUSES.find((x) => x.value === s)?.label ?? '—';
}

/** Stars rendered as a numeric + visual rating (1–5). */
export function ratingStars(rating: number): string {
	const r = Math.max(0, Math.min(5, Math.round(rating)));
	return '★★★★★'.slice(0, r) + '☆☆☆☆☆'.slice(0, 5 - r);
}

/** Aggregate rating distribution helper. */
export function ratingDistribution(ratings: number[]): Record<number, number> {
	const out: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
	for (const r of ratings) {
		const bucket = Math.max(1, Math.min(5, Math.round(r)));
		out[bucket] += 1;
	}
	return out;
}
