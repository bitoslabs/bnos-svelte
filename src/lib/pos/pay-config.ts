import { browser } from '$app/environment';

/** Local pay-config for the QR/Lightning/Bank checkout flow.
 *  Stored separately from the per-method list so a single merchant config
 *  powers PromptPay / VietQR / Lightning / bank QR generation. */
export const PAY_CONFIG_KEY = 'bnos-os:settings-pay';

export interface PayConfig {
	/** Preferred QR scheme — drives which builder runs for the `qr` method. */
	qrScheme: 'promptpay' | 'vietqr' | 'bank';
	/** PromptPay: phone / national id / e-wallet id. */
	promptpayId: string;
	/** VietQR: 6-digit bank BIN. */
	vietqrBin: string;
	/** VietQR: account number. */
	vietqrAccount: string;
	/** Generic bank: account name. */
	bankAccountName: string;
	/** Generic bank: account number. */
	bankAccountNumber: string;
	/** Generic bank: bank name. */
	bankName: string;
	/** Show QR on the customer-facing display automatically at checkout. */
	showOnCustomerDisplay: boolean;
	/** Auto-confirm the sale when the cashier taps "Mark paid" (vs hold for verify). */
	confirmOnPaid: boolean;
}

export const defaultPayConfig: PayConfig = {
	qrScheme: 'promptpay',
	promptpayId: '',
	vietqrBin: '',
	vietqrAccount: '',
	bankAccountName: '',
	bankAccountNumber: '',
	bankName: '',
	showOnCustomerDisplay: true,
	confirmOnPaid: true
};

export function loadPayConfig(): PayConfig {
	if (!browser) return { ...defaultPayConfig };
	try {
		const raw = localStorage.getItem(PAY_CONFIG_KEY);
		return raw ? { ...defaultPayConfig, ...JSON.parse(raw) } : { ...defaultPayConfig };
	} catch {
		return { ...defaultPayConfig };
	}
}

export function savePayConfig(cfg: PayConfig) {
	if (!browser) return;
	localStorage.setItem(PAY_CONFIG_KEY, JSON.stringify(cfg));
}

export function hasQrConfigured(cfg: PayConfig): boolean {
	if (cfg.qrScheme === 'promptpay') return cfg.promptpayId.trim().length > 0;
	if (cfg.qrScheme === 'vietqr') return cfg.vietqrAccount.trim().length > 0 && cfg.vietqrBin.trim().length > 0;
	return cfg.bankAccountNumber.trim().length > 0;
}

export function hasLightningConfigured(_cfg: PayConfig): boolean {
	// Lightning address is owned by Settings → Bitcoin (single source of truth).
	// Imported lazily to avoid a circular import with payment-qr/lightning.
	if (typeof localStorage === 'undefined') return false;
	try {
		const btc = JSON.parse(localStorage.getItem('bnos-os:settings-bitcoin') ?? '{}');
		return typeof btc.lightningAddress === 'string' && btc.lightningAddress.trim().length > 0;
	} catch {
		return false;
	}
}
