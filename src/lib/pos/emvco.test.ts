import { describe, it, expect } from 'vitest';
import { buildPromptPay, buildVietQr, buildBankQr, crc16 } from './emvco';

describe('emvco builders', () => {
	it('PromptPay payload is structurally valid + CRC self-verifies', () => {
		const p = buildPromptPay({ id: '0812345678', amount: 100.5, currency: 'THB' });
		// Starts with payload format indicator 000201
		expect(p.startsWith('000201')).toBe(true);
		// Has PromptPay merchant tag (29 or 30)
		expect(p.includes('29') || p.includes('30')).toBe(true);
		// Contains the AID
		expect(p.includes('A000000677010111')).toBe(true);
		// Currency 764 (THB)
		expect(p.includes('5303764')).toBe(true);
		// Amount
		expect(p.includes('5406100.50')).toBe(true);
		// CRC self-verifies: recompute CRC over base (excl. last 4 hex chars)
		const base = p.slice(0, -4);
		const appended = p.slice(-4);
		expect(crc16(base)).toBe(appended);
	});

	it('PromptPay phone normalization (0812345678 → 0066812345678)', () => {
		const p = buildPromptPay({ id: '0812345678' });
		// 0115 (len 15) prefix 0066 + 812345678 = 0066812345678 (13 digits)
		expect(p.includes('0066812345678')).toBe(true);
	});

	it('VietQR builds with NAPAS AID + CRC', () => {
		const p = buildVietQr({ bin: '970436', account: '0011001234567', amount: 50000, currency: 'VND' });
		expect(p.startsWith('000201')).toBe(true);
		expect(p.includes('A000000727')).toBe(true);
		expect(p.includes('970436')).toBe(true);
		expect(p.includes('0011001234567')).toBe(true);
		expect(p.includes('5303704')).toBe(true); // VND = 704
		// CRC self-verifies
		const base = p.slice(0, -4);
		expect(crc16(base)).toBe(p.slice(-4));
	});

	it('static (no amount) PromptPay uses tag 29, dynamic (amount) uses tag 30', () => {
		const stat = buildPromptPay({ id: '0812345678' });
		const dyn = buildPromptPay({ id: '0812345678', amount: 50 });
		expect(stat.includes('2937')).toBe(true);
		expect(dyn.includes('3037')).toBe(true);
	});

	it('bank QR fallback is human-readable', () => {
		const p = buildBankQr({
			accountName: 'Bitdigo',
			accountNumber: '1234567890',
			bankName: 'KBank',
			amount: 200,
			currency: 'THB'
		});
		expect(p).toContain('Bitdigo');
		expect(p).toContain('1234567890');
		expect(p).toContain('KBank');
		expect(p).toContain('200.00');
	});
});
