/**
 * Map async tasks with a bounded concurrency. Results keep input order, which
 * makes this safe for bulk local writes that should not flood relays at once.
 */
export async function mapLimit<T, R>(
	items: readonly T[],
	limit: number,
	task: (item: T, index: number) => Promise<R>
): Promise<R[]> {
	if (limit <= 0) throw new Error('mapLimit: limit must be positive');
	const results = new Array<R>(items.length);
	let next = 0;

	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (true) {
			const index = next++;
			if (index >= items.length) return;
			results[index] = await task(items[index]!, index);
		}
	});

	await Promise.all(workers);
	return results;
}
