/**
 * Internationalisation store (Svelte 5 runes).
 *
 * - Single source of truth for the active display language, persisted to
 *   localStorage and kept in sync with the legacy `GeneralSettings.language`
 *   preference so the existing Settings → General switcher keeps working.
 * - `t()` is a reactive translate function: call it inside any reactive
 *   context (template / `$derived` / `$effect`) and it re-runs when the
 *   locale changes. Safe to call from plain `.ts` modules too — it simply
 *   returns the string for the *current* locale (used by toasts, etc.).
 *
 * Usage in components:
 *   import { t } from '$lib/i18n/i18n.svelte';
 *   <h1>{t('nav.dashboard')}</h1>
 *   <p>{t('topbar.relaysActive', { active: 3, total: 5 })}</p>
 */
import { browser } from '$app/environment';
import { GENERAL_SETTINGS_KEY } from '$lib/settings/local';
import {
	DEFAULT_LOCALE,
	locales,
	localeTag,
	messages,
	resolve,
	type DeepDict,
	type Locale,
	type TranslateFn
} from './messages';

export const STORAGE_KEY = 'bnos-os:locale';

function detectLocale(): Locale {
	if (!browser) return DEFAULT_LOCALE;
	// 1. Explicit locale storage wins.
	const stored = localStorage.getItem(STORAGE_KEY) as Locale | null;
	if (stored && (locales as readonly string[]).includes(stored)) return stored;
	// 2. Legacy general-settings language field.
	try {
		const raw = localStorage.getItem(GENERAL_SETTINGS_KEY);
		if (raw) {
			const lang = JSON.parse(raw)?.language;
			if (lang && (locales as readonly string[]).includes(lang)) return lang as Locale;
		}
	} catch {
		/* ignore */
	}
	// 3. Browser language.
	const nav = navigator.language?.toLowerCase() ?? '';
	if (nav.startsWith('lo')) return 'lo';
	if (nav.startsWith('th')) return 'th';
	return DEFAULT_LOCALE;
}

function applyHtmlLang(locale: Locale) {
	if (!browser) return;
	document.documentElement.lang = localeTag[locale];
	// Expose the locale to the design system so locale-specific typography can
	// react immediately without adding classes to every translated label.
	document.documentElement.dataset.locale = locale;
}

class I18nStore {
	/** Current display language. Reactive — reading it tracks dependencies. */
	locale = $state<Locale>(DEFAULT_LOCALE);

	/** Initialise from storage / browser. Call once on mount (+layout.svelte). */
	init = () => {
		if (!browser) return;
		const detected = detectLocale();
		this.locale = detected;
		applyHtmlLang(detected);
		// Mirror into the legacy general-settings object so Settings → General
		// shows the correct value without a separate write.
		this.syncLegacyGeneralSettings(detected);
	};

	/** Change the active language everywhere (reactive). */
	set = (locale: Locale) => {
		if (!(locales as readonly string[]).includes(locale)) return;
		this.locale = locale;
		if (browser) {
			localStorage.setItem(STORAGE_KEY, locale);
			applyHtmlLang(locale);
		}
		this.syncLegacyGeneralSettings(locale);
	};

	private syncLegacyGeneralSettings(locale: Locale) {
		if (!browser) return;
		try {
			const raw = localStorage.getItem(GENERAL_SETTINGS_KEY);
			const obj = raw ? JSON.parse(raw) : {};
			if (obj.language !== locale) {
				obj.language = locale;
				localStorage.setItem(GENERAL_SETTINGS_KEY, JSON.stringify(obj));
			}
		} catch {
			/* ignore */
		}
	}

	/** List of selectable locales (for switchers). */
	get available(): readonly Locale[] {
		return locales;
	}

	/** Reactive translate. Reads `this.locale` so callers re-render on change. */
	t: TranslateFn = (key, params) => {
		const locale = this.locale;
		return resolve(
			messages[locale] as unknown as DeepDict,
			key,
			params,
			messages[DEFAULT_LOCALE] as unknown as DeepDict
		);
	};
}

export const i18n = new I18nStore();

/** Convenience: reactive translate function bound to the global store. */
export const t = i18n.t;

export { locales, localeTag, DEFAULT_LOCALE };
export type { Locale };
