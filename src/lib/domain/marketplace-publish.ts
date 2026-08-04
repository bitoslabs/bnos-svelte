/**
 * Marketplace publish helpers — leak-safe projection of internal catalog data
 * to a public marketplace listing.
 *
 * The threat
 * ----------
 * A `catalog.product` (kind 30100, org-internal) carries internal economics:
 * `cost`, `costPrice`, `supplierId`/`preferredSupplierId`/`supplierSku`,
 * inventory reorder thresholds (`lowStockThreshold`, `reorderPoint`,
 * `reorderQuantity`, `unitCost`), `taxRate`, margins. A `marketplace.product`
 * listing (kind 30951) is the PUBLIC face published to channels/relays for
 * discovery. If a listing is built by spreading the catalog product
 * (`{ ...product.data }`), all that internal economics leaks publicly.
 *
 * The fix
 * -------
 * `toPublicListing` builds a listing from a catalog product using an
 * **allowlist** — it copies ONLY public fields, by construction. `redactListing`
 * is defense-in-depth: it strips any internal field that snuck onto a listing
 * object before it is published. Use both; neither alone is sufficient if a
 * future refactor spreads catalog fields.
 */
import type { MarketplaceProduct, Product } from './types';

/** Fields safe to expose publicly on a listing. Everything else is internal. */
const PUBLIC_PRODUCT_FIELDS = new Set([
	'name',
	'sku',
	'barcode',
	'description',
	'price',
	'images',
	'image',
	'tags',
	'currency'
]);

/** Internal-economics field names that must NEVER appear on a public listing. */
export const INTERNAL_ECONOMICS_FIELDS = [
	'cost',
	'costPrice',
	'supplierId',
	'preferredSupplierId',
	'supplierSku',
	'supplierIds',
	'unitCost',
	'taxRate',
	'taxable',
	'taxInclusive',
	'margin',
	'inventory',
	'productInventoryLink',
	'lowStockThreshold',
	'reorderPoint',
	'reorderQuantity',
	'allowBackorder',
	'denySaleWhenOutOfStock'
] as const;
const INTERNAL_FIELD_SET = new Set<string>(INTERNAL_ECONOMICS_FIELDS);

export interface PublicListingInput {
	channelIds: string[];
	price?: number;
	compareAtPrice?: number;
	inventoryTracked?: boolean;
	stock?: number;
	description?: string;
	images?: string[];
	status?: MarketplaceProduct['status'];
	publishedAt?: string;
}

/**
 * Build a marketplace listing from a catalog product, copying ONLY allowlisted
 * public fields. Internal economics can't leak because they're never read.
 * Returns the listing data (caller adds id/scope via `glo.upsert`).
 */
export function toPublicListing(
	product: { id: string; data: Product },
	input: PublicListingInput
): MarketplaceProduct {
	const d = product.data as unknown as Record<string, unknown>;
	const images =
		input.images ??
		(Array.isArray(d.images)
			? (d.images as string[])
			: typeof d.image === 'string'
				? [d.image]
				: undefined);

	// SKU/barcode are public (channels need them for sync). Cost/supplier are NOT.
	const sku = typeof d.sku === 'string' ? d.sku : undefined;

	return {
		productId: product.id,
		productName: typeof d.name === 'string' ? d.name : 'Untitled product',
		sku,
		channelIds: input.channelIds.slice(),
		status: input.status ?? 'draft',
		price: input.price ?? (typeof d.price === 'number' ? d.price : 0),
		compareAtPrice: input.compareAtPrice,
		inventoryTracked: input.inventoryTracked ?? false,
		stock: input.inventoryTracked ? input.stock : undefined,
		images: images?.length ? images : undefined,
		description:
			input.description ?? (typeof d.description === 'string' ? d.description : undefined),
		publishedAt: input.publishedAt
	};
}

/**
 * Defense-in-depth: strip any internal-economics fields present on a listing
 * object before it is published to a public channel/relay. Idempotent.
 * Accepts any object shape (typed return preserves the input type).
 */
export function redactListing<T>(listing: T): T {
	const source = listing as Record<string, unknown>;
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(source)) {
		if (INTERNAL_FIELD_SET.has(key)) continue;
		out[key] = value;
	}
	return out as T;
}

/** True if a listing payload contains any internal-economics field (leak check). */
export function hasInternalFields<T>(listing: T): boolean {
	return Object.keys(listing as Record<string, unknown>).some((k) => INTERNAL_FIELD_SET.has(k));
}

/** Re-export the allowlist for tests / docs. */
export { PUBLIC_PRODUCT_FIELDS };
