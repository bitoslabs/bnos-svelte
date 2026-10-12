import { describe, expect, it } from 'vitest';
import {
	CATALOG_KIT_KIND,
	CATALOG_KIT_TAG,
	kitToBrowseItem,
	latestActiveCatalogKits,
	parseCatalogKitEvent,
	type RawNostrEvent
} from './catalog-kit';

const PRESET = {
	format: 'bnos.catalog-preset',
	schemaVersion: 1,
	id: 'relay-kit',
	name: 'Relay kit',
	categories: [{ key: 'drinks', name: 'Drinks' }],
	units: [{ key: 'piece', name: 'Piece', abbreviation: 'pc' }],
	modifierGroups: [],
	products: [{ key: 'coffee', name: 'Coffee', categoryKey: 'drinks', unitKey: 'piece', price: 2500 }]
};

const PUBKEY = 'a'.repeat(64);

const event = (overrides: Partial<RawNostrEvent> = {}): RawNostrEvent => ({
	kind: CATALOG_KIT_KIND,
	pubkey: PUBKEY,
	created_at: 100,
	tags: [
		['d', 'relay-kit'],
		['t', CATALOG_KIT_TAG],
		['status', 'active'],
		['v', '1']
	],
	content: JSON.stringify(PRESET),
	...overrides
});

describe('parseCatalogKitEvent', () => {
	it('reads a valid active kit', () => {
		const kit = parseCatalogKitEvent(event());
		expect(kit?.kitId).toBe('relay-kit');
		expect(kit?.status).toBe('active');
		expect(kit?.preset?.products).toHaveLength(1);
	});

	it('uses the centrally allocated kind', () => {
		expect(CATALOG_KIT_KIND).toBe(30956);
	});

	it('rejects foreign or malformed events', () => {
		expect(parseCatalogKitEvent(event({ kind: 1 }))).toBeNull();
		expect(parseCatalogKitEvent(event({ tags: [['d', 'relay-kit']] }))).toBeNull();
		expect(parseCatalogKitEvent(event({ tags: [['t', CATALOG_KIT_TAG]] }))).toBeNull();
		expect(parseCatalogKitEvent(event({ pubkey: 'nope' }))).toBeNull();
		expect(
			parseCatalogKitEvent(
				event({ tags: [['d', 'x'], ['t', CATALOG_KIT_TAG], ['status', 'bogus']] })
			)
		).toBeNull();
		expect(parseCatalogKitEvent(event({ content: 'not json' }))).toBeNull();
		expect(parseCatalogKitEvent(event({ content: '{"format":"x"}' }))).toBeNull();
	});

	it('parses a withdrawal without requiring a preset body', () => {
		const kit = parseCatalogKitEvent(
			event({ tags: [['d', 'relay-kit'], ['t', CATALOG_KIT_TAG], ['status', 'withdrawn']], content: '{}' })
		);
		expect(kit?.status).toBe('withdrawn');
		expect(kit?.preset).toBeNull();
	});
});

describe('latestActiveCatalogKits', () => {
	it('keeps the newest event per author+kit and drops withdrawn', () => {
		const older = event({ created_at: 100 });
		const newer = event({ created_at: 200 });
		const withdrawn = event({
			created_at: 300,
			tags: [['d', 'relay-kit'], ['t', CATALOG_KIT_TAG], ['status', 'withdrawn']],
			content: '{}'
		});
		expect(latestActiveCatalogKits([older, newer])).toHaveLength(1);
		expect(latestActiveCatalogKits([older, newer, withdrawn])).toHaveLength(0);

		const otherAuthor = event({ pubkey: 'b'.repeat(64), created_at: 150 });
		expect(latestActiveCatalogKits([newer, otherAuthor])).toHaveLength(2);
	});

	it('maps a kit to the shared browse-item shape', () => {
		const [kit] = latestActiveCatalogKits([event()]);
		const item = kitToBrowseItem(kit);
		expect(item.presetId).toBe('relay-kit');
		expect(item.productId.startsWith('relay:')).toBe(true);
		expect(item.counts).toEqual({ categories: 1, units: 1, modifierGroups: 0, products: 1 });
		expect(item.publisher).toContain('…');
	});
});
