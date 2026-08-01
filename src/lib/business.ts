/**
 * Business-profile option sets — ported from bdgo-os `setup/company.vue` so the
 * onboarding wizard offers the same shop / business-type choices. Icons resolve
 * to the offline Lucide set (see lib/icons.ts).
 */
import type { BusinessModel, BusinessType } from '$nostr/tenant.svelte';

export interface BusinessModelOption {
	value: BusinessModel;
	label: string;
	icon: string;
	desc: string;
}

export const businessModels: BusinessModelOption[] = [
	{ value: 'single', label: 'Single store', icon: 'lucide:store', desc: 'One location, one team' },
	{ value: 'multi_branch', label: 'Multi-branch', icon: 'lucide:building-2', desc: 'Several owned locations' },
	{ value: 'chain', label: 'Chain', icon: 'lucide:link', desc: 'Linked stores, shared catalog' },
	{ value: 'franchise_hq', label: 'Franchise HQ', icon: 'lucide:globe', desc: 'Own the brand, onboard branches' },
	{ value: 'franchise_branch', label: 'Franchise branch', icon: 'lucide:map', desc: 'Operate under a brand' }
];

export interface BusinessTypeOption {
	value: BusinessType;
	label: string;
	icon: string;
	/** Enables the restaurant module (tables / kitchen / waiter / queue). */
	restaurant?: boolean;
}

export const businessTypes: BusinessTypeOption[] = [
	{ value: 'retail', label: 'Retail', icon: 'lucide:shopping-bag' },
	{ value: 'restaurant', label: 'Restaurant', icon: 'lucide:utensils', restaurant: true },
	{ value: 'cafe', label: 'Café', icon: 'lucide:coffee', restaurant: true },
	{ value: 'service', label: 'Service', icon: 'lucide:scissors' },
	{ value: 'wholesale', label: 'Wholesale', icon: 'lucide:truck' },
	{ value: 'other', label: 'Other', icon: 'lucide:circle-dot' }
];

export const currencies = [
	{ value: 'USD', label: 'USD · US Dollar' },
	{ value: 'THB', label: 'THB · Thai Baht' },
	{ value: 'LAK', label: 'LAK · Lao Kip' },
	{ value: 'EUR', label: 'EUR · Euro' },
	{ value: 'GBP', label: 'GBP · British Pound' },
	{ value: 'JPY', label: 'JPY · Japanese Yen' },
	{ value: 'CNY', label: 'CNY · Chinese Yuan' },
	{ value: 'VND', label: 'VND · Vietnamese Dong' },
	{ value: 'BTC', label: 'BTC · Bitcoin (sats)' }
];

/** Sample catalog seed per business type (used by the catalog setup step). */
export function seedForType(type: BusinessType): { name: string; price: number; categoryId: string }[] {
	switch (type) {
		case 'cafe':
			return [
				{ name: 'Espresso', price: 25_000, categoryId: 'drinks' },
				{ name: 'Cappuccino', price: 35_000, categoryId: 'drinks' },
				{ name: 'Latte', price: 38_000, categoryId: 'drinks' },
				{ name: 'Croissant', price: 20_000, categoryId: 'bakery' }
			];
		case 'restaurant':
			return [
				{ name: 'Pad Thai', price: 60_000, categoryId: 'mains' },
				{ name: 'Tom Yum Goong', price: 75_000, categoryId: 'mains' },
				{ name: 'Som Tum', price: 45_000, categoryId: 'starters' },
				{ name: 'Mango Sticky Rice', price: 50_000, categoryId: 'dessert' },
				{ name: 'Chang Beer', price: 40_000, categoryId: 'drinks' }
			];
		case 'service':
			return [
				{ name: 'Haircut', price: 100_000, categoryId: 'services' },
				{ name: 'Beard trim', price: 40_000, categoryId: 'services' },
				{ name: 'Shampoo & blow-dry', price: 80_000, categoryId: 'services' }
			];
		case 'wholesale':
			return [
				{ name: 'Carton · 24 units', price: 240_000, categoryId: 'cases' },
				{ name: 'Pallet · 120 units', price: 1_200_000, categoryId: 'bulk' }
			];
		case 'retail':
		default:
			return [
				{ name: 'Bottled Water', price: 8_000, categoryId: 'drinks' },
				{ name: 'Snack Pack', price: 15_000, categoryId: 'snacks' },
				{ name: 'Phone Cable', price: 45_000, categoryId: 'electronics' },
				{ name: 'Tote Bag', price: 30_000, categoryId: 'accessories' }
			];
	}
}
