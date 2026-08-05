import { describe, it, expect } from 'vitest';
import {
	parseNwcUri,
	NwcProvider,
	selectProviderForConfig,
	type ProviderConfig
} from './lightning-providers';

const PK64 = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const SECRET64 = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';

describe('lightning provider factory', () => {
	it('parses NWC URIs', () => {
		const c = parseNwcUri(
			`nostr+walletconnect://${PK64}?relay=wss%3A%2F%2Frelay.example&secret=${SECRET64}`
		);
		expect(c).not.toBeNull();
		expect(c!.relay).toBe('wss://relay.example');
		expect(c!.secret).toBe(SECRET64);
		expect(c!.walletPubkey).toBe(PK64);
		expect(c!.walletPubkey).toHaveLength(64);
	});

	it('rejects malformed NWC URIs', () => {
		expect(parseNwcUri('not-a-uri')).toBeNull();
		expect(parseNwcUri('nostr+walletconnect://abc')).toBeNull(); // no params
		expect(
			parseNwcUri(`nostr+walletconnect://tooshort?relay=wss://x&secret=${SECRET64}`)
		).toBeNull(); // pubkey not 64 hex
	});

	it('NwcProvider throws on invalid URI', () => {
		expect(() => new NwcProvider('garbage')).toThrow();
	});

	it('returns null when nothing is selected', () => {
		expect(selectProviderForConfig({} as ProviderConfig)).toBeNull();
		expect(selectProviderForConfig({ lightningProvider: 'lnaddress' } as ProviderConfig)).toBeNull();
	});

	it('selects lnaddress when configured', () => {
		const p = selectProviderForConfig({
			lightningProvider: 'lnaddress',
			lightningAddress: 'store@bitdigo.com'
		} as ProviderConfig);
		expect(p).not.toBeNull();
		expect(p!.id).toBe('lnaddress');
		expect(p!.autoConfirms).toBe(false);
	});

	it('selects blink when configured (auto-confirms)', () => {
		const p = selectProviderForConfig({
			lightningProvider: 'blink',
			blinkApiKey: 'blink_test_key'
		} as ProviderConfig);
		expect(p).not.toBeNull();
		expect(p!.id).toBe('blink');
		expect(p!.autoConfirms).toBe(true);
	});

	it('selects nwc when configured (auto-confirms)', () => {
		const p = selectProviderForConfig({
			lightningProvider: 'nwc',
			nwcUrl: `nostr+walletconnect://${PK64}?relay=wss://relay.example&secret=${SECRET64}`
		} as ProviderConfig);
		expect(p).not.toBeNull();
		expect(p!.id).toBe('nwc');
		expect(p!.autoConfirms).toBe(true);
	});

	it('selects lnd only when BOTH url + macaroon present', () => {
		expect(
			selectProviderForConfig({ lightningProvider: 'lnd', lndUrl: 'https://x:8080' } as ProviderConfig)
		).toBeNull();
		const p = selectProviderForConfig({
			lightningProvider: 'lnd',
			lndUrl: 'https://127.0.0.1:8080',
			lndMacaroon: '020105'
		} as ProviderConfig);
		expect(p).not.toBeNull();
		expect(p!.id).toBe('lnd');
		expect(p!.autoConfirms).toBe(false);
	});

	it('selects alby, phoenixd, strike', () => {
		expect(
			selectProviderForConfig({ lightningProvider: 'alby', albyApiKey: 'k' } as ProviderConfig)!.id
		).toBe('alby');
		expect(
			selectProviderForConfig({
				lightningProvider: 'phoenixd',
				phoenixdUrl: 'http://127.0.0.1:9740',
				phoenixdPass: 'pw'
			} as ProviderConfig)!.id
		).toBe('phoenixd');
		expect(
			selectProviderForConfig({ lightningProvider: 'strike', strikeApiKey: 'k' } as ProviderConfig)!
				.id
		).toBe('strike');
	});
});
