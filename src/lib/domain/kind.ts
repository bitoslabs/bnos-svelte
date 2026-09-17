/**
 * GLO object-type ↔ Nostr-kind registry.
 *
 * The **kind** for every object is resolved through the authoritative
 * `GLO_KIND_BY_TYPE` map exported from `@bitos/bnos-core/glo`. This module
 * never hard-codes a Nostr kind number — it only declares the object *types*
 * the bnos-svelte client uses and derives their kinds from the standard.
 *
 * Known BNOS types (catalog.*, commerce.*, crm.*, identity.staff,
 * inventory.adjustment, location, organization) keep their central domain
 * kind. Extension types (supplier, expense, membership, …) have no registered
 * domain meaning yet, so `getGloKindForType` returns the NIP-78 application
 * data fallback `30078` for them — exactly as the GLO spec requires.
 *
 * @see @bitos/bnos-core `docs/GLO.md` and `docs/KIND-AUDIT.md`
 */
import { NOSTR_KINDS } from '@bitos/bnos-core';
import { GLO_KIND_BY_TYPE, getGloKindForType, type GloObjectType } from '@bitos/bnos-core/glo';

/**
 * The object types bnos-svelte reads and writes.
 *
 * - Known GLO types use their canonical dotted name.
 * - Extension types use a short kebab name. Most ride NIP-78 `30078`;
 *   shift/cash-event use their registered BNOS event kinds.
 */
export const TYPE = {
	// catalog (known kinds 30100–30103)
	product: 'catalog.product',
	category: 'catalog.category',
	unit: 'catalog.unit',
	modifierGroup: 'catalog.modifier-group',
	// commerce (known kinds 30200–30202)
	order: 'commerce.order',
	payment: 'commerce.payment',
	refund: 'commerce.refund',
	// crm (known kind 30300)
	customer: 'crm.customer',
	// identity (known kind 30500)
	staff: 'identity.staff',
	// inventory (known kind 30400)
	adjustment: 'inventory.adjustment',
	// organization (known kind 30078)
	organization: 'organization',
	// location (known kind 30600)
	location: 'location',
	/** Alias kept for the settings/branches UI (`glo.all(TYPE.branch)`). */
	branch: 'location',
	// extension types → NIP-78 fallback 30078
	supplier: 'supplier',
	purchaseOrder: 'purchase-order',
	stockTransfer: 'stock-transfer',
	expense: 'expense',
	coupon: 'coupon',
	promotion: 'promotion',
	loyaltyPoints: 'loyalty-points',
	membership: 'membership',
	membershipSubscription: 'membership-subscription',
	membershipCheckIn: 'membership-check-in',
	shift: 'shift',
	cashEvent: 'cash-event',
	// audit / activity feed (NIP-78 fallback 30078)
	activity: 'activity',
	// marketplace (dedicated BNOS marketplace kinds 30950–30955)
	marketplaceConnection: 'marketplace.connection',
	marketplaceProduct: 'marketplace.product',
	marketplaceReview: 'marketplace.review'
} as const satisfies Record<string, GloObjectType | string>;

export type DomainType = keyof typeof TYPE;
export type DomainTypeValue = (typeof TYPE)[DomainType];

/**
 * Authoritative kind for each client type, derived from the standard map
 * plus app-side BNOS kinds that are not yet in the GLO type map.
 * `KIND.product === 30100`, `KIND.expense === 30078`, etc.
 */
const APP_KIND_OVERRIDES: Partial<Record<DomainType, number>> = {
	shift: NOSTR_KINDS.SHIFT,
	cashEvent: NOSTR_KINDS.CASH_EVENT,
	// Marketplace types ride the dedicated BNOS marketplace kinds (30950–30955)
	// reserved in @bitos/bnos-core but not yet registered in GLO_KIND_BY_TYPE.
	marketplaceConnection: NOSTR_KINDS.STORE_CONNECTION,
	marketplaceProduct: NOSTR_KINDS.MARKETPLACE_PRODUCT,
	marketplaceReview: NOSTR_KINDS.MARKETPLACE_REVIEW
};

export const KIND = Object.fromEntries(
	(Object.keys(TYPE) as DomainType[]).map((k) => [
		k,
		APP_KIND_OVERRIDES[k] ?? getGloKindForType(TYPE[k])
	])
) as { [K in DomainType]: number };

/** Type-string → resolved kind (e.g. `kindForType('commerce.order') === 30200`). */
export const KIND_BY_TYPE: Record<string, number> = Object.fromEntries(
	(Object.keys(TYPE) as DomainType[]).map((k) => [TYPE[k], KIND[k]])
);
export function kindForType(type: string): number {
	return KIND_BY_TYPE[type] ?? getGloKindForType(type);
}

/** Reverse lookup: kind number → list of client type keys using it. */
export const TYPES_FOR_KIND: Record<number, DomainType[]> = (() => {
	const out: Record<number, DomainType[]> = {};
	for (const key of Object.keys(TYPE) as DomainType[]) {
		const kind = KIND[key];
		(out[kind] ??= []).push(key);
	}
	return out;
})();

/** Re-export the standard map so callers have a single import surface. */
export { GLO_KIND_BY_TYPE, getGloKindForType };
