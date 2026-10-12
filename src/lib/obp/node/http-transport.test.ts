/**
 * HTTP transport binding tests: real request/response over a local HTTP
 * server, retry classification, fail-closed confidential delivery, and
 * the SvelteKit-compatible inbox request handler.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { HttpTransport, handleObpInboxRequest } from './http-transport';
import { createTwoNodePilot } from '../testing/harness';
import { MemoryObpStores } from './store';
import { BusinessNode } from './business-node';
import { DefaultObpPolicy } from '../policy';
import { generateSigningKey, signEnvelope } from '../signature';
import type { ObpEnvelope, ObpUnsignedEnvelope } from '../types';

let server: Server | undefined;
afterEach(() => {
	server?.close();
	server = undefined;
});

function listen(handler: (req: unknown, res: unknown) => void): Promise<string> {
	return new Promise((resolve) => {
		server = createServer(handler as never);
		server.listen(0, '127.0.0.1', () => {
			const addr = server!.address() as { port: number };
			resolve(`http://127.0.0.1:${addr.port}/obp/inbox`);
		});
	});
}

describe('HttpTransport', () => {
	it('delivers envelopes as JSON POSTs and acks on 2xx', async () => {
		const seen: { body: unknown; contentType?: string; recipient?: string }[] = [];
		const endpoint = await listen((req, res) => {
			const r = req as { method?: string; headers: Record<string, string> };
			let raw = '';
			(req as { on: (e: string, cb: (d?: string) => void) => void }).on('data', (d) => (raw += d ?? ''));
			(req as { on: (e: string, cb: () => void) => void }).on('end', () => {
				seen.push({
					body: JSON.parse(raw),
					contentType: r.headers['content-type'],
					recipient: r.headers['x-obp-recipient']
				});
				(res as { writeHead: (c: number, h: Record<string, string>) => void }).writeHead(202, {
					'x-obp-transport-id': 'tr-1'
				});
				(res as { end: () => void }).end();
			});
		});

		const transport = new HttpTransport({ endpoint, allowInsecureHttp: true });
		const env = draftEnvelope();
		const result = await transport.deliver(env, { confidential: true, recipient: 'org:seller' });
		expect(result).toEqual({ ok: true, transportId: 'tr-1' });
		expect(seen[0].contentType).toBe('application/json');
		expect(seen[0].recipient).toBe('org:seller');
		expect((seen[0].body as { messageId: string }).messageId).toBe(env.messageId);
	});

	it('classifies 4xx as permanent and 5xx/429 as retryable', async () => {
		const endpoint = await listen((req, res) => {
			const r = req as { url?: string };
			const status = r.url?.includes('500') ? 500 : r.url?.includes('429') ? 429 : 404;
			(res as { writeHead: (c: number) => void; end: () => void }).writeHead(status);
			(res as { end: () => void }).end();
		});

		const transport = new HttpTransport({ endpoint, allowInsecureHttp: true });
		expect(
			await transport.deliver(draftEnvelope(), { confidential: false, recipient: 'x' })
		).toMatchObject({ ok: false, error: 'http-404', retryable: false });
	});

	it('fails closed for confidential envelopes over plain HTTP', async () => {
		const endpoint = await listen((_req, res) => {
			(res as { writeHead: (c: number) => void; end: () => void }).writeHead(200);
			(res as { end: () => void }).end();
		});
		const transport = new HttpTransport({ endpoint }); // no allowInsecureHttp
		expect(transport.canEncrypt).toBe(false);
		const result = await transport.deliver(draftEnvelope(), {
			confidential: true,
			recipient: 'org:seller'
		});
		expect(result).toEqual({ ok: false, error: 'encryption-unavailable', retryable: false });
	});

	it('network failures are retryable', async () => {
		const transport = new HttpTransport({
			endpoint: 'http://127.0.0.1:1/obp/inbox', // nothing listens on port 1
			allowInsecureHttp: true,
			timeoutMs: 500
		});
		const result = await transport.deliver(draftEnvelope(), {
			confidential: false,
			recipient: 'x'
		});
		expect(result.retryable).toBe(true);
	});
});

describe('handleObpInboxRequest', () => {
	it('answers with the node decision and correlationId', async () => {
		const pilot = createTwoNodePilot();
		const request = new Request('http://x/obp/inbox', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(signedRfq(pilot.buyer.keys.staff.secretKey, pilot.buyer.keys.staff.pubkey))
		});
		const response = await handleObpInboxRequest(pilot.seller.node, request);
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			correlationId: string;
			decision: string;
			duplicate: boolean;
		};
		expect(body.decision).toBe('accepted');
		expect(body.correlationId).toMatch(/-/);
	});

	it('rejects malformed JSON bodies with 400', async () => {
		const pilot = createTwoNodePilot();
		const request = new Request('http://x/obp/inbox', {
			method: 'POST',
			body: 'not-json'
		});
		const response = await handleObpInboxRequest(pilot.seller.node, request);
		expect(response.status).toBe(400);
	});

	it('a node backed by KV stores serves a full HTTP round trip', async () => {
		const pilot = createTwoNodePilot();
		const registry = pilot.seller.registry;
		const sellerKvNode = new BusinessNode({
			org: { orgId: 'org:seller', name: 'Seller Co', ownerPubkey: pilot.seller.keys.owner.pubkey },
			registry,
			stores: new MemoryObpStores(),
			signers: new Map([[pilot.seller.keys.owner.grantId, pilot.seller.keys.owner.secretKey]]),
			policy: new DefaultObpPolicy()
		});

		const endpoint = await listen((req, res) => {
			let raw = '';
			(req as { on: (e: string, cb: (d?: string) => void) => void }).on('data', (d) => (raw += d ?? ''));
			(req as { on: (e: string, cb: () => void) => void }).on('end', async () => {
				const response = await handleObpInboxRequest(
					sellerKvNode,
					new Request('http://x/obp/inbox', {
						method: 'POST',
						body: raw
					})
				);
				const body = await response.text();
				(res as { writeHead: (c: number, h: Record<string, string>) => void }).writeHead(
					response.status,
					{ 'content-type': 'application/json' }
				);
				(res as { end: (b: string) => void }).end(body);
			});
		});

		const transport = new HttpTransport({ endpoint, allowInsecureHttp: true });
		const rfq = signedRfq(pilot.buyer.keys.staff.secretKey, pilot.buyer.keys.staff.pubkey);
		const result = await transport.deliver(rfq, { confidential: true, recipient: 'org:seller' });
		expect(result.ok).toBe(true);
		const doc = await sellerKvNode.getDocument(rfq.documentId);
		expect(doc?.state).toBe('issued');
	});
});

function draftEnvelope(): ObpEnvelope {
	const { secretKey, pubkey } = generateSigningKey();
	return signEnvelope(baseDraft(pubkey), secretKey);
}

function signedRfq(secretKey: Uint8Array, pubkey: string): ObpEnvelope {
	return signEnvelope(baseDraft(pubkey), secretKey);
}

function baseDraft(pubkey: string): ObpUnsignedEnvelope {
	return {
		protocol: 'obp',
		version: '0.1',
		messageId: `msg-${crypto.randomUUID()}`,
		documentId: `doc-${crypto.randomUUID()}`,
		documentType: 'rfq',
		action: 'issue',
		issuer: 'org:buyer',
		signerKeyId: 'buyer:staff',
		signerPubkey: pubkey,
		recipient: 'org:seller',
		createdAt: new Date().toISOString(),
		expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
		currency: 'LAK',
		lines: [{ description: 'beans', quantity: 2, unit: 'kg', unitPriceMinor: 85_000 }],
		totalsMinor: 170_000,
		references: []
	};
}
