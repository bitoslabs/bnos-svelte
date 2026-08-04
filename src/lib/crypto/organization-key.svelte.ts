/**
 * Organization key — runes-based singleton: the single entry point for "do we
 * have the AES key for the active organization, and please encrypt/decrypt
 * with it".
 *
 * Ported from bdgo-os `useCompanyKeys`, renamed to the GLO standard term
 * `organization` (one key per organization — the GLO trust boundary), with a
 * clean scheme id. One key per org means a manager/owner retains cross-branch
 * visibility (orders, shifts, reports) while the payload stays confidential to
 * the org.
 *
 * Lifecycle
 * ---------
 *  • Owner device → `ensureActiveKey()` mints the 32-byte organization key.
 *  • Staff device  → `ensureActiveKey()` first pulls NIP-44 key grants
 *    (`syncKeyGrantsForCurrentUser`); the imported key lands under the same
 *    `organization:<orgId>` scope, so `protectSensitiveValue` works unchanged.
 *  • On logout → caller wipes stored keys.
 */
import { browser } from '$app/environment';
import { tenant } from '$nostr/tenant.svelte';
import { session } from '$nostr/session.svelte';
import {
	getOrCreateSensitiveDataKey,
	getSensitiveDataKeyId,
	getSensitiveDataScopeId,
	getStoredSensitiveDataKey,
	isEncryptionEnvelope,
	protectSensitiveValue,
	unprotectSensitiveValue
} from './sensitive-data';
import { syncKeyGrantsForCurrentUser } from './organization-key-grants';
import type { SensitiveDataDomain } from './privacy';

/** localStorage flag that enables payload encryption (opt-in, default off). */
const ENABLED_KEY = 'bnos-os:encryption';

/** Is payload encryption switched on for this device? */
export const isEncryptionEnabled = (): boolean =>
	browser && localStorage.getItem(ENABLED_KEY) === '1';

/** Toggle payload encryption (existing plaintext data stays plaintext). */
export const setEncryptionEnabled = (enabled: boolean) => {
	if (!browser) return;
	if (enabled) localStorage.setItem(ENABLED_KEY, '1');
	else localStorage.removeItem(ENABLED_KEY);
};

class OrganizationKeyStore {
	/** Scope id for the active organization (`organization:<orgId>`), or null. */
	get activeScopeId(): string | null {
		if (!tenant.state.organizationId) return null;
		return getSensitiveDataScopeId(tenant.state.organizationId, session.pubkey);
	}

	/** Key id for the active organization scope (`organization:<orgId>:v1`). */
	get activeKeyId(): string | null {
		if (!this.activeScopeId) return null;
		return getSensitiveDataKeyId(this.activeScopeId);
	}

	/** Is the active organization's AES key present locally? */
	get hasActiveKey(): boolean {
		if (!this.activeKeyId) return false;
		return !!getStoredSensitiveDataKey(this.activeKeyId);
	}

	/** Only owner/admin may mint a new organization key. */
	get canCreateKey(): boolean {
		return tenant.state.activeRole === 'owner' || tenant.state.activeRole === 'admin';
	}

	/**
	 * Ensure the active organization's AES key is available locally.
	 *  1. already stored → use it
	 *  2. staff → sync NIP-44 grants, then use the imported key
	 *  3. owner/admin → mint a new key
	 * Throws if a staff member has no grant and no permission to create.
	 */
	ensureActiveKey = async (options: { allowCreate?: boolean } = {}): Promise<string> => {
		const scopeId = this.activeScopeId;
		if (!scopeId) throw new Error('No active organization to secure');
		const keyId = getSensitiveDataKeyId(scopeId);
		if (getStoredSensitiveDataKey(keyId)) return keyId;

		if (options.allowCreate !== false && this.canCreateKey) {
			getOrCreateSensitiveDataKey(scopeId);
			return keyId;
		}

		// Staff path: pull the key through NIP-44 grants.
		await syncKeyGrantsForCurrentUser();
		if (getStoredSensitiveDataKey(keyId)) return keyId;

		throw new Error(
			'Organization encryption key is not available. Ask an owner/admin to grant this staff key.'
		);
	};

	/** Best-effort: ensure the key for the active org on context change. */
	autoEnsureActiveKey = async (): Promise<void> => {
		if (this.activeScopeId && session.pubkey) {
			try {
				await this.ensureActiveKey();
			} catch {
				/* staff without a grant yet — encryption stays off until granted */
			}
		}
	};

	/** Encrypt a value for the active organization. Returns the AES-GCM envelope object. */
	encrypt = async (
		value: unknown,
		domain: SensitiveDataDomain,
		extra?: { branchId?: string | null; recordId?: string | null }
	) => {
		const scopeId = this.activeScopeId;
		if (!scopeId) throw new Error('No active organization to encrypt for');
		if (!getStoredSensitiveDataKey(getSensitiveDataKeyId(scopeId))) {
			await this.ensureActiveKey({ allowCreate: this.canCreateKey });
		}
		return protectSensitiveValue(value, {
			domain,
			scopeId,
			organizationId: tenant.state.organizationId || undefined,
			branchId: extra?.branchId ?? null,
			recordId: extra?.recordId ?? null
		});
	};

	/** Decrypt an envelope object (passthrough if not encrypted). */
	decrypt = async <T>(value: unknown): Promise<T> => {
		return unprotectSensitiveValue<T>(value);
	};

	/** Convenience: is a value an encryption envelope? */
	isEncrypted = (value: unknown): boolean => isEncryptionEnvelope(value);
}

export const organizationKey = new OrganizationKeyStore();
