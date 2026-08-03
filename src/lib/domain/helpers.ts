/**
 * GLO object build/read helpers.
 *
 * The bnos-svelte client stores every record as a GLO object whose `data`
 * carries the canonical fields plus the bdgo-os extension fields. Per the
 * GLO spec, vendor-only fields should also ride under a reverse-domain
 * extension key. `objectFor` does both: it puts the full standardized payload
 * in `data` (so the UI has flat field access) and mirrors the bdgo-only subset
 * under `extensions[BNOS_EXT_KEY]` for cross-client discoverability.
 */
import {
	createGloObject,
	createGloEventTemplate,
	createGloFilter,
	isGloObject,
	parseGloEvent,
	type GloObject,
	type GloObjectType,
	type GloVisibility
} from '@bitos/bnos-core/glo';
import { getGloKindForType } from '@bitos/bnos-core/glo';
import type { GloScope } from '@bitos/bnos-core/glo';

import { TYPE, type DomainType, type DomainTypeValue } from './kind';

/** Reverse-domain extension namespace for bdgo-os / bnos-svelte vendor fields. */
export const BNOS_EXT_KEY = 'org.bitos.bnos';

export { createGloEventTemplate, createGloFilter, isGloObject, parseGloEvent };

export interface BuildObjectOptions {
	id?: string;
	visibility?: GloVisibility;
	scope?: GloScope;
	/** Extra extension namespaces beyond `org.bitos.bnos`. */
	extensions?: Record<string, unknown>;
	client?: string;
}

/**
 * Build a standardized GLO object for a client type. `data` is typed by the
 * caller through the generic so each entity keeps its full field set.
 */
export function objectFor<TData>(
	type: DomainTypeValue | string,
	data: TData,
	opts: BuildObjectOptions = {}
): GloObject<TData, string> {
	return createGloObject<TData, string>({
		type,
		id: opts.id ?? uid(),
		scope: opts.scope ?? {},
		visibility: opts.visibility ?? 'organization',
		data,
		extensions: {
			[BNOS_EXT_KEY]: { client: opts.client ?? 'bnos-svelte' },
			...(opts.extensions ?? {})
		} as never
	});
}

/** Extract the canonical `data` payload from a GLO object (typed by caller). */
export function dataOf<TData>(object: GloObject<unknown>): TData {
	return object.data as TData;
}

/** Read the `org.bitos.bnos` extension namespace (vendor metadata). */
export function bnosExt(object: GloObject<unknown>): Record<string, unknown> | undefined {
	const ext = object.extensions?.[BNOS_EXT_KEY];
	return ext && typeof ext === 'object' ? (ext as Record<string, unknown>) : undefined;
}

/** The Nostr kind a given client type resolves to (via the standard map). */
export function kindOf(type: DomainTypeValue | string): number {
	return getGloKindForType(type);
}

/** Convenience: the full list of client types (for "sync everything"). */
export const ALL_TYPES: DomainTypeValue[] = Object.values(TYPE);

function uid(): string {
	if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
		return crypto.randomUUID();
	}
	return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
