import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
	SCHEME,
	fromBase64Url,
	getSensitiveDataKeyId,
	getSensitiveDataScopeId,
	getStoredSensitiveDataKey,
	isEncryptionEnvelope,
	isProtectedContent,
	protectSensitiveJson,
	protectSensitiveValue,
	storeSensitiveDataKey,
	toBase64Url,
	unprotectSensitiveJson,
	unprotectSensitiveValue
} from './sensitive-data';

// sensitive-data reads `window.crypto.subtle` + `window.localStorage`. vitest's
// node project has neither on `globalThis`, so expose a minimal `window`
// backed by node's native webcrypto + an in-memory store. (Node 20+ ships
// globalThis.crypto.subtle natively.)
const memStore = new Map<string, string>();
beforeAll(() => {
	(globalThis as unknown as { window: Record<string, unknown> }).window = {
		crypto: globalThis.crypto,
		localStorage: {
			getItem: (k: string) => memStore.get(k) ?? null,
			setItem: (k: string, v: string) => void memStore.set(k, v),
			removeItem: (k: string) => void memStore.delete(k)
		}
	};
});

afterEach(() => memStore.clear());

afterAll(() => {
	delete (globalThis as unknown as { window?: unknown }).window;
});

describe('base64url', () => {
	it('round-trips arbitrary bytes', () => {
		const bytes = new Uint8Array([0, 1, 2, 250, 255, 128, 64, 32]);
		expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
	});
	it('produces url-safe output without padding', () => {
		expect(toBase64Url(new Uint8Array([255]))).not.toMatch(/[+/=]/);
	});
});

describe('key management', () => {
	it('derives stable scope/key ids', () => {
		const scope = getSensitiveDataScopeId('org-1', 'pk');
		expect(scope).toBe('organization:org-1');
		expect(getSensitiveDataKeyId(scope)).toBe('organization:org-1:v1');
	});
	it('falls back to user scope when no company', () => {
		expect(getSensitiveDataScopeId(null, 'pk-1')).toBe('user:pk-1');
		expect(getSensitiveDataScopeId(null, null)).toBe('local');
	});
	it('stores and retrieves a raw key', () => {
		const key = new Uint8Array(32).fill(7);
		storeSensitiveDataKey('k1', key);
		expect(getStoredSensitiveDataKey('k1')).toEqual(key);
	});
});

describe('protect/unprotect (string surface)', () => {
	it('encrypts then decrypts back to the original value', async () => {
		const secret = { name: 'Latte', price: 35000, customer: 'Satoshi' };
		const scope = getSensitiveDataScopeId('org-1', 'pk');
		const envelope = await protectSensitiveJson(secret, { domain: 'order', scopeId: scope });
		expect(isProtectedContent(envelope)).toBe(true);
		// The ciphertext is NOT the plaintext.
		expect(envelope).not.toContain('Satoshi');
		const back = await unprotectSensitiveJson<typeof secret>(envelope);
		expect(back).toEqual(secret);
	});

	it('unprotectSensitiveJson passes through non-envelope JSON', async () => {
		const plain = JSON.stringify({ hello: 'world' });
		expect(await unprotectSensitiveJson(plain)).toEqual({ hello: 'world' });
	});
});

describe('protect/unprotect (object surface, for GLO data)', () => {
	it('returns an envelope object that round-trips', async () => {
		const secret = { customer: 'Alice', total: 1200 };
		const scope = getSensitiveDataScopeId('org-1', 'pk');
		const envelope = await protectSensitiveValue(secret, { domain: 'customer', scopeId: scope });
		expect(isEncryptionEnvelope(envelope)).toBe(true);
		expect((envelope as any).ciphertext).not.toContain('Alice');
		const back = await unprotectSensitiveValue<typeof secret>(envelope);
		expect(back).toEqual(secret);
	});

	it('unprotectSensitiveValue passes through non-envelope values', async () => {
		expect(await unprotectSensitiveValue({ plain: true })).toEqual({ plain: true });
		expect(await unprotectSensitiveValue('hello')).toBe('hello');
	});
});

describe('AAD binding (payload substitution defense)', () => {
	it('cannot decrypt with a key from a different scope', async () => {
		const secret = { order: 'ORD-1', total: 99 };
		// Encrypt under org-A's key.
		const scopeA = getSensitiveDataScopeId('org-A', 'pk');
		const envelopeA = await protectSensitiveJson(secret, { domain: 'order', scopeId: scopeA });
		// Store org-B's key under the SAME key id — decryption must fail (wrong key).
		memStore.clear();
		const scopeB = getSensitiveDataScopeId('org-B', 'pk');
		// Force a key for scopeB so getStoredSensitiveDataKeyId resolves, but it's
		// a different random key than the one that encrypted envelopeA.
		storeSensitiveDataKey(getSensitiveDataKeyId(scopeB), new Uint8Array(32).fill(1));
		// Rewrite the envelope's kid to point at scopeB's key id to simulate
		// an attacker replaying org-A's ciphertext against org-B.
		const tampered = JSON.parse(envelopeA);
		tampered.kid = getSensitiveDataKeyId(scopeB);
		tampered.scopeId = scopeB;
		await expect(unprotectSensitiveJson(JSON.stringify(tampered))).rejects.toThrow();
	});
});

describe('scheme constant', () => {
	it('uses the bnos GLO-namespaced scheme id', () => {
		expect(SCHEME).toBe('org.bitos.bnos.organization-key.v1');
	});
});
