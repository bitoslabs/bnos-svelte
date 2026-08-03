import { browser } from '$app/environment';

const DEVICE_KEY = 'bnos-os:device:id';
const HARDWARE_SETTINGS_KEY = 'bnos-os:settings-hardware';
const NUMBER_SEQUENCE_KEY_PREFIX = 'bnos-os:number-seq:';
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function randomToken(length: number) {
	const bytes = new Uint8Array(length);
	if (browser && crypto.getRandomValues) crypto.getRandomValues(bytes);
	else {
		for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
	}
	return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}

function compactDate(date: Date) {
	const yy = String(date.getFullYear()).slice(-2);
	const mm = String(date.getMonth() + 1).padStart(2, '0');
	const dd = String(date.getDate()).padStart(2, '0');
	return `${yy}${mm}${dd}`;
}

function compactScope(scope?: string | null) {
	const cleaned = (scope ?? '')
		.replace(/^(loc|org)-/i, '')
		.replace(/[^a-z0-9]/gi, '')
		.toUpperCase();
	return (cleaned || 'MAIN').slice(0, 4).padEnd(4, 'X');
}

function normalizeDeviceCode(value?: string | null) {
	const cleaned = (value ?? '').replace(/[^a-z0-9]/gi, '').toUpperCase();
	return cleaned.slice(0, 4);
}

function configuredDeviceCode() {
	if (!browser) return '';
	try {
		const raw = localStorage.getItem(HARDWARE_SETTINGS_KEY);
		if (!raw) return '';
		const parsed = JSON.parse(raw) as { deviceCode?: string };
		return normalizeDeviceCode(parsed.deviceCode);
	} catch {
		return '';
	}
}

export function getDeviceCode() {
	const manualCode = configuredDeviceCode();
	if (manualCode) return manualCode;
	if (!browser) return randomToken(4);
	const existing = localStorage.getItem(DEVICE_KEY);
	if (existing) return existing;
	const next = randomToken(4);
	localStorage.setItem(DEVICE_KEY, next);
	return next;
}

export function newRecordId(prefix = 'id') {
	if (browser && crypto.randomUUID) return crypto.randomUUID();
	return `${prefix}-${Date.now()}-${randomToken(8)}`;
}

export function nowIso() {
	return new Date().toISOString();
}

export function nextReadableNumber(options: {
	prefix: string;
	scope?: string | null;
	at?: Date;
	sequenceWidth?: number;
}) {
	const at = options.at ?? new Date();
	const day = compactDate(at);
	const scope = compactScope(options.scope);
	const device = getDeviceCode();
	const key = `${NUMBER_SEQUENCE_KEY_PREFIX}${options.prefix}:${day}:${scope}:${device}`;
	let sequence = 1;
	if (browser) {
		sequence = Number(localStorage.getItem(key) ?? '0') + 1;
		localStorage.setItem(key, String(sequence));
	}
	return `${options.prefix}-${day}-${scope}-${device}-${String(sequence).padStart(options.sequenceWidth ?? 4, '0')}`;
}
