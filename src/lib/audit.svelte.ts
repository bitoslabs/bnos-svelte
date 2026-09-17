/**
 * Audit / activity log.
 *
 * `logActivity()` appends an immutable `activity` (NIP-78) record capturing who
 * did what — the backbone of loss prevention + accountability for multi-staff
 * stores. Reads the active staff/role/branch from the tenant context so every
 * entry is correctly attributed. Never throws (logging must not break a sale).
 */
import { glo } from '$nostr/store.svelte';
import { tenant } from '$nostr/tenant.svelte';
import { session } from '$nostr/session.svelte';
import { TYPE, type Activity, type ActivityAction } from '$lib/domain';
import { newRecordId } from '$lib/utils/record-id';

type LogInput = {
	action: ActivityAction;
	resource: string;
	summary: string;
	resourceId?: string;
	amount?: number;
	currency?: string;
	meta?: Record<string, unknown>;
};

export async function logActivity(input: LogInput): Promise<void> {
	const staff = tenant.state.activeStaffInfo;
	const entry: Activity = {
		action: input.action,
		resource: input.resource,
		resourceId: input.resourceId,
		summary: input.summary,
		amount: input.amount,
		currency: input.currency,
		actorId: tenant.state.activeStaffId ?? undefined,
		actorName: staff?.name ?? session.shortNpub ?? 'System',
		actorRole: tenant.state.activeRole ?? undefined,
		branchId: tenant.state.locationId ?? undefined,
		at: new Date().toISOString(),
		meta: input.meta
	};
	try {
		await glo.upsert<Activity>(TYPE.activity, entry, { id: newRecordId('activity') });
	} catch (e) {
		console.warn('[audit] failed to log activity', e);
	}
}
