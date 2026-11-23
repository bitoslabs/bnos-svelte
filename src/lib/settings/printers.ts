/**
 * Printer profiles — the single source of truth for receipt / kitchen printers.
 *
 * Historically the Hardware settings page stored one global printer
 * (`hardware.printerType` / `paperSize` / `cashDrawer`) while the Printers page
 * stored a full multi-printer CRUD list under its own key. They never
 * reconciled, so the Hardware values (the only ones actually read by the POS,
 * `print.ts` and `workspace-settings.ts`) drifted from the Printers list.
 *
 * This module owns the Printers list and *derives* the legacy Hardware fields
 * from the active (default) printer, so every consumer keeps working while the
 * Printers page becomes the one place printers are configured.
 */
import { browser } from '$app/environment';
import { buildTestReceiptBytes, bytesToBase64 } from '$lib/pos/escpos';
import { isMobilePrintPlatform, printEscPosNative, printTestNative } from '$lib/print/native';
import type { PrintTransport } from '$lib/print/sdk';
import {
	loadHardwareSettings,
	saveHardwareSettings,
	type HardwareSettings
} from '$lib/settings/local';

export const PRINTERS_KEY = 'bnos-os:printers';

export type ConnectionType =
	'native' | 'browser' | 'usb' | 'network' | 'bluetooth' | 'websocket' | 'webhook';
/** Legacy enum consumed by the POS auto-print gate & workspace-settings sync. */
export type LegacyPrinterType = 'browser' | 'usb' | 'network' | 'none';
export type PaperSize = '58mm' | '80mm';

export interface Printer {
	id: string;
	name: string;
	enabled: boolean;
	isDefault: boolean;
	connectionType: ConnectionType;
	/** Transport used when `connectionType === 'native'`. */
	nativeTransport?: PrintTransport;
	ip: string;
	port: string;
	useApiProxy: boolean;
	macAddress: string;
	url: string;
	authToken: string;
	payloadFormat: 'raw' | 'json';
	charsPerLine: number;
	autoPrint: boolean;
	autoCut: boolean;
	cutMode: 'full' | 'partial';
	paperSize: PaperSize;
	copies: number;
	printDensity: number;
	cashDrawerEnabled: boolean;
	/** Free-form note shown on the profile card (location, paper roll, etc.). */
	note?: string;
}

export interface ConnectionMeta {
	id: ConnectionType;
	label: string;
	icon: string;
	/** Tailwind classes for the accent swatch. */
	color: string;
	/** Short helper shown under the connection picker. */
	hint: string;
}

export const CONNECTION_OPTIONS: ConnectionMeta[] = [
	{
		id: 'native',
		label: 'BNOS Print Service',
		icon: 'lucide:radio-tower',
		color: 'bg-indigo-500/10 text-indigo-500',
		hint: 'Native daemon on desktop or the BNOS Print app on iOS & Android.'
	},
	{
		id: 'browser',
		label: 'Browser',
		icon: 'lucide:globe',
		color: 'bg-emerald-500/10 text-emerald-500',
		hint: 'System print dialog. No drivers required.'
	},
	{
		id: 'network',
		label: 'Network / IP',
		icon: 'lucide:server',
		color: 'bg-blue-500/10 text-blue-500',
		hint: 'ESC/POS over TCP (port 9100).'
	},
	{
		id: 'usb',
		label: 'USB',
		icon: 'lucide:usb',
		color: 'bg-amber-500/10 text-amber-500',
		hint: 'Raw USB via WebUSB.'
	},
	{
		id: 'bluetooth',
		label: 'Bluetooth',
		icon: 'lucide:bluetooth',
		color: 'bg-purple-500/10 text-purple-500',
		hint: 'BLE printer (Web Bluetooth).'
	},
	{
		id: 'websocket',
		label: 'WebSocket',
		icon: 'lucide:cloud',
		color: 'bg-cyan-500/10 text-cyan-500',
		hint: 'Print server bridging to a local printer.'
	},
	{
		id: 'webhook',
		label: 'Webhook',
		icon: 'lucide:webhook',
		color: 'bg-pink-500/10 text-pink-500',
		hint: 'HTTP endpoint that receives the print job.'
	}
];

export function connectionMeta(ct: ConnectionType | string): ConnectionMeta {
	return CONNECTION_OPTIONS.find((c) => c.id === ct) ?? CONNECTION_OPTIONS[0];
}

export function defaultPrinter(): Printer {
	return {
		id: '',
		name: '',
		enabled: true,
		isDefault: false,
		connectionType: 'browser',
		nativeTransport: 'tcp',
		ip: '',
		port: '9100',
		useApiProxy: false,
		macAddress: '',
		url: '',
		authToken: '',
		payloadFormat: 'raw',
		charsPerLine: 48,
		autoPrint: false,
		autoCut: false,
		cutMode: 'full',
		paperSize: '80mm',
		copies: 1,
		printDensity: 8,
		cashDrawerEnabled: false,
		note: ''
	};
}

function sanitize(raw: unknown): Printer {
	const d = defaultPrinter();
	if (!raw || typeof raw !== 'object') return d;
	const r = raw as Record<string, unknown>;
	return {
		...d,
		...r,
		nativeTransport: normalizeTransport(r.nativeTransport),
		// Clamp / coerce numeric fields so a corrupt payload can't crash the UI.
		copies: clampInt(r.copies, 1, 5, 1),
		charsPerLine: clampInt(r.charsPerLine, 16, 96, 48),
		printDensity: clampInt(r.printDensity, 1, 15, 8),
		enabled: r.enabled !== false,
		isDefault: r.isDefault === true,
		useApiProxy: r.useApiProxy === true,
		autoPrint: r.autoPrint === true,
		autoCut: r.autoCut === true,
		cashDrawerEnabled: r.cashDrawerEnabled === true
	};
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
	const n = Math.floor(Number(v));
	if (!Number.isFinite(n)) return fallback;
	return Math.min(max, Math.max(min, n));
}

function normalizeTransport(v: unknown): PrintTransport {
	return v === 'ble' || v === 'bt_spp' || v === 'usb' || v === 'tcp' ? v : 'tcp';
}

export function loadPrinters(): Printer[] {
	if (!browser) return [];
	try {
		const raw = localStorage.getItem(PRINTERS_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.map(sanitize).filter((p) => p.id && p.name);
	} catch {
		return [];
	}
}

/**
 * Persist the list and keep the legacy Hardware fields derived from the active
 * printer in sync (POS auto-print gate + workspace-settings payload).
 */
export function savePrinters(list: Printer[]): void {
	if (!browser) return;
	localStorage.setItem(PRINTERS_KEY, JSON.stringify(list));
	syncHardwareFromPrinters(list);
}

/** Default printer, falling back to the first enabled, then the first overall. */
export function getActivePrinter(list: Printer[] = loadPrinters()): Printer | null {
	if (list.length === 0) return null;
	return list.find((p) => p.isDefault && p.enabled) ?? list.find((p) => p.enabled) ?? list[0];
}

/** Map a printer connection onto the legacy enum used by the POS gate. */
export function toLegacyPrinterType(p: Printer | null): LegacyPrinterType {
	if (!p || !p.enabled) return 'none';
	switch (p.connectionType) {
		case 'browser':
			return 'browser';
		case 'usb':
		case 'bluetooth':
			return 'usb';
		case 'native':
		case 'network':
		case 'websocket':
		case 'webhook':
			return 'network';
		default:
			return 'none';
	}
}

export function getActivePaperSize(list: Printer[] = loadPrinters()): PaperSize {
	return getActivePrinter(list)?.paperSize ?? '80mm';
}

/**
 * True when `sendEscPosToPrinter` can deliver raw ESC/POS for this profile.
 * `usb` / `bluetooth` route through the native mobile app (deeplink); on
 * desktop they fall back to the system print dialog.
 */
export function isEscPosTarget(p: Printer | null): boolean {
	if (!p || !p.enabled) return false;
	switch (p.connectionType) {
		case 'network':
		case 'webhook':
		case 'websocket':
		case 'native':
			return true;
		case 'usb':
		case 'bluetooth':
			return isMobilePrintPlatform();
		default:
			return false;
	}
}

export function hasActiveCashDrawer(list: Printer[] = loadPrinters()): boolean {
	return list.some((p) => p.enabled && p.cashDrawerEnabled);
}

/**
 * Re-derive `printerType`, `paperSize` and `cashDrawer` on the Hardware settings
 * blob so the POS (`pos/+page.svelte`), `print.ts` and the Nostr
 * `workspace-settings` sync keep reflecting reality without each having to know
 * about the multi-printer store.
 */
export function syncHardwareFromPrinters(list: Printer[] = loadPrinters()): void {
	if (!browser) return;
	const active = getActivePrinter(list);
	const hw: HardwareSettings = {
		...loadHardwareSettings(),
		printerType: toLegacyPrinterType(active),
		paperSize: active?.paperSize ?? loadHardwareSettings().paperSize,
		cashDrawer: hasActiveCashDrawer(list)
	};
	saveHardwareSettings(hw);
}

// ── Validation ──────────────────────────────────────────────────────────────

const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const MAC = /^([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}$/;

export type FieldErrors = Partial<Record<keyof Printer | 'form', string>>;

/** Returns a map of field → message. Empty object means the form is valid. */
export function validatePrinter(p: Printer): FieldErrors {
	const errs: FieldErrors = {};
	if (!p.name.trim()) errs.name = 'Name is required';
	if (!p.id.trim()) errs.id = 'ID is required';

	switch (p.connectionType) {
		case 'native': {
			const transport = p.nativeTransport ?? 'tcp';
			if (transport === 'tcp') {
				if (!p.ip.trim()) errs.ip = 'IP address is required';
				else if (!IPV4.test(p.ip.trim()) || p.ip.split('.').some((o) => Number(o) > 255))
					errs.ip = 'Enter a valid IPv4 address';
				const port = Number(p.port);
				if (!p.port.trim() || !Number.isInteger(port) || port < 1 || port > 65535)
					errs.port = 'Port must be 1–65535';
			} else if (transport === 'ble' || transport === 'bt_spp') {
				if (!p.macAddress.trim()) errs.macAddress = 'MAC address is required';
				else if (!MAC.test(p.macAddress.trim())) errs.macAddress = 'Format AA:BB:CC:DD:EE:FF';
			}
			break;
		}
		case 'network': {
			if (!p.ip.trim()) errs.ip = 'IP address is required';
			else if (!IPV4.test(p.ip.trim()) || p.ip.split('.').some((o) => Number(o) > 255))
				errs.ip = 'Enter a valid IPv4 address';
			const port = Number(p.port);
			if (!p.port.trim() || !Number.isInteger(port) || port < 1 || port > 65535)
				errs.port = 'Port must be 1–65535';
			break;
		}
		case 'bluetooth': {
			if (!p.macAddress.trim()) errs.macAddress = 'MAC address is required';
			else if (!MAC.test(p.macAddress.trim())) errs.macAddress = 'Format AA:BB:CC:DD:EE:FF';
			break;
		}
		case 'websocket': {
			if (!p.url.trim()) errs.url = 'WebSocket URL is required';
			else if (!/^wss?:\/\//i.test(p.url.trim())) errs.url = 'Must start with ws:// or wss://';
			break;
		}
		case 'webhook': {
			if (!p.url.trim()) errs.url = 'Endpoint URL is required';
			else if (!/^https?:\/\//i.test(p.url.trim()))
				errs.url = 'Must start with http:// or https://';
			break;
		}
	}
	return errs;
}

/** True when all connection-specific fields are present (used for status pills). */
export function isPrinterComplete(p: Printer): boolean {
	return Object.keys(validatePrinter(p)).length === 0;
}

// ── Connection test ─────────────────────────────────────────────────────────

export type TestResult = { ok: boolean; message: string };

/**
 * Send raw ESC/POS bytes to a configured `network`, `webhook`, or `websocket` printer.
 */
export async function sendEscPosToPrinter(p: Printer, bytes: Uint8Array): Promise<TestResult> {
	const dataBase64 = bytesToBase64(bytes);

	switch (p.connectionType) {
		case 'native': {
			const res = await printEscPosNative(p, bytes);
			return { ok: res.ok, message: res.message };
		}
		case 'network': {
			const port = Number(p.port) || 9100;
			const ip = p.ip.trim();
			// Mobile browsers cannot open raw TCP sockets — hand off to the
			// native app through a bnos-print:// deeplink instead.
			if (isMobilePrintPlatform()) {
				const res = await printEscPosNative(p, bytes);
				return { ok: res.ok, message: res.message };
			}
			if (!p.useApiProxy) {
				const target = `http://${ip}:${port}`;
				try {
					await fetch(target, {
						method: 'POST',
						mode: 'no-cors',
						body: new Blob([bytes.slice()]),
						signal: AbortSignal.timeout(15000)
					});
					return {
						ok: true,
						message: `Sent ${bytes.length} bytes directly to ${ip}:${port}`
					};
				} catch (e) {
					return {
						ok: false,
						message:
							e instanceof Error && e.name === 'TimeoutError'
								? `Timed out connecting to ${ip}:${port}`
								: `Could not reach ${target} directly from browser`
					};
				}
			}
			try {
				const res = await fetch('/api/print', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						ip,
						port,
						dataBase64
					}),
					signal: AbortSignal.timeout(15000)
				});
				const json = (await res.json().catch(() => null)) as {
					ok?: boolean;
					error?: string;
					bytes?: number;
				} | null;
				if (!res.ok || !json?.ok) {
					return {
						ok: false,
						message: json?.error ?? `Print server responded ${res.status}`
					};
				}
				return {
					ok: true,
					message: `Sent ${json.bytes ?? bytes.length} bytes to ${p.ip}:${p.port || '9100'}`
				};
			} catch (e) {
				return {
					ok: false,
					message:
						e instanceof Error && e.name === 'TimeoutError'
							? 'Timed out reaching /api/print'
							: 'Could not reach /api/print'
				};
			}
		}
		case 'webhook': {
			try {
				const isRaw = p.payloadFormat === 'raw';
				const res = await fetch(p.url, {
					method: 'POST',
					headers: {
						'Content-Type': isRaw ? 'application/octet-stream' : 'application/json',
						...(p.authToken ? { Authorization: p.authToken } : {})
					},
					body: isRaw
						? new Blob([bytes.slice()])
						: JSON.stringify({
								type: 'print',
								printer: p.id,
								format: 'escpos-base64',
								dataBase64,
								ts: Date.now()
							}),
					signal: AbortSignal.timeout(15000)
				});
				if (!res.ok) return { ok: false, message: `Endpoint responded ${res.status}` };
				return { ok: true, message: 'Print job sent to webhook' };
			} catch (e) {
				return {
					ok: false,
					message:
						e instanceof Error && e.name === 'TimeoutError'
							? 'Timed out reaching the endpoint'
							: 'Could not reach the endpoint (CORS or network)'
				};
			}
		}
		case 'websocket': {
			return await new Promise<TestResult>((resolve) => {
				let settled = false;
				let ws: WebSocket;
				const done = (r: TestResult) => {
					if (settled) return;
					settled = true;
					try {
						ws.close();
					} catch {
						/* ignore */
					}
					resolve(r);
				};
				try {
					ws = new WebSocket(p.url);
				} catch {
					return resolve({ ok: false, message: 'Invalid WebSocket URL' });
				}
				const timer = setTimeout(() => done({ ok: false, message: 'Timed out connecting' }), 8000);
				ws.onopen = () => {
					clearTimeout(timer);
					try {
						if (p.payloadFormat === 'raw') {
							ws.send(bytes.slice());
						} else {
							ws.send(
								JSON.stringify({
									type: 'print',
									printer: p.id,
									format: 'escpos-base64',
									dataBase64
								})
							);
						}
						done({ ok: true, message: 'Print job sent via WebSocket' });
					} catch {
						done({ ok: false, message: 'Failed to send print data over WebSocket' });
					}
				};
				ws.onerror = () => {
					clearTimeout(timer);
					done({ ok: false, message: 'Socket connection failed' });
				};
			});
		}
		case 'usb':
		case 'bluetooth': {
			if (isMobilePrintPlatform()) {
				const res = await printEscPosNative(p, bytes);
				return { ok: res.ok, message: res.message };
			}
			return {
				ok: false,
				message:
					'Browsers cannot open raw device sockets — use the OS print dialog or the BNOS Print Service.'
			};
		}
		default:
			return { ok: false, message: `Direct ESC/POS not supported for ${p.connectionType}` };
	}
}

/**
 * Attempt a real connection test where the browser allows it:
 *  - `browser`   → opens the system print dialog
 *  - `network`   → sends an ESC/POS test receipt via `/api/print`
 *  - `webhook`   → POSTs a small JSON probe to the endpoint
 *  - `websocket` → opens a short-lived socket and pings a probe
 *  - `usb` / `bluetooth` → browsers can't open raw sockets, so we
 *    validate the config and report that a driver/agent bridge is required.
 */
export async function testPrinter(p: Printer): Promise<TestResult> {
	const errs = validatePrinter(p);
	if (errs.ip || errs.port || errs.url || errs.macAddress) {
		return {
			ok: false,
			message: errs.ip ?? errs.port ?? errs.url ?? errs.macAddress ?? 'Invalid setup'
		};
	}

	switch (p.connectionType) {
		case 'native': {
			const res = await printTestNative(p);
			return { ok: res.ok, message: res.message };
		}
		case 'browser': {
			window.print();
			return { ok: true, message: 'System print dialog opened' };
		}
		case 'webhook': {
			try {
				const res = await fetch(p.url, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						...(p.authToken ? { Authorization: p.authToken } : {})
					},
					body: JSON.stringify({ type: 'test', printer: p.id, charset: 'raw', ts: Date.now() }),
					signal: AbortSignal.timeout(15000)
				});
				if (!res.ok) return { ok: false, message: `Endpoint responded ${res.status}` };
				return { ok: true, message: 'Endpoint accepted the test job' };
			} catch (e) {
				return {
					ok: false,
					message:
						e instanceof Error && e.name === 'TimeoutError'
							? 'Timed out reaching the endpoint'
							: 'Could not reach the endpoint (CORS or network)'
				};
			}
		}
		case 'websocket': {
			return await new Promise<TestResult>((resolve) => {
				let settled = false;
				const done = (r: TestResult) => {
					if (settled) return;
					settled = true;
					try {
						ws.close();
					} catch {
						/* ignore */
					}
					resolve(r);
				};
				let ws: WebSocket;
				try {
					ws = new WebSocket(p.url);
				} catch {
					return resolve({ ok: false, message: 'Invalid WebSocket URL' });
				}
				const timer = setTimeout(() => done({ ok: false, message: 'Timed out connecting' }), 8000);
				ws.onopen = () => {
					clearTimeout(timer);
					try {
						ws.send(JSON.stringify({ type: 'test', printer: p.id }));
					} catch {
						/* ignore */
					}
					done({ ok: true, message: 'Socket connected & probe sent' });
				};
				ws.onerror = () => {
					clearTimeout(timer);
					done({ ok: false, message: 'Socket connection failed' });
				};
			});
		}
		case 'network':
			return await sendEscPosToPrinter(p, buildTestReceiptBytes(p));
		case 'usb':
		case 'bluetooth':
			if (isMobilePrintPlatform()) {
				const res = await printEscPosNative(p, buildTestReceiptBytes(p));
				return { ok: res.ok, message: res.message };
			}
			return {
				ok: false,
				message:
					'Browsers cannot open raw device sockets — config is valid; test via the print agent / driver.'
			};
		default:
			return { ok: false, message: 'Unsupported connection type' };
	}
}
