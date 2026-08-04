import { describe, expect, it } from 'vitest';
import { resolveSyncScope } from './store.svelte';

describe('resolveSyncScope (owner ↔ staff device sync strategy)', () => {
	const ME = 'a'.repeat(64);
	const ORG = 'org-001';
	const LOC = 'loc-branch-A';

	it('restricts workspace types to the device’s own pubkey (owner finds own org/location)', () => {
		const params = resolveSyncScope({
			type: 'organization',
			isWorkspaceType: true,
			orgId: ORG,
			sessionPubkey: ME
		});
		expect(params).toEqual({ types: ['organization'], authors: [ME] });
	});

	it('discovers operational types via the org scope topic with NO author restriction', () => {
		// This is the key behaviour that lets a staff device read owner-authored
		// products AND an owner device read staff-authored orders: there is no
		// `authors` filter, only the org scope topic.
		const params = resolveSyncScope({
			type: 'catalog.product',
			isWorkspaceType: false,
			orgId: ORG,
			sessionPubkey: ME
		});
		expect(params.authors).toBeUndefined();
		expect(params.organizationId).toBe(ORG);
		expect(params.locationId).toBeUndefined();
	});

	it('orders/payments/shifts resolve the same way (org-wide, any author)', () => {
		for (const type of ['commerce.order', 'commerce.payment', 'shift']) {
			expect(
				resolveSyncScope({
					type,
					isWorkspaceType: false,
					orgId: ORG,
					sessionPubkey: ME
				}).authors
			).toBeUndefined();
		}
	});

	it('adds the branch locationId for branch-scoped sync', () => {
		const params = resolveSyncScope({
			type: 'commerce.order',
			isWorkspaceType: false,
			orgId: ORG,
			locationId: LOC,
			sessionPubkey: ME
		});
		expect(params.organizationId).toBe(ORG);
		expect(params.locationId).toBe(LOC);
		// createGloFilter turns org+loc into the `glo:scope:org:loc` topic.
	});

	it('treats null locationId as org-wide (no branch restriction)', () => {
		const params = resolveSyncScope({
			type: 'commerce.order',
			isWorkspaceType: false,
			orgId: ORG,
			locationId: null,
			sessionPubkey: ME
		});
		expect(params.locationId).toBeUndefined();
	});

	it('falls back to own pubkey when there is no org context (avoids a global query)', () => {
		const params = resolveSyncScope({
			type: 'catalog.product',
			isWorkspaceType: false,
			orgId: undefined,
			sessionPubkey: ME
		});
		expect(params.authors).toEqual([ME]);
		expect(params.organizationId).toBeUndefined();
	});

	it('respects an explicit authors override', () => {
		const params = resolveSyncScope({
			type: 'catalog.product',
			isWorkspaceType: false,
			orgId: ORG,
			sessionPubkey: ME,
			authors: ['owner-pubkey', ME]
		});
		expect(params.authors).toEqual(['owner-pubkey', ME]);
		expect(params.organizationId).toBe(ORG);
	});
});
