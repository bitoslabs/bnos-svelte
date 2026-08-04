/**
 * Reactive feature-flag store — the single source of truth for module
 * toggles (Marketplace, Restaurant, Loyalty, CRM, Multi-branch, AI …).
 *
 * Replaces the local-state copy that lived inside `settings/features/+page`.
 * Because `state` is a `$state` proxy, the sidebar / layout re-render the
 * moment a flag flips — no reload, no manual invalidation.
 *
 * Persisted to localStorage (`bnos-os:features`) and hydrated in `+layout`.
 */
import { browser } from '$app/environment';

const KEY = 'bnos-os:features';

export type FeatureKey =
	| 'restaurant'
	| 'retail'
	| 'loyalty'
	| 'crm'
	| 'multiBranch'
	| 'marketplace'
	| 'ai';

export const FEATURE_KEYS: FeatureKey[] = [
	'restaurant',
	'retail',
	'loyalty',
	'crm',
	'multiBranch',
	'marketplace',
	'ai'
];

export const FEATURE_META: Record<
	FeatureKey,
	{ icon: string; label: string; description: string }
> = {
	restaurant: {
		icon: 'lucide:chef-hat',
		label: 'Restaurant',
		description: 'Kitchen display, tables, waiter station, queue'
	},
	retail: {
		icon: 'solar:shop-minimalistic-bold-duotone',
		label: 'Retail',
		description: 'Barcode, inventory, stock adjustments'
	},
	loyalty: {
		icon: 'lucide:star',
		label: 'Loyalty points',
		description: 'Earn and redeem points at checkout'
	},
	crm: {
		icon: 'lucide:users',
		label: 'CRM',
		description: 'Customer segments, history, outreach'
	},
	multiBranch: {
		icon: 'lucide:map-pin',
		label: 'Multi-branch',
		description: 'Manage multiple locations and transfers'
	},
	marketplace: {
		icon: 'lucide:globe',
		label: 'Marketplace',
		description: 'Sell on external marketplaces & social channels'
	},
	ai: {
		icon: 'lucide:sparkles',
		label: 'AI assistant',
		description: 'Forecasting, restock suggestions, insights'
	}
};

const DEFAULTS: Record<FeatureKey, boolean> = {
	restaurant: false,
	retail: true,
	loyalty: false,
	crm: false,
	multiBranch: false,
	marketplace: false,
	ai: false
};

class FeaturesStore {
	state = $state<Record<FeatureKey, boolean>>({ ...DEFAULTS });
	hydrated = $state(false);

	load = () => {
		if (!browser) return;
		try {
			const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
			this.state = { ...DEFAULTS, ...saved };
			// Restaurant is also driven by business type when not explicitly set.
			if (saved.restaurant === undefined) {
				/* business-type override handled by tenant where needed */
			}
		} catch {
			this.state = { ...DEFAULTS };
		}
		this.hydrated = true;
	};

	private persist = () => {
		if (!browser) return;
		localStorage.setItem(KEY, JSON.stringify(this.state));
	};

	replace = (snapshot: Partial<Record<FeatureKey, boolean>>) => {
		this.state = { ...DEFAULTS, ...this.state, ...snapshot };
		this.persist();
		this.hydrated = true;
	};

	isEnabled = (key: FeatureKey): boolean => this.state[key];

	set = (key: FeatureKey, value: boolean) => {
		if (this.state[key] === value) return;
		this.state = { ...this.state, [key]: value };
		this.persist();
	};

	toggle = (key: FeatureKey) => {
		this.set(key, !this.state[key]);
		return this.state[key];
	};
}

export const features = new FeaturesStore();
