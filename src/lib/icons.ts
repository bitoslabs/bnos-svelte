/**
 * Icon registry — Svelte equivalent of Nuxt Icon.
 * Registers the full Lucide collection offline (from @iconify-json/lucide) so
 * every icon referenced by name resolves with no network request and works SSR.
 * bdgo-os uses Solar/Hugeicons/Flowbite sets too; add more `addCollection`
 * imports here as needed without changing any call sites.
 */
import { addCollection } from '@iconify/svelte';
import { LUCIDE_SUBSET } from './icons-subset.generated';

let registered = false;
let fullIcons: Promise<void> | null = null;

export function registerIcons() {
	if (registered) return;
	addCollection(LUCIDE_SUBSET);
	registered = true;
}

/** True when `resolveIcon(name)` is available in the generated subset. */
export function hasLocalIcon(name: string): boolean {
	const icon = resolveIcon(name);
	if (!icon.startsWith('lucide:')) return true;
	const subset = LUCIDE_SUBSET as {
		icons: Record<string, unknown>;
		aliases?: Record<string, unknown>;
	};
	const key = icon.slice('lucide:'.length);
	return Object.hasOwn(subset.icons, key) || Object.hasOwn(subset.aliases ?? {}, key);
}

/** Load the full Lucide collection when an icon name came from external data
 *  rather than the source scan. Cached; called lazily by <Icon>. */
export function loadFullIcons(): Promise<void> {
	if (!fullIcons) {
		fullIcons = import('@iconify-json/lucide/icons.json').then(({ default: full }) => {
			addCollection(full);
		});
	}
	return fullIcons;
}

/**
 * Convert `i-lucide-foo` (Nuxt Icon convention) / Solar names into Iconify
 * `set:foo`. Already-iconify names pass through. Solar `solar:…` and flowbite
 * `flowbite:…` names pass through unchanged (add those collections to render
 * them; otherwise they'll be ignored gracefully).
 */
export function toIconify(name: string): string {
	if (!name) return '';
	if (name.includes(':')) return name;
	if (name.startsWith('i-lucide-')) return 'lucide:' + name.slice('i-lucide-'.length);
	if (name.startsWith('i-mdi-')) return 'mdi:' + name.slice('i-mdi-'.length);
	if (name.startsWith('i-ph-')) return 'ph:' + name.slice('i-ph-'.length);
	return name;
}

/**
 * Map arbitrary icon names used across bdgo-os to the closest Lucide glyph
 * available offline. Keeps the sidebar/portraits readable without bundling
 * every icon set bdgo-os pulls in.
 */
export const ICON_FALLBACK: Record<string, string> = {
	// sales
	'flowbite:cash-register-solid': 'lucide:scan-line',
	'solar:bill-bold-duotone': 'lucide:receipt-text',
	'solar:users-group-rounded-linear': 'lucide:users',
	'solar:tag-price-linear': 'lucide:tags',
	'solar:crown-linear': 'lucide:crown',
	// restaurant
	'solar:armchair-linear': 'lucide:armchair',
	'hugeicons:waiter': 'lucide:concierge-bell',
	'solar:chef-hat-linear': 'lucide:chef-hat',
	'solar:clipboard-list-linear': 'lucide:clipboard-list',
	// catalog
	'solar:box-linear': 'lucide:package',
	'lucide:warehouse': 'lucide:warehouse',
	// insights
	'oui:nav-dashboards': 'lucide:layout-dashboard',
	'solar:chart-linear': 'lucide:chart-line',
	'solar:transfer-horizontal-linear': 'lucide:arrow-left-right',
	'solar:wallet-money-linear': 'lucide:wallet',
	// general
	'solar:settings-linear': 'lucide:settings',
	'solar:logout-2-linear': 'lucide:log-out',
	'solar:smartphone-linear': 'lucide:smartphone',
	'solar:alt-arrow-right-linear': 'lucide:chevron-right',
	'solar:alt-arrow-up-linear': 'lucide:chevron-up',
	'solar:alt-arrow-down-linear': 'lucide:chevron-down',
	'solar:cloud-cross-linear': 'lucide:cloud-off',
	// Names referenced in the UI but absent from this Lucide version.
	'lucide:bag': 'lucide:shopping-bag',
	'lucide:cart': 'lucide:shopping-cart',
	'lucide:cart-x': 'lucide:trash-2',
	'lucide:cart-plus': 'lucide:shopping-cart',
	'lucide:card-receipt': 'lucide:receipt',
	'lucide:cloud-save': 'lucide:cloud-upload',
	'lucide:shop': 'lucide:store'
};

export function resolveIcon(name: string): string {
	return ICON_FALLBACK[name] ?? toIconify(name);
}
