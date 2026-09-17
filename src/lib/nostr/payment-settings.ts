import { glo } from './store.svelte';
import { tenant } from './tenant.svelte';

// Keep this shared data module usable from both SvelteKit and plain TypeScript
// tooling. It is also safe during SSR because all browser access is guarded.
const isBrowser = () => typeof window !== 'undefined';

export const PAYMENT_SETTINGS_SYNC_EVENT = 'bnos:payment-settings-sync';

export const PAYMENT_SETTINGS_TYPES = [
	'settings.bitcoin',
	'settings.payment-method',
	'settings.pay-config'
] as const;

type PaymentSettingsType = (typeof PAYMENT_SETTINGS_TYPES)[number];

const LOCAL_KEYS: Record<PaymentSettingsType, string> = {
	'settings.bitcoin': 'bnos-os:settings-bitcoin',
	'settings.payment-method': 'bnos-os:payment-methods',
	'settings.pay-config': 'bnos-os:settings-pay'
};

const RECORD_IDS: Record<PaymentSettingsType, string> = {
	'settings.bitcoin': 'bitcoin',
	'settings.payment-method': 'payment-methods',
	'settings.pay-config': 'pay-config'
};

function notify() {
	if (isBrowser()) window.dispatchEvent(new CustomEvent(PAYMENT_SETTINGS_SYNC_EVENT));
}

function writeLocal(type: PaymentSettingsType, data: unknown) {
	if (!isBrowser()) return;
	localStorage.setItem(LOCAL_KEYS[type], JSON.stringify(data));
}

/** Publish one merchant payment configuration as an organization-scoped GLO record. */
export async function syncPaymentSettingsToNostr(
	type: PaymentSettingsType,
	data: unknown
): Promise<boolean> {
	if (!isBrowser() || !tenant.state.organizationId) return false;
	const result = await glo.upsertWithStatus(type, data, {
		id: RECORD_IDS[type],
		scope: { organizationId: tenant.state.organizationId },
		visibility: 'organization'
	});
	return result.published;
}

/** Apply a synced record to the existing local cache used by POS/settings pages. */
export function hydratePaymentSetting(type: PaymentSettingsType) {
	if (!isBrowser()) return false;
	const record = glo.get(type, RECORD_IDS[type]);
	if (!record) return false;
	writeLocal(type, record.data);
	notify();
	return true;
}

export function hydratePaymentSettingsFromNostr() {
	let count = 0;
	for (const type of PAYMENT_SETTINGS_TYPES) {
		if (hydratePaymentSetting(type)) count++;
	}
	return count;
}

/** Migrate settings created before a workspace was available, then publish them. */
export async function syncLocalPaymentSettingsToNostr(types: readonly PaymentSettingsType[] = PAYMENT_SETTINGS_TYPES) {
	if (!isBrowser() || !tenant.state.organizationId) return 0;
	let published = 0;
	for (const type of types) {
		// Relay state wins. Only migrate a local-only setting, never overwrite a
		// record that was restored from another device.
		if (glo.get(type, RECORD_IDS[type])) continue;
		const raw = localStorage.getItem(LOCAL_KEYS[type]);
		if (!raw) continue;
		try {
			if (await syncPaymentSettingsToNostr(type, JSON.parse(raw))) published++;
		} catch {
			/* The local copy remains available and the GLO publish queue retries later. */
		}
	}
	return published;
}
