/**
 * Media upload settings — runes-based singleton persisted to localStorage.
 *
 * Owns credentials for the Cloudinary + S3-compatible providers and the default
 * provider used by every upload in the app (product images, logos, avatars, …).
 *
 * Like the rest of BNOS this is local-first: provider secrets live on-device
 * (same trust model as the Nostr private key). When no provider is configured
 * (`'none'`), uploads go directly to the free Blossom server using the
 * currently signed-in Nostr identity.
 *
 * Separation of concerns:
 *   • `uploaders.ts`   → pure functions + crypto (no state, fully testable)
 *   • this module      → state, persistence, the `upload()` dispatcher + derived helpers
 *   • `MediaImageInput`→ the reusable UI widget that calls `media.upload()`
 */
import { browser } from '$app/environment';
import {
	uploadWithProvider,
	uploadToBlossom,
	type CloudinaryConfig,
	type MediaProviderId,
	type MediaSettings,
	type S3Config,
	type UploadOptions,
	type UploadedMedia,
	type UploadedMediaProviderId
} from './uploaders';
import { session } from '$nostr/session.svelte';
import { signNostrEvent, type NostrEvent } from '@bitos/bnos-core';

export const STORAGE_KEY = 'bnos-os:settings-media';

export const DEFAULTS: MediaSettings = {
	defaultProvider: 'none',
	cloudinary: { cloudName: '', uploadPreset: '', apiKey: '', apiSecret: '' },
	s3: { bucket: '', region: 'us-east-1', accessKey: '', secretKey: '' }
};

export const MEDIA_PROVIDERS: {
	id: MediaProviderId;
	label: string;
	icon: string;
	description: string;
}[] = [
	{
		id: 'cloudinary',
		label: 'Cloudinary',
		icon: 'lucide:cloud-sun',
		description: 'Unsigned preset (safest) or signed uploads'
	},
	{
		id: 's3',
		label: 'S3 / R2 / B2',
		icon: 'lucide:database',
		description: 'Direct PUT to S3-compatible storage (AWS SigV4)'
	}
];

export function providerLabel(id: UploadedMediaProviderId | 'none'): string {
	if (id === 'none') return 'Free Blossom';
	if (id === 'blossom') return 'Free Blossom';
	if (id === 'server') return 'Blossom';
	return MEDIA_PROVIDERS.find((p) => p.id === id)?.label ?? id;
}

class MediaStore {
	state = $state<MediaSettings>(structuredClone(DEFAULTS));

	/** Restore from localStorage. Safe to call on mount; no-op on the server. */
	load = () => {
		if (!browser) return;
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (raw) {
				const parsed = JSON.parse(raw) as Partial<MediaSettings>;
				this.state = {
					...structuredClone(DEFAULTS),
					...parsed,
					cloudinary: { ...DEFAULTS.cloudinary, ...(parsed.cloudinary ?? {}) },
					s3: { ...DEFAULTS.s3, ...(parsed.s3 ?? {}) }
				};
			}
		} catch {
			/* ignore malformed storage */
		}
	};

	private persist = () => {
		if (browser) localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
	};

	setDefaultProvider = (id: MediaProviderId | 'none') => {
		this.state.defaultProvider = id;
		this.persist();
	};

	updateCloudinary = (patch: Partial<CloudinaryConfig>) => {
		this.state.cloudinary = { ...this.state.cloudinary, ...patch };
		this.persist();
	};

	updateS3 = (patch: Partial<S3Config>) => {
		this.state.s3 = { ...this.state.s3, ...patch };
		this.persist();
	};

	reset = () => {
		this.state = structuredClone(DEFAULTS);
		this.persist();
	};

	/** Whether a provider has the minimum fields filled in. */
	isConfigured = (id: MediaProviderId): boolean => {
		if (id === 'cloudinary') {
			const c = this.state.cloudinary;
			if (!c.cloudName.trim()) return false;
			// Signed mode (API key + secret) OR an unsigned upload preset.
			const signed = !!(c.apiKey?.trim() && c.apiSecret?.trim());
			return signed || !!c.uploadPreset?.trim();
		}
		const s = this.state.s3;
		return !!s.bucket.trim() && !!s.accessKey.trim() && !!s.secretKey.trim();
	};

	/** Configured providers, in display order. */
	configured = $derived(MEDIA_PROVIDERS.filter((p) => this.isConfigured(p.id)));

	/** True when uploads will route through the free Blossom default. */
	usingServerFallback = $derived(this.state.defaultProvider === 'none');

	/**
	 * Upload a single file via the given (or the default) provider.
	 *
	 * The active org id is passed as `owner` automatically so server-side uploads
	 * land in an org-scoped folder. Callers pass just `{ purpose }`.
	 */
	upload = async (
		file: File,
		provider?: MediaProviderId,
		options: UploadOptions = {}
	): Promise<UploadedMedia> => {
		const id = provider ?? this.state.defaultProvider;
		if (id === 'none') {
			const snap = session.snapshot;
			if (!snap) throw new Error('Sign in with a Nostr identity before uploading to Blossom');
			return uploadToBlossom(file, async (sha256) => {
				const event = (await signNostrEvent({
					template: {
						kind: 24242,
						created_at: Math.floor(Date.now() / 1000),
						tags: [
							['t', 'upload'],
							['expiration', String(Math.floor(Date.now() / 1000) + 60)],
							['server', 'blossom.nostr.build'],
							['x', sha256]
						],
						content: 'Upload blob to Blossom'
					},
					fallbackPubkey: snap.pubkey,
					loginMethod: snap.loginMethod,
					nsec: snap.nsec,
					extensionSigner: session.extensionSigner ?? undefined
				})) as NostrEvent;
				return `Nostr ${base64Url(JSON.stringify(event))}`;
			});
		}
		if (id !== 'cloudinary' && id !== 's3') throw new Error(`Unknown provider: ${id}`);
		return uploadWithProvider(file, id, this.state);
	};
}

function base64Url(value: string): string {
	const bytes = new TextEncoder().encode(value);
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const media = new MediaStore();
