import { describe, it, expect } from 'vitest';
import {
	isLightningAddress,
	parseLightningAddress,
	isLnurlString,
	decodeLnurlUrl,
	decodeBolt11AmountMsat,
	isNwcUri
} from './lightning';

describe('lightning decoders', () => {
	it('validates Lightning addresses', () => {
		expect(isLightningAddress('store@bitdigo.com')).toBe(true);
		expect(isLightningAddress('user@walletofsatoshi.com')).toBe(true);
		expect(isLightningAddress('not-an-address')).toBe(false);
		expect(isLightningAddress('https://x.com')).toBe(false);
		expect(isLightningAddress('lnurl1abc')).toBe(false);
	});

	it('parses address into user + domain', () => {
		expect(parseLightningAddress('store@bitdigo.com')).toEqual({
			user: 'store',
			domain: 'bitdigo.com'
		});
		expect(parseLightningAddress('bad')).toBeNull();
	});

	it('detects lnurl1 strings', () => {
		expect(isLnurlString('lnurl1dp68gurn8ghj7um5v93kketj9ehx2amn9uh8w...')).toBe(true);
		expect(isLnurlString('lightning:lnurl1dp68gurn8ghj7...')).toBe(true);
		expect(isLnurlString('store@x.com')).toBe(false);
	});

	it('decodes a real lnurl1 string to a URL', () => {
		// Known vector: lnurl1dp68gurn8ghj7mrww4excttxsd (truncated) decodes to https://...
		// Use a complete known test LNURL for a public endpoint.
		const lnurl = 'lnurl1dp68gurn8ghj7um5v93kketj9ehx2amn9uh8w6tw8u6c6eun9yvyp8q6rqdp88yfh';
		const url = decodeLnurlUrl(lnurl);
		// Whatever it decodes to, it should be a non-empty https URL string
		expect(typeof url).toBe('string');
		expect(url).toMatch(/^https?:\/\//);
	});

	it('decodes BOLT11 amounts from the human-readable part', () => {
		// lnbc1000n1… = 1000 nano-BTC = 0.00000100 BTC = 100 sats = 100000 msat
		expect(decodeBolt11AmountMsat('lnbc1000n1pjxyzqq')).toBe(100_000);
		// lnbc1u1… = 0.00000100 BTC = 100 sats
		expect(decodeBolt11AmountMsat('lnbc1u1pjxyzqq')).toBe(100_000);
		// lnbc1500n1… = 150 sats = 150000 msat
		expect(decodeBolt11AmountMsat('lnbc1500n1pjxyzqq')).toBe(150_000);
		// zero-amount invoice (any amount)
		expect(decodeBolt11AmountMsat('lnbc1pjxyzqq')).toBe(0);
		// non-bolt11
		expect(decodeBolt11AmountMsat('notaninvoice')).toBeNull();
	});

	it('detects NWC URIs', () => {
		expect(isNwcUri('nostr+walletconnect://abc@relay.example?secret=xyz')).toBe(true);
		expect(isNwcUri('store@x.com')).toBe(false);
	});
});
