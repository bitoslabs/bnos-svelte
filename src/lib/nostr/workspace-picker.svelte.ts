/**
 * Post-login workspace picker.
 *
 * When a user belongs to more than one company, the workspace resolver would
 * otherwise silently pick one (the last active company, or the first record).
 * This store opens a one-time chooser after login so the user explicitly picks
 * the company (and branch) they want to work in.
 *
 * The choice is remembered per identity in `sessionStorage`, so a page reload
 * does not re-prompt; signing out clears it (sessionStorage is wiped on logout).
 */
import { browser } from '$app/environment';
import { session } from './session.svelte';
import { tenant } from './tenant.svelte';
import { glo } from './store.svelte';
import { memberships } from './memberships.svelte';
import { switchWorkspace, workspaceSwitchOptions, type WorkspaceOptions } from './workspace-switch';
import type { BranchSettings, CompanySettings } from './organization-settings';

const PICKED_PREFIX = 'bnos-os:workspace-picked:';

class WorkspacePickerStore {
	open = $state(false);
	companies = $state<CompanySettings[]>([]);
	branches = $state<BranchSettings[]>([]);
	selectedCompanyId = $state('');
	selectedBranchId = $state('');
	switching = $state(false);

	get selectedCompany(): CompanySettings | undefined {
		return this.companies.find((company) => company.id === this.selectedCompanyId);
	}

	get selectedCompanyName(): string {
		return this.selectedCompany?.name ?? '';
	}

	/** Branches the identity can use within a company. */
	private branchesFor(companyId: string): BranchSettings[] {
		const all = this.branches.filter((branch) => branch.storeId === companyId);
		const allowed = memberships.myBranchesForCompany(companyId);
		// No membership data yet → do not hide branches.
		if (!allowed.length) return all;
		return all.filter((branch) => allowed.includes(branch.id));
	}

	/** Branches belonging to the selected company. */
	get selectedCompanyBranches(): BranchSettings[] {
		return this.branchesFor(this.selectedCompanyId);
	}

	private pickedKey(): string {
		return `${PICKED_PREFIX}${session.pubkey ?? ''}`;
	}

	/** True once this identity has chosen a workspace in this tab. */
	hasPicked(): boolean {
		if (!browser) return false;
		try {
			return sessionStorage.getItem(this.pickedKey()) === '1';
		} catch {
			return false;
		}
	}

	private markPicked() {
		if (!browser) return;
		try {
			sessionStorage.setItem(this.pickedKey(), '1');
		} catch {
			/* best effort */
		}
	}

	/**
	 * Companies the signed-in identity can actually open. Owners see the
	 * companies they authored; staff see the companies they have an active
	 * membership in. When membership data is not available yet we do not hide
	 * anything (the resolver will still guard access).
	 */
	private accessibleCompanies(companies: CompanySettings[]): CompanySettings[] {
		const me = session.pubkey?.trim().toLowerCase() ?? '';
		const staffCompanies = new Set(memberships.myCompanies);
		if (staffCompanies.size === 0) return companies;

		return companies.filter((company) => {
			if (staffCompanies.has(company.id)) return true;
			const org = glo
				.all<Record<string, unknown>>('organization')
				.find((item) => item.id === company.id);
			const owner = (org?.scope?.ownerPubkey ?? '').trim().toLowerCase();
			return !owner || owner === me;
		});
	}

	/**
	 * Open the chooser when the identity has more than one accessible company
	 * and has not already picked one in this tab. Returns true when it opened.
	 */
	maybePrompt(): boolean {
		if (!browser || !session.pubkey) return false;
		if (this.open) return true;
		if (this.hasPicked()) return false;

		const options: WorkspaceOptions = workspaceSwitchOptions();
		const companies = this.accessibleCompanies(options.companies);
		if (companies.length <= 1) return false;

		this.companies = companies;
		this.branches = options.branches;
		this.selectedCompanyId =
			companies.find((company) => company.id === tenant.state.organizationId)?.id ??
			companies[0].id;
		this.selectCompany(this.selectedCompanyId);
		this.open = true;
		return true;
	}

	/** Select a company and default to its first active branch. */
	selectCompany(companyId: string) {
		this.selectedCompanyId = companyId;
		const branches = this.branchesFor(companyId);
		this.selectedBranchId =
			branches.find((branch) => branch.status === 'active')?.id ?? branches[0]?.id ?? '';
	}

	/** Apply the selection and close the chooser. */
	async confirm(): Promise<boolean> {
		if (!this.selectedCompanyId) return false;
		this.switching = true;
		try {
			const ok = await switchWorkspace(this.selectedCompanyId, this.selectedBranchId || undefined);
			if (ok) {
				this.markPicked();
				this.open = false;
			}
			return ok;
		} finally {
			this.switching = false;
		}
	}

	/** Keep the workspace the resolver already activated. */
	keepCurrent() {
		this.markPicked();
		this.open = false;
	}

	/** Reset in-memory state (used on sign-out). */
	reset() {
		this.open = false;
		this.companies = [];
		this.branches = [];
		this.selectedCompanyId = '';
		this.selectedBranchId = '';
		this.switching = false;
	}
}

export const workspacePicker = new WorkspacePickerStore();
