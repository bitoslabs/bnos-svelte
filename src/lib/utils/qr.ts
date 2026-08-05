/**
 * QR Code public API — thin wrapper over the vendored Nayuki generator
 * (`$lib/vendor/qrcodegen`). Exports a single `encodeText` that returns a
 * square `Uint8Array[]` matrix (1 = dark module) ready to render as SVG/canvas.
 *
 * Used by every payment-QR surface (Lightning, PromptPay/EMVCo, bank transfer,
 * npub) so they all share one offline-capable encoder.
 */
import qrcodegen from '$lib/vendor/qrcodegen';

export type EccLevel = 'low' | 'medium' | 'quartile' | 'high';

const ECC_BY_LEVEL: Record<EccLevel, unknown> = {
	low: (qrcodegen.QrCode.Ecc as any).LOW,
	medium: (qrcodegen.QrCode.Ecc as any).MEDIUM,
	quartile: (qrcodegen.QrCode.Ecc as any).QUARTILE,
	high: (qrcodegen.QrCode.Ecc as any).HIGH
};

/**
 * Encode `text` into a QR module matrix. Returns an array of rows, each row a
 * `Uint8Array` where `1` is a dark module. Throws only if the payload is too
 * large for version 1–40 (extremely unlikely for payment strings).
 */
export function encodeText(text: string, ecl: EccLevel = 'medium'): Uint8Array[] {
	const qr = (qrcodegen.QrCode as any).encodeText(text, ECC_BY_LEVEL[ecl]);
	const bools: boolean[][] = qr.getModules();
	const n = bools.length;
	const out: Uint8Array[] = new Array(n);
	for (let y = 0; y < n; y++) {
		const row = new Uint8Array(n);
		const src = bools[y];
		for (let x = 0; x < n; x++) row[x] = src[x] ? 1 : 0;
		out[y] = row;
	}
	return out;
}
