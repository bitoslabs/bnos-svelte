import { describe, expect, it, vi } from 'vitest';
import { loadBitosPayEntitlement, syncBitosPayWorkspace } from './client';

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

const syncBody = {
	object: 'bnos_workspace_sync',
	organization_id: 'org_pay_1',
	merchant_id: 'mer_1',
	provider_connection_id: 'pc_1',
	api_key: 'bp_test_secret',
	api_key_id: 'key_1',
	owner_pubkey: 'a'.repeat(64),
	subject_ref: 'bnos:org-123',
	created: true,
	livemode: false,
	console_url: '/console/',
	verification: 'owner_key_only',
	warning: 'sandbox'
};

describe('BitOS Pay sync client', () => {
	it('signs the challenge and sends the workspace binding', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(
				json({
					challenge: 'nch_1',
					origin: 'https://pay.example',
					expires_at: '2026-01-01T00:00:00Z'
				})
			)
			.mockResolvedValueOnce(json(syncBody, 201));
		const signer = {
			signEvent: vi.fn(async (template) => ({
				...template,
				pubkey: 'b'.repeat(64),
				id: 'c'.repeat(64),
				sig: 'd'.repeat(128)
			}))
		};
		const result = await syncBitosPayWorkspace({
			baseUrl: 'https://pay.example/',
			workspaceId: 'org-123',
			workspaceName: 'Shop',
			merchantName: 'Shop',
			country: 'LA',
			signer,
			fetchImpl
		});
		expect(result.apiKey).toBe('bp_test_secret');
		expect(result.sync.subject_ref).toBe('bnos:org-123');
		expect(signer.signEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: 22242,
				tags: expect.arrayContaining([['subject', 'bnos:org-123']])
			})
		);
		const body = JSON.parse(fetchImpl.mock.calls[1][1].body as string);
		expect(body.workspace_id).toBe('org-123');
		expect(body.event.tags).toContainEqual(['subject', 'bnos:org-123']);
	});

	it('keeps an existing key when a later sync returns no key', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(json({ challenge: 'nch_1', origin: 'https://pay.example' }))
			.mockResolvedValueOnce(json({ ...syncBody, api_key: null, created: false }));
		const result = await syncBitosPayWorkspace({
			baseUrl: 'https://pay.example',
			workspaceId: 'org-123',
			workspaceName: 'Shop',
			merchantName: 'Shop',
			existingApiKey: 'bp_test_old',
			signer: {
				signEvent: async (template) => ({
					...template,
					pubkey: 'b'.repeat(64),
					id: 'c'.repeat(64),
					sig: 'd'.repeat(128)
				})
			},
			fetchImpl
		});
		expect(result.apiKey).toBe('bp_test_old');
		expect(result.sync.created).toBe(false);
	});

	it('maps a workspace conflict and refuses a different subject', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(json({ challenge: 'nch_1', origin: 'https://pay.example' }))
			.mockResolvedValueOnce(
				json({ error: { code: 'PAY_SUBJECT_CONFLICT', message: 'linked' } }, 409)
			);
		await expect(
			syncBitosPayWorkspace({
				baseUrl: 'https://pay.example',
				workspaceId: 'org-123',
				workspaceName: 'Shop',
				merchantName: 'Shop',
				signer: {
					signEvent: async (template) => ({
						...template,
						pubkey: 'b'.repeat(64),
						id: 'c'.repeat(64),
						sig: 'd'.repeat(128)
					})
				},
				fetchImpl
			})
		).rejects.toMatchObject({ code: 'PAY_SUBJECT_CONFLICT', status: 409 });
	});

	it('loads the entitlement with the sandbox key', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				object: 'entitlement',
				organization_id: 'org_pay_1',
				plan: 'workspace_free',
				features: [],
				limits: {},
				status: 'ACTIVE',
				revision: 0
			})
		);
		const entitlement = await loadBitosPayEntitlement({
			baseUrl: 'https://pay.example',
			apiKey: 'bp_test_secret',
			fetchImpl
		});
		expect(entitlement.plan).toBe('workspace_free');
		expect(fetchImpl.mock.calls[0][1].headers.authorization).toBe('Bearer bp_test_secret');
	});
});
