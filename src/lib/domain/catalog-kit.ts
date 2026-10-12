/**
 * Relay-discovered BNOS catalog kits (kind 30956).
 *
 * The templates Studio publishes a kit as a signed, addressable event whose
 * content is a `bnos.catalog-preset` document. The event envelope (kind, d/t/
 * status tags, content parsing, addressable dedupe) is owned by
 * `@bitos/bnos-core`; this module adds the console's preset-schema validation
 * and maps kits to the shared browse shape the URL/paste sources use.
 *
 * Pure: it takes raw events and returns parsed kits; relay I/O stays in caller.
 */
import {
	CATALOG_KIT_KIND as CORE_CATALOG_KIT_KIND,
	CATALOG_KIT_TYPE_TAG,
	parseCatalogKitEvent as parseCoreCatalogKitEvent,
	type NostrEvent
} from '@bitos/bnos-core';
import { parseCatalogPreset, type BrowseCatalogItem, type CatalogPreset } from './catalog-preset';

export const CATALOG_KIT_KIND = CORE_CATALOG_KIT_KIND;
export const CATALOG_KIT_TAG = CATALOG_KIT_TYPE_TAG;

export interface RelayCatalogKit {
	kitId: string;
	pubkey: string;
	status: 'active' | 'withdrawn';
	preset: CatalogPreset | null;
	createdAt: number;
}

export interface RawNostrEvent {
	kind?: number;
	pubkey?: string;
	created_at?: number;
	tags?: string[][];
	content?: string;
	id?: string;
	sig?: string;
}

/**
 * Validate a relay event: the core contract for the envelope, then the
 * `bnos.catalog-preset` schema for an active kit's content.
 */
export function parseCatalogKitEvent(event: RawNostrEvent): RelayCatalogKit | null {
	const base = parseCoreCatalogKitEvent(event as NostrEvent);
	if (!base) return null;
	if (base.status !== 'active') {
		return { ...base, preset: null };
	}
	const parsed = parseCatalogPreset(base.preset);
	if (!parsed.ok) return null;
	return { ...base, preset: parsed.data };
}

/** Newest event per (pubkey, kitId), then keep valid active kits only. */
export function latestActiveCatalogKits(events: RawNostrEvent[]): RelayCatalogKit[] {
	const byKey = new Map<string, RelayCatalogKit>();
	for (const event of events ?? []) {
		const parsed = parseCatalogKitEvent(event);
		if (!parsed) continue;
		const key = `${parsed.pubkey}:${parsed.kitId}`;
		const current = byKey.get(key);
		if (!current || parsed.createdAt > current.createdAt) byKey.set(key, parsed);
	}
	return [...byKey.values()].filter((kit) => kit.status === 'active' && kit.preset);
}

/** Shape a relay kit as a browse item (same type the URL/paste sources produce). */
export function kitToBrowseItem(kit: RelayCatalogKit, publisherLabel?: string): BrowseCatalogItem {
	const preset = kit.preset;
	if (!preset) throw new Error('Cannot map a withdrawal to a browse item.');
	return {
		presetId: preset.id,
		productId: `relay:${kit.pubkey.slice(0, 8)}:${kit.kitId}`,
		name: preset.name,
		summary: preset.summary,
		publisher: publisherLabel ?? `${kit.pubkey.slice(0, 10)}…${kit.pubkey.slice(-6)}`,
		version: '1.0.0',
		targetApp: 'bnos',
		counts: {
			categories: preset.categories.length,
			units: preset.units.length,
			modifierGroups: preset.modifierGroups.length,
			products: preset.products.length
		},
		preset
	};
}
