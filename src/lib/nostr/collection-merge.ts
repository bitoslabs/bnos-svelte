/**
 * Merge local mutations made while IndexedDB hydration was still in flight
 * with the stored snapshot. Local writes win, and removed IDs stay removed —
 * without this, a fast upsert before hydration completes would be overwritten
 * (or persist an incomplete collection).
 */
export function mergeHydratedCollection<T extends { id: string }>(
	local: readonly T[],
	loaded: readonly T[],
	removed: Readonly<Record<string, true>> = {}
): T[] {
	const byId: Record<string, T> = {};
	for (const obj of loaded) byId[obj.id] = obj;
	for (const id of Object.keys(removed)) delete byId[id];
	for (const obj of local) byId[obj.id] = obj;
	return Object.values(byId);
}
