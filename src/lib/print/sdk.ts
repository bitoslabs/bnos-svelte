/**
 * BNOS Print Service web SDK (platform client + deeplink helpers).
 *
 * Vendored from `@bnos/print-sdk` → `packages/web-sdk/src/index.ts` in
 * https://github.com/bitoslabs/bitos-print-service so the app can ship without
 * a cross-repository package dependency.
 *
 * Only the transport / deeplink surface is mirrored here. Receipt byte building
 * stays in `$lib/pos/escpos` (the app's richer column/paper-width renderer).
 * Keep this file in sync with upstream when the protocol changes.
 */
export type PrintPlatform = 'desktop' | 'ios' | 'android';
export type PrintTransport = 'tcp' | 'ble' | 'bt_spp' | 'usb';

export interface DiscoveredPrinter {
	id: string;
	name: string;
	transport: PrintTransport;
	ip?: string;
	port?: number;
	address: string;
	protocol: 'escpos' | 'tspl';
	paperWidthMm: number;
	isDefault?: boolean;
}

export interface AddPrinterInput {
	name: string;
	ip: string;
	port?: number;
	paperWidthMm?: number;
	isDefault?: boolean;
}

export interface PrintJobInput {
	type: 'raw' | 'test' | 'receipt';
	printerId?: string;
	transport?: PrintTransport;
	ip?: string;
	port?: number;
	mac?: string;
	data?: Uint8Array;
	jobUrl?: string;
	cut?: boolean;
	callback?: string;
	silent?: boolean;
}

export interface PrintResponse {
	ok: boolean;
	bytes?: number;
	jobId?: string;
	error?: string;
	needsInstall?: boolean;
	mode: 'desktop-http' | 'mobile-deeplink';
	deeplinkUrl?: string;
}

export interface PrintHealth {
	ok: boolean;
	service?: string;
	version?: string;
	platform?: string;
	needsInstall?: boolean;
}

export interface BnosPrintClientOptions {
	daemonUrl?: string;
	platform?: PrintPlatform;
	fetchImpl?: typeof fetch;
	navigate?: (url: string) => void;
}

export const MAX_DEEPLINK_BYTES = 16 * 1024;

export function detectPrintPlatform(userAgent?: string): PrintPlatform {
	const ua = userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '');
	if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
	if (/Android/i.test(ua)) return 'android';
	return 'desktop';
}

export function toBase64(bytes: Uint8Array): string {
	if (typeof Buffer !== 'undefined') {
		return Buffer.from(bytes).toString('base64');
	}
	let binary = '';
	for (let i = 0; i < bytes.length; i += 1) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

export function toBase64Url(bytes: Uint8Array): string {
	return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function gzipCompress(bytes: Uint8Array): Promise<Uint8Array | null> {
	if (typeof CompressionStream === 'undefined') {
		return null;
	}
	const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
	const buf = await new Response(stream).arrayBuffer();
	return new Uint8Array(buf);
}

function populateDeeplinkParams(params: URLSearchParams, job: PrintJobInput): void {
	params.set('v', '1');
	params.set('type', job.type);
	if (job.transport) params.set('transport', job.transport);
	if (job.ip) params.set('ip', job.ip);
	if (job.port) params.set('port', String(job.port));
	if (job.mac) params.set('mac', job.mac);
	if (job.cut !== undefined) params.set('cut', job.cut ? '1' : '0');
	if (job.silent !== undefined) params.set('silent', job.silent ? '1' : '0');
	if (job.callback) params.set('callback', job.callback);
}

export function buildDeeplinkUrl(job: PrintJobInput): string {
	const params = new URLSearchParams();
	populateDeeplinkParams(params, job);

	if (job.jobUrl) {
		params.set('jobUrl', job.jobUrl);
	} else if (job.data && job.data.length > 0) {
		if (job.data.length > MAX_DEEPLINK_BYTES) {
			throw new Error(
				`Payload (${job.data.length} bytes) exceeds ${MAX_DEEPLINK_BYTES} byte deeplink limit; use buildDeeplinkUrlAsync() or pass jobUrl.`
			);
		}
		params.set('data', toBase64Url(job.data));
	}

	return `bnos-print://print?${params.toString()}`;
}

export async function buildDeeplinkUrlAsync(job: PrintJobInput): Promise<string> {
	const params = new URLSearchParams();
	populateDeeplinkParams(params, job);

	if (job.jobUrl) {
		params.set('jobUrl', job.jobUrl);
		return `bnos-print://print?${params.toString()}`;
	}

	if (job.data && job.data.length > 0) {
		if (job.data.length <= MAX_DEEPLINK_BYTES) {
			params.set('data', toBase64Url(job.data));
		} else {
			const compressed = await gzipCompress(job.data);
			if (compressed && compressed.length <= MAX_DEEPLINK_BYTES) {
				params.set('enc', 'gzip');
				params.set('data', toBase64Url(compressed));
			} else {
				throw new Error(
					`Payload (${job.data.length} bytes) exceeds ${MAX_DEEPLINK_BYTES} byte deeplink limit even after gzip; pass jobUrl instead.`
				);
			}
		}
	}

	return `bnos-print://print?${params.toString()}`;
}

export function buildSetupDeeplinkUrl(callback?: string): string {
	const params = new URLSearchParams({ v: '1' });
	if (callback) params.set('callback', callback);
	return `bnos-print://setup?${params.toString()}`;
}

export function parseCallbackResult(urlOrSearch: string): {
	ok: boolean;
	jobId?: string;
	error?: string;
} {
	const query = urlOrSearch.includes('?')
		? urlOrSearch.slice(urlOrSearch.indexOf('?') + 1)
		: urlOrSearch;
	const params = new URLSearchParams(query);
	const ok = params.get('ok') === '1' || params.get('ok') === 'true';
	return {
		ok,
		jobId: params.get('jobId') ?? undefined,
		error: params.get('error') ?? undefined
	};
}

export class BnosPrintClient {
	private readonly daemonUrl: string;
	private readonly platform: PrintPlatform;
	private readonly fetchImpl: typeof fetch;
	private readonly navigate: (url: string) => void;

	constructor(options: BnosPrintClientOptions = {}) {
		this.daemonUrl = (options.daemonUrl ?? 'http://127.0.0.1:3100').replace(/\/+$/, '');
		this.platform = options.platform ?? detectPrintPlatform();
		this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
		this.navigate =
			options.navigate ??
			((url: string) => {
				if (typeof window !== 'undefined') {
					window.location.href = url;
				}
			});
	}

	get currentPlatform(): PrintPlatform {
		return this.platform;
	}

	async checkHealth(): Promise<PrintHealth> {
		if (this.platform !== 'desktop') {
			return { ok: true, platform: this.platform };
		}
		try {
			const res = await this.fetchImpl(`${this.daemonUrl}/health`, { method: 'GET' });
			if (!res.ok) return { ok: false, needsInstall: true };
			return (await res.json()) as PrintHealth;
		} catch {
			return { ok: false, needsInstall: true };
		}
	}

	async listPrinters(): Promise<DiscoveredPrinter[]> {
		if (this.platform !== 'desktop') {
			return [];
		}
		const res = await this.fetchImpl(`${this.daemonUrl}/printers`, { method: 'GET' });
		if (!res.ok) {
			throw new Error(`Failed to list printers: HTTP ${res.status}`);
		}
		const json = (await res.json()) as { ok: boolean; printers?: DiscoveredPrinter[] };
		return json.printers ?? [];
	}

	async addPrinter(input: AddPrinterInput): Promise<DiscoveredPrinter> {
		const res = await this.fetchImpl(`${this.daemonUrl}/printers`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(input)
		});
		const json = (await res.json()) as {
			ok: boolean;
			printer?: DiscoveredPrinter;
			error?: string;
		};
		if (!res.ok || !json.printer) {
			throw new Error(json.error ?? `Failed to add printer: HTTP ${res.status}`);
		}
		return json.printer;
	}

	async setDefaultPrinter(printerId: string): Promise<boolean> {
		const res = await this.fetchImpl(
			`${this.daemonUrl}/printers/${encodeURIComponent(printerId)}/default`,
			{ method: 'POST' }
		);
		return res.ok;
	}

	async removePrinter(printerId: string): Promise<boolean> {
		const res = await this.fetchImpl(
			`${this.daemonUrl}/printers/${encodeURIComponent(printerId)}`,
			{ method: 'DELETE' }
		);
		return res.ok;
	}

	async printTest(
		target?: Pick<PrintJobInput, 'printerId' | 'ip' | 'port' | 'transport' | 'callback'>
	): Promise<PrintResponse> {
		return this.print({ type: 'test', ...target });
	}

	async print(job: PrintJobInput): Promise<PrintResponse> {
		if (this.platform === 'ios' || this.platform === 'android') {
			const deeplinkUrl = await buildDeeplinkUrlAsync(job);
			this.navigate(deeplinkUrl);
			return { ok: true, mode: 'mobile-deeplink', deeplinkUrl };
		}

		const body: Record<string, unknown> = {
			type: job.type,
			printerId: job.printerId,
			ip: job.ip,
			port: job.port,
			transport: job.transport,
			mac: job.mac
		};
		if (job.data && job.data.length > 0) {
			body.dataBase64 = toBase64(job.data);
		}

		try {
			const res = await this.fetchImpl(`${this.daemonUrl}/print`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			const json = (await res.json()) as Omit<PrintResponse, 'mode'>;
			return { ...json, mode: 'desktop-http' };
		} catch (err) {
			return {
				ok: false,
				needsInstall: true,
				error: err instanceof Error ? err.message : String(err),
				mode: 'desktop-http'
			};
		}
	}
}
