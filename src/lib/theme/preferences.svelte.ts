/**
 * User appearance preferences — runes-based singleton persisted to localStorage
 * and applied before first paint (no-flash script in app.html). Color mode is
 * handled by `mode-watcher`; accent/neutral/surface/font/radius/density live here.
 */
import { browser } from '$app/environment';
import {
	accentOptions,
	accentScale,
	neutralOptions,
	surfaceOptions,
	surfaceTintOptions,
	fontSizeOptions,
	radiusOptions,
	densityOptions,
	type NeutralKey,
	type Surface,
	type SurfaceTint,
	type FontSize,
	type Radius,
	type Density
} from './colors';

export interface Preferences {
	accent: string;
	neutral: NeutralKey;
	surface: Surface;
	surfaceTint: SurfaceTint;
	fontSize: FontSize;
	radius: Radius;
	density: Density;
}

export const STORAGE_KEY = 'bnos-os:prefs';
export const DEFAULTS: Preferences = {
	accent: 'brand',
	neutral: 'zinc',
	surface: 'macos',
	surfaceTint: 'balanced',
	fontSize: 'md',
	radius: 'md',
	density: 'normal'
};

function applyAccent(accent: string) {
	if (!browser) return;
	const scale = accentScale[accent] ?? accentScale.brand;
	const root = document.documentElement;
	(Object.keys(scale) as (keyof typeof scale)[]).forEach((shade) => {
		root.style.setProperty(`--color-primary-${shade}`, scale[shade]);
	});
}

class PrefsStore {
	state = $state<Preferences>({ ...DEFAULTS });

	apply = () => {
		if (!browser) return;
		const html = document.documentElement;
		html.dataset.density = this.state.density;
		html.dataset.neutral = this.state.neutral;
		html.dataset.radius = this.state.radius;
		html.dataset.surface = this.state.surface;
		html.dataset.surfaceTint = this.state.surfaceTint;
		html.style.fontSize =
			fontSizeOptions.find((f) => f.key === this.state.fontSize)?.value ?? '16px';
		html.style.setProperty(
			'--ui-radius',
			radiusOptions.find((r) => r.key === this.state.radius)?.value ?? '0.75rem'
		);
		applyAccent(this.state.accent);
	};

	persist = () => {
		if (!browser) return;
		localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
	};

	load = () => {
		if (!browser) return;
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (raw) this.state = { ...DEFAULTS, ...JSON.parse(raw) };
		} catch {
			/* ignore malformed storage */
		}
	};

	private set<K extends keyof Preferences>(key: K, value: Preferences[K]) {
		this.state[key] = value;
		this.persist();
		this.apply();
	}

	setAccent = (v: string) => this.set('accent', v);
	setNeutral = (v: NeutralKey) => this.set('neutral', v);
	setSurface = (v: Surface) => this.set('surface', v);
	setSurfaceTint = (v: SurfaceTint) => this.set('surfaceTint', v);
	setFontSize = (v: FontSize) => this.set('fontSize', v);
	setRadius = (v: Radius) => this.set('radius', v);
	setDensity = (v: Density) => this.set('density', v);
}

export const preferences = new PrefsStore();

export {
	accentOptions,
	neutralOptions,
	surfaceOptions,
	surfaceTintOptions,
	fontSizeOptions,
	radiusOptions,
	densityOptions
};
