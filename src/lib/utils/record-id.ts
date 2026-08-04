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

/**
 * Opaque, unguessable, collision-free organization id — a 122-bit UUID behind a
 * short `org_` prefix. Used as the GLO `organizationId` / scope-token.
 *
 * IMPORTANT: the org id is published in event tags (`organization`,
 * `glo:organization:<id>`) for relay discovery, so it MUST be an unguessable
 * capability token — never derived from the owner's pubkey (which is public and
 * would let anyone harvest the org's events) and never a short human string
 * (collision + guessing). A random UUID satisfies both uniqueness and
 * unguessability. The human-readable `organizationCode` is separate (display).
 */
export function newOrganizationId(): string {
	if (browser && crypto.randomUUID) return `org_${crypto.randomUUID()}`;
	return `org_${Date.now().toString(36)}${randomToken(16)}`;
}

/** Opaque location/branch id (same rationale as `newOrganizationId`). */
export function newLocationId(): string {
	if (browser && crypto.randomUUID) return `loc_${crypto.randomUUID()}`;
	return `loc_${Date.now().toString(36)}${randomToken(16)}`;
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
