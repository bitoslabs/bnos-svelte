import { describe, expect, it } from 'vitest';
import {
	BUILTIN_CATALOG_JSON,
	BUILTIN_TEMPLATES,
	builtinCatalogItems,
	builtinTemplateForBusinessType
} from './builtin-presets';

describe('built-in catalog presets', () => {
	it('parses through the shared browser-catalog contract', () => {
		const items = builtinCatalogItems();
		expect(items).toHaveLength(BUILTIN_TEMPLATES.length);
		for (const item of items) {
			expect(item.presetId).toBe(item.preset.id);
			expect(item.publisher).toBe('Built-in');
			expect(item.counts.products).toBeGreaterThan(0);
			expect(item.counts.categories).toBeGreaterThan(0);
		}
	});

	it('ships café and noodle-shop kits with modifier groups', () => {
		const byId = new Map(BUILTIN_TEMPLATES.map((t) => [t.preset.id, t]));
		const cafe = byId.get('builtin-cafe');
		const noodle = byId.get('builtin-noodle-shop');

		expect(cafe).toBeDefined();
		expect(cafe?.preset.categories.map((c) => c.name)).toContain('Hot Coffee');
		expect(cafe?.preset.products.map((p) => p.name)).toContain('Latte');
		expect(cafe?.preset.modifierGroups.map((g) => g.key)).toContain('size');

		expect(noodle).toBeDefined();
		expect(noodle?.preset.products.map((p) => p.name)).toContain('Beef Noodle Soup');
		expect(noodle?.preset.modifierGroups.map((g) => g.key)).toContain('noodle-type');
		expect(noodle?.preset.modifierGroups.map((g) => g.key)).toContain('protein');
	});

	it('uses unique ids and keys throughout', () => {
		const seenIds = new Set<string>();
		for (const template of BUILTIN_TEMPLATES) {
			expect(seenIds.has(template.preset.id)).toBe(false);
			seenIds.add(template.preset.id);

			for (const [label, entries] of [
				['categories', template.preset.categories],
				['units', template.preset.units],
				['modifierGroups', template.preset.modifierGroups],
				['products', template.preset.products]
			] as const) {
				const keys = entries.map((entry) => entry.key);
				expect(new Set(keys).size, `${template.preset.id} ${label}`).toBe(keys.length);
			}
		}
	});

	it('recommends a kit for every business type', () => {
		expect(builtinTemplateForBusinessType('cafe')?.preset.id).toBe('builtin-cafe');
		expect(builtinTemplateForBusinessType('noodle')?.preset.id).toBe('builtin-noodle-shop');
		expect(builtinTemplateForBusinessType('restaurant')?.preset.id).toBe('builtin-restaurant');
		expect(builtinTemplateForBusinessType('retail')?.preset.id).toBe('builtin-retail-mini-mart');
		expect(builtinTemplateForBusinessType('unknown')?.preset.id).toBe('builtin-retail-mini-mart');
	});

	it('exports a bnos-presets shaped document', () => {
		expect(BUILTIN_CATALOG_JSON.format).toBe('bnos.catalog-catalog');
		expect(BUILTIN_CATALOG_JSON.schemaVersion).toBe(1);
		expect(BUILTIN_CATALOG_JSON.items).toHaveLength(BUILTIN_TEMPLATES.length);
	});
});
