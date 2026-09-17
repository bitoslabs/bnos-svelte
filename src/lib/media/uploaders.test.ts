/**
 * AWS Signature V4 + Cloudinary signature correctness tests.
 *
 * The expected values here are computed against AWS's *published* reference
 * example inputs, so matching them proves our Web-Crypto signer is genuinely
 * correct — not merely internally consistent.
 *
 * (Server project: unit tests run under vitest's `server` project, node env.)
 */
import { describe, expect, it, vi } from 'vitest';
import {
	getSigningKey,
	signAwsRequestV4,
	signCloudinaryRequest,
	toHex,
	classifyMime,
	humanBytes,
	sha256File,
	uploadToBlossom
} from './uploaders';

const SECRET = 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY';
const EMPTY_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

describe('AWS SigV4 helpers', () => {
	it('derives the signing key matching the reference crypto chain', async () => {
		const key = await getSigningKey(SECRET, '20150830', 'us-east-1', 'iam');
		expect(toHex(key)).toBe('c4afb1cc5771d871763a393e44b703571b55cc28424d1a5e86da6ed3c154a4b9');
	});

	it('builds a complete Authorization header with a correct signature', async () => {
		const authorization = await signAwsRequestV4({
			method: 'GET',
			canonicalUri: '/',
			canonicalQueryString: '',
			canonicalHeaders: 'host:iam.amazonaws.com\nx-amz-date:20150830T123600Z\n',
			signedHeaders: 'host;x-amz-date',
			payloadHash: EMPTY_SHA,
			amzDate: '20150830T123600Z',
			dateStamp: '20150830',
			region: 'us-east-1',
			service: 'iam',
			accessKey: 'AKIAIOSFODNN7EXAMPLE',
			secretKey: SECRET
		});

		// Canonical-request hash + signature computed independently with Node crypto.
		expect(authorization).toBe(
			'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20150830/us-east-1/iam/aws4_request, ' +
				'SignedHeaders=host;x-amz-date, ' +
				'Signature=91fb24346d00546d6da247c85eb79148080a6e3ae1ac9aa8eae9ccdabfd70b33'
		);
	});
});

describe('Cloudinary signature', () => {
	it('produces the SHA-1 signature matching the reference crypto', async () => {
		const sig = await signCloudinaryRequest(
			{ timestamp: '1315060510', upload_preset: 'my_preset' },
			'ABCD'
		);
		expect(sig).toBe('c22f01f08a5bd62009ae0a1941dfb5cd21d01d18');
	});

	it('sorts params including folder before signing', async () => {
		const sig = await signCloudinaryRequest(
			{ folder: 'bnos', timestamp: '1315060510', upload_preset: 'my_preset' },
			'ABCD'
		);
		expect(sig).toBe('49ae32a921a3f1f069849d6da2855145df9eb29f');
	});
});

describe('utilities', () => {
	it('hashes file data using SHA-256 for Blossom uploads', async () => {
		const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });
		expect(await sha256File(file)).toBe(
			'2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
		);
	});

	it('uploads raw file bytes to Blossom with PUT and its signed hash', async () => {
		const originalFetch = globalThis.fetch;
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					url: 'https://blossom.nostr.build/abc.txt',
					type: 'text/plain',
					size: 5
				}),
				{ status: 201, headers: { 'Content-Type': 'application/json' } }
			)
		);
		globalThis.fetch = fetchMock;
		try {
			const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });
			const result = await uploadToBlossom(file, async (hash) => `Nostr signed-${hash}`);

			expect(fetchMock).toHaveBeenCalledWith('https://blossom.nostr.build/upload', {
				method: 'PUT',
				headers: {
					Authorization:
						'Nostr signed-2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
					'Content-Type': 'text/plain',
					'X-SHA-256':
						'2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
				},
				body: file
			});
			expect(result).toMatchObject({
				url: 'https://blossom.nostr.build/abc.txt',
				kind: 'file',
				provider: 'blossom'
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it('classifies mime types', () => {
		expect(classifyMime('image/png')).toBe('image');
		expect(classifyMime('video/mp4')).toBe('video');
		expect(classifyMime('application/pdf')).toBe('file');
	});

	it('formats bytes readably', () => {
		expect(humanBytes(0)).toBe('0 B');
		expect(humanBytes(512)).toBe('512 B');
		expect(humanBytes(1536)).toBe('1.5 KB');
		expect(humanBytes(5 * 1024 * 1024)).toBe('5.0 MB');
	});
});
