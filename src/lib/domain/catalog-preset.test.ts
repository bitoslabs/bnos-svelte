import { describe, expect, it, vi } from 'vitest';
import {
	CATALOG_FORMAT,
	PRESET_FORMAT,
	applyCatalogPreset,
	parseBrowseCatalog,
	parseCatalogPreset,
	planPresetApplication,
	presetRecordId,
	slug
} from './catalog-preset';
import { TYPE } from './kind';

const preset = {
	format: PRESET_FORMAT,
	schemaVersion: 1,
	id: 'sats-shop-starter',
	name: 'Sats Shop Starter',
	currency: 'SATS',
	source: { app: 'templates', productId: 'sats-shop' },
	categories: [{ key: 'drinks', name: 'Drinks', sortOrder: 1 }],
	units: [{ key: 'piece', name: 'Piece', abbreviation: 'pc', type: 'count', isDefault: true }],
	modifierGroups: [
		{
			key: 'milk',
			name: 'Milk',
			selectionType: 'single',
			modifiers: [
				{ name: 'Whole', priceAdjustment: 0, isDefault: true },
				{ name: 'Oat', priceAdjustment: 1000 }
			]
		}
	],
	products: [
		{
			key: 'latte',
			name: 'Latte',
			categoryKey: 'drinks',
			unitKey: 'piece',
			price: 5500,
			tags: ['coffee'],
			modifierGroupKeys: ['milk']
		}
	]
};

const catalog = {
	format: CATALOG_FORMAT,
	schemaVersion: 1,
	generatedAt: '2026-01-01T00:00:00.000Z',
	count: 1,
	items: [
		{
			presetId: 'sats-shop-starter',
			productId: 'sats-shop',
			name: 'Sats Shop',
			summary: 'A small counter shop',
			publisher: 'okto',
			version: '1.0.3',
			license: 'Commercial',
			priceSats: 21000,
			targetApp: 'bnos',
			counts: { categories: 1, units: 1, modifierGroups: 1, products: 1 },
			preset
		}
	]
};

describe('parseCatalogPreset', () => {
	it('accepts a well-formed preset', () => {
		const result = parseCatalogPreset(preset);
		expect(result.ok).toBe(true);
		expect(result.data?.id).toBe('sats-shop-starter');
		expect(result.data?.products).toHaveLength(1);
	});

	it('rejects wrong format, schema and empty products', () => {
		expect(parseCatalogPreset({ ...preset, format: 'x' }).ok).toBe(false);
		expect(parseCatalogPreset({ ...preset, schemaVersion: 9 }).ok).toBe(false);
		expect(parseCatalogPreset({ ...preset, products: [] }).ok).toBe(false);
	});

	it('rejects undeclared refs and duplicate keys', () => {
		const broken = {
			...preset,
			products: [{ ...preset.products[0], categoryKey: 'ghost', modifierGroupKeys: ['ghost'] }]
		};
		const result = parseCatalogPreset(broken);
		expect(result.ok).toBe(false);
		expect(result.errors.some((e) => e.includes('categoryKey'))).toBe(true);
		expect(result.errors.some((e) => e.includes('modifierGroupKeys'))).toBe(true);

		const dupes = { ...preset, products: [preset.products[0], { ...preset.products[0] }] };
		expect(parseCatalogPreset(dupes).ok).toBe(false);
	});
});

describe('parseBrowseCatalog', () => {
	it('accepts the producer document and counts entries', () => {
		const result = parseBrowseCatalog(JSON.parse(JSON.stringify(catalog)));
		expect(result.ok).toBe(true);
		expect(result.data?.items).toHaveLength(1);
		expect(result.data?.items[0].counts).toEqual({
			categories: 1,
			units: 1,
			modifierGroups: 1,
			products: 1
		});
	});

	it('rejects foreign documents and embedded bad presets', () => {
		expect(parseBrowseCatalog({ format: 'x', schemaVersion: 1, items: [] }).ok).toBe(false);
		const bad = { ...catalog, items: [{ preset: { format: 'x' } }] };
		expect(parseBrowseCatalog(bad).ok).toBe(false);
	});
});

describe('preset record ids', () => {
	it('are deterministic and namespaced', () => {
		expect(presetRecordId('Sats Shop Starter', 'product', 'Latte')).toBe(
			'preset:sats-shop-starter:product:latte'
		);
		expect(presetRecordId('sats-shop-starter', 'product', 'latte')).toBe(
			presetRecordId('Sats Shop Starter', 'product', 'Latte')
		);
		expect(slug('  Hello, World!  ')).toBe('hello-world');
	});
});

describe('planPresetApplication', () => {
	it('resolves category, unit and modifier links through seeded ids', () => {
		const plan = planPresetApplication(parseCatalogPreset(preset).data!);
		const categoryId = plan.categories[0].id;
		const unitId = plan.units[0].id;
		const groupId = plan.modifierGroups[0].id;
		expect(plan.products[0].data.categoryId).toBe(categoryId);
		expect(plan.products[0].data.unitId).toBe(unitId);
		expect(plan.products[0].data.modifierGroupIds).toEqual([groupId]);
		expect(plan.products[0].data.price).toBe(5500);
		expect(plan.products[0].data.status).toBe('active');
	});

	it('falls back to the preset defaultPrice for products without a price', () => {
		const withDefault = {
			...preset,
			defaultPrice: 7000,
			products: [{ ...preset.products[0], price: undefined }]
		};
		const parsed = parseCatalogPreset(withDefault);
		expect(parsed.ok).toBe(true);
		const plan = planPresetApplication(parsed.data!);
		expect(plan.products[0].data.price).toBe(7000);
		// An explicit price still wins over the default.
		const explicit = planPresetApplication(parseCatalogPreset(preset).data!);
		expect(explicit.products[0].data.price).toBe(5500);
	});

	it('rejects a negative defaultPrice', () => {
		expect(parseCatalogPreset({ ...preset, defaultPrice: -1 }).ok).toBe(false);
	});

	it('falls back to the preset currency and honors an override', () => {
		const parsed = parseCatalogPreset(preset).data!;
		expect(planPresetApplication(parsed).products[0].data.currency).toBe('SATS');
		expect(planPresetApplication(parsed, { currency: 'THB' }).products[0].data.currency).toBe(
			'THB'
		);
	});
});

describe('applyCatalogPreset', () => {
	it('seeds in dependency order and is idempotent across re-applies', async () => {
		const calls: Array<{ type: string; id: string }> = [];
		const upsert = vi.fn(async (type: string, _data: unknown, options: { id: string }) => {
			calls.push({ type, id: options.id });
		});

		const first = await applyCatalogPreset(preset, upsert);
		expect(first.ok).toBe(true);
		expect(first.counts).toEqual({ categories: 1, units: 1, modifierGroups: 1, products: 1 });
		expect(calls.map((c) => c.type)).toEqual([
			TYPE.category,
			TYPE.unit,
			TYPE.modifierGroup,
			TYPE.product
		]);

		calls.length = 0;
		await applyCatalogPreset(preset, upsert);
		expect(calls.map((c) => c.id)).toEqual([
			presetRecordId(preset.id, 'category', 'drinks'),
			presetRecordId(preset.id, 'unit', 'piece'),
			presetRecordId(preset.id, 'modifier-group', 'milk'),
			presetRecordId(preset.id, 'product', 'latte')
		]);
	});

	it('does not touch the store when the preset is invalid', async () => {
		const upsert = vi.fn();
		const result = await applyCatalogPreset({ format: 'x' }, upsert);
		expect(result.ok).toBe(false);
		expect(upsert).not.toHaveBeenCalled();
	});
});
