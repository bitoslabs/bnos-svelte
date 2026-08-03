import { browser } from '$app/environment';
import { glo } from './store.svelte';
import { relays } from './relay.svelte';
import { session } from './session.svelte';
import { tenant } from './tenant.svelte';
import { warmRelays } from './client';
import { TYPE } from '$lib/domain';
import { syncOrganizationSettingsToWorkspace } from './organization-settings';
import { memberships } from './memberships.svelte';
import { restoreTenantFromWorkspace } from './workspace.svelte';

export const CORE_DATA_TYPES = [
	TYPE.organization,
	TYPE.location,
	TYPE.product,
	TYPE.category,
	TYPE.unit,
	TYPE.modifierGroup,
	TYPE.adjustment,
	TYPE.order,
	TYPE.payment,
	TYPE.refund,
	TYPE.shift,
	TYPE.customer
] as const;

export const SECONDARY_DATA_TYPES = [
	'catalog.bundle',
	TYPE.expense,
	TYPE.supplier,
	TYPE.purchaseOrder,
	TYPE.stockTransfer,
	TYPE.staff,
	TYPE.coupon,
	TYPE.promotion,
	TYPE.loyaltyPoints,
	TYPE.membership,
	TYPE.membershipSubscription,
	TYPE.membershipCheckIn,
	TYPE.cashEvent,
	'restaurant.table',
	'restaurant.queue',
	'restaurant.waiter-assignment',
	'restaurant.order',
	'blocked.entry',
	'settings.payment-method'
] as const;

export const ALL_OPERATIONAL_DATA_TYPES = [...CORE_DATA_TYPES, ...SECONDARY_DATA_TYPES] as const;

const SYNC_STAMP_PREFIX = 'bnos:sync:last-at:';
const BACKGROUND_SYNC_COOLDOWN_MS = 90_000;
const PAGE_SYNC_COOLDOWN_MS = 30_000;

type SyncStatus = 'idle' | 'syncing' | 'done' | 'failed';

function syncKey(scope: string) {
	return `${SYNC_STAMP_PREFIX}${tenant.state.organizationId || 'no-workspace'}:${scope}`;
}

function getLastSyncAt(scope: string) {
	if (!browser) return 0;
	const raw = localStorage.getItem(syncKey(scope));
	return raw ? Number(raw) || 0 : 0;
}

function setLastSyncAt(scope: string, value = Date.now()) {
	if (!browser) return;
	localStorage.setItem(syncKey(scope), String(value));
}

function shouldSync(scope: string, cooldownMs: number) {
	return Date.now() - getLastSyncAt(scope) > cooldownMs;
}

function typeScope(type: string) {
	return `type:${type}`;
}

function includesWorkspaceTypes(types: readonly string[]) {
	return types.includes(TYPE.organization) || types.includes(TYPE.location);
}

function staleTypes(types: readonly string[], cooldownMs: number) {
	if (!browser) return [...types];
	return types.filter((type) => shouldSync(typeScope(type), cooldownMs));
}

function idle(callback: () => void) {
	if (!browser) return;
	if ('requestIdleCallback' in window) {
		window.requestIdleCallback(callback, { timeout: 1500 });
		return;
	}
	setTimeout(callback, 250);
}

class SyncStore {
	status = $state<SyncStatus>('idle');
	current = $state('');
	lastSyncedAt = $state(0);
	error = $state<string | null>(null);

	hydrate(types: readonly string[]) {
		for (const type of types) {
			glo.hydrate(type);
		}
	}

	async syncTypes(
		types: readonly string[],
		options: { force?: boolean; scope?: string; cooldownMs?: number; silent?: boolean } = {}
	) {
		const scope = options.scope ?? types.join(',');
		const cooldownMs = options.cooldownMs ?? BACKGROUND_SYNC_COOLDOWN_MS;
		this.hydrate(types);

		if (!types.length) return false;
		if (!session.pubkey || !relays.online) return false;
		if (!options.force && !shouldSync(scope, cooldownMs)) return false;

		if (!options.silent) {
			this.status = 'syncing';
			this.current = scope;
			this.error = null;
		}

		try {
			await warmRelays();
			await glo.flushPublishQueue();
			for (const type of types) {
				await glo.sync(type);
				setLastSyncAt(typeScope(type));
			}
			if (includesWorkspaceTypes(types)) {
				// Staff devices do not author the workspace records themselves, so
				// also resolve via membership to fetch owner-authored org/location data.
				await memberships.resolveStaffWorkspace();
				restoreTenantFromWorkspace();
			}
			setLastSyncAt(scope);
			this.lastSyncedAt = Date.now();
			if (!options.silent) {
				this.status = 'done';
				setTimeout(() => {
					if (this.status === 'done') this.status = 'idle';
				}, 2000);
			}
			return true;
		} catch (e) {
			this.error = e instanceof Error ? e.message : String(e);
			if (!options.silent) {
				this.status = 'failed';
				setTimeout(() => {
					if (this.status === 'failed') this.status = 'idle';
				}, 2500);
			}
			return false;
		}
	}

	backgroundOperationalSync(options: { force?: boolean } = {}) {
		this.hydrate(ALL_OPERATIONAL_DATA_TYPES);
		idle(() => {
			const coreTypes = options.force
				? [...CORE_DATA_TYPES]
				: staleTypes(CORE_DATA_TYPES, BACKGROUND_SYNC_COOLDOWN_MS);
			const secondaryTypes = options.force
				? [...SECONDARY_DATA_TYPES]
				: staleTypes(SECONDARY_DATA_TYPES, BACKGROUND_SYNC_COOLDOWN_MS * 2);

			void this.syncTypes(coreTypes, {
				force: options.force,
				scope: 'core',
				silent: true
			}).then(() => {
				if (!secondaryTypes.length) return false;
				return this.syncTypes(secondaryTypes, {
					force: options.force,
					scope: 'secondary',
					cooldownMs: BACKGROUND_SYNC_COOLDOWN_MS * 2,
					silent: true
				});
			});
		});
	}

	pageSync(types: readonly string[], options: { force?: boolean; scope?: string } = {}) {
		this.hydrate(types);
		idle(() => {
			const syncTypes = options.force ? [...types] : staleTypes(types, PAGE_SYNC_COOLDOWN_MS);
			if (!syncTypes.length) return;
			void this.syncTypes(syncTypes, {
				force: options.force,
				scope: options.scope ?? `page:${types.join(',')}`,
				cooldownMs: PAGE_SYNC_COOLDOWN_MS,
				silent: true
			});
		});
	}

	async manualSync() {
		await syncOrganizationSettingsToWorkspace();
		await this.syncTypes(CORE_DATA_TYPES, { force: true, scope: 'core', silent: false });
		await this.syncTypes(SECONDARY_DATA_TYPES, { force: true, scope: 'secondary', silent: false });
	}
}

export const dataSync = new SyncStore();
