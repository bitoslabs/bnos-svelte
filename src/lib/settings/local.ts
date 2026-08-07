import { browser } from '$app/environment';

export const RECEIPT_SETTINGS_KEY = 'bnos-os:receipt';
export const GENERAL_SETTINGS_KEY = 'bnos-os:settings-general';
export const HARDWARE_SETTINGS_KEY = 'bnos-os:settings-hardware';

export interface ReceiptSettings {
	storeName: string;
	header: string;
	footer: string;
	paperSize: '58mm' | '80mm';
	logoUrl: string;
	showLogo: boolean;
	taxId: string;
	showTaxId: boolean;
	showQr: boolean;
	qrData: string;
	showStoreName: boolean;
	showPhone: boolean;
	showAddress: boolean;
	showDate: boolean;
	showOrderNumber: boolean;
	showBarcode: boolean;
	showCashierName: boolean;
	phone: string;
	address: string;
}

export interface GeneralSettings {
	defaultPayment: string;
	playSound: boolean;
	paymentSound: boolean;
	autoPrint: boolean;
	confirmClear: boolean;
	compactMode: boolean;
	language: string;
	/** Auto-apply the best eligible promotion when the cart qualifies.
	 *  Respects cashier overrides (manual discounts + dismissals). */
	autoApplyPromotions: boolean;
}

export interface HardwareSettings {
	printerType: 'browser' | 'usb' | 'network' | 'none';
	paperSize: '58mm' | '80mm';
	deviceCode: string;
	cashDrawer: boolean;
	barcodeScanner: boolean;
	customerDisplay: boolean;
	scaleConnected: boolean;
}

export const defaultReceiptSettings: ReceiptSettings = {
	storeName: '',
	header: '',
	footer: 'Thank you for your purchase!',
	paperSize: '80mm',
	logoUrl: '',
	showLogo: false,
	taxId: '',
	showTaxId: false,
	showQr: false,
	qrData: '',
	showStoreName: true,
	showPhone: false,
	showAddress: false,
	showDate: true,
	showOrderNumber: true,
	showBarcode: false,
	showCashierName: false,
	phone: '',
	address: ''
};

export const defaultGeneralSettings: GeneralSettings = {
	defaultPayment: 'cash',
	playSound: true,
	paymentSound: true,
	autoPrint: false,
	confirmClear: true,
	compactMode: false,
	language: 'en',
	autoApplyPromotions: true
};

export const defaultHardwareSettings: HardwareSettings = {
	printerType: 'browser',
	paperSize: '80mm',
	deviceCode: '',
	cashDrawer: false,
	barcodeScanner: false,
	customerDisplay: false,
	scaleConnected: false
};

function readJson<T extends object>(key: string, defaults: T): T {
	if (!browser) return { ...defaults };
	try {
		const raw = localStorage.getItem(key);
		return raw ? { ...defaults, ...JSON.parse(raw) } : { ...defaults };
	} catch {
		return { ...defaults };
	}
}

function writeJson<T extends object>(key: string, value: T) {
	if (!browser) return;
	localStorage.setItem(key, JSON.stringify(value));
}

export function loadReceiptSettings(fallbackStoreName = ''): ReceiptSettings {
	const settings = readJson(RECEIPT_SETTINGS_KEY, defaultReceiptSettings);
	if (!settings.storeName) settings.storeName = fallbackStoreName;
	return settings;
}

export function saveReceiptSettings(settings: ReceiptSettings) {
	writeJson(RECEIPT_SETTINGS_KEY, settings);
}

export function loadGeneralSettings(): GeneralSettings {
	return readJson(GENERAL_SETTINGS_KEY, defaultGeneralSettings);
}

export function saveGeneralSettings(settings: GeneralSettings) {
	writeJson(GENERAL_SETTINGS_KEY, settings);
}

export function loadHardwareSettings(): HardwareSettings {
	return readJson(HARDWARE_SETTINGS_KEY, defaultHardwareSettings);
}

export function saveHardwareSettings(settings: HardwareSettings) {
	writeJson(HARDWARE_SETTINGS_KEY, settings);
}
