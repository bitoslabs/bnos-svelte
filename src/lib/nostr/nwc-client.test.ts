import { describe, it, expect } from 'vitest';
import {
	parseNwcConnectionString,
	nwcNotificationMatchesInvoice,
	NWC_REQUEST_KIND,
	NWC_RESPONSE_KIND,
	NWC_NOTIFICATION_KIND,
	type NwcPaymentReceived
} from './nwc-client';

const PK64 = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const SECRET64 = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';

describe('NWC connection string parsing', () => {
	it('parses a standard URI (encoded relay param)', () => {
		const c = parseNwcConnectionString(
			`nostr+walletconnect://${PK64}?relay=${encodeURIComponent('wss://relay.example')}&secret=${SECRET64}`
		);
		expect(c).not.toBeNull();
		expect(c!.walletPubkey).toBe(PK64);
		expect(c!.secret).toBe(SECRET64);
		expect(c!.relays).toEqual(['wss://relay.example']);
	});

	it('collects and dedupes multiple relay params', () => {
		const c = parseNwcConnectionString(
			`nostr+walletconnect://${PK64}?relay=wss%3A%2F%2Fa.example&relay=wss%3A%2F%2Fb.example&relay=wss%3A%2F%2Fa.example&secret=${SECRET64}`
		);
		expect(c!.relays).toEqual(['wss://a.example', 'wss://b.example']);
	});

	it('lowercases pubkey and secret', () => {
		const c = parseNwcConnectionString(
			`nostr+walletconnect://${PK64.toUpperCase()}?relay=wss%3A%2F%2Frelay.example&secret=${SECRET64.toUpperCase()}`
		);
		expect(c!.walletPubkey).toBe(PK64);
		expect(c!.secret).toBe(SECRET64);
	});

	it('rejects malformed URIs', () => {
		expect(parseNwcConnectionString('not-a-uri')).toBeNull();
		expect(parseNwcConnectionString('nostr+walletconnect://abc?relay=wss://x&secret=' + SECRET64)).toBeNull(); // bad pubkey
		expect(
			parseNwcConnectionString(`nostr+walletconnect://${PK64}?relay=wss://x&secret=short`)
		).toBeNull(); // bad secret
		expect(parseNwcConnectionString(`nostr+walletconnect://${PK64}?secret=${SECRET64}`)).toBeNull(); // no relay
		expect(
			parseNwcConnectionString(`nostr+walletconnect://${PK64}?relay=ftp%3A%2F%2Fx&secret=${SECRET64}`)
		).toBeNull(); // non-ws relay scheme
	});
});

describe('NWC notification matching', () => {
	const PR = 'lnbc1000n1pxyzqq';

	it('matches when the notification carries the same BOLT11', () => {
		const n: NwcPaymentReceived = { invoice: PR, amountSats: 100 };
		expect(nwcNotificationMatchesInvoice(n, PR)).toBe(true);
		expect(nwcNotificationMatchesInvoice(n, `  ${PR}  `)).toBe(true); // trims
	});

	it('does not match a different invoice', () => {
		const n: NwcPaymentReceived = { invoice: 'lnbc9999n1other', amountSats: 99 };
		expect(nwcNotificationMatchesInvoice(n, PR)).toBe(false);
	});

	it('does not match when the wallet omitted the invoice string', () => {
		const n: NwcPaymentReceived = { amountSats: 100 };
		expect(nwcNotificationMatchesInvoice(n, PR)).toBe(false);
	});
});

describe('NIP-47 kind constants', () => {
	it('uses the spec kinds', () => {
		expect(NWC_REQUEST_KIND).toBe(23194);
		expect(NWC_RESPONSE_KIND).toBe(23195);
		expect(NWC_NOTIFICATION_KIND).toBe(7375);
	});
});
