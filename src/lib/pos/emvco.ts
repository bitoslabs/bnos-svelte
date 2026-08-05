/**
 * EMVCo / QR-payment payload builders — offline, deterministic.
 *
 * Supports the formats a multi-currency BNOS POS actually needs:
 *   • PromptPay (Thailand, EMVCo Tag-30, currency 764, CRC-16/CCITT-FALSE)
 *   • VietQR (Vietnam, EMVCo Tag-38, NAPAS AID, currency 704)
 *   • Generic static bank / account QR (human-readable + simple URI)
 *
 * All builders are pure functions (no network) so a cashier can generate a
 * scannable QR instantly, even fully offline. The CRC follows EMVCo's spec:
 * CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF, no reflection, xorOut 0x0000).
 */

const COUNTRY_BY_CURRENCY: Record<string, string> = {
	THB: 'TH',
	VND: 'VN',
	LAK: 'LA',
	USD: 'US',
	KRW: 'KR',
	JPY: 'JP',
	SGD: 'SG',
	MYR: 'MY',
	IDR: 'ID',
	PHP: 'PH',
	CNY: 'CN'
};
const CURRENCY_BY_CODE: Record<string, string> = {
	TH: '764',
	VN: '704',
	LA: '418',
	US: '840',
	KR: '410',
	JP: '392',
	SG: '702',
	MY: '458',
	ID: '360',
	PH: '608',
	CN: '156'
};

/** Tag-length-value encoder. */
function tlv(tag: string, value: string): string {
	const len = value.length.toString().padStart(2, '0');
	return `${tag}${len}${value}`;
}

/** CRC-16/CCITT-FALSE (EMVCo standard). */
export function crc16(data: string): string {
	let crc = 0xffff;
	for (let i = 0; i < data.length; i++) {
		crc ^= data.charCodeAt(i) << 8;
		for (let j = 0; j < 8; j++) {
			crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
			crc &= 0xffff;
		}
	}
	return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** Strip all non-digit characters; pad phone numbers for PromptPay. */
function promptpayTargetId(input: string): { kind: 'phone' | 'national' | 'ewallet'; value: string } {
	const raw = input.replace(/\D/g, '');
	// Mobile phone (e.g. 0812345678 → 0066812345678 → 13 digits)
	if (raw.length >= 9 && raw.length <= 10 && raw.startsWith('0')) {
		return { kind: 'phone', value: '0066' + raw.slice(1) };
	}
	if (raw.length === 12 && raw.startsWith('66')) return { kind: 'phone', value: '00' + raw };
	// National ID / Citizen ID (13 digits)
	if (raw.length === 13) return { kind: 'national', value: raw };
	// E-Wallet (e.g. 10-digit account / biller)
	return { kind: 'ewallet', value: raw };
}

export interface PromptPayInput {
	/** Phone number, National ID, or e-Wallet ID. */
	id: string;
	amount?: number;
	currency?: string; // default THB
}

/** Build a PromptPay (Tag-30) QR payload, with optional dynamic amount. */
export function buildPromptPay({ id, amount, currency = 'THB' }: PromptPayInput): string {
	const target = promptpayTargetId(id);
	const aid = tlv('00', 'A000000677010111'); // PromptPay global AID
	const payloadId = tlv('01', target.value);
	const merchant = tlv('29', aid + payloadId);
	const hasAmount = typeof amount === 'number' && amount > 0 && Number.isFinite(amount);
	const merchantInfo = tlv('30', aid + payloadId); // tag 30 = dynamic (with amount)
	const pfi = tlv('00', '01'); // payload format indicator
	const pim = hasAmount ? tlv('01', '12') : tlv('01', '11'); // 12=dynamic, 11=static
	const mcc = tlv('52', '0000');
	const cur = tlv('53', CURRENCY_BY_CODE[COUNTRY_BY_CURRENCY[currency] ?? 'TH'] ?? '764');
	const amt = hasAmount ? tlv('54', amount!.toFixed(2)) : '';
	const ctry = tlv('58', 'TH');
	const name = tlv('59', 'BNOS'); // merchant name (max 25)
	const city = tlv('60', 'Bangkok');
	const zip = tlv('61', '00000');
	const crcPlaceholder = '6304';

	const base =
		pfi +
		pim +
		(hasAmount ? merchantInfo : merchant) +
		mcc +
		cur +
		amt +
		ctry +
		name +
		city +
		zip +
		crcPlaceholder;
	const crc = crc16(base);
	return base + crc;
}

export interface VietQrInput {
	/** Bank BIN code (6 digits) or short bank code. */
	bin: string;
	/** Account number. */
	account: string;
	amount?: number;
	currency?: string; // default VND
	message?: string;
}

const NAPAS_AID = tlv('00', 'A000000727'); // NAPAS consumer AID
const VIETQR_AID = tlv('00', 'A000000727'); // VietQR (NAPAS National QR)

/** Build a VietQR (Tag 38) payload (NAPAS national QR), with optional amount. */
export function buildVietQr({ bin, account, amount, currency = 'VND', message }: VietQrInput): string {
	const acq = tlv('00', 'A000000727');
	const acc = tlv('01', tlv('00', bin.padStart(6, '0')) + tlv('01', account));
	const merchant = tlv('38', acq + acc);
	const hasAmount = typeof amount === 'number' && amount > 0 && Number.isFinite(amount);
	const pfi = tlv('00', '01');
	const pim = hasAmount ? tlv('01', '12') : tlv('01', '11');
	const mcc = tlv('52', '6011');
	const cur = tlv('53', CURRENCY_BY_CODE[COUNTRY_BY_CURRENCY[currency] ?? 'VN'] ?? '704');
	const amt = hasAmount ? tlv('54', amount!.toFixed(2)) : '';
	const ctry = tlv('58', 'VN');
	const name = tlv('59', 'BNOS');
	const city = tlv('60', 'Hanoi');
	const zip = message ? tlv('62', tlv('08', message.slice(0, 25))) : '';
	const crcPlaceholder = '63' + '04';

	const base = pfi + pim + merchant + mcc + cur + amt + ctry + name + city + zip + crcPlaceholder;
	const crc = crc16(base);
	return base + crc;
}

export interface BankQrInput {
	accountName: string;
	accountNumber: string;
	bankName?: string;
	amount?: number;
	currency?: string;
	note?: string;
}

/** Fallback static bank-transfer QR — a clean, human-readable BEC/IMPS-style
 *  payload + a `bank://` URI. Works everywhere; not tied to one rails spec. */
export function buildBankQr(input: BankQrInput): string {
	const amt = typeof input.amount === 'number' && input.amount > 0 ? input.amount : null;
	const lines = [
		`PAY TO: ${input.accountName}`,
		input.bankName ? `BANK: ${input.bankName}` : '',
		`ACCOUNT: ${input.accountNumber}`,
		amt ? `AMOUNT: ${amt.toFixed(2)} ${input.currency ?? ''}`.trim() : '',
		input.note ? `NOTE: ${input.note}` : ''
	].filter(Boolean);
	return lines.join('\n');
}
