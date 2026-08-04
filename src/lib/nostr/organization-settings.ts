import { browser } from '$app/environment';
import type { BusinessModel, BusinessType, TenantContext } from './tenant.svelte';
import { glo } from './store.svelte';
import { bnosExt } from '$lib/domain/helpers';
import { currentWorkspaceSettingsPayload } from './workspace-settings';

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
	taxIncluded: boolean;
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

function normalizeCompanySettings(value: Partial<CompanySettings>): CompanySettings {
	const taxRate = typeof value.taxRate === 'number' && Number.isFinite(value.taxRate) ? value.taxRate : 0;
	const enableTax = typeof value.enableTax === 'boolean' ? value.enableTax : taxRate > 0;

	return {
		id: value.id ?? '',
		code: value.code ?? '',
		name: value.name ?? '',
		businessModel: value.businessModel ?? 'single',
		businessType: value.businessType ?? 'retail',
		currency: value.currency ?? 'USD',
		enableTax,
		taxRate,
		taxIncluded: typeof value.taxIncluded === 'boolean' ? value.taxIncluded : false
	};
}

function normalizeBranchSettings(value: Partial<BranchSettings>): BranchSettings {
	return {
		id: value.id ?? '',
		code: value.code ?? '',
		storeId: value.storeId ?? '',
		name: value.name ?? '',
		address: value.address ?? '',
		phone: value.phone ?? '',
		email: value.email ?? '',
		status: value.status === 'inactive' ? 'inactive' : 'active'
	};
}

function numberOr(value: unknown, fallback = 0): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function booleanOr(value: unknown, fallback = false): boolean {
	return typeof value === 'boolean' ? value : fallback;
}

function stringOr(value: unknown, fallback = ''): string {
	return typeof value === 'string' ? value : fallback;
}

function companyFromWorkspaceObject(object: {
	id: string;
	data?: unknown;
	extensions?: Record<string, unknown>;
}): CompanySettings {
	const data = object.data && typeof object.data === 'object'
		? (object.data as Record<string, unknown>)
		: {};
	const ext = bnosExt(object as never) ?? {};
	const taxRate = numberOr(ext.taxRate, numberOr(data.taxRate, 0));

	return normalizeCompanySettings({
		id: object.id,
		code: stringOr(data.code, object.id),
		name: stringOr(data.name, ''),
		businessModel: stringOr(ext.businessModel, 'single') as BusinessModel,
		businessType: stringOr(ext.businessType, 'retail') as BusinessType,
		currency: stringOr(data.currency, 'USD'),
		enableTax: booleanOr(ext.enableTax, taxRate > 0),
		taxRate,
		taxIncluded: booleanOr(ext.taxIncluded, booleanOr(data.taxInclusive, false))
	});
}

function branchFromWorkspaceObject(object: {
	id: string;
	data?: unknown;
	scope?: Record<string, unknown>;
}): BranchSettings {
	const data = object.data && typeof object.data === 'object'
		? (object.data as Record<string, unknown>)
		: {};
	const scope = object.scope && typeof object.scope === 'object'
		? (object.scope as Record<string, unknown>)
		: {};

	return normalizeBranchSettings({
		id: object.id,
		code: stringOr(data.code, object.id),
		storeId: stringOr(scope.organizationId, stringOr(data.storeId, '')),
		name: stringOr(data.name, ''),
		address: stringOr(data.address, ''),
		phone: stringOr(data.phone, ''),
		email: stringOr(data.email, ''),
		status: stringOr(data.status, 'active') as BranchSettings['status']
	});
}

export function readOrganizationSettings(): OrganizationSettingsSnapshot | null {
	if (!browser) return null;
	try {
		const raw = localStorage.getItem(ORGANIZATION_SETTINGS_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<OrganizationSettingsSnapshot>;
		return {
			companies: Array.isArray(parsed.companies)
				? parsed.companies.map((company) => normalizeCompanySettings(company))
				: [],
			branches: Array.isArray(parsed.branches)
				? parsed.branches.map((branch) => normalizeBranchSettings(branch))
				: [],
			activeCompanyId: parsed.activeCompanyId ?? '',
			activeBranchId: parsed.activeBranchId ?? ''
		};
	} catch {
		return null;
	}
}

export function writeOrganizationSettings(snapshot: OrganizationSettingsSnapshot) {
	if (!browser) return;
	localStorage.setItem(ORGANIZATION_SETTINGS_KEY, JSON.stringify(snapshot));
}

export function buildOrganizationSettingsFromWorkspace(active?: {
	activeCompanyId?: string;
	activeBranchId?: string | null;
}): OrganizationSettingsSnapshot | null {
	const companies = glo
		.all<Record<string, unknown>>('organization')
		.map((company) => companyFromWorkspaceObject(company))
		.filter((company) => !!company.id && !!company.name);
	const branches = glo
		.all<Record<string, unknown>>('location')
		.map((branch) => branchFromWorkspaceObject(branch))
		.filter((branch) => !!branch.id && !!branch.storeId);

	if (companies.length === 0 && branches.length === 0) return null;

	const activeCompanyId =
		active?.activeCompanyId && companies.some((company) => company.id === active.activeCompanyId)
			? active.activeCompanyId
			: companies[0]?.id ?? '';
	const activeBranchId =
		active?.activeBranchId && branches.some((branch) => branch.id === active.activeBranchId)
			? active.activeBranchId
			: branches.find((branch) => branch.storeId === activeCompanyId)?.id ?? branches[0]?.id ?? '';

	return {
		companies,
		branches,
		activeCompanyId,
		activeBranchId
	};
}

export function hydrateOrganizationSettingsFromWorkspace(active?: {
	activeCompanyId?: string;
	activeBranchId?: string | null;
}) {
	if (!browser) return null;
	const snapshot = buildOrganizationSettingsFromWorkspace(active);
	if (!snapshot) return null;
	writeOrganizationSettings(snapshot);
	return snapshot;
}

export async function syncOrganizationSettingsToWorkspace(snapshot?: OrganizationSettingsSnapshot) {
	if (!browser) return 0;

	const settings = snapshot ?? readOrganizationSettings();
	if (!settings) return 0;

	let synced = 0;

	for (const company of settings.companies) {
		const nextExt = {
			...currentWorkspaceSettingsPayload(),
			businessModel: company.businessModel,
			businessType: company.businessType,
			taxRate: company.enableTax ? company.taxRate : 0,
			taxIncluded: company.taxIncluded
		};
		await glo.upsert(
			'organization',
			{
				name: company.name,
				code: company.code,
				currency: company.currency,
				status: 'active'
			},
			{
				id: company.id,
				scope: { organizationId: company.id },
				extensions: {
					'org.bitos.bnos': nextExt
				}
			}
		);
		synced++;
	}

	for (const branch of settings.branches) {
		await glo.upsert(
			'location',
			{
				name: branch.name,
				code: branch.code,
				type: 'store',
				status: branch.status,
				address: branch.address,
				phone: branch.phone,
				email: branch.email
			},
			{
				id: branch.id,
				scope: {
					organizationId: branch.storeId,
					locationId: branch.id
				}
			}
		);
		synced++;
	}

	return synced;
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
		taxRate: tenant.defaultTaxRate,
		taxIncluded: tenant.taxIncludedInPrice
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
