/**
 * NIP-17 gift-wrap construction tests.
 *
 * Unwraps the event the way a recipient client would — gift wrap → seal →
 * rumor — to prove the full NIP-17/NIP-59 chain is correct: NIP-44 layers,
 * sender-signed seal, throwaway wrap key, and the plaintext chat message.
 */
import { describe, expect, it } from 'vitest';
import {
	generateSecretKey,
	getPublicKey,
	nip19,
	nip44,
	type Event as NostrToolsEvent
} from 'nostr-tools';
import { buildGiftWrap } from './nip17';

function keypair() {
	const sk = generateSecretKey();
	const pk = getPublicKey(sk);
	return { sk, hex: pk, npub: nip19.npubEncode(pk), nsec: nip19.nsecEncode(sk) };
}

const KIND_SEAL = 13;
const KIND_GIFT_WRAP = 1059;
const KIND_CHAT_MESSAGE = 14;

describe('NIP-17 gift wrap', () => {
	it('builds a kind-1059 wrap addressed to the recipient from a throwaway key', async () => {
		const sender = keypair();
		const receiver = keypair();
		const wrap = await buildGiftWrap({
			senderPubkey: sender.hex,
			recipientPubkey: receiver.hex,
			content: 'hello there',
			tags: [['t', 'bnos-feedback']],
			loginMethod: 'nsec',
			nsec: sender.nsec
		});

		expect(wrap.kind).toBe(KIND_GIFT_WRAP);
		expect(wrap.tags).toContainEqual(['p', receiver.hex]);
		// The wrap pubkey must not be the sender's.
		expect(wrap.pubkey).not.toBe(sender.hex);
	});

	it('unwraps to the original chat message', async () => {
		const sender = keypair();
		const receiver = keypair();
		const message = 'Bug: nothing happens\n\n— BNOS v1.0.0 · Bug report';
		const wrap = await buildGiftWrap({
			senderPubkey: sender.hex,
			recipientPubkey: receiver.hex,
			content: message,
			tags: [
				['t', 'bnos-feedback'],
				['t', 'bug']
			],
			loginMethod: 'nsec',
			nsec: sender.nsec
		});

		// gift wrap → seal
		const sealKey = nip44.getConversationKey(receiver.sk, wrap.pubkey);
		const seal = JSON.parse(nip44.v2.decrypt(wrap.content, sealKey)) as NostrToolsEvent;
		expect(seal.kind).toBe(KIND_SEAL);
		expect(seal.pubkey).toBe(sender.hex);
		expect(seal.tags).toEqual([]);

		// seal → rumor
		const sealConvKey = nip44.getConversationKey(receiver.sk, seal.pubkey);
		const rumor = JSON.parse(nip44.v2.decrypt(seal.content, sealConvKey)) as NostrToolsEvent & {
			id: string;
		};
		expect(rumor.kind).toBe(KIND_CHAT_MESSAGE);
		expect(rumor.pubkey).toBe(sender.hex);
		expect(rumor.content).toBe(message);
		expect(rumor.tags).toContainEqual(['p', receiver.hex]);
		expect(rumor.tags).toContainEqual(['t', 'bnos-feedback']);
		expect(rumor.tags).toContainEqual(['client', 'bnos']);
		expect(rumor.id).toMatch(/^[0-9a-f]{64}$/);
	});

	it('requires an nsec or extension (no plaintext fallback)', async () => {
		const sender = keypair();
		const receiver = keypair();
		await expect(
			buildGiftWrap({
				senderPubkey: sender.hex,
				recipientPubkey: receiver.hex,
				content: 'x',
				loginMethod: 'extension',
				nsec: null
			})
		).rejects.toThrow();
	});
});
