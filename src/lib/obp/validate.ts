/**
 * OBP v0.1 envelope schema validation.
 *
 * Hand-rolled validation on purpose: the contract must stay dependency-free
 * and run in every runtime (node tests, browser adapter, future CLI). Every
 * check returns a stable `OBP-E01` rejection with a precise message so
 * conformance fixtures can assert exact failure reasons.
 */
import {
	CURRENCY_MINOR_UNITS,
	OBP_ACTIONS,
	OBP_DOCUMENT_TYPES,
	OBP_PROTOCOL,
	OBP_VERSION,
	type ObpEnvelope,
	type ObpError
} from './types';

const ISO_RE =
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const HEX64_RE = /^[0-9a-f]{64}$/;
const HEX128_RE = /^[0-9a-f]{128}$/;

/**
 * Validate an inbound envelope's shape and internal consistency. With
 * `partial: true`, skip `payloadHash`/`signature` (unsigned drafts).
 */
export function validateEnvelope(env: unknown, opts: { partial?: boolean } = {}): ObpError | null {
	if (typeof env !== 'object' || env === null) return err('envelope must be an object');
	const e = env as Record<string, unknown>;

	if (e.protocol !== OBP_PROTOCOL) return err(`protocol must be "${OBP_PROTOCOL}"`);
	if (e.version !== OBP_VERSION) return err(`version must be "${OBP_VERSION}"`);
	for (const f of ['messageId', 'documentId', 'issuer', 'signerKeyId', 'recipient'])
		if (!nonEmptyString(e[f])) return err(`${f} must be a non-empty string`);
	if (typeof e.signerPubkey !== 'string' || !/^[0-9a-f]{64}$/.test(e.signerPubkey)) {
		return err('signerPubkey must be 64-char lowercase hex');
	}

	if (!OBP_DOCUMENT_TYPES.includes(e.documentType as never)) {
		return err(`documentType must be one of ${OBP_DOCUMENT_TYPES.join(', ')}`);
	}
	if (!OBP_ACTIONS.includes(e.action as never)) {
		return err(`action must be one of ${OBP_ACTIONS.join(', ')}`);
	}

	if (!ISO_RE.test(String(e.createdAt))) return err('createdAt must be ISO-8601');
	if (!ISO_RE.test(String(e.expiresAt))) return err('expiresAt must be ISO-8601');
	if (Date.parse(String(e.expiresAt)) <= Date.parse(String(e.createdAt))) {
		return err('expiresAt must be after createdAt');
	}

	if (!nonEmptyString(e.currency)) return err('currency must be a non-empty string');
	const currency = String(e.currency).toUpperCase();
	if (!(currency in CURRENCY_MINOR_UNITS)) {
		return err(`currency ${String(e.currency)} has no registered minor-unit precision`);
	}

	if (!Array.isArray(e.lines)) return err('lines must be an array');
	// Goods documents need lines; monetary-only documents (payment evidence,
	// receipt) carry their amount in totalsMinor and reference the invoice.
	const GOODS_TYPES = ['rfq', 'quote', 'purchase_order', 'invoice'];
	if (e.action === 'issue' && GOODS_TYPES.includes(String(e.documentType)) && e.lines.length === 0) {
		return err('lines must be a non-empty array for issue actions');
	}
	let total = 0;
	for (const [i, line] of (e.lines as Record<string, unknown>[]).entries()) {
		if (!nonEmptyString(line.description)) return err(`lines[${i}].description required`);
		if (!safeInt(line.quantity) || (line.quantity as number) <= 0) {
			return err(`lines[${i}].quantity must be a positive safe integer`);
		}
		if (!nonEmptyString(line.unit)) return err(`lines[${i}].unit required`);
		if (!safeInt(line.unitPriceMinor) || (line.unitPriceMinor as number) < 0) {
			return err(`lines[${i}].unitPriceMinor must be a non-negative safe integer`);
		}
		total += (line.quantity as number) * (line.unitPriceMinor as number);
	}
	if (!safeInt(e.totalsMinor)) return err('totalsMinor must be a safe integer');
	// With line items, the total must equal the line math; without lines
	// (payment evidence, receipts) the total stands alone but must be sane.
	if (e.lines.length > 0 && e.totalsMinor !== total) {
		return err(`totalsMinor ${String(e.totalsMinor)} != Σ quantity×unitPriceMinor (${total})`);
	}
	if (e.lines.length === 0 && (e.totalsMinor as number) < 0) {
		return err('totalsMinor must be non-negative');
	}
	for (const f of ['taxMinor', 'shippingMinor']) {
		if (e[f] !== undefined && !safeInt(e[f])) return err(`${f} must be a safe integer`);
	}

	if (!Array.isArray(e.references)) return err('references must be an array');
	for (const [i, ref] of (e.references as Record<string, unknown>[]).entries()) {
		if (!nonEmptyString(ref.documentId)) return err(`references[${i}].documentId required`);
		if (!OBP_DOCUMENT_TYPES.includes(ref.documentType as never)) {
			return err(`references[${i}].documentType invalid`);
		}
		if (ref.hash !== undefined && !HEX64_RE.test(String(ref.hash))) {
			return err(`references[${i}].hash must be 64-char lowercase hex`);
		}
	}

	if (e.settlement !== undefined) {
		const s = e.settlement as Record<string, unknown>;
		if (!nonEmptyString(s.method) || !nonEmptyString(s.externalId)) {
			return err('settlement requires method and externalId');
		}
	}

	if (e.deliveryTerms !== undefined) {
		const d = e.deliveryTerms as Record<string, unknown>;
		if (!nonEmptyString(d.method) || !nonEmptyString(d.place)) {
			return err('deliveryTerms requires method and place');
		}
		if (!safeInt(d.leadTimeDays) || (d.leadTimeDays as number) < 0) {
			return err('deliveryTerms.leadTimeDays must be a non-negative integer');
		}
	}

	if (!opts.partial) {
		if (!HEX64_RE.test(String(e.payloadHash ?? ''))) {
			return err('payloadHash must be 64-char lowercase hex');
		}
		if (!HEX128_RE.test(String(e.signature ?? ''))) {
			return err('signature must be 128-char lowercase hex');
		}
	}

	return null;
}

function nonEmptyString(v: unknown): boolean {
	return typeof v === 'string' && v.length > 0;
}
function safeInt(v: unknown): boolean {
	return typeof v === 'number' && Number.isSafeInteger(v);
}
function err(message: string): ObpError {
	return { code: 'OBP-E01', message };
}

/** True when `at` (ISO) is strictly before the envelope expiry. */
export function isExpired(env: ObpEnvelope, at: Date = new Date()): boolean {
	return Date.parse(env.expiresAt) <= at.getTime();
}
