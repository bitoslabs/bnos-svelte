/**
 * Built-in catalog starter kits (native presets).
 *
 * These are shipped with the console so a new merchant can seed a realistic
 * catalog in one click — no relay, no remote URL, no marketplace round-trip.
 * They use the exact same `bnos.catalog-preset` contract as published kits
 * (`./catalog-preset`), so applying one is idempotent and produces real
 * categories, units, modifier groups and products.
 *
 * Keep the JSON shape byte-compatible with `bnos-presets.json` so the same
 * objects can be exported/published later if desired.
 */
import {
	CATALOG_FORMAT,
	CATALOG_SCHEMA_VERSION,
	PRESET_FORMAT,
	PRESET_SCHEMA_VERSION,
	parseBrowseCatalog,
	type BrowseCatalogItem,
	type CatalogPreset
} from './catalog-preset';
import type { BusinessType } from './types';

export interface BuiltinTemplate {
	/** Iconify name for the setup cards. */
	icon: string;
	/** Business types this kit is recommended for. */
	businessTypes: BusinessType[];
	preset: CatalogPreset;
}

const CAFE_PRESET: CatalogPreset = {
	format: PRESET_FORMAT,
	schemaVersion: PRESET_SCHEMA_VERSION,
	id: 'builtin-cafe',
	name: 'Café starter kit',
	summary: 'Coffee, cold drinks, tea and bakery with size, milk and sweetness options.',
	currency: 'LAK',
	defaultPrice: 30_000,
	categories: [
		{ key: 'hot-coffee', name: 'Hot Coffee', sortOrder: 1 },
		{ key: 'cold-coffee', name: 'Cold Coffee', sortOrder: 2 },
		{ key: 'tea', name: 'Tea & Matcha', sortOrder: 3 },
		{ key: 'bakery', name: 'Bakery', sortOrder: 4 }
	],
	units: [
		{ key: 'cup', name: 'Cup', symbol: 'cup', type: 'count', isDefault: true },
		{ key: 'piece', name: 'Piece', symbol: 'pc', type: 'count' }
	],
	modifierGroups: [
		{
			key: 'size',
			name: 'Size',
			selectionType: 'single',
			required: true,
			modifiers: [
				{ name: 'Small', priceAdjustment: 0, isDefault: true },
				{ name: 'Medium', priceAdjustment: 5_000 },
				{ name: 'Large', priceAdjustment: 9_000 }
			]
		},
		{
			key: 'milk',
			name: 'Milk',
			selectionType: 'single',
			modifiers: [
				{ name: 'Whole milk', priceAdjustment: 0, isDefault: true },
				{ name: 'Oat milk', priceAdjustment: 6_000 },
				{ name: 'Soy milk', priceAdjustment: 6_000 },
				{ name: 'Almond milk', priceAdjustment: 6_000 },
				{ name: 'No milk', priceAdjustment: 0 }
			]
		},
		{
			key: 'sweetness',
			name: 'Sweetness',
			selectionType: 'single',
			modifiers: [
				{ name: '0%', priceAdjustment: 0 },
				{ name: '25%', priceAdjustment: 0 },
				{ name: '50%', priceAdjustment: 0, isDefault: true },
				{ name: '75%', priceAdjustment: 0 },
				{ name: '100%', priceAdjustment: 0 }
			]
		},
		{
			key: 'ice',
			name: 'Ice',
			selectionType: 'single',
			modifiers: [
				{ name: 'Regular ice', priceAdjustment: 0, isDefault: true },
				{ name: 'Less ice', priceAdjustment: 0 },
				{ name: 'No ice', priceAdjustment: 0 }
			]
		},
		{
			key: 'extras',
			name: 'Extras',
			selectionType: 'multiple',
			modifiers: [
				{ name: 'Extra espresso shot', priceAdjustment: 8_000 },
				{ name: 'Vanilla syrup', priceAdjustment: 5_000 },
				{ name: 'Caramel syrup', priceAdjustment: 5_000 },
				{ name: 'Whipped cream', priceAdjustment: 6_000 }
			]
		}
	],
	products: [
		{
			key: 'espresso',
			name: 'Espresso',
			price: 25_000,
			categoryKey: 'hot-coffee',
			unitKey: 'cup',
			modifierGroupKeys: ['size', 'sweetness'],
			sortOrder: 1
		},
		{
			key: 'americano',
			name: 'Americano',
			price: 30_000,
			categoryKey: 'hot-coffee',
			unitKey: 'cup',
			modifierGroupKeys: ['size', 'sweetness', 'extras'],
			sortOrder: 2
		},
		{
			key: 'cappuccino',
			name: 'Cappuccino',
			price: 35_000,
			categoryKey: 'hot-coffee',
			unitKey: 'cup',
			modifierGroupKeys: ['size', 'milk', 'sweetness', 'extras'],
			sortOrder: 3
		},
		{
			key: 'latte',
			name: 'Latte',
			price: 38_000,
			categoryKey: 'hot-coffee',
			unitKey: 'cup',
			modifierGroupKeys: ['size', 'milk', 'sweetness', 'extras'],
			sortOrder: 4
		},
		{
			key: 'flat-white',
			name: 'Flat White',
			price: 40_000,
			categoryKey: 'hot-coffee',
			unitKey: 'cup',
			modifierGroupKeys: ['size', 'milk', 'sweetness', 'extras'],
			sortOrder: 5
		},
		{
			key: 'mocha',
			name: 'Mocha',
			price: 45_000,
			categoryKey: 'hot-coffee',
			unitKey: 'cup',
			modifierGroupKeys: ['size', 'milk', 'sweetness', 'extras'],
			sortOrder: 6
		},
		{
			key: 'iced-americano',
			name: 'Iced Americano',
			price: 35_000,
			categoryKey: 'cold-coffee',
			unitKey: 'cup',
			modifierGroupKeys: ['size', 'sweetness', 'ice', 'extras'],
			sortOrder: 7
		},
		{
			key: 'iced-latte',
			name: 'Iced Latte',
			price: 42_000,
			categoryKey: 'cold-coffee',
			unitKey: 'cup',
			modifierGroupKeys: ['size', 'milk', 'sweetness', 'ice', 'extras'],
			sortOrder: 8
		},
		{
			key: 'iced-mocha',
			name: 'Iced Mocha',
			price: 48_000,
			categoryKey: 'cold-coffee',
			unitKey: 'cup',
			modifierGroupKeys: ['size', 'milk', 'sweetness', 'ice', 'extras'],
			sortOrder: 9
		},
		{
			key: 'matcha-latte',
			name: 'Matcha Latte',
			price: 45_000,
			categoryKey: 'tea',
			unitKey: 'cup',
			modifierGroupKeys: ['size', 'milk', 'sweetness', 'ice'],
			sortOrder: 10
		},
		{
			key: 'thai-iced-tea',
			name: 'Thai Iced Tea',
			price: 35_000,
			categoryKey: 'tea',
			unitKey: 'cup',
			modifierGroupKeys: ['size', 'milk', 'sweetness', 'ice'],
			sortOrder: 11
		},
		{
			key: 'lemon-tea',
			name: 'Lemon Tea',
			price: 30_000,
			categoryKey: 'tea',
			unitKey: 'cup',
			modifierGroupKeys: ['size', 'sweetness', 'ice'],
			sortOrder: 12
		},
		{
			key: 'butter-croissant',
			name: 'Butter Croissant',
			price: 20_000,
			categoryKey: 'bakery',
			unitKey: 'piece',
			sortOrder: 13
		},
		{
			key: 'almond-croissant',
			name: 'Almond Croissant',
			price: 28_000,
			categoryKey: 'bakery',
			unitKey: 'piece',
			sortOrder: 14
		},
		{
			key: 'banana-bread',
			name: 'Banana Bread',
			price: 25_000,
			categoryKey: 'bakery',
			unitKey: 'piece',
			sortOrder: 15
		},
		{
			key: 'chocolate-cake',
			name: 'Chocolate Cake',
			price: 30_000,
			categoryKey: 'bakery',
			unitKey: 'piece',
			sortOrder: 16
		}
	]
};

const NOODLE_PRESET: CatalogPreset = {
	format: PRESET_FORMAT,
	schemaVersion: PRESET_SCHEMA_VERSION,
	id: 'builtin-noodle-shop',
	name: 'Noodle shop starter kit',
	summary: 'Noodle soups, dry noodles and sides with noodle type, protein and spice options.',
	currency: 'LAK',
	defaultPrice: 50_000,
	categories: [
		{ key: 'noodle-soup', name: 'Noodle Soup', sortOrder: 1 },
		{ key: 'dry-noodle', name: 'Dry Noodles', sortOrder: 2 },
		{ key: 'sides', name: 'Sides', sortOrder: 3 },
		{ key: 'drinks', name: 'Drinks', sortOrder: 4 }
	],
	units: [
		{ key: 'bowl', name: 'Bowl', symbol: 'bowl', type: 'count', isDefault: true },
		{ key: 'plate', name: 'Plate', symbol: 'plate', type: 'count' },
		{ key: 'piece', name: 'Piece', symbol: 'pc', type: 'count' },
		{ key: 'glass', name: 'Glass', symbol: 'glass', type: 'count' }
	],
	modifierGroups: [
		{
			key: 'noodle-type',
			name: 'Noodle type',
			selectionType: 'single',
			required: true,
			modifiers: [
				{ name: 'Rice noodles', priceAdjustment: 0, isDefault: true },
				{ name: 'Egg noodles', priceAdjustment: 0 },
				{ name: 'Vermicelli', priceAdjustment: 0 },
				{ name: 'Wide rice noodles', priceAdjustment: 0 },
				{ name: 'Instant noodles', priceAdjustment: 0 }
			]
		},
		{
			key: 'protein',
			name: 'Protein',
			selectionType: 'single',
			required: true,
			modifiers: [
				{ name: 'Beef', priceAdjustment: 0, isDefault: true },
				{ name: 'Pork', priceAdjustment: 0 },
				{ name: 'Chicken', priceAdjustment: 0 },
				{ name: 'Fish balls', priceAdjustment: 0 },
				{ name: 'Shrimp', priceAdjustment: 10_000 },
				{ name: 'Tofu', priceAdjustment: 0 }
			]
		},
		{
			key: 'portion',
			name: 'Portion',
			selectionType: 'single',
			required: true,
			modifiers: [
				{ name: 'Regular', priceAdjustment: 0, isDefault: true },
				{ name: 'Large', priceAdjustment: 15_000 }
			]
		},
		{
			key: 'spice',
			name: 'Spice level',
			selectionType: 'single',
			modifiers: [
				{ name: 'Not spicy', priceAdjustment: 0, isDefault: true },
				{ name: 'Mild', priceAdjustment: 0 },
				{ name: 'Medium', priceAdjustment: 0 },
				{ name: 'Thai spicy', priceAdjustment: 0 }
			]
		},
		{
			key: 'extras',
			name: 'Extras',
			selectionType: 'multiple',
			modifiers: [
				{ name: 'Extra noodles', priceAdjustment: 10_000 },
				{ name: 'Extra meat', priceAdjustment: 20_000 },
				{ name: 'Boiled egg', priceAdjustment: 8_000 },
				{ name: 'Vegetables', priceAdjustment: 5_000 },
				{ name: 'Crispy pork', priceAdjustment: 15_000 }
			]
		}
	],
	products: [
		{
			key: 'beef-noodle-soup',
			name: 'Beef Noodle Soup',
			price: 55_000,
			categoryKey: 'noodle-soup',
			unitKey: 'bowl',
			modifierGroupKeys: ['noodle-type', 'protein', 'portion', 'spice', 'extras'],
			sortOrder: 1
		},
		{
			key: 'pork-noodle-soup',
			name: 'Pork Noodle Soup',
			price: 50_000,
			categoryKey: 'noodle-soup',
			unitKey: 'bowl',
			modifierGroupKeys: ['noodle-type', 'protein', 'portion', 'spice', 'extras'],
			sortOrder: 2
		},
		{
			key: 'chicken-noodle-soup',
			name: 'Chicken Noodle Soup',
			price: 50_000,
			categoryKey: 'noodle-soup',
			unitKey: 'bowl',
			modifierGroupKeys: ['noodle-type', 'protein', 'portion', 'spice', 'extras'],
			sortOrder: 3
		},
		{
			key: 'fish-ball-noodle-soup',
			name: 'Fish Ball Noodle Soup',
			price: 45_000,
			categoryKey: 'noodle-soup',
			unitKey: 'bowl',
			modifierGroupKeys: ['noodle-type', 'protein', 'portion', 'spice', 'extras'],
			sortOrder: 4
		},
		{
			key: 'tom-yum-noodle-soup',
			name: 'Tom Yum Noodle Soup',
			price: 60_000,
			categoryKey: 'noodle-soup',
			unitKey: 'bowl',
			modifierGroupKeys: ['noodle-type', 'protein', 'portion', 'spice', 'extras'],
			sortOrder: 5
		},
		{
			key: 'boat-noodles',
			name: 'Boat Noodles',
			price: 40_000,
			categoryKey: 'noodle-soup',
			unitKey: 'bowl',
			modifierGroupKeys: ['noodle-type', 'protein', 'portion', 'spice', 'extras'],
			sortOrder: 6
		},
		{
			key: 'dry-noodles-pork',
			name: 'Dry Noodles with Pork',
			price: 50_000,
			categoryKey: 'dry-noodle',
			unitKey: 'plate',
			modifierGroupKeys: ['noodle-type', 'protein', 'portion', 'spice', 'extras'],
			sortOrder: 7
		},
		{
			key: 'dry-noodles-chicken',
			name: 'Dry Noodles with Chicken',
			price: 50_000,
			categoryKey: 'dry-noodle',
			unitKey: 'plate',
			modifierGroupKeys: ['noodle-type', 'protein', 'portion', 'spice', 'extras'],
			sortOrder: 8
		},
		{
			key: 'pad-see-ew',
			name: 'Pad See Ew',
			price: 55_000,
			categoryKey: 'dry-noodle',
			unitKey: 'plate',
			modifierGroupKeys: ['protein', 'portion', 'spice', 'extras'],
			sortOrder: 9
		},
		{
			key: 'spring-rolls',
			name: 'Spring Rolls',
			price: 25_000,
			categoryKey: 'sides',
			unitKey: 'piece',
			sortOrder: 10
		},
		{
			key: 'fried-dumplings',
			name: 'Fried Dumplings',
			price: 30_000,
			categoryKey: 'sides',
			unitKey: 'piece',
			sortOrder: 11
		},
		{
			key: 'thai-iced-tea',
			name: 'Thai Iced Tea',
			price: 25_000,
			categoryKey: 'drinks',
			unitKey: 'glass',
			sortOrder: 12
		},
		{
			key: 'iced-green-tea',
			name: 'Iced Green Tea',
			price: 20_000,
			categoryKey: 'drinks',
			unitKey: 'glass',
			sortOrder: 13
		},
		{
			key: 'bottled-water',
			name: 'Bottled Water',
			price: 8_000,
			categoryKey: 'drinks',
			unitKey: 'piece',
			sortOrder: 14
		}
	]
};

const RESTAURANT_PRESET: CatalogPreset = {
	format: PRESET_FORMAT,
	schemaVersion: PRESET_SCHEMA_VERSION,
	id: 'builtin-restaurant',
	name: 'Restaurant starter kit',
	summary: 'Thai starters, curries, mains and drinks with spice and rice options.',
	currency: 'LAK',
	defaultPrice: 60_000,
	categories: [
		{ key: 'starters', name: 'Starters', sortOrder: 1 },
		{ key: 'mains', name: 'Mains', sortOrder: 2 },
		{ key: 'soups', name: 'Soups & Curries', sortOrder: 3 },
		{ key: 'dessert', name: 'Dessert', sortOrder: 4 },
		{ key: 'drinks', name: 'Drinks', sortOrder: 5 }
	],
	units: [
		{ key: 'plate', name: 'Plate', symbol: 'plate', type: 'count', isDefault: true },
		{ key: 'bowl', name: 'Bowl', symbol: 'bowl', type: 'count' },
		{ key: 'glass', name: 'Glass', symbol: 'glass', type: 'count' }
	],
	modifierGroups: [
		{
			key: 'spice',
			name: 'Spice level',
			selectionType: 'single',
			modifiers: [
				{ name: 'Not spicy', priceAdjustment: 0, isDefault: true },
				{ name: 'Mild', priceAdjustment: 0 },
				{ name: 'Medium', priceAdjustment: 0 },
				{ name: 'Thai spicy', priceAdjustment: 0 }
			]
		},
		{
			key: 'rice',
			name: 'Rice',
			selectionType: 'single',
			modifiers: [
				{ name: 'Jasmine rice', priceAdjustment: 0, isDefault: true },
				{ name: 'Sticky rice', priceAdjustment: 5_000 },
				{ name: 'No rice', priceAdjustment: 0 }
			]
		},
		{
			key: 'extras',
			name: 'Extras',
			selectionType: 'multiple',
			modifiers: [
				{ name: 'Extra rice', priceAdjustment: 5_000 },
				{ name: 'Fried egg', priceAdjustment: 8_000 },
				{ name: 'Extra chili', priceAdjustment: 0 }
			]
		}
	],
	products: [
		{
			key: 'spring-rolls',
			name: 'Spring Rolls',
			price: 35_000,
			categoryKey: 'starters',
			unitKey: 'plate',
			sortOrder: 1
		},
		{
			key: 'som-tum',
			name: 'Som Tum',
			price: 45_000,
			categoryKey: 'starters',
			unitKey: 'plate',
			modifierGroupKeys: ['spice'],
			sortOrder: 2
		},
		{
			key: 'pad-thai',
			name: 'Pad Thai',
			price: 60_000,
			categoryKey: 'mains',
			unitKey: 'plate',
			modifierGroupKeys: ['spice', 'extras'],
			sortOrder: 3
		},
		{
			key: 'fried-rice',
			name: 'Fried Rice',
			price: 50_000,
			categoryKey: 'mains',
			unitKey: 'plate',
			modifierGroupKeys: ['spice', 'extras'],
			sortOrder: 4
		},
		{
			key: 'green-curry',
			name: 'Green Curry',
			price: 65_000,
			categoryKey: 'soups',
			unitKey: 'bowl',
			modifierGroupKeys: ['spice', 'rice'],
			sortOrder: 5
		},
		{
			key: 'massaman-curry',
			name: 'Massaman Curry',
			price: 70_000,
			categoryKey: 'soups',
			unitKey: 'bowl',
			modifierGroupKeys: ['spice', 'rice'],
			sortOrder: 6
		},
		{
			key: 'tom-yum-goong',
			name: 'Tom Yum Goong',
			price: 75_000,
			categoryKey: 'soups',
			unitKey: 'bowl',
			modifierGroupKeys: ['spice', 'rice'],
			sortOrder: 7
		},
		{
			key: 'mango-sticky-rice',
			name: 'Mango Sticky Rice',
			price: 50_000,
			categoryKey: 'dessert',
			unitKey: 'plate',
			sortOrder: 8
		},
		{
			key: 'thai-iced-tea',
			name: 'Thai Iced Tea',
			price: 25_000,
			categoryKey: 'drinks',
			unitKey: 'glass',
			sortOrder: 9
		},
		{
			key: 'beer',
			name: 'Beer',
			price: 40_000,
			categoryKey: 'drinks',
			unitKey: 'glass',
			sortOrder: 10
		}
	]
};

const RETAIL_PRESET: CatalogPreset = {
	format: PRESET_FORMAT,
	schemaVersion: PRESET_SCHEMA_VERSION,
	id: 'builtin-retail-mini-mart',
	name: 'Mini-mart starter kit',
	summary: 'Drinks, snacks, household basics and accessories for a small shop.',
	currency: 'LAK',
	defaultPrice: 15_000,
	categories: [
		{ key: 'drinks', name: 'Drinks', sortOrder: 1 },
		{ key: 'snacks', name: 'Snacks', sortOrder: 2 },
		{ key: 'household', name: 'Household', sortOrder: 3 },
		{ key: 'accessories', name: 'Accessories', sortOrder: 4 }
	],
	units: [
		{ key: 'piece', name: 'Piece', symbol: 'pc', type: 'count', isDefault: true },
		{ key: 'pack', name: 'Pack', symbol: 'pack', type: 'count' },
		{ key: 'bottle', name: 'Bottle', symbol: 'btl', type: 'count' }
	],
	modifierGroups: [],
	products: [
		{
			key: 'bottled-water',
			name: 'Bottled Water',
			price: 8_000,
			categoryKey: 'drinks',
			unitKey: 'bottle',
			sortOrder: 1
		},
		{
			key: 'soft-drink',
			name: 'Soft Drink',
			price: 12_000,
			categoryKey: 'drinks',
			unitKey: 'bottle',
			sortOrder: 2
		},
		{
			key: 'energy-drink',
			name: 'Energy Drink',
			price: 20_000,
			categoryKey: 'drinks',
			unitKey: 'bottle',
			sortOrder: 3
		},
		{
			key: 'potato-chips',
			name: 'Potato Chips',
			price: 15_000,
			categoryKey: 'snacks',
			unitKey: 'pack',
			sortOrder: 4
		},
		{
			key: 'chocolate-bar',
			name: 'Chocolate Bar',
			price: 18_000,
			categoryKey: 'snacks',
			unitKey: 'piece',
			sortOrder: 5
		},
		{
			key: 'instant-noodles',
			name: 'Instant Noodles',
			price: 10_000,
			categoryKey: 'snacks',
			unitKey: 'piece',
			sortOrder: 6
		},
		{
			key: 'toothpaste',
			name: 'Toothpaste',
			price: 25_000,
			categoryKey: 'household',
			unitKey: 'piece',
			sortOrder: 7
		},
		{
			key: 'laundry-soap',
			name: 'Laundry Soap',
			price: 35_000,
			categoryKey: 'household',
			unitKey: 'piece',
			sortOrder: 8
		},
		{
			key: 'phone-cable',
			name: 'Phone Cable',
			price: 45_000,
			categoryKey: 'accessories',
			unitKey: 'piece',
			sortOrder: 9
		},
		{
			key: 'aa-batteries',
			name: 'AA Batteries (4-pack)',
			price: 30_000,
			categoryKey: 'accessories',
			unitKey: 'pack',
			sortOrder: 10
		},
		{
			key: 'tote-bag',
			name: 'Tote Bag',
			price: 30_000,
			categoryKey: 'accessories',
			unitKey: 'piece',
			sortOrder: 11
		},
		{
			key: 'lighter',
			name: 'Lighter',
			price: 10_000,
			categoryKey: 'accessories',
			unitKey: 'piece',
			sortOrder: 12
		}
	]
};

/** Native starter kits available without a network connection. */
export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
	{ icon: 'lucide:coffee', businessTypes: ['cafe'], preset: CAFE_PRESET },
	{ icon: 'lucide:utensils', businessTypes: ['noodle'], preset: NOODLE_PRESET },
	{ icon: 'lucide:chef-hat', businessTypes: ['restaurant'], preset: RESTAURANT_PRESET },
	{
		icon: 'lucide:shopping-bag',
		businessTypes: ['retail', 'wholesale', 'other'],
		preset: RETAIL_PRESET
	}
];

/** `bnos-presets.json`-shaped document for the built-in kits. */
export const BUILTIN_CATALOG_JSON = {
	format: CATALOG_FORMAT,
	schemaVersion: CATALOG_SCHEMA_VERSION,
	generatedAt: '2026-01-01T00:00:00.000Z',
	count: BUILTIN_TEMPLATES.length,
	items: BUILTIN_TEMPLATES.map(({ preset }) => ({
		presetId: preset.id,
		productId: `builtin:${preset.id}`,
		name: preset.name,
		summary: preset.summary,
		publisher: 'Built-in',
		category: 'starter-kit',
		version: '1.0.0',
		license: 'CC0-1.0',
		targetApp: 'bnos',
		preset
	}))
};

/**
 * Parse and validate the built-in kits through the same consumer contract used
 * for remote kits. Returns an empty list (and logs) if a preset ever drifts.
 */
export function builtinCatalogItems(): BrowseCatalogItem[] {
	const result = parseBrowseCatalog(BUILTIN_CATALOG_JSON);
	if (!result.ok) {
		console.error('[builtin-presets] invalid built-in catalog:', result.errors);
		return [];
	}
	return result.data.items;
}

/** The built-in kit recommended for a merchant's business type, if any. */
export function builtinTemplateForBusinessType(type: string): BuiltinTemplate | null {
	const match = BUILTIN_TEMPLATES.find((template) =>
		(template.businessTypes as string[]).includes(type)
	);
	return match ?? BUILTIN_TEMPLATES[BUILTIN_TEMPLATES.length - 1] ?? null;
}
