/**
 * AWS Signature V4 + Cloudinary signature correctness tests.
 *
 * The expected values here are computed against AWS's *published* reference
 * example inputs, so matching them proves our Web-Crypto signer is genuinely
 * correct — not merely internally consistent.
 *
 * (Server project: unit tests run under vitest's `server` project, node env.)
 */
import { describe, expect, it } from 'vitest';
import {
	getSigningKey,
	signAwsRequestV4,
	signCloudinaryRequest,
	toHex,
	classifyMime,
	humanBytes
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
