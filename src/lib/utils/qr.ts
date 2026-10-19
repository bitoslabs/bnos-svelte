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

type QrCodeLike = { getModules(): boolean[][] };
type QrCodeStatic = {
	encodeText(text: string, ecl: unknown): QrCodeLike;
	Ecc: Record<'LOW' | 'MEDIUM' | 'QUARTILE' | 'HIGH', unknown>;
};
const QrCode = (qrcodegen as { QrCode: QrCodeStatic }).QrCode;

const ECC_BY_LEVEL: Record<EccLevel, unknown> = {
	low: QrCode.Ecc.LOW,
	medium: QrCode.Ecc.MEDIUM,
	quartile: QrCode.Ecc.QUARTILE,
	high: QrCode.Ecc.HIGH
};

/**
 * Encode `text` into a QR module matrix. Returns an array of rows, each row a
 * `Uint8Array` where `1` is a dark module. Throws only if the payload is too
 * large for version 1–40 (extremely unlikely for payment strings).
 */
export function encodeText(text: string, ecl: EccLevel = 'medium'): Uint8Array[] {
	const qr = QrCode.encodeText(text, ECC_BY_LEVEL[ecl]);
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
