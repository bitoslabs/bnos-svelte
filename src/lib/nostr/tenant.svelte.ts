/**
 * Tenant context — the active organization + location (+ currency) the app is
 * operating under. These ids seed the `GloScope` of every record the app
 * creates and the `createGloFilter` scope topic of every relay query. Set
 * during the setup wizard and persisted to localStorage.
 */
import { browser } from '$app/environment';
import { NOSTR_KINDS } from '@bitos/bnos-core';
import { createGloObject, type GloOrganization } from '@bitos/bnos-core/glo';

const STORAGE_KEY = 'bnos-os:tenant';

export type BusinessModel =
	| 'single'
	| 'multi_branch'
	| 'chain'
	| 'franchise_hq'
	| 'franchise_branch';

export type BusinessType =
	| 'retail'
	| 'restaurant'
	| 'cafe'
	| 'service'
	| 'wholesale'
	| 'other';

export interface TenantContext {
	organizationId: string;
	organizationName: string;
	organizationCode: string;
	businessModel: BusinessModel;
	businessType: BusinessType;
	locationId: string | null;
	locationName: string;
	currency: string;
	defaultTaxRate: number;
	taxIncludedInPrice: boolean;
	setupComplete: boolean;
}

export const DEFAULT_TENANT: TenantContext = {
	organizationId: '',
	organizationName: '',
	organizationCode: '',
	businessModel: 'single',
	businessType: 'retail',
	locationId: null,
	locationName: '',
	currency: 'USD',
	defaultTaxRate: 0,
	taxIncludedInPrice: false,
	setupComplete: false
};

function hasTenantChanges(state: TenantContext, patch: Partial<TenantContext>) {
	return (Object.keys(patch) as (keyof TenantContext)[]).some((key) => !Object.is(state[key], patch[key]));
}

class TenantStore {
	state = $state<TenantContext>({ ...DEFAULT_TENANT });
	hydrated = $state(false);

	load = () => {
		if (!browser) return;
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (raw) this.state = { ...DEFAULT_TENANT, ...JSON.parse(raw) };
		} catch {
			/* ignore */
		}
		this.hydrated = true;
	};

	persist = () => {
		if (!browser) return;
		localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
	};

	/** Configure the tenant during/after setup. */
	configure = (patch: Partial<TenantContext>) => {
		if (!hasTenantChanges(this.state, patch)) return;
		this.state = { ...this.state, ...patch };
		this.persist();
	};

	completeSetup = () => {
		if (this.state.setupComplete) return;
		this.state = { ...this.state, setupComplete: true };
		this.persist();
	};

	reset = () => {
		this.state = { ...DEFAULT_TENANT };
		if (browser) localStorage.removeItem(STORAGE_KEY);
	};

	get scope() {
		return {
			organizationId: this.state.organizationId,
			locationId: this.state.locationId ?? undefined,
			ownerPubkey: undefined
		};
	}

	/** Restaurant flows (tables / kitchen / waiter / queue) are enabled for
	 * eat-in business types — mirrors bdgo-os feature gating. */
	get restaurantEnabled() {
		return this.state.businessType === 'restaurant' || this.state.businessType === 'cafe';
	}

	/** Multi-location model — gates branch management UI. */
	get isMultiLocation() {
		return (
			this.state.businessModel === 'multi_branch' ||
			this.state.businessModel === 'chain' ||
			this.state.businessModel === 'franchise_hq' ||
			this.state.businessModel === 'franchise_branch'
		);
	}
}

export const tenant = new TenantStore();

/** Build a GLO organization object for the active tenant (used by setup). */
export function makeOrganizationObject(input: Partial<GloOrganization> & { id: string }) {
	return createGloObject<GloOrganization, 'organization'>({
		type: 'organization',
		id: input.id,
		scope: { organizationId: input.id },
		visibility: 'organization',
		data: {
			name: input.name ?? 'My Store',
			currency: input.currency ?? tenant.state.currency,
			...input
		},
		extensions: {
			// bdgo-os business profile carried as GLO extensions (non-standard fields).
			'org.bitos.bnos': {
				businessType: tenant.state.businessType,
				businessModel: tenant.state.businessModel,
				taxRate: tenant.state.defaultTaxRate,
				taxIncluded: tenant.state.taxIncludedInPrice
			}
		} as never
	});
}

export { NOSTR_KINDS };
