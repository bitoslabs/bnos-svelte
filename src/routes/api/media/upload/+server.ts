import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import { signCloudinaryRequest } from '$lib/media/uploaders';

/**
 * Optional server-side upload fallback.
 *
 * Used automatically by `media.upload()` when no personal provider (Cloudinary /
 * S3) is configured. The server signs the request with credentials from env so
 * the secret never reaches the browser. Disabled (503) until `BNOS_CLOUDINARY_*`
 * env vars are present — which keeps BNOS local-first by default.
 *
 * Folder layout: `<BNOS_CLOUDINARY_FOLDER>/bnos/<owner|anonymous>/<purpose>`
 */
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const PURPOSES = new Set(['product', 'category', 'brand', 'logo', 'avatar', 'receipt', 'test']);

function cloudinaryConfig() {
	const cloudName = env.BNOS_CLOUDINARY_CLOUD_NAME?.trim() ?? '';
	const apiKey = env.BNOS_CLOUDINARY_API_KEY?.trim() ?? '';
	const apiSecret = env.BNOS_CLOUDINARY_API_SECRET?.trim() ?? '';
	const uploadPreset = env.BNOS_CLOUDINARY_UPLOAD_PRESET?.trim() ?? '';
	const folder = env.BNOS_CLOUDINARY_FOLDER?.trim() ?? 'bnos';

	return {
		cloudName,
		apiKey,
		apiSecret,
		uploadPreset,
		folder,
		enabled: !!cloudName && (!!uploadPreset || !!(apiKey && apiSecret))
	};
}

function safeOwner(value: FormDataEntryValue | null) {
	if (typeof value !== 'string') return '';
	const trimmed = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 64);
	return trimmed || '';
}

function safePurpose(value: FormDataEntryValue | null) {
	if (typeof value !== 'string') return 'upload';
	const trimmed = value.trim().toLowerCase();
	return PURPOSES.has(trimmed) ? trimmed : 'upload';
}

/** `GET` lets the client detect whether the fallback is available. */
export async function GET() {
	const cfg = cloudinaryConfig();
	return json({ enabled: cfg.enabled });
}

export async function POST({ request }) {
	const cfg = cloudinaryConfig();
	if (!cfg.enabled) {
		return json({ error: 'Server media uploads are not configured' }, { status: 503 });
	}

	const formData = await request.formData();
	const maybeFile = formData.get('file');
	const owner = safeOwner(formData.get('owner'));
	const purpose = safePurpose(formData.get('purpose'));

	if (!(maybeFile instanceof File)) {
		return json({ error: 'Missing file upload' }, { status: 400 });
	}
	if (!maybeFile.size) {
		return json({ error: 'Uploaded file is empty' }, { status: 400 });
	}
	if (maybeFile.size > MAX_UPLOAD_BYTES) {
		return json({ error: 'File exceeds 100 MB upload limit' }, { status: 413 });
	}

	const upstreamForm = new FormData();
	upstreamForm.append('file', maybeFile);

	const signedParams: Record<string, string> = {};
	if (cfg.uploadPreset) {
		upstreamForm.append('upload_preset', cfg.uploadPreset);
		signedParams.upload_preset = cfg.uploadPreset;
	}

	const folderParts = [cfg.folder, 'bnos', owner || 'anonymous', purpose]
		.filter(Boolean)
		.map((part) => part.replace(/^\/+|\/+$/g, ''));
	const folder = folderParts.join('/');
	if (folder) {
		upstreamForm.append('folder', folder);
		signedParams.folder = folder;
	}

	if (cfg.apiKey && cfg.apiSecret) {
		const timestamp = Math.floor(Date.now() / 1000).toString();
		signedParams.timestamp = timestamp;
		upstreamForm.append('timestamp', timestamp);
		upstreamForm.append('api_key', cfg.apiKey);
		upstreamForm.append('signature', await signCloudinaryRequest(signedParams, cfg.apiSecret));
	}

	const response = await fetch(`https://api.cloudinary.com/v1_1/${cfg.cloudName}/auto/upload`, {
		method: 'POST',
		body: upstreamForm
	});

	let payload: Record<string, unknown> | null = null;
	try {
		payload = (await response.json()) as Record<string, unknown>;
	} catch {
		/* response body was not JSON; payload stays null */
	}

	if (!response.ok) {
		const detail =
			typeof payload?.error === 'object' && payload?.error && 'message' in payload.error
				? String(payload.error.message)
				: `${response.status} ${response.statusText}`;
		return json({ error: `Cloudinary upload failed: ${detail}` }, { status: response.status });
	}

	const resourceType = String(payload?.resource_type ?? '');
	const kind = resourceType === 'video' ? 'video' : resourceType === 'image' ? 'image' : 'file';
	const format = typeof payload?.format === 'string' ? payload.format : '';

	return json({
		url: String(payload?.secure_url ?? ''),
		kind,
		mimeType: format ? `${resourceType}/${format}` : maybeFile.type || 'application/octet-stream',
		bytes: typeof payload?.bytes === 'number' ? payload.bytes : maybeFile.size,
		provider: 'server'
	});
}
