/**
 * Owner-side organization key distribution — the missing half of the
 * encryption feature.
 *
 * Why this exists
 * ---------------
 * `syncKeyGrantsForCurrentUser()` (the staff-pull side) was already wired, but
 * the owner-PUBLISH side (`buildOrganizationKeyGrantEvent` + publish) was never
 * called from anywhere. Without it, an owner who turns on encryption publishes
 * AES-encrypted orders/customers that staff devices can NEVER decrypt (they
 * find zero grants addressed to them) — encrypted records are silently dropped.
 *
 * This module closes the loop: it grants the org AES key (NIP-44-wrapped) to
 * each staff member's pubkey and publishes a kind 30512 event per recipient.
 * It runs on:
 *   1. encryption toggle ON  → grant to all existing staff
 *   2. staff create / update → grant to that staff member
 *   3. a manual "Re-share key with staff" button in Settings
 *
 * Kept in its own module to avoid the crypto import cycle
 * (organization-key.svelte ↔ organization-key-grants.ts).
 */
import { glo } from '$nostr/store.svelte';
import { tenant } from '$nostr/tenant.svelte';
import { organizationKey, isEncryptionEnabled } from './organization-key.svelte';
import {
	buildOrganizationKeyGrantEvent,
	publishOrganizationKeyGrant
} from './organization-key-grants';
import { TYPE } from '$lib/domain';

export interface GrantResult {
	granted: number;
	skipped: number;
	failed: number;
}

/** Is this device permitted to mint + distribute the org key (owner/admin)? */
export function canDistributeKey(): boolean {
	return organizationKey.canCreateKey && !!tenant.state.organizationId;
}

/** Should grants be active right now? Owner/admin + encryption on + key ready. */
export function keyDistributionActive(): boolean {
	return canDistributeKey() && isEncryptionEnabled() && organizationKey.hasActiveKey;
}

interface StaffWithPubkey {
	id: string;
	pubkey: string;
	name?: string;
}

/** All staff records that carry a pubkey (grants need a recipient). */
export function staffEligibleForKey(): StaffWithPubkey[] {
	const all = glo.all<{ pubkey?: string; name?: string }, typeof TYPE.staff>(TYPE.staff);
	return all
		.filter((s) => typeof s.data?.pubkey === 'string' && s.data.pubkey!.trim().length === 64)
		.map((s) => ({ id: s.id, pubkey: s.data!.pubkey!.trim(), name: s.data?.name }));
}

/** Grant the org key to one recipient pubkey. Returns ok / error message. */
export async function grantKeyToPubkey(
	recipientPubkey: string
): Promise<{ ok: boolean; error?: string }> {
	const orgId = tenant.state.organizationId;
	const pk = recipientPubkey.trim();
	if (!orgId) return { ok: false, error: 'No active organization' };
	if (pk.length !== 64) return { ok: false, error: 'Invalid staff pubkey' };
	if (!organizationKey.canCreateKey)
		return { ok: false, error: 'Only owner/admin can share the organization key' };
	try {
		// buildOrganizationKeyGrantEvent creates the org key if missing (idempotent).
		const event = await buildOrganizationKeyGrantEvent({
			organizationId: orgId,
			recipientPubkey: pk
		});
		const published = await publishOrganizationKeyGrant(event);
		return { ok: published, error: published ? undefined : 'Publish failed (relay offline?)' };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}

/** Grant the org key to EVERY staff member with a pubkey. Summary result. */
export async function grantKeyToAllStaff(): Promise<GrantResult> {
	if (!keyDistributionActive()) {
		const all = glo.all(TYPE.staff);
		return { granted: 0, skipped: all.length, failed: 0 };
	}
	const eligible = staffEligibleForKey();
	let granted = 0;
	let failed = 0;
	for (const s of eligible) {
		const r = await grantKeyToPubkey(s.pubkey);
		if (r.ok) granted++;
		else failed++;
	}
	return { granted, skipped: 0, failed };
}
