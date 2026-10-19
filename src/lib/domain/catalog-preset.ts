/**
 * BNOS catalog preset contract (consumer side).
 *
 * A marketplace product item (a starter kit from the `templates` storefront)
 * ships a versioned JSON "preset" describing GLO objects this console can seed:
 * catalog categories, units, modifier groups and products. This module parses
 * and validates that document and turns it into a deterministic GLO upsert plan.
 *
 * It is pure and framework-free: the caller injects the `upsert` function, so
 * the whole apply flow is unit-testable without IndexedDB, relays or the DOM.
 *
 * Idempotency: every seeded record id is derived from the preset id and the
 * entry key (`preset:<presetId>:<kind>:<key>`), so applying the same kit twice
 * upserts the same records instead of duplicating them. The contract here must
 * stay byte-compatible with `apps/templates/src/lib/catalog-preset.js`.
 */
import type { Category, ModifierGroup, Product, Unit } from './types';
import { TYPE } from './kind';
import { mapLimit } from '../utils/async';

export const PRESET_FORMAT = 'bnos.catalog-preset';
export const PRESET_SCHEMA_VERSION = 1;
export const CATALOG_FORMAT = 'bnos.catalog-catalog';
export const CATALOG_SCHEMA_VERSION = 1;

export const MAX_PRESET_PRODUCTS = 500;
export const MAX_PRESET_META = 200;

export interface PresetCategory {
	key: string;
	name: string;
	description?: string;
	sortOrder?: number;
}

export interface PresetUnit {
	key: string;
	name: string;
	abbreviation?: string;
	symbol?: string;
	type?: Unit['type'];
	isDefault?: boolean;
}

export interface PresetModifierOption {
	name: string;
	priceAdjustment?: number;
	isDefault?: boolean;
}

export interface PresetModifierGroup {
	key: string;
	name: string;
	selectionType?: 'single' | 'multiple';
	required?: boolean;
	minSelections?: number;
	maxSelections?: number;
	modifiers?: PresetModifierOption[];
}

export interface PresetProduct {
	key: string;
	name: string;
	description?: string;
	sku?: string;
	barcode?: string;
	categoryKey?: string;
	unitKey?: string;
	price?: number;
	currency?: string;
	tags?: string[];
	images?: string[];
	sortOrder?: number;
	modifierGroupKeys?: string[];
}

export interface CatalogPreset {
	format: string;
	schemaVersion: number;
	id: string;
	name: string;
	summary?: string;
	currency?: string;
	/** Fallback price (minor units) applied to products that omit one. */
	defaultPrice?: number;
	source?: Record<string, unknown>;
	categories: PresetCategory[];
	units: PresetUnit[];
	modifierGroups: PresetModifierGroup[];
	products: PresetProduct[];
}

export interface BrowseCatalogItem {
	presetId: string;
	productId: string;
	name: string;
	summary?: string;
	publisher?: string;
	category?: string;
	version?: string;
	license?: string;
	priceSats?: number;
	targetApp?: string;
	counts: { categories: number; units: number; modifierGroups: number; products: number };
	preset: CatalogPreset;
}

export interface BrowseCatalog {
	format: string;
	schemaVersion: number;
	generatedAt?: string;
	count?: number;
	items: BrowseCatalogItem[];
}

export interface PresetApplicationPlan {
	categories: Array<{ id: string; data: Category }>;
	units: Array<{ id: string; data: Unit }>;
	modifierGroups: Array<{ id: string; data: ModifierGroup }>;
	products: Array<{ id: string; data: Product }>;
}

export interface PresetApplyResult {
	ok: boolean;
	errors: string[];
	counts: { categories: number; units: number; modifierGroups: number; products: number };
}

export type GloUpsert = (
	type: string,
	data: unknown,
	options: { id: string }
) => Promise<unknown> | unknown;

type ParseResult<T> =
	{ ok: true; data: T; errors: [] } | { ok: false; data: null; errors: string[] };

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
	typeof value === 'string' && value.trim().length > 0;

export function slug(value: unknown): string {
	return String(value ?? '')
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

/** Deterministic record id for one preset entry; mirrors the producer helper. */
export function presetRecordId(presetId: string, kind: string, key: string): string {
	return `preset:${slug(presetId)}:${kind}:${slug(key)}`;
}

function parseEntries(
	input: unknown,
	label: string,
	{ min = 0, max = MAX_PRESET_META, required = [] as string[] } = {}
): { errors: string[]; value: Record<string, unknown>[] } {
	const errors: string[] = [];
	if (input == null) return { errors, value: [] };
	if (!Array.isArray(input)) return { errors: [`${label} must be an array.`], value: [] };
	if (input.length < min) errors.push(`${label} needs at least ${min}.`);
	if (input.length > max) errors.push(`${label} exceeds the ${max}-entry limit.`);
	const seen = new Set<string>();
	const value: Record<string, unknown>[] = [];
	input.forEach((entry, index) => {
		if (!isObject(entry)) {
			errors.push(`${label}[${index}] must be an object.`);
			return;
		}
		if (!isNonEmptyString(entry.key)) {
			errors.push(`${label}[${index}].key is required.`);
			return;
		}
		const key = slug(entry.key);
		if (seen.has(key)) {
			errors.push(`${label}[${index}].key "${entry.key}" is duplicated.`);
			return;
		}
		seen.add(key);
		for (const field of required) {
			if (!isNonEmptyString(entry[field])) errors.push(`${label}[${index}].${field} is required.`);
		}
		value.push({ ...entry, key });
	});
	return { errors, value };
}

/** Validate and normalize a preset document. Never guesses; rejects honestly. */
export function parseCatalogPreset(input: unknown): ParseResult<CatalogPreset> {
	const errors: string[] = [];
	if (!isObject(input)) return { ok: false, data: null, errors: ['Preset must be an object.'] };
	if (input.format !== PRESET_FORMAT) errors.push(`Preset format must be "${PRESET_FORMAT}".`);
	if (input.schemaVersion !== PRESET_SCHEMA_VERSION) {
		errors.push(`Unsupported preset schemaVersion: ${String(input.schemaVersion)}.`);
	}
	if (!isNonEmptyString(input.id)) errors.push('Preset id is required.');
	if (!isNonEmptyString(input.name)) errors.push('Preset name is required.');
	if (input.defaultPrice != null) {
		const fallback = Number(input.defaultPrice);
		if (!Number.isFinite(fallback) || fallback < 0) {
			errors.push('defaultPrice must be a non-negative number.');
		}
	}

	const categories = parseEntries(input.categories, 'categories', { required: ['name'] });
	const units = parseEntries(input.units, 'units', { required: ['name'] });
	const groups = parseEntries(input.modifierGroups, 'modifierGroups', { required: ['name'] });
	const products = parseEntries(input.products, 'products', {
		min: 1,
		max: MAX_PRESET_PRODUCTS,
		required: ['name']
	});
	errors.push(...categories.errors, ...units.errors, ...groups.errors, ...products.errors);

	const categoryKeys = new Set(categories.value.map((entry) => entry.key as string));
	const unitKeys = new Set(units.value.map((entry) => entry.key as string));
	const groupKeys = new Set(groups.value.map((entry) => entry.key as string));

	const normalizedGroups: PresetModifierGroup[] = groups.value.map((group, index) => {
		const rawModifiers = group.modifiers ?? group.options;
		const modifiers: PresetModifierOption[] = [];
		if (rawModifiers != null) {
			if (!Array.isArray(rawModifiers))
				errors.push(`modifierGroups[${index}].modifiers must be an array.`);
			else {
				rawModifiers.forEach((option, optionIndex) => {
					if (!isObject(option) || !isNonEmptyString(option.name)) {
						errors.push(`modifierGroups[${index}].modifiers[${optionIndex}].name is required.`);
						return;
					}
					modifiers.push({
						name: option.name,
						priceAdjustment: Number(option.priceAdjustment) || 0,
						isDefault: option.isDefault === true
					});
				});
			}
		}
		return {
			key: group.key as string,
			name: String(group.name),
			selectionType: group.selectionType === 'multiple' ? 'multiple' : 'single',
			required: group.required === true,
			minSelections: typeof group.minSelections === 'number' ? group.minSelections : undefined,
			maxSelections: typeof group.maxSelections === 'number' ? group.maxSelections : undefined,
			modifiers
		};
	});

	const normalizedProducts: PresetProduct[] = products.value.map((product, index) => {
		const categoryKey = product.categoryKey != null ? slug(product.categoryKey) : undefined;
		const unitKey = product.unitKey != null ? slug(product.unitKey) : undefined;
		if (categoryKey && !categoryKeys.has(categoryKey)) {
			errors.push(`products[${index}].categoryKey "${categoryKey}" is not declared.`);
		}
		if (unitKey && !unitKeys.has(unitKey)) {
			errors.push(`products[${index}].unitKey "${unitKey}" is not declared.`);
		}
		const modifierGroupKeys = Array.isArray(product.modifierGroupKeys)
			? product.modifierGroupKeys.map((key) => slug(key))
			: [];
		for (const key of modifierGroupKeys) {
			if (!groupKeys.has(key))
				errors.push(`products[${index}].modifierGroupKeys has unknown key "${key}".`);
		}
		const price = product.price == null ? undefined : Number(product.price);
		if (price != null && (!Number.isFinite(price) || price < 0)) {
			errors.push(`products[${index}].price must be a non-negative number.`);
		}
		return {
			key: product.key as string,
			name: String(product.name),
			description: isNonEmptyString(product.description) ? product.description : undefined,
			sku: isNonEmptyString(product.sku) ? product.sku : undefined,
			barcode: isNonEmptyString(product.barcode) ? product.barcode : undefined,
			categoryKey,
			unitKey,
			price,
			currency: isNonEmptyString(product.currency) ? product.currency : undefined,
			tags: Array.isArray(product.tags) ? product.tags.filter(isNonEmptyString) : undefined,
			images: Array.isArray(product.images) ? product.images.filter(isNonEmptyString) : undefined,
			sortOrder: typeof product.sortOrder === 'number' ? product.sortOrder : undefined,
			modifierGroupKeys
		};
	});

	if (errors.length) return { ok: false, data: null, errors };
	return {
		ok: true,
		errors: [],
		data: {
			format: PRESET_FORMAT,
			schemaVersion: PRESET_SCHEMA_VERSION,
			id: slug(input.id),
			name: String(input.name).trim(),
			summary: isNonEmptyString(input.summary) ? input.summary : undefined,
			currency: isNonEmptyString(input.currency) ? input.currency : undefined,
			defaultPrice: input.defaultPrice != null ? Number(input.defaultPrice) : undefined,
			source: isObject(input.source) ? input.source : undefined,
			categories: categories.value as unknown as PresetCategory[],
			units: units.value as unknown as PresetUnit[],
			modifierGroups: normalizedGroups,
			products: normalizedProducts
		}
	};
}

/** Validate a browse-catalog document and every embedded preset. */
export function parseBrowseCatalog(input: unknown): ParseResult<BrowseCatalog> {
	if (!isObject(input) || input.format !== CATALOG_FORMAT) {
		return { ok: false, data: null, errors: [`Catalog format must be "${CATALOG_FORMAT}".`] };
	}
	if (input.schemaVersion !== CATALOG_SCHEMA_VERSION) {
		return {
			ok: false,
			data: null,
			errors: [`Unsupported catalog schemaVersion: ${String(input.schemaVersion)}.`]
		};
	}
	if (!Array.isArray(input.items))
		return { ok: false, data: null, errors: ['Catalog items must be an array.'] };
	const errors: string[] = [];
	const items: BrowseCatalogItem[] = [];
	input.items.forEach((item, index) => {
		if (!isObject(item) || !isObject(item.preset)) {
			errors.push(`items[${index}] must include a preset object.`);
			return;
		}
		const result = parseCatalogPreset(item.preset);
		if (!result.ok) {
			errors.push(`items[${index}]: ${result.errors.join(' ')}`);
			return;
		}
		items.push({
			presetId: isNonEmptyString(item.presetId) ? item.presetId : result.data.id,
			productId: isNonEmptyString(item.productId) ? item.productId : result.data.id,
			name: isNonEmptyString(item.name) ? item.name : result.data.name,
			summary: isNonEmptyString(item.summary) ? item.summary : undefined,
			publisher: isNonEmptyString(item.publisher) ? item.publisher : undefined,
			category: isNonEmptyString(item.category) ? item.category : undefined,
			version: isNonEmptyString(item.version) ? item.version : undefined,
			license: isNonEmptyString(item.license) ? item.license : undefined,
			priceSats: typeof item.priceSats === 'number' ? item.priceSats : undefined,
			targetApp: isNonEmptyString(item.targetApp) ? item.targetApp : undefined,
			counts: {
				categories: result.data.categories.length,
				units: result.data.units.length,
				modifierGroups: result.data.modifierGroups.length,
				products: result.data.products.length
			},
			preset: result.data
		});
	});
	return errors.length
		? { ok: false, data: null, errors }
		: {
				ok: true,
				data: { format: CATALOG_FORMAT, schemaVersion: CATALOG_SCHEMA_VERSION, items },
				errors: []
			};
}

/**
 * Build the ordered GLO upsert plan for a preset. Pure: no store, no I/O.
 * Order matters — categories/units/modifier groups exist before products
 * reference them.
 */
export function planPresetApplication(
	preset: CatalogPreset,
	options: { currency?: string } = {}
): PresetApplicationPlan {
	const categoryIdByKey = new Map<string, string>();
	const unitIdByKey = new Map<string, string>();
	const groupIdByKey = new Map<string, string>();

	const categories: PresetApplicationPlan['categories'] = preset.categories.map((category) => {
		const id = presetRecordId(preset.id, 'category', category.key);
		categoryIdByKey.set(category.key, id);
		const data: Category = {
			name: category.name,
			description: category.description,
			sortOrder: category.sortOrder,
			status: 'active'
		};
		return { id, data };
	});

	const units: PresetApplicationPlan['units'] = preset.units.map((unit) => {
		const id = presetRecordId(preset.id, 'unit', unit.key);
		unitIdByKey.set(unit.key, id);
		const data: Unit = {
			name: unit.name,
			symbol: unit.symbol ?? unit.abbreviation ?? unit.name,
			type: unit.type ?? 'count',
			isDefault: unit.isDefault === true
		};
		return { id, data };
	});

	const modifierGroups: PresetApplicationPlan['modifierGroups'] = preset.modifierGroups.map(
		(group) => {
			const id = presetRecordId(preset.id, 'modifier-group', group.key);
			groupIdByKey.set(group.key, id);
			const data: ModifierGroup = {
				name: group.name,
				selectionType: group.selectionType ?? 'single',
				singleChoice: group.selectionType !== 'multiple',
				required: group.required === true,
				minSelections: group.minSelections,
				maxSelections: group.maxSelections,
				modifiers: (group.modifiers ?? []).map((option) => ({
					name: option.name,
					priceAdjustment: option.priceAdjustment ?? 0,
					price: option.priceAdjustment ?? 0,
					isDefault: option.isDefault === true
				})),
				status: 'active'
			};
			return { id, data };
		}
	);

	const currency = options.currency ?? preset.currency;
	const products: PresetApplicationPlan['products'] = preset.products.map((product) => {
		const id = presetRecordId(preset.id, 'product', product.key);
		const data: Product = {
			name: product.name,
			description: product.description,
			sku: product.sku,
			barcode: product.barcode,
			categoryId: product.categoryKey ? categoryIdByKey.get(product.categoryKey) : undefined,
			unitId: product.unitKey ? unitIdByKey.get(product.unitKey) : undefined,
			price: product.price ?? preset.defaultPrice ?? 0,
			currency: product.currency ?? currency,
			images: product.images,
			tags: product.tags,
			modifierGroupIds: (product.modifierGroupKeys ?? [])
				.map((key) => groupIdByKey.get(key))
				.filter((value): value is string => Boolean(value)),
			sortOrder: product.sortOrder,
			status: 'active',
			available: true,
			isPublic: false,
			type: 'standard',
			trackInventory: true,
			taxable: true
		};
		return { id, data };
	});

	return { categories, units, modifierGroups, products };
}

/**
 * Apply a preset through an injected `upsert`. Validates first, then seeds
 * categories → units → modifier groups → products. Returns honest counts.
 */
export async function applyCatalogPreset(
	preset: unknown,
	upsert: GloUpsert,
	options: { currency?: string } = {}
): Promise<PresetApplyResult> {
	const parsed = parseCatalogPreset(preset);
	if (!parsed.ok) {
		return {
			ok: false,
			errors: parsed.errors,
			counts: { categories: 0, units: 0, modifierGroups: 0, products: 0 }
		};
	}
	const plan = planPresetApplication(parsed.data, options);
	// Keep the dependency order between groups, but write each group with
	// bounded concurrency so a large kit doesn't flood the relay queue.
	const batchSize = 8;
	await mapLimit(plan.categories, batchSize, (record) =>
		Promise.resolve(upsert(TYPE.category, record.data, { id: record.id }))
	);
	await mapLimit(plan.units, batchSize, (record) =>
		Promise.resolve(upsert(TYPE.unit, record.data, { id: record.id }))
	);
	await mapLimit(plan.modifierGroups, batchSize, (record) =>
		Promise.resolve(upsert(TYPE.modifierGroup, record.data, { id: record.id }))
	);
	await mapLimit(plan.products, batchSize, (record) =>
		Promise.resolve(upsert(TYPE.product, record.data, { id: record.id }))
	);
	return {
		ok: true,
		errors: [],
		counts: {
			categories: plan.categories.length,
			units: plan.units.length,
			modifierGroups: plan.modifierGroups.length,
			products: plan.products.length
		}
	};
}
