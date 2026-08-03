/**
 * PIN hashing for POS login. Stores only a SHA-256 hash of the PIN; the raw
 * PIN is never persisted. Ported from bdgo-os-nuxt `app/utils/pin.ts`.
 */

const PIN_SALT = 'bdgoos-pos-pin-v1';

/** Hash a PIN with a static salt using SHA-256 (Web Crypto). Returns hex. */
export async function hashPin(pin: string): Promise<string> {
	const data = new TextEncoder().encode(pin + PIN_SALT);
	const hashBuffer = await crypto.subtle.digest('SHA-256', data);
	return Array.from(new Uint8Array(hashBuffer))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

/** Verify a plaintext PIN against a stored hash. */
export async function verifyPin(pin: string, hash: string): Promise<boolean> {
	if (!hash) return false;
	return (await hashPin(pin)) === hash;
}
