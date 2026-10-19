/** Build a lowercased searchable string per record id, once per collection
 *  change instead of on every keystroke. */
export function buildSearchIndex<T extends { id: string }>(
	items: readonly T[],
	text: (item: T) => string
): Record<string, string> {
	const index: Record<string, string> = {};
	for (const item of items) index[item.id] = text(item).toLowerCase();
	return index;
}

/**
 * Keep the highest-scoring items without sorting the full candidate set.
 * Negative scores are discarded (the fuzzy matcher uses -1 for "no match").
 */
export function topScored<T>(items: Iterable<T>, limit: number, score: (item: T) => number): T[] {
	if (limit <= 0) return [];
	const best: { item: T; score: number }[] = [];

	for (const item of items) {
		const value = score(item);
		if (value < 0) continue;
		const last = best[best.length - 1];
		if (best.length === limit && last && value <= last.score) continue;

		let index = best.length;
		while (index > 0 && best[index - 1]!.score < value) index--;
		best.splice(index, 0, { item, score: value });
		if (best.length > limit) best.pop();
	}

	return best.map((entry) => entry.item);
}
