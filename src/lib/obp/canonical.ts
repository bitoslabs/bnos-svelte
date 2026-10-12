/**
 * OBP canonical serialization and payload hashing.
 *
 * Canonical JSON rules (RFC 8785-style, restricted to the value shapes the
 * v0.1 envelope can contain — strings, booleans, safe integers, arrays and
 * flat objects; no floats, no null):
 *
 * 1. Object keys are sorted by UTF-16 code unit order.
 * 2. No insignificant whitespace between tokens.
 * 3. Strings use minimal JSON escaping (`"`, `\`, short forms for the
 *    standard control characters, `\u00XX` for the rest of U+0000–U+001F)
 *    with literal UTF-8 for everything else.
 * 4. Numbers must be safe integers (±2^53−1) and serialize as `String(n)`.
 *
 * The payload hash is SHA-256 over the UTF-8 canonical bytes of the
 * envelope **without** `payloadHash` and `signature`. The signature covers
 * exactly those same bytes.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import type { ObpEnvelope, ObpUnsignedEnvelope } from './types';

export class CanonicalizationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'CanonicalizationError';
	}
}

/** Escape a string per minimal JSON rules (RFC 8785 short forms). */
function escapeString(s: string): string {
	let out = '"';
	for (const ch of s) {
		const code = ch.codePointAt(0)!;
		if (ch === '"') out += '\\"';
		else if (ch === '\\') out += '\\\\';
		else if (ch === '\b') out += '\\b';
		else if (ch === '\t') out += '\\t';
		else if (ch === '\n') out += '\\n';
		else if (ch === '\f') out += '\\f';
		else if (ch === '\r') out += '\\r';
		else if (code <= 0x1f) out += '\\u' + code.toString(16).padStart(4, '0');
		else out += ch;
	}
	return out + '"';
}

/** Deterministic JSON serialization of a contract value. */
export function canonicalJson(value: unknown): string {
	if (value === null || value === undefined) {
		throw new CanonicalizationError('null/undefined are not canonicalizable');
	}
	switch (typeof value) {
		case 'string':
			return escapeString(value);
		case 'boolean':
			return value ? 'true' : 'false';
		case 'number':
			if (!Number.isSafeInteger(value)) {
				throw new CanonicalizationError(`non-safe-integer number: ${value}`);
			}
			return String(value);
		case 'object': {
			if (Array.isArray(value)) {
				return '[' + value.map((v) => canonicalJson(v)).join(',') + ']';
			}
			const keys = Object.keys(value).sort();
			return (
				'{' +
				keys
					.filter((k) => (value as Record<string, unknown>)[k] !== undefined)
					.map((k) => escapeString(k) + ':' + canonicalJson((value as Record<string, unknown>)[k]))
					.join(',') +
				'}'
			);
		}
		default:
			throw new CanonicalizationError(`unsupported type: ${typeof value}`);
	}
}

/** UTF-8 canonical bytes of the unsigned envelope. */
export function canonicalEnvelopeBytes(env: ObpUnsignedEnvelope | ObpEnvelope): Uint8Array {
	const unsigned: Record<string, unknown> = { ...(env as Record<string, unknown>) };
	delete unsigned.payloadHash;
	delete unsigned.signature;
	return new TextEncoder().encode(canonicalJson(unsigned));
}

/** SHA-256 hex over the canonical envelope bytes. */
export function envelopePayloadHash(env: ObpUnsignedEnvelope | ObpEnvelope): string {
	const bytes = canonicalEnvelopeBytes(env);
	return toHex(sha256(bytes));
}

/** Hex helper (lowercase). */
export function toHex(bytes: Uint8Array): string {
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Parse a lowercase/uppercase hex string into bytes; throws when invalid. */
export function fromHex(hex: string): Uint8Array {
	if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) {
		throw new CanonicalizationError('invalid hex string');
	}
	const out = new Uint8Array(hex.length / 2);
	for (let i = 0; i < out.length; i++) {
		out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	}
	return out;
}

/**
 * Verify that `envelope.payloadHash` matches the recomputed canonical hash.
 * This binds the signature to the exact field values on the wire.
 */
export function verifyPayloadHash(envelope: ObpEnvelope): boolean {
	return envelopePayloadHash(envelope) === envelope.payloadHash;
}
