/**
 * Media upload providers — pure, framework-agnostic helpers.
 *
 * No Svelte, no DOM globals beyond the Web Crypto API + `fetch`. That keeps this
 * module fully unit-testable (see `uploaders.test.ts`) and reusable from any
 * store, route, or component.
 *
 * Four upload paths are supported:
 *
 *   • Cloudinary  — unsigned "upload preset" flow (safest for browsers; the
 *                   secret never ships to the client) OR signed uploads using
 *                   the API key + secret. Signed locally with SHA-1.
 *   • S3 / R2     — direct PUT using an AWS Signature V4 signer built on Web
 *                   Crypto. Works against AWS S3 and any S3-compatible store
 *                   (Cloudflare R2, MinIO, Backblaze B2, …). CORS must allow
 *                   PUT from this origin.
 *   • Blossom     — authenticated direct PUT to the free nostr.build Blossom
 *                   server. This is the no-configuration default.
 *   • Server      — optional POST `/api/media/upload`, which signs + forwards
 *                   to Cloudinary using server-side env vars.
 *
 * Ported from bitos-nostr, adapted to BNOS's org-scoped (not pubkey-scoped)
 * folder layout: `<folder>/bnos/<owner|anonymous>/<purpose>`.
 */

export type MediaProviderId = 'cloudinary' | 's3';
/** Includes the implicit `'server'` path returned by the fallback endpoint. */
export type UploadedMediaProviderId = MediaProviderId | 'blossom' | 'server';

/** Semantic bucket the file belongs to — drives the storage folder + validation. */
export type UploadPurpose =
	| 'product'
	| 'category'
	| 'brand'
	| 'logo'
	| 'avatar'
	| 'receipt'
	| 'test';

export interface UploadOptions {
	/** Owner scope (the active org id). Becomes a folder segment on the server path. */
	owner?: string;
	purpose?: UploadPurpose;
}

export interface CloudinaryConfig {
	/** Cloud name — the `xxxxx` in `res.cloudinary.com/xxxxx`. */
	cloudName: string;
	/** Unsigned upload preset. Required when no API key/secret are set. */
	uploadPreset?: string;
	/** API key — enables signed uploads when paired with the API secret. */
	apiKey?: string;
	/** API secret — enables signed uploads. Stored only on this device. */
	apiSecret?: string;
	/** Optional folder prefix applied on upload. */
	folder?: string;
}

export interface S3Config {
	bucket: string;
	/** AWS region, or `auto` for Cloudflare R2. */
	region: string;
	/** Optional S3-compatible endpoint base, e.g. `https://<acct>.r2.cloudflarestorage.com`. */
	endpoint?: string;
	accessKey: string;
	secretKey: string;
	/** Public base used when referencing the uploaded file (CDN / custom domain). */
	publicUrlBase?: string;
	/** Optional key prefix (folder). */
	folder?: string;
}

export interface MediaSettings {
	/** `'none'` routes uploads to the free Blossom server. */
	defaultProvider: MediaProviderId | 'none';
	cloudinary: CloudinaryConfig;
	s3: S3Config;
}

export interface UploadedMedia {
	url: string;
	kind: 'image' | 'video' | 'file';
	mimeType: string;
	bytes: number;
	provider: UploadedMediaProviderId;
}

/** Free, public Blossom service used when no personal media provider is selected. */
export const FREE_BLOSSOM_SERVER = 'https://blossom.nostr.build';

export type BlossomAuthorization = (sha256: string) => Promise<string>;

export function classifyMime(mime: string): UploadedMedia['kind'] {
	if (mime.startsWith('image/')) return 'image';
	if (mime.startsWith('video/')) return 'video';
	return 'file';
}

/** Human-readable byte size, e.g. `1.5 MB`. */
export function humanBytes(n: number): string {
	if (!n) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB'];
	const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
	return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${units[i]}`;
}

/* ========================================================================== *
   Blossom — authenticated direct PUT (BUD-02 / BUD-11)
 * ========================================================================== */

/** SHA-256 hex of a file, used both for BUD-11 authorization and the upload header. */
export async function sha256File(file: File): Promise<string> {
	return toHex(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()));
}

/**
 * Upload a binary file to a Blossom server. The server returns a BUD-02 blob
 * descriptor, whose URL is the stable, content-addressed URL to store.
 */
export async function uploadToBlossom(
	file: File,
	createAuthorization: BlossomAuthorization,
	server = FREE_BLOSSOM_SERVER
): Promise<UploadedMedia> {
	if (!file.size) throw new Error('Uploaded file is empty');
	const baseUrl = server.trim().replace(/\/+$/, '');
	if (!baseUrl) throw new Error('Blossom server is not configured');

	const sha256 = await sha256File(file);
	const authorization = await createAuthorization(sha256);
	const res = await fetch(`${baseUrl}/upload`, {
		method: 'PUT',
		headers: {
			Authorization: authorization,
			'Content-Type': file.type || 'application/octet-stream',
			'X-SHA-256': sha256
		},
		body: file
	});

	let payload: { url?: unknown; type?: unknown; size?: unknown; message?: unknown } = {};
	let responseBody = '';
	try {
		responseBody = await res.text();
		payload = JSON.parse(responseBody) as typeof payload;
	} catch {
		// Some Blossom servers return a plain-text diagnostic on failure.
		payload.message = responseBody || res.statusText;
	}

	if (!res.ok) {
		const detail =
			(res.headers.get('X-Reason') ||
				(typeof payload.message === 'string' && payload.message) ||
				`${res.status} ${res.statusText}`) ??
			`${res.status} ${res.statusText}`;
		throw new Error(`Blossom upload failed: ${detail}`);
	}
	if (typeof payload.url !== 'string' || !payload.url) {
		throw new Error('Blossom upload succeeded without a blob URL');
	}

	const mimeType = typeof payload.type === 'string' && payload.type ? payload.type : file.type || 'application/octet-stream';
	return {
		url: payload.url,
		kind: classifyMime(mimeType),
		mimeType,
		bytes: typeof payload.size === 'number' ? payload.size : file.size,
		provider: 'blossom'
	};
}

/* ========================================================================== *
   Cloudinary — unsigned preset OR signed (API key + secret) upload
 * ========================================================================== */

const encoder = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
	return Array.from(new Uint8Array(buf))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}
export { toHex };

/** Cloudinary signature: SHA-1 hex of (params sorted by key joined as `k=v` by `&`, then api_secret appended). */
export async function signCloudinaryRequest(
	params: Record<string, string>,
	apiSecret: string
): Promise<string> {
	const stringToSign =
		Object.keys(params)
			.sort()
			.map((k) => `${k}=${params[k]}`)
			.join('&') + apiSecret;
	const digest = await crypto.subtle.digest('SHA-1', encoder.encode(stringToSign));
	return toHex(digest);
}

export async function uploadToCloudinary(
	file: File,
	cfg: CloudinaryConfig
): Promise<UploadedMedia> {
	const cloudName = cfg.cloudName?.trim();
	if (!cloudName) throw new Error('Cloudinary cloud name is not configured');

	const apiKey = cfg.apiKey?.trim();
	const apiSecret = cfg.apiSecret?.trim();
	const uploadPreset = cfg.uploadPreset?.trim();
	const folder = cfg.folder?.trim();

	// Signed uploads need the API key + secret; otherwise an unsigned preset is required.
	const signedMode = !!(apiKey && apiSecret);
	if (!signedMode && !uploadPreset) {
		throw new Error('Cloudinary needs an unsigned upload preset, or an API key + API secret');
	}

	const form = new FormData();
	form.append('file', file);

	// Parameters that participate in the signature (everything except file/signature/api_key).
	const signedParams: Record<string, string> = {};
	if (uploadPreset) {
		form.append('upload_preset', uploadPreset);
		signedParams.upload_preset = uploadPreset;
	}
	if (folder) {
		form.append('folder', folder);
		signedParams.folder = folder;
	}

	if (signedMode) {
		const timestamp = Math.floor(Date.now() / 1000).toString();
		signedParams.timestamp = timestamp;
		form.append('timestamp', timestamp);
		form.append('signature', await signCloudinaryRequest(signedParams, apiSecret));
		form.append('api_key', apiKey);
	}

	const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`, {
		method: 'POST',
		body: form
	});

	if (!res.ok) {
		let detail = `${res.status} ${res.statusText}`;
		try {
			const body = await res.json();
			detail = body?.error?.message || detail;
		} catch {
			/* ignore non-json error bodies */
		}
		throw new Error(`Cloudinary upload failed: ${detail}`);
	}

	const data = await res.json();
	const resourceType = String(data.resource_type ?? '');
	const kind: UploadedMedia['kind'] =
		resourceType === 'video' ? 'video' : resourceType === 'image' ? 'image' : 'file';
	const format = typeof data.format === 'string' ? data.format : '';

	return {
		url: String(data.secure_url ?? ''),
		kind,
		mimeType: format ? `${resourceType}/${format}` : file.type || 'application/octet-stream',
		bytes: typeof data.bytes === 'number' ? data.bytes : file.size,
		provider: 'cloudinary'
	};
}

/* ========================================================================== *
   S3 / S3-compatible — AWS Signature V4 direct PUT
 * ========================================================================== */

async function sha256Hex(data: string | BufferSource): Promise<string> {
	const buf = typeof data === 'string' ? encoder.encode(data) : data;
	return toHex(await crypto.subtle.digest('SHA-256', buf));
}

async function hmacSha256(key: BufferSource, message: string): Promise<ArrayBuffer> {
	const cryptoKey = await crypto.subtle.importKey(
		'raw',
		key,
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
}

/** Derive the AWS SigV4 signing key (AWS4 prefix → date → region → service → aws4_request). */
export async function getSigningKey(
	secretAccessKey: string,
	dateStamp: string,
	region: string,
	service: string
): Promise<ArrayBuffer> {
	const kSecret = encoder.encode(`AWS4${secretAccessKey}`);
	const kDate = await hmacSha256(kSecret, dateStamp);
	const kRegion = await hmacSha256(kDate, region);
	const kService = await hmacSha256(kRegion, service);
	return hmacSha256(kService, 'aws4_request');
}

export interface AwsSignInput {
	method: string;
	canonicalUri: string;
	canonicalQueryString: string;
	canonicalHeaders: string;
	signedHeaders: string;
	payloadHash: string;
	amzDate: string;
	dateStamp: string;
	region: string;
	service: string;
	accessKey: string;
	secretKey: string;
}

/** Build the canonical request, string-to-sign, and final Authorization header. */
export async function signAwsRequestV4(input: AwsSignInput): Promise<string> {
	const canonicalRequest = [
		input.method,
		input.canonicalUri,
		input.canonicalQueryString,
		input.canonicalHeaders,
		input.signedHeaders,
		input.payloadHash
	].join('\n');

	const scope = `${input.dateStamp}/${input.region}/${input.service}/aws4_request`;
	const stringToSign = [
		'AWS4-HMAC-SHA256',
		input.amzDate,
		scope,
		await sha256Hex(canonicalRequest)
	].join('\n');

	const signingKey = await getSigningKey(
		input.secretKey,
		input.dateStamp,
		input.region,
		input.service
	);
	const signature = toHex(await hmacSha256(signingKey, stringToSign));
	return `AWS4-HMAC-SHA256 Credential=${input.accessKey}/${scope}, SignedHeaders=${input.signedHeaders}, Signature=${signature}`;
}

/** URI-encode a path segment-by-segment so `/` separators are preserved. */
function encodePath(p: string): string {
	return p
		.split('/')
		.map((seg) => encodeURIComponent(seg))
		.join('/');
}

function sanitizeName(name: string): string {
	return name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'file';
}

export async function uploadToS3(file: File, cfg: S3Config): Promise<UploadedMedia> {
	const bucket = cfg.bucket?.trim();
	const accessKey = cfg.accessKey?.trim();
	const secretKey = cfg.secretKey?.trim();
	if (!bucket) throw new Error('S3 bucket is not configured');
	if (!accessKey) throw new Error('S3 access key is not configured');
	if (!secretKey) throw new Error('S3 secret key is not configured');

	const region = cfg.region?.trim() || 'us-east-1';
	const endpoint = cfg.endpoint?.trim().replace(/\/+$/, '') || '';
	const folderPrefix = cfg.folder?.trim().replace(/^\/+|\/+$/g, '');

	const objectKey = [
		...(folderPrefix ? folderPrefix.split('/') : []),
		`${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${sanitizeName(file.name)}`
	].join('/');
	const encodedKey = encodePath(objectKey);

	// Resolve host + path-style prefix.
	let host: string;
	let pathPrefix = ''; // prepended to the canonical/public path (path-style)
	let protocol = 'https:';
	if (endpoint) {
		const u = new URL(endpoint);
		protocol = u.protocol;
		host = u.host;
		pathPrefix = `/${bucket}`; // path-style: /<bucket>/<key>
	} else {
		// AWS S3 virtual-hosted style.
		host =
			region === 'us-east-1'
				? `${bucket}.s3.amazonaws.com`
				: `${bucket}.s3.${region}.amazonaws.com`;
	}

	const canonicalUri = `${pathPrefix}/${encodedKey}`;
	const canonicalQueryString = '';

	// Payload hash (SHA-256 of the file body).
	const fileBuffer = await file.arrayBuffer();
	const payloadHash = toHex(await crypto.subtle.digest('SHA-256', fileBuffer));

	// Dates.
	const now = new Date();
	const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
	const dateStamp = amzDate.slice(0, 8);

	const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
	const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

	// `Host` is a forbidden header in fetch; the browser sets it from the URL.
	const url = `${protocol}//${host}${canonicalUri}`;
	const authorization = await signAwsRequestV4({
		method: 'PUT',
		canonicalUri,
		canonicalQueryString,
		canonicalHeaders,
		signedHeaders,
		payloadHash,
		amzDate,
		dateStamp,
		region,
		service: 's3',
		accessKey,
		secretKey
	});

	const res = await fetch(url, {
		method: 'PUT',
		headers: {
			'x-amz-content-sha256': payloadHash,
			'x-amz-date': amzDate,
			'Content-Type': file.type || 'application/octet-stream',
			Authorization: authorization
		},
		body: file
	});

	if (!res.ok) {
		let detail = `${res.status} ${res.statusText}`;
		try {
			const text = await res.text();
			const match = text.match(/<Message>([\s\S]*?)<\/Message>/);
			if (match) detail = match[1];
		} catch {
			/* ignore */
		}
		throw new Error(`S3 upload failed: ${detail}`);
	}

	// Resolve the public URL used to reference the file.
	let publicUrl: string;
	if (cfg.publicUrlBase?.trim()) {
		publicUrl = `${cfg.publicUrlBase.trim().replace(/\/+$/, '')}/${encodedKey}`;
	} else if (endpoint) {
		publicUrl = `${endpoint}/${bucket}/${encodedKey}`;
	} else {
		publicUrl =
			region === 'us-east-1'
				? `https://${bucket}.s3.amazonaws.com/${encodedKey}`
				: `https://${bucket}.s3.${region}.amazonaws.com/${encodedKey}`;
	}

	return {
		url: publicUrl,
		kind: classifyMime(file.type),
		mimeType: file.type || 'application/octet-stream',
		bytes: file.size,
		provider: 's3'
	};
}

/* ========================================================================== *
   Server fallback — POST /api/media/upload (Cloudinary signed proxy)
 * ========================================================================== */

export async function uploadViaServer(file: File, options: UploadOptions = {}): Promise<UploadedMedia> {
	const form = new FormData();
	form.append('file', file);
	if (options.owner) form.append('owner', options.owner);
	if (options.purpose) form.append('purpose', options.purpose);

	const res = await fetch('/api/media/upload', {
		method: 'POST',
		body: form
	});

	let payload: { error?: string } & Partial<UploadedMedia> = {};
	try {
		payload = (await res.json()) as typeof payload;
	} catch {
		payload = {};
	}

	if (!res.ok) {
		throw new Error(payload.error || `Server upload failed: ${res.status} ${res.statusText}`);
	}

	if (!payload.url) throw new Error('Server upload succeeded without a media URL');
	return {
		url: payload.url,
		kind: payload.kind ?? classifyMime(file.type),
		mimeType: payload.mimeType ?? (file.type || 'application/octet-stream'),
		bytes: payload.bytes ?? file.size,
		provider: 'server'
	};
}

/* ========================================================================== *
   Dispatcher
 * ========================================================================== */

/** Dispatch to the configured provider. `server`/`none` is handled by the store. */
export async function uploadWithProvider(
	file: File,
	provider: MediaProviderId,
	settings: MediaSettings
): Promise<UploadedMedia> {
	if (provider === 'cloudinary') return uploadToCloudinary(file, settings.cloudinary);
	if (provider === 's3') return uploadToS3(file, settings.s3);
	throw new Error(`Unknown media provider: ${provider}`);
}

/** Whether the configured/default provider would route through the free Blossom default. */
export function isServerFallback(settings: MediaSettings): boolean {
	const id = settings.defaultProvider;
	if (id === 'none') return true;
	if (id !== 'cloudinary' && id !== 's3') return true;
	return false;
}
