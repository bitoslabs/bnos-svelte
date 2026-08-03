/**
 * Nostr key helpers for the staff feature:
 *  - pubkey normalization (npub ⇄ hex) via nostr-tools `nip19`
 *  - keypair generation (when an owner creates keys for a staff member)
 *  - local "staff key" backup storage (so owners can recover keys they minted)
 *  - staff + keys plain-text export
 *
 * Ported from bdgo-os-nuxt `app/utils/nostr-keys.ts`.
 */
import { browser } from '$app/environment';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import type { Staff } from '$lib/domain';

export interface StaffKeyEntry {
	staffId: string;
	staffName: string;
	pubkey: string;
	npub: string;
	/** Only present when the owner generated (and backed up) the nsec. */
	nsec?: string;
	generatedAt: number;
}

const STORAGE_KEY = 'bnos-os:staff-keys';

/** True for a 64-char hex pubkey. */
export function isHexPubkey(value: string): boolean {
	return /^[0-9a-fA-F]{64}$/.test(value.trim());
}

/** Accept either an npub1… or a 64-char hex pubkey. */
export function isValidPubkeyInput(value: string): boolean {
	const v = value.trim();
	return v.startsWith('npub1') || isHexPubkey(v);
}

/** Normalize npub1…/hex → lowercase hex pubkey. Throws on bad input. */
export function normalizePubkey(value: string): string {
	const v = value.trim();
	if (v.startsWith('npub1')) {
		const decoded = nip19.decode(v);
		if (decoded.type !== 'npub') throw new Error('Expected an npub');
		// DecodedNpub.data is already a lowercase hex pubkey string.
		return (decoded.data as string).toLowerCase();
	}
	if (isHexPubkey(v)) return v.toLowerCase();
	throw new Error('Unrecognized pubkey format. Use npub1… or a 64-char hex pubkey.');
}

/** hex → npub1… (returns '' if conversion fails, e.g. during SSR). */
export function hexToNpub(hex: string): string {
	try {
		return nip19.npubEncode(hex);
	} catch {
		return '';
	}
}

export interface GeneratedKeyPair {
	privkey: string;
	pubkey: string;
	npub: string;
	nsec: string;
}

/** Generate a fresh keypair for a staff member. */
export function generateKeyPair(): GeneratedKeyPair {
	const skBytes = generateSecretKey();
	const skHex = Array.from(skBytes, (b) => b.toString(16).padStart(2, '0')).join('');
	const pkHex = getPublicKey(skBytes);
	return {
		privkey: skHex,
		pubkey: pkHex,
		npub: nip19.npubEncode(pkHex),
		nsec: nip19.nsecEncode(skBytes)
	};
}

// ── Staff key backup storage ────────────────────────────────────────

function loadKeys(): StaffKeyEntry[] {
	if (!browser) return [];
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		const parsed = raw ? (JSON.parse(raw) as StaffKeyEntry[]) : [];
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

function persistKeys(keys: StaffKeyEntry[]) {
	if (!browser) return;
	localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
}

/** Save (or replace) the backup entry for a staff member's key. */
export function saveStaffKey(entry: StaffKeyEntry) {
	const keys = loadKeys().filter((k) => k.staffId !== entry.staffId && k.pubkey !== entry.pubkey);
	keys.unshift(entry);
	persistKeys(keys);
}

/** Remove a staff key backup by staff id. */
export function removeStaffKey(staffId: string) {
	persistKeys(loadKeys().filter((k) => k.staffId !== staffId));
}

/** Find a backed-up key entry by the staff member's pubkey. */
export function findStaffKeyByPubkey(pubkey: string): StaffKeyEntry | undefined {
	return loadKeys().find((k) => k.pubkey === pubkey);
}

/** Does this pubkey have a backed-up key on this device? */
export function hasStoredKey(pubkey: string): boolean {
	return !!pubkey && !!findStaffKeyByPubkey(pubkey);
}

/**
 * Render a plain-text backup of staff + their keys. Used by the "Export Staff"
 * button (mirrors bdgo-os-nuxt `exportStaffKeysTxt`).
 */
export function exportStaffKeysTxt(staff: { data: Staff; id: string }[]): string {
	const keys = loadKeys();
	const lines: string[] = [
		'# BNOS Staff & Key Backup',
		`# Exported ${new Date().toISOString()}`,
		`# Records: ${staff.length}`,
		''
	];
	for (const { data: member, id } of staff) {
		lines.push(`## ${member.name}${member.displayName ? ` (${member.displayName})` : ''}`);
		lines.push(`  ID:        ${id}`);
		lines.push(`  Role:      ${member.role}`);
		lines.push(`  Status:    ${member.status}`);
		lines.push(`  npub:      ${member.npub ?? hexToNpub(member.pubkey ?? '')}`);
		const key = keys.find((k) => k.pubkey === member.pubkey);
		if (key?.nsec) lines.push(`  nsec:      ${key.nsec}   ← KEEP THIS SECRET`);
		lines.push('');
	}
	lines.push('# End of backup');
	return lines.join('\n');
}
