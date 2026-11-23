/**
 * Integration layer between BNOS printer profiles and the native print service
 * (desktop daemon on `http://127.0.0.1:3100` + `bnos-print://` mobile deeplinks).
 *
 * See https://github.com/bitoslabs/bitos-print-service for the native apps and
 * protocol reference.
 */
import { browser } from '$app/environment';
import type { Printer } from '$lib/settings/printers';
import {
	BnosPrintClient,
	buildSetupDeeplinkUrl,
	detectPrintPlatform,
	parseCallbackResult,
	type PrintHealth,
	type PrintJobInput,
	type PrintPlatform,
	type PrintTransport
} from './sdk';

export const PRINT_SERVICE_GITHUB_URL = 'https://github.com/bitoslabs/bitos-print-service';
export const PRINT_SERVICE_DAEMON_URL = 'http://127.0.0.1:3100';

export interface NativePrintResult {
	ok: boolean;
	message: string;
	mode: 'desktop-http' | 'mobile-deeplink';
	needsInstall?: boolean;
}

export interface NativePrintOptions {
	/** Where the mobile app should return after printing. Defaults to this page. */
	callback?: string;
	/** Return to `callback` immediately on success (mobile). */
	silent?: boolean;
}

let client: BnosPrintClient | null = null;

export function currentPrintPlatform(): PrintPlatform {
	return detectPrintPlatform();
}

export function isMobilePrintPlatform(): boolean {
	return currentPrintPlatform() !== 'desktop';
}

export function getNativePrintClient(): BnosPrintClient {
	if (!client) {
		client = new BnosPrintClient({
			daemonUrl: PRINT_SERVICE_DAEMON_URL,
			navigate: (url: string) => {
				if (browser) window.location.href = url;
			}
		});
	}
	return client;
}

/** Transport the native service should use for this profile. */
export function nativeTransportFor(printer: Printer): PrintTransport {
	if (printer.nativeTransport) return printer.nativeTransport;
	if (printer.connectionType === 'bluetooth') return 'bt_spp';
	if (printer.connectionType === 'usb') return 'usb';
	return 'tcp';
}

export function nativeTargetLabel(printer: Printer): string {
	const transport = nativeTransportFor(printer);
	if (transport === 'tcp') return `${printer.ip || '—'}:${printer.port || '9100'}`;
	if (transport === 'ble' || transport === 'bt_spp') return printer.macAddress || '—';
	return transport.toUpperCase();
}

function buildJob(
	printer: Printer,
	bytes: Uint8Array,
	opts: NativePrintOptions = {}
): PrintJobInput {
	const transport = nativeTransportFor(printer);
	const job: PrintJobInput = {
		type: 'raw',
		transport,
		data: bytes,
		cut: printer.autoCut
	};

	if (transport === 'tcp') {
		job.ip = printer.ip.trim();
		job.port = Number(printer.port) || 9100;
	} else if (transport === 'ble' || transport === 'bt_spp') {
		job.mac = printer.macAddress.trim();
	}

	if (isMobilePrintPlatform()) {
		job.callback = opts.callback ?? (browser ? window.location.href : undefined);
		job.silent = opts.silent ?? false;
	}

	return job;
}

/** Send raw ESC/POS bytes through the native service (HTTP on desktop, deeplink on mobile). */
export async function printEscPosNative(
	printer: Printer,
	bytes: Uint8Array,
	opts: NativePrintOptions = {}
): Promise<NativePrintResult> {
	const mobile = isMobilePrintPlatform();
	const mode = mobile ? 'mobile-deeplink' : 'desktop-http';

	try {
		const res = await getNativePrintClient().print(buildJob(printer, bytes, opts));
		if (res.mode === 'mobile-deeplink') {
			return {
				ok: true,
				mode: 'mobile-deeplink',
				message: 'Opening the BNOS Print app…'
			};
		}
		if (res.ok) {
			return {
				ok: true,
				mode: 'desktop-http',
				message: `Sent ${res.bytes ?? bytes.length} bytes via BNOS Print Service`
			};
		}
		return {
			ok: false,
			mode: 'desktop-http',
			needsInstall: res.needsInstall,
			message: res.needsInstall
				? 'BNOS Print Service is not running on this device. Install or start it, then retry.'
				: (res.error ?? 'BNOS Print Service rejected the job')
		};
	} catch (err) {
		return {
			ok: false,
			mode,
			message: err instanceof Error ? err.message : String(err)
		};
	}
}

/** Send a diagnostic test job through the native service. */
export async function printTestNative(
	printer: Printer,
	opts: NativePrintOptions = {}
): Promise<NativePrintResult> {
	const mobile = isMobilePrintPlatform();
	try {
		const res = await getNativePrintClient().print({
			type: 'test',
			transport: nativeTransportFor(printer),
			ip: printer.ip.trim() || undefined,
			port: Number(printer.port) || 9100,
			mac: printer.macAddress.trim() || undefined,
			callback: mobile
				? (opts.callback ?? (browser ? window.location.href : undefined))
				: undefined,
			silent: opts.silent ?? false
		});
		if (res.mode === 'mobile-deeplink') {
			return { ok: true, mode: 'mobile-deeplink', message: 'Opening the BNOS Print app…' };
		}
		if (res.ok) {
			return { ok: true, mode: 'desktop-http', message: 'Native service printed a test page' };
		}
		return {
			ok: false,
			mode: 'desktop-http',
			needsInstall: res.needsInstall,
			message: res.needsInstall
				? 'BNOS Print Service is not running on this device.'
				: (res.error ?? 'Test print failed')
		};
	} catch (err) {
		return {
			ok: false,
			mode: mobile ? 'mobile-deeplink' : 'desktop-http',
			message: err instanceof Error ? err.message : String(err)
		};
	}
}

/** Probe the desktop daemon. On mobile there is no daemon to reach. */
export async function probePrintService(): Promise<PrintHealth> {
	const platform = currentPrintPlatform();
	if (platform !== 'desktop') {
		return { ok: true, platform };
	}
	return getNativePrintClient().checkHealth();
}

/** Ask the native mobile app to open its printer setup / pairing screen. */
export function openNativeSetup(): void {
	if (!browser) return;
	window.location.href = buildSetupDeeplinkUrl(window.location.href);
}

/**
 * Read `?ok=1&jobId=…` / `?ok=0&error=…` appended by the mobile app when it
 * returns through the deeplink callback, then strip those params from the URL.
 * Returns `null` when the page was not opened as a print callback.
 */
export function consumePrintCallback(): { ok: boolean; jobId?: string; error?: string } | null {
	if (!browser) return null;
	const url = new URL(window.location.href);
	if (!url.searchParams.has('ok')) return null;

	const result = parseCallbackResult(url.search);
	url.searchParams.delete('ok');
	url.searchParams.delete('jobId');
	url.searchParams.delete('error');
	const search = url.searchParams.toString();
	window.history.replaceState({}, '', `${url.pathname}${search ? `?${search}` : ''}${url.hash}`);
	return result;
}
