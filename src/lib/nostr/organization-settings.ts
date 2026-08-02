import { browser } from '$app/environment';
import type { BusinessModel, BusinessType, TenantContext } from './tenant.svelte';

export const ORGANIZATION_SETTINGS_KEY = 'bnos-os:settings-organization';

export interface CompanySettings {
	id: string;
	code: string;
	name: string;
	businessModel: BusinessModel;
	businessType: BusinessType;
	currency: string;
	enableTax: boolean;
	taxRate: number;
}

export interface BranchSettings {
	id: string;
	code: string;
	storeId: string;
	name: string;
	address: string;
	phone: string;
	email: string;
	status: 'active' | 'inactive';
}

export interface OrganizationSettingsSnapshot {
	companies: CompanySettings[];
	branches: BranchSettings[];
	activeCompanyId: string;
	activeBranchId: string;
}

export function readOrganizationSettings(): OrganizationSettingsSnapshot | null {
	if (!browser) return null;
	try {
		const raw = localStorage.getItem(ORGANIZATION_SETTINGS_KEY);
		return raw ? (JSON.parse(raw) as OrganizationSettingsSnapshot) : null;
	} catch {
		return null;
	}
}

export function writeOrganizationSettings(snapshot: OrganizationSettingsSnapshot) {
	if (!browser) return;
	localStorage.setItem(ORGANIZATION_SETTINGS_KEY, JSON.stringify(snapshot));
}

export function upsertOrganizationSettingsFromTenant(tenant: TenantContext) {
	if (!browser || !tenant.organizationId || !tenant.organizationName) return;

	const current = readOrganizationSettings() ?? {
		companies: [],
		branches: [],
		activeCompanyId: '',
		activeBranchId: ''
	};

	const company: CompanySettings = {
		id: tenant.organizationId,
		code: tenant.organizationCode || tenant.organizationId,
		name: tenant.organizationName,
		businessModel: tenant.businessModel,
		businessType: tenant.businessType,
		currency: tenant.currency,
		enableTax: tenant.defaultTaxRate > 0,
		taxRate: tenant.defaultTaxRate
	};

	const companies = [company, ...current.companies.filter((item) => item.id !== company.id)];
	const branches = tenant.locationId
		? [
			{
				id: tenant.locationId,
				code: tenant.locationId,
				storeId: tenant.organizationId,
				name: tenant.locationName || 'Main Branch',
				address: '',
				phone: '',
				email: '',
				status: 'active' as const
			},
			...current.branches.filter((item) => item.id !== tenant.locationId)
		]
		: current.branches;

	writeOrganizationSettings({
		companies,
		branches,
		activeCompanyId: tenant.organizationId,
		activeBranchId: tenant.locationId ?? current.activeBranchId
	});
}
