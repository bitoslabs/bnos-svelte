import { features } from '$lib/features.svelte';
import { media } from '$lib/media/media.svelte';
import { notifications } from '$lib/stores/notifications.svelte';
import { glo } from './store.svelte';
import { profile } from './profile.svelte';
import { session } from './session.svelte';
import { tenant } from './tenant.svelte';

/**
 * Sign out and clear every in-memory workspace/identity store. Callers should
 * use this instead of repeating `session.logout(); tenant.reset(); …` so a
 * previous identity's data can never leak into the next session.
 */
export function clearIdentityStores(): void {
	notifications.clear();
	media.reset();
	features.reset();
	tenant.reset();
	profile.reset();
}

export async function signOutAndClear(): Promise<void> {
	await session.logout();
	glo.clearAll({ signOut: true });
	clearIdentityStores();
}
