import { browser } from '$app/environment';
import { glo } from './store.svelte';
import { tenant } from './tenant.svelte';
import { TYPE, type Organization } from '$lib/domain';
import { BNOS_EXT_KEY } from '$lib/domain/helpers';
import {
	loadGeneralSettings,
	saveGeneralSettings,
	loadReceiptSettings,
	saveReceiptSettings,
	loadHardwareSettings,
	saveHardwareSettings,
	type GeneralSettings,
	type ReceiptSettings,
	type HardwareSettings
} from '$lib/settings/local';
import { FEATURE_KEYS, features, type FeatureKey } from '$lib/features.svelte';

const STORE_BRANDING_KEY = 'bnos-os:settings-store';

type WorkspaceFeatureFlags = Partial<Record<FeatureKey, boolean>>;

type WorkspaceBranding = {
	storeLogo?: string;
	storeWebsite?: string;
};

type WorkspaceSettingsPayload = {
	features?: WorkspaceFeatureFlags;
	locale?: string;
	defaultPayment?: string;
	taxRate?: number;
	taxInclusive?: boolean;
	receiptHeader?: string;
	receiptFooter?: string;
	hardware?: Partial<HardwareSettings>;
	receipt?: Partial<ReceiptSettings>;
	branding?: WorkspaceBranding;
};

export const WORKSPACE_SETTINGS_SYNC_EVENT = 'bnos:workspace-settings-sync';

function notifyWorkspaceSettingsSync() {
	if (!browser) return;
	window.dispatchEvent(new CustomEvent(WORKSPACE_SETTINGS_SYNC_EVENT));
}

function activeOrganizationObject() {
	const orgId = tenant.state.organizationId;
	if (orgId) {
		const byId = glo.get(TYPE.organization, orgId);
		if (byId) return byId as typeof byId & { data: Organization };
	}
	return glo.all<Organization, typeof TYPE.organization>(TYPE.organization)[0];
}

function bnosWorkspaceSettings() {
	const org = activeOrganizationObject();
	const ext = org?.extensions?.[BNOS_EXT_KEY];
	if (!ext || typeof ext !== 'object') return {};
	return ext as WorkspaceSettingsPayload;
}

function readStoreBranding(): WorkspaceBranding {
	if (!browser) return {};
	try {
		const raw = localStorage.getItem(STORE_BRANDING_KEY);
		const parsed = raw ? JSON.parse(raw) : {};
		return {
			storeLogo: typeof parsed.storeLogo === 'string' ? parsed.storeLogo : '',
			storeWebsite: typeof parsed.storeWebsite === 'string' ? parsed.storeWebsite : ''
		};
	} catch {
		return {};
	}
}

function writeStoreBranding(branding: WorkspaceBranding) {
	if (!browser) return;
	localStorage.setItem(STORE_BRANDING_KEY, JSON.stringify(branding));
}

export function currentWorkspaceSettingsPayload(): WorkspaceSettingsPayload {
	const general = loadGeneralSettings();
	const receipt = loadReceiptSettings(tenant.state.organizationName || '');
	const hardware = loadHardwareSettings();
	const branding = readStoreBranding();

	return {
		features: Object.fromEntries(FEATURE_KEYS.map((key) => [key, features.isEnabled(key)])),
		locale: general.language,
		defaultPayment: general.defaultPayment,
		taxRate: tenant.state.defaultTaxRate,
		taxInclusive: tenant.state.taxIncludedInPrice,
		receiptHeader: receipt.header,
		receiptFooter: receipt.footer,
		hardware: {
			printerType: hardware.printerType,
			paperSize: hardware.paperSize,
			cashDrawer: hardware.cashDrawer,
			barcodeScanner: hardware.barcodeScanner
		},
		receipt: {
			storeName: receipt.storeName,
			header: receipt.header,
			footer: receipt.footer,
			paperSize: receipt.paperSize,
			logoUrl: receipt.logoUrl,
			showLogo: receipt.showLogo,
			taxId: receipt.taxId,
			showTaxId: receipt.showTaxId,
			showQr: receipt.showQr,
			qrData: receipt.qrData,
			showStoreName: receipt.showStoreName,
			showPhone: receipt.showPhone,
			showAddress: receipt.showAddress,
			showDate: receipt.showDate,
			showOrderNumber: receipt.showOrderNumber,
			showBarcode: receipt.showBarcode,
			showCashierName: receipt.showCashierName,
			phone: receipt.phone,
			address: receipt.address
		},
		branding
	};
}

export function applyWorkspaceSettingsFromOrganization() {
	if (!browser) return false;

	const payload = bnosWorkspaceSettings();
	const general = loadGeneralSettings();
	const receipt = loadReceiptSettings(tenant.state.organizationName || '');
	const hardware = loadHardwareSettings();
	const nextReceipt: ReceiptSettings = {
		...receipt,
		storeName: (payload.receipt?.storeName ?? tenant.state.organizationName ?? receipt.storeName) || '',
		header: payload.receipt?.header ?? payload.receiptHeader ?? receipt.header,
		footer: payload.receipt?.footer ?? payload.receiptFooter ?? receipt.footer,
		paperSize: payload.receipt?.paperSize ?? payload.hardware?.paperSize ?? receipt.paperSize,
		logoUrl: payload.receipt?.logoUrl ?? receipt.logoUrl,
		showLogo: payload.receipt?.showLogo ?? receipt.showLogo,
		taxId: payload.receipt?.taxId ?? receipt.taxId,
		showTaxId: payload.receipt?.showTaxId ?? receipt.showTaxId,
		showQr: payload.receipt?.showQr ?? receipt.showQr,
		qrData: payload.receipt?.qrData ?? receipt.qrData,
		showStoreName: payload.receipt?.showStoreName ?? receipt.showStoreName,
		showPhone: payload.receipt?.showPhone ?? receipt.showPhone,
		showAddress: payload.receipt?.showAddress ?? receipt.showAddress,
		showDate: payload.receipt?.showDate ?? receipt.showDate,
		showOrderNumber: payload.receipt?.showOrderNumber ?? receipt.showOrderNumber,
		showBarcode: payload.receipt?.showBarcode ?? receipt.showBarcode,
		showCashierName: payload.receipt?.showCashierName ?? receipt.showCashierName,
		phone: payload.receipt?.phone ?? receipt.phone,
		address: payload.receipt?.address ?? receipt.address
	};
	if (payload.features) {
		features.replace(payload.features);
	}

	const nextGeneral: GeneralSettings = {
		...general,
		defaultPayment: payload.defaultPayment ?? general.defaultPayment,
		language: payload.locale ?? general.language
	};
	saveGeneralSettings(nextGeneral);

	saveReceiptSettings(nextReceipt);

	saveHardwareSettings({
		...hardware,
		printerType: payload.hardware?.printerType ?? hardware.printerType,
		paperSize: payload.hardware?.paperSize ?? hardware.paperSize,
		cashDrawer: payload.hardware?.cashDrawer ?? hardware.cashDrawer,
		barcodeScanner: payload.hardware?.barcodeScanner ?? hardware.barcodeScanner
	});

	if (payload.branding) {
		writeStoreBranding({
			storeLogo: payload.branding.storeLogo ?? '',
			storeWebsite: payload.branding.storeWebsite ?? ''
		});
	}

	notifyWorkspaceSettingsSync();

	return true;
}

export async function syncWorkspaceSettingsToOrganization() {
	if (!browser || !tenant.state.organizationId) return false;

	const org = activeOrganizationObject();
	if (!org) return false;

	const existingExt = org.extensions?.[BNOS_EXT_KEY];
	const payload = currentWorkspaceSettingsPayload();

	await glo.upsert(
		TYPE.organization,
		org.data,
		{
			id: org.id,
			scope: { organizationId: org.id },
			extensions: {
				[BNOS_EXT_KEY]: {
					...(existingExt && typeof existingExt === 'object' ? existingExt : {}),
					...payload
				}
			}
		}
	);

	notifyWorkspaceSettingsSync();

	return true;
}
