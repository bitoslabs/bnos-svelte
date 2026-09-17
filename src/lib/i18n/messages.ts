/**
 * i18n message dictionaries + locale metadata.
 *
 * Keys are dot-paths into the nested dictionary objects, e.g.
 * `t('common.save')`, `t('nav.pos')`, `t('settings.general')`.
 */
import { en } from './locales/en';
import { lo } from './locales/lo';
import { th } from './locales/th';

export const locales = ['en', 'lo', 'th'] as const;
export type Locale = (typeof locales)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/** Maps a locale to its BCP-47 tag (used for <html lang> + date/number formatting). */
export const localeTag: Record<Locale, string> = {
	en: 'en-US',
	lo: 'lo-LA',
	th: 'th-TH'
};

/** Native display label for each locale (shown in the language switcher). */
export const nativeNames: Record<Locale, string> = {
	en: 'English',
	lo: 'ລາວ',
	th: 'ไทย'
};

/** Short flag emoji for each locale. */
export const localeFlag: Record<Locale, string> = {
	en: '🇬🇧',
	lo: '🇱🇦',
	th: '🇹🇭'
};

export const messages = { en, lo, th } as const;

/** Deep writable dictionary type (any nested string record). */
export type DeepDict = { [k: string]: string | DeepDict };

export type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

/**
 * Resolve a dot-path key against a dictionary, falling back to the key itself
 * (and then to English, then to the raw key) so the UI never renders `undefined`.
 * Supports `{placeholder}` interpolation.
 */
export function resolve(
	dict: DeepDict | undefined,
	key: string,
	params?: Record<string, string | number>,
	fallbackDict?: DeepDict
): string {
	const value = lookup(dict, key) ?? lookup(fallbackDict, key);
	let str = typeof value === 'string' ? value : key;
	if (params) {
		for (const [k, v] of Object.entries(params)) {
			str = str.replaceAll(`{${k}}`, String(v));
		}
	}
	return str;
}

function lookup(dict: DeepDict | undefined, key: string): string | DeepDict | undefined {
	if (!dict) return undefined;
	if (key in dict) return dict[key];
	const parts = key.split('.');
	let cur: unknown = dict;
	for (const p of parts) {
		if (cur && typeof cur === 'object' && p in (cur as object)) {
			cur = (cur as Record<string, unknown>)[p];
		} else {
			return undefined;
		}
	}
	return typeof cur === 'string' ? cur : undefined;
}
