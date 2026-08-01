/**
 * Nostr kind registry — re-exported from @bitos/bnos-core so the app has a
 * single import surface. bdGo OS maps every domain object to a parameterized
 * replaceable kind (30xxx). See bnos-core `events/kinds` + `glo/kinds`.
 */
export {
	NOSTR_KINDS,
	getKindName,
	getKindNames,
	getKindLifecycle,
	isAddressableKind,
	isReplaceableKind,
	type NostrKind
} from '@bitos/bnos-core';

export {
	GLO_KINDS,
	GLO_KIND_BY_TYPE,
	GLO_OBJECT_KINDS,
	getGloKindForType,
	getEventLifecycle as getGloEventLifecycle,
	type GloKind
} from '@bitos/bnos-core/glo';
