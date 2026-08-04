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
	it('rejects ciphertext replayed across records under the same key (recordId AAD)', async () => {
		const scope = getSensitiveDataScopeId('org-A', 'pk');
		const envA = JSON.parse(
			await protectSensitiveJson(
				{ total: 100 },
				{ domain: 'order', scopeId: scope, recordId: 'rec-A' }
			)
		) as Record<string, unknown>;
		const envB = JSON.parse(
			await protectSensitiveJson(
				{ total: 200 },
				{ domain: 'order', scopeId: scope, recordId: 'rec-B' }
			)
		) as Record<string, unknown>;
		// Swap record-A's ciphertext into record-B's envelope (same key, same nonce
		// space) — GCM must reject because the AAD (recordId) no longer matches.
		const replayed = { ...envB, ciphertext: envA.ciphertext, nonce: envA.nonce };
		await expect(unprotectSensitiveJson(JSON.stringify(replayed))).rejects.toThrow();
	});

	it('cannot decrypt with a key from a different scope (wrong opaque kid)', async () => {
		const scopeA = getSensitiveDataScopeId('org-A', 'pk');
		const envelopeA = JSON.parse(
			await protectSensitiveJson({ total: 9 }, { domain: 'order', scopeId: scopeA })
		) as { kid: string };
		// Wipe org-A's key, mint org-B's (different random key + opaque kid).
		memStore.clear();
		await protectSensitiveJson(
			{ x: 1 },
			{ domain: 'order', scopeId: getSensitiveDataScopeId('org-B', 'pk') }
		);
		// Point org-A's ciphertext at org-B's kid → wrong key → GCM auth failure.
		const orgBkid = (
			JSON.parse(
				await protectSensitiveJson(
					{ x: 1 },
					{ domain: 'order', scopeId: getSensitiveDataScopeId('org-B', 'pk') }
				)
			) as { kid: string }
		).kid;
		const tampered = { ...envelopeA, kid: orgBkid };
		await expect(unprotectSensitiveJson(JSON.stringify(tampered))).rejects.toThrow();
	});
});

describe('privacy — envelope leaks no org/branch/domain metadata', () => {
	it('does not serialize organizationId, branchId, domain, or scopeId', async () => {
		const scope = getSensitiveDataScopeId('org-secret', 'pk');
		const envelope = JSON.parse(
			await protectSensitiveJson(
				{ customer: 'Satoshi', card: '4242' },
				{
					domain: 'payment',
					scopeId: scope,
					organizationId: 'org-secret',
					branchId: 'branch-1',
					recordId: 'rec-1'
				}
			)
		) as Record<string, unknown>;
		expect(envelope).not.toHaveProperty('organizationId');
		expect(envelope).not.toHaveProperty('branchId');
		expect(envelope).not.toHaveProperty('domain');
		expect(envelope).not.toHaveProperty('scopeId');
		expect(envelope).not.toHaveProperty('companyId');
		// The kid is opaque and carries no org identifier.
		expect(String(envelope.kid)).toMatch(/^k_[0-9a-f]{32}$/);
		expect(String(envelope.kid)).not.toContain('org-secret');
		// And the plaintext secrets are not present.
		expect(JSON.stringify(envelope)).not.toContain('Satoshi');
		expect(JSON.stringify(envelope)).not.toContain('4242');
	});
});

describe('scheme constant', () => {
	it('uses the bnos GLO-namespaced scheme id', () => {
		expect(SCHEME).toBe('org.bitos.bnos.organization-key.v1');
	});
});
