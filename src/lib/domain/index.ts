/**
 * bnos-svelte domain model — bdgo-os's core type system, standardized on the
 * GLO data model (`@bitos/bnos-core/glo`).
 *
 * - `kind.ts`   — object-type ↔ Nostr-kind registry (authoritative, derived).
 * - `types.ts`  — canonical GLO types widened with the full bdgo-os field set.
 * - `helpers.ts`— build/read GLO objects with the `org.bitos.bnos` extension.
 * - `meta.ts`   — status colors + expense categories (view layer).
 *
 * See `FIELDS.md` for the field-by-field coverage audit of every bdgo-os
 * entity against the GLO canonical model.
 */
export * from './kind';
export * from './types';
export * from './helpers';
export * from './meta';
export * from './order-sources';
