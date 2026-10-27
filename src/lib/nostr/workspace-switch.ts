/**
 * Workspace switching — one entry point for "make this company (+ branch) the
 * active workspace". Used by the account menu and the organization settings
 * page so both paths apply the same tenant context, staff role, persisted
 * snapshot and relay state.
 */
import { browser } from '$app/environment';
import { tenant } from './tenant.svelte';
import { memberships } from './memberships.svelte';
import { applyWorkspaceSettingsFromOrganization } from './workspace-settings';
import {
	readOrganizationSettings,
	writeOrganizationSettings,
	syncOrganizationSettingsToWorkspace,
	type BranchSettings,
	type CompanySettings
} from './organization-settings';

/** Dispatched after a switch so open views can reload company-scoped state. */
export const WORKSPACE_SWITCHED_EVENT = 'bnos:workspace-switched';

export interface WorkspaceOptions {
	companies: CompanySettings[];
	branches: BranchSettings[];
}

/** Companies/branches the switcher can offer (from the persisted snapshot). */
export function workspaceSwitchOptions(): WorkspaceOptions {
	const snapshot = readOrganizationSettings();
	return {
		companies: snapshot?.companies ?? [],
		branches: snapshot?.branches ?? []
	};
}

/**
 * Activate `companyId` and, unless a branch is given, its first active branch.
 * Pass `branchId: null` to switch company without a branch.
 */
export async function switchWorkspace(
	companyId: string,
	branchId?: string | null
): Promise<boolean> {
	if (!browser || !companyId) return false;
	const snapshot = readOrganizationSettings();
	if (!snapshot) return false;

	const company = snapshot.companies.find((c) => c.id === companyId);
	if (!company) return false;

	const companyBranches = snapshot.branches.filter((b) => b.storeId === companyId);
	const branch =
		branchId === undefined
			? (companyBranches.find((b) => b.status === 'active') ?? companyBranches[0])
			: (companyBranches.find((b) => b.id === branchId) ?? null);

	tenant.configure({
		organizationId: company.id,
		organizationCode: company.code,
		organizationName: company.name,
		organizationLogoUrl: company.logoUrl,
		businessModel: company.businessModel,
		businessType: company.businessType,
		currency: company.currency,
		defaultTaxRate: company.enableTax ? company.taxRate : 0,
		taxIncludedInPrice: company.taxIncluded,
		locationId: branch?.id ?? null,
		locationName: branch?.name ?? ''
	});

	// Rebind the role/branch access to the new company before anything renders.
	await memberships.resolveActiveCompany();
	tenant.completeSetup();

	const next = {
		...snapshot,
		activeCompanyId: company.id,
		activeBranchId: branch?.id ?? ''
	};
	writeOrganizationSettings(next);
	await syncOrganizationSettingsToWorkspace(next);
	applyWorkspaceSettingsFromOrganization();

	if (browser) window.dispatchEvent(new CustomEvent(WORKSPACE_SWITCHED_EVENT));
	return true;
}
