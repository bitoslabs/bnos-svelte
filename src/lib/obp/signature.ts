/**
 * OBP signing and verification over the canonical envelope bytes.
 *
 * Signatures are BIP-340 schnorr (secp256k1) — the same curve scheme Nostr
 * uses, but OBP signs its own canonical bytes, not a Nostr event. A Nostr
 * pubkey is a signing key here, not an organization identity by itself;
 * organizational authority comes from key grants in `identity.ts`.
 */
import { schnorr } from '@noble/curves/secp256k1.js';
import { canonicalEnvelopeBytes, envelopePayloadHash, fromHex, toHex } from './canonical';
import type { ObpEnvelope, ObpUnsignedEnvelope } from './types';

/** 32-byte secret key. */
export type ObpSecretKey = Uint8Array;

/** Generate a fresh signing key pair for tests, pilots and new grants. */
export function generateSigningKey(): { secretKey: ObpSecretKey; pubkey: string } {
	const secretKey = schnorr.utils.randomSecretKey();
	return { secretKey, pubkey: toHex(schnorr.getPublicKey(secretKey)) };
}

/** Compute payload hash, sign the canonical bytes and fill both fields. */
export function signEnvelope(env: ObpUnsignedEnvelope, secretKey: ObpSecretKey): ObpEnvelope {
	const payloadHash = envelopePayloadHash(env);
	const signature = toHex(schnorr.sign(canonicalEnvelopeBytes(env), secretKey));
	return { ...env, payloadHash, signature };
}

/**
 * Verify an envelope's signature against the canonical bytes implied by
 * its fields. Returns false for any malformed input; callers map that to
 * `OBP-E02` plus a hash check result.
 */
export function verifyEnvelopeSignature(
	envelope: ObpEnvelope,
	pubkey: string
): boolean {
	try {
		const bytes = canonicalEnvelopeBytes(envelope);
		const sig = fromHex(envelope.signature);
		const key = fromHex(pubkey);
		if (sig.length !== 64 || key.length !== 32) return false;
		return schnorr.verify(sig, bytes, key);
	} catch {
		return false;
	}
}
