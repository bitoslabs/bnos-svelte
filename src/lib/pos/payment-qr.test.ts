import { describe, expect, it } from 'vitest';
import { defaultPayConfig } from './pay-config';
import { buildQrPayment } from './payment-qr';

describe('static bank QR payment', () => {
	it('uses the uploaded image instead of generating a bank payload', () => {
		const imageUrl = 'https://media.example.test/bank-qr.png';
		const result = buildQrPayment({
			method: 'qr',
			amount: 125_000,
			currency: 'THB',
			config: {
				...defaultPayConfig,
				qrScheme: 'bank',
				useStaticBankQr: true,
				staticBankQrImageUrl: imageUrl
			}
		});

		expect(result).toMatchObject({
			configured: true,
			kind: 'bank',
			imageUrl,
			payload: ''
		});
	});

	it('requires an image when static bank QR is enabled', () => {
		const result = buildQrPayment({
			method: 'qr',
			amount: 100,
			currency: 'THB',
			config: { ...defaultPayConfig, qrScheme: 'bank', useStaticBankQr: true }
		});

		expect(result.configured).toBe(false);
		expect(result.hint).toContain('Upload a static bank QR image');
	});
});
