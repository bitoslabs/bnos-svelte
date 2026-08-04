/**
 * Organization key grants — NIP-44 distribution of the per-organization AES key.
 *
 * Ported from bdgo-os `company-key-grants.ts`, renamed to the GLO standard
 * `organization` term. The owner NIP-44-encrypts the org's raw AES key to each
 * staff pubkey and publishes a kind 30512 event addressed with `#p = <staff>`.
 * The staff device queries `{ kinds: [30512], #p: [me] }`, NIP-44-decrypts the
 * wrapped key, and stores it locally — after which encrypted org data decrypts
 * transparently.
 *
 * NIP-44 is used exactly where it belongs (1:1 key handoff); bulk org data is
 * encrypted with fast symmetric AES-GCM. See `docs/SECURITY.md` in
 * @bitos/bnos-core for the contract this implements.
 */
import { nip19, nip44 } from 'nostr-tools';
import { NOSTR_KINDS, signNostrEvent, type NostrEvent } from '@bitos/bnos-core';
import { fetchEvents, sendEvent } from '$nostr/client';
import { session } from '$nostr/session.svelte';
import {
	fromBase64Url,
	getOrCreateSensitiveDataKey,
	getSensitiveDataScopeId,
	storeSensitiveDataKey,
	toBase64Url
} from './sensitive-data';
import type { OrganizationKeyGrant, SensitiveDataDomain } from './privacy';

export const DEFAULT_GRANT_SCOPES: SensitiveDataDomain[] = [
	'order',
	'payment',
	'refund',
	'product',
	'customer',
	'staff',
	'shift',
	'cash_event',
	'settings',
	'membership',
	'membership_subscription',
	'membership_checkin'
];

/** Minimal NIP-44 extension surface (some wallets expose encrypt/decrypt). */
type Nip44Window = Window & {
	nostr?: {
		nip44?: {
			encrypt: (pubkey: string, plaintext: string) => Promise<string>;
			decrypt: (pubkey: string, ciphertext: string) => Promise<string>;
		};
	};
};

function getNip44Ext() {
	if (typeof window === 'undefined') return null;
	return (window as Nip44Window).nostr?.nip44 ?? null;
}

/** NIP-44 encrypt to a recipient pubkey (extension first, then nsec). */
export async function encryptToPubkey(
	recipientPubkey: string,
	plaintext: string,
	senderNsec?: string | null
): Promise<string> {
	const ext = getNip44Ext();
	if (ext) return ext.encrypt(recipientPubkey, plaintext);
	if (!senderNsec) {
		throw new Error('NIP-44 encryption requires an extension or nsec login');
	}
	const decoded = nip19.decode(senderNsec);
	if (decoded.type !== 'nsec') throw new Error('Invalid nsec');
	const conversationKey = nip44.getConversationKey(decoded.data as Uint8Array, recipientPubkey);
	return nip44.v2.encrypt(plaintext, conversationKey);
}

/** NIP-44 decrypt from a sender pubkey (extension first, then nsec). */
export async function decryptFromPubkey(
	senderPubkey: string,
	ciphertext: string,
	recipientNsec?: string | null
): Promise<string> {
	const ext = getNip44Ext();
	if (ext) return ext.decrypt(senderPubkey, ciphertext);
	if (!recipientNsec) {
		throw new Error('NIP-44 decryption requires an extension or nsec login');
	}
	const decoded = nip19.decode(recipientNsec);
	if (decoded.type !== 'nsec') throw new Error('Invalid nsec');
	const conversationKey = nip44.getConversationKey(decoded.data as Uint8Array, senderPubkey);
	return nip44.v2.decrypt(ciphertext, conversationKey);
}

export interface BuildKeyGrantInput {
	organizationId: string;
	recipientPubkey: string;
	scopes?: SensitiveDataDomain[];
}

/**
 * Build + sign a kind 30512 key-grant event for one staff member. Uses the
 * currently logged-in identity (owner/admin) as author. Creates the org AES
 * key locally if it does not yet exist.
 */
export async function buildOrganizationKeyGrantEvent(
	input: BuildKeyGrantInput
): Promise<NostrEvent> {
	if (!session.pubkey) throw new Error('Sign in to grant an organization key');
	const scopeId = getSensitiveDataScopeId(input.organizationId, session.pubkey);
	const { keyId, rawKey } = getOrCreateSensitiveDataKey(scopeId);
	const nowSec = Math.floor(Date.now() / 1000);

	const grant: OrganizationKeyGrant = {
		organizationId: input.organizationId,
		keyId,
		keyVersion: 1,
		wrappedKey: await encryptToPubkey(
			input.recipientPubkey,
			toBase64Url(rawKey),
			session.snapshot?.nsec ?? null
		),
		recipientPubkey: input.recipientPubkey,
		scopes: input.scopes ?? DEFAULT_GRANT_SCOPES,
		createdAt: nowSec
	};

	const template = {
		kind: NOSTR_KINDS.COMPANY_KEY_GRANT,
		created_at: nowSec,
		content: JSON.stringify(grant),
		tags: [
			['d', `${input.organizationId}:v1:${input.recipientPubkey}`],
			['t', 'bdgoos'],
			['t', 'organization_key_grant'],
			['organization', input.organizationId],
			['p', input.recipientPubkey],
			['key_id', keyId]
		]
	};

	return (await signNostrEvent({
		template,
		fallbackPubkey: session.snapshot!.pubkey,
		loginMethod: session.snapshot!.loginMethod,
		nsec: session.snapshot!.nsec,
		extensionSigner: session.extensionSigner ?? undefined
	})) as NostrEvent;
}

/**
 * Import a kind 30512 grant addressed to the current user: NIP-44-decrypt the
 * wrapped AES key and store it locally. Returns true on success.
 */
export async function importOrganizationKeyGrantEvent(event: NostrEvent): Promise<boolean> {
	if (event.kind !== NOSTR_KINDS.COMPANY_KEY_GRANT) return false;
	const me = session.pubkey;
	if (!me) return false;
	let grant: OrganizationKeyGrant;
	try {
		grant = JSON.parse(event.content) as OrganizationKeyGrant;
	} catch {
		return false;
	}
	if (grant.recipientPubkey !== me || grant.revokedAt) return false;
	const rawKey = fromBase64Url(
		await decryptFromPubkey(event.pubkey, grant.wrappedKey, session.snapshot?.nsec ?? null)
	);
	storeSensitiveDataKey(grant.keyId, rawKey);
	return true;
}

/** Publish a signed grant event to the configured relays. */
export async function publishOrganizationKeyGrant(event: NostrEvent): Promise<boolean> {
	return sendEvent(event);
}

/**
 * Pull every key-grant event addressed to the current user (`#p = me`) and
 * import each. Called during login / membership resolution so a staff device
 * obtains the organization AES key before it tries to read encrypted data.
 */
export async function syncKeyGrantsForCurrentUser(): Promise<{ imported: number; failed: number }> {
	const me = session.pubkey;
	if (!me) return { imported: 0, failed: 0 };
	let events: NostrEvent[];
	try {
		events = await fetchEvents({ kinds: [NOSTR_KINDS.COMPANY_KEY_GRANT], '#p': [me], limit: 500 });
	} catch {
		return { imported: 0, failed: 0 };
	}
	// Keep the newest grant per (organization, recipient) coordinate.
	const byD = new Map<string, NostrEvent>();
	for (const ev of events) {
		const d = ev.tags.find((t) => t[0] === 'd')?.[1];
		if (!d) continue;
		const prev = byD.get(d);
		if (!prev || ev.created_at > prev.created_at) byD.set(d, ev);
	}
	let imported = 0;
	let failed = 0;
	for (const ev of byD.values()) {
		try {
			if (await importOrganizationKeyGrantEvent(ev)) imported++;
			else failed++;
		} catch {
			failed++;
		}
	}
	return { imported, failed };
}
