/**
 * NIP-17 private direct messages — gift-wrapped kind 1059.
 *
 * The modern DM scheme (NIP-17 + NIP-59): a plaintext `kind:14` chat message
 * ("rumor", unsigned) is sealed into a sender-signed `kind:13` event (NIP-44
 * encrypted to the recipient), then wrapped in a random-key `kind:1059` event
 * (NIP-44 encrypted again). Only the gift wrap is published, so participant
 * identities, real timestamps and inner tags never appear on the wire — and
 * clients render it as a normal message instead of the deprecated kind-4
 * "legacy" DM.
 *
 * Timestamps are backdated by a random span (≤2 days) so grouping by
 * `created_at` cannot correlate sender and recipient.
 */
import { finalizeEvent, generateSecretKey, getEventHash, nip19, nip44 } from 'nostr-tools';
import {
	signNostrEvent,
	type BnosLoginMethod,
	type NostrEvent,
	type NostrExtensionSigner
} from '@bitos/bnos-core';
import { BNOS_CLIENT_ID } from '$nostr/client-id';

const KIND_CHAT_MESSAGE = 14; // rumor
const KIND_SEAL = 13;
const KIND_GIFT_WRAP = 1059;
const MAX_BACKDATE_SECONDS = 2 * 24 * 60 * 60;

/** Minimal NIP-44 extension surface (most NIP-07 wallets expose nip44). */
type Nip44Window = Window & {
	nostr?: {
		nip44?: {
			encrypt: (pubkey: string, plaintext: string) => Promise<string>;
		};
	};
};

function getNip44Ext() {
	if (typeof window === 'undefined') return null;
	return (window as Nip44Window).nostr?.nip44 ?? null;
}

/** NIP-44 encrypt to a recipient (extension first, then nsec). */
async function nip44EncryptTo(
	recipientPubkey: string,
	plaintext: string,
	senderNsec?: string | null
): Promise<string> {
	const ext = getNip44Ext();
	if (ext) return ext.encrypt(recipientPubkey, plaintext);
	if (!senderNsec) {
		throw new Error('NIP-17 requires an extension with NIP-44 or an nsec login');
	}
	const decoded = nip19.decode(senderNsec);
	if (decoded.type !== 'nsec') throw new Error('Invalid nsec');
	const conversationKey = nip44.getConversationKey(decoded.data as Uint8Array, recipientPubkey);
	return nip44.v2.encrypt(plaintext, conversationKey);
}

/** Random `created_at` up to two days before `nowSec` (NIP-17 metadata hygiene). */
function backdate(nowSec: number): number {
	return nowSec - Math.floor(Math.random() * MAX_BACKDATE_SECONDS);
}

export interface GiftWrapInput {
	senderPubkey: string;
	recipientPubkey: string;
	/** Plaintext chat message (kind-14 content). */
	content: string;
	/** Extra tags for the inner rumor (encrypted, so safe to add `t`/`client`). */
	tags?: string[][];
	loginMethod: BnosLoginMethod;
	nsec?: string | null;
	extensionSigner?: NostrExtensionSigner;
	now?: number;
}

/**
 * Build a signed kind-1059 gift wrap carrying a kind-14 chat message for one
 * recipient. Publish the result to the recipient's NIP-17 inbox relays.
 */
export async function buildGiftWrap(input: GiftWrapInput): Promise<NostrEvent> {
	const nowSec = input.now ?? Math.floor(Date.now() / 1000);

	// 1. Rumor — unsigned kind-14 chat message (never published as-is).
	const extraTags = input.tags ?? [];
	const rumor = {
		pubkey: input.senderPubkey,
		created_at: nowSec,
		kind: KIND_CHAT_MESSAGE,
		tags: [
			['p', input.recipientPubkey],
			...extraTags,
			...(extraTags.some((tag) => tag[0] === 'client') ? [] : [['client', BNOS_CLIENT_ID]])
		],
		content: input.content
	};
	const sealed = { ...rumor, id: getEventHash(rumor) };

	// 2. Seal — kind 13, signed by the sender, NIP-44 to the recipient.
	const sealTemplate = {
		kind: KIND_SEAL,
		created_at: backdate(nowSec),
		tags: [] as string[][],
		content: await nip44EncryptTo(input.recipientPubkey, JSON.stringify(sealed), input.nsec ?? null)
	};
	const seal = (await signNostrEvent({
		template: sealTemplate,
		fallbackPubkey: input.senderPubkey,
		loginMethod: input.loginMethod,
		nsec: input.nsec,
		extensionSigner: input.extensionSigner
	})) as NostrEvent;

	// 3. Gift wrap — kind 1059, signed by a throwaway key, NIP-44 to recipient.
	const wrapSecret = generateSecretKey();
	const conversationKey = nip44.getConversationKey(wrapSecret, input.recipientPubkey);
	const wrap = finalizeEvent(
		{
			kind: KIND_GIFT_WRAP,
			created_at: backdate(nowSec),
			tags: [['p', input.recipientPubkey]],
			content: nip44.v2.encrypt(JSON.stringify(seal), conversationKey)
		},
		wrapSecret
	);
	return wrap as unknown as NostrEvent;
}
