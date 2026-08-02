import { glo } from '$nostr/store.svelte';
import { TYPE } from '$lib/domain';
import { toast } from '$lib/stores/toast.svelte';

export function createProductActions() {
	async function adjustStock(
		productId: string,
		direction: 'increase' | 'decrease',
		qty: number,
		reason: string
	) {
		const product = glo.get(TYPE.product, productId);
		if (!product) return;
		await glo.upsert(TYPE.adjustment, {
			productId,
			productName: String((product.data as Record<string, unknown>).name ?? 'Unknown'),
			type: direction,
			quantity: Math.abs(qty),
			reason: reason || 'Manual adjustment',
			occurredAt: new Date().toISOString()
		});
		const current = ((product.data as Record<string, unknown>).stockLevel ?? 0) as number;
		const newStock =
			direction === 'increase' ? current + Math.abs(qty) : Math.max(0, current - Math.abs(qty));
		await glo.upsert(
			TYPE.product,
			{ ...(product.data as Record<string, unknown>), stockLevel: newStock },
			{ id: product.id }
		);
		toast.success('Stock adjusted');
	}

	async function toggleAvailability(productId: string) {
		const product = glo.get(TYPE.product, productId);
		if (!product) return;
		await glo.upsert(
			TYPE.product,
			{
				...(product.data as Record<string, unknown>),
				isAvailable: !((product.data as Record<string, unknown>).isAvailable ?? false)
			},
			{ id: product.id }
		);
	}

	async function duplicate(productId: string) {
		const product = glo.get(TYPE.product, productId);
		if (!product) return;
		const data = { ...(product.data as Record<string, unknown>) };
		data.name = String(data.name ?? 'Product') + ' (copy)';
		data.stockLevel = 0;
		await glo.upsert(TYPE.product, data);
		toast.success('Product duplicated');
	}

	return { adjustStock, toggleAvailability, duplicate };
}
