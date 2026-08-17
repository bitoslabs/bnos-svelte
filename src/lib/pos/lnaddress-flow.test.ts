import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LnurlAddressProvider, selectProviderForConfig } from './lightning-providers';

const PK64 = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const PR = 'lnbc1000n1pxyzqq'; // decodes to 100 sats = 100_000 msat

/** Route table for the mocked provider (an LNURL-pay service with NIP-57). */
let callbackQuery: URLSearchParams | null = null;
let verifyResponse: { status: string; settled: boolean } = { status: 'OK', settled: false };

function stubFetch() {
	return vi.fn(async (input: RequestInfo | URL) => {
		const url = String(input);
		if (url === 'https://prov.example/.well-known/lnurlp/store') {
			return new Response(
				JSON.stringify({
					status: 'OK',
					tag: 'payRequest',
					callback: 'https://prov.example/callback',
					minSendable: 1000,
					maxSendable: 1_000_000_000,
					metadata: JSON.stringify([['text/plain', 'BNOS']]),
					commentAllowed: 120,
					allowsNostr: true,
					nostrPubkey: PK64
				}),
				{ status: 200 }
			);
		}
		if (url.startsWith('https://prov.example/callback')) {
			callbackQuery = new URL(url).searchParams;
			return new Response(JSON.stringify({ status: 'OK', pr: PR, verify: 'https://prov.example/verify?v=1' }), {
				status: 200
			});
		}
		if (url.startsWith('https://prov.example/verify')) {
			return new Response(JSON.stringify(verifyResponse), { status: 200 });
		}
		return new Response(JSON.stringify({ status: 'ERROR', reason: 'not found' }), { status: 404 });
	});
}

let fetchMock: ReturnType<typeof stubFetch>;

beforeEach(() => {
	fetchMock = stubFetch();
	vi.stubGlobal('fetch', fetchMock);
	callbackQuery = null;
	verifyResponse = { status: 'OK', settled: false };
});
afterEach(() => {
	vi.unstubAllGlobals();
});

describe('LnurlAddressProvider auto-confirm flow (mocked provider)', () => {
	it('sends a NIP-57 zap request with the invoice and flips autoConfirms', async () => {
		const provider = new LnurlAddressProvider('store@prov.example', {
			recipientPubkey: PK64,
			relays: ['wss://nos.lol']
		});
		expect(provider.autoConfirms).toBe(false);

		const inv = await provider.makeInvoice(100_000, 'Coffees');

		// Invoice came back amount-verified from the BOLT11 itself.
		expect(inv.pr).toBe(PR);
		expect(inv.amountSats).toBe(100);
		expect(inv.verifyUrl).toBe('https://prov.example/verify?v=1');

		// The invoice request carried our zap request + the lnurl bech32 param.
		expect(callbackQuery).not.toBeNull();
		expect(callbackQuery!.get('amount')).toBe('100000');
		const nostrParam = callbackQuery!.get('nostr');
		expect(nostrParam).toBeTruthy();
		const zap = JSON.parse(nostrParam!) as { kind?: number; tags?: string[][]; id?: string };
		expect(zap.kind).toBe(9734);
		expect(zap.id).toMatch(/^[0-9a-f]{64}$/);
		expect(zap.tags).toContainEqual(['p', PK64]);
		expect(zap.tags).toContainEqual(['amount', '100000']);
		expect(zap.tags).toContainEqual(['relays', 'wss://nos.lol']);
		expect(callbackQuery!.get('lnurl')).toMatch(/^lnurl1/);

		// Detection capability is now advertised.
		expect(provider.autoConfirms).toBe(true);
		expect(typeof provider.watchPayment).toBe('function');
	});

	it('polls the verify URL for settlement', async () => {
		const provider = new LnurlAddressProvider('store@prov.example', {
			recipientPubkey: PK64,
			relays: ['wss://nos.lol']
		});
		const inv = await provider.makeInvoice(100_000);

		expect(await provider.getPaymentStatus(PR)).toBe('pending');
		verifyResponse = { status: 'OK', settled: true };
		expect(await provider.getPaymentStatus(PR)).toBe('paid');
		// Unknown invoice → unknown (never falsely confirms).
		expect(await provider.getPaymentStatus('lnbc9999n1other')).toBe('unknown');
	});

	it('flips autoConfirms via verify even without a zap-capable provider', async () => {
		// Same provider, no nostr context → plain invoice; verify URL still polls.
		const provider = selectProviderForConfig(
			{ lightningProvider: 'lnaddress', lightningAddress: 'store@prov.example' } as never
		)!;
		const inv = await provider.makeInvoice(100_000);
		expect(inv.pr).toBe(PR);
		expect(callbackQuery!.get('nostr')).toBeNull(); // no zap request sent
		expect(provider.autoConfirms).toBe(true); // verify URL present
	});
});
