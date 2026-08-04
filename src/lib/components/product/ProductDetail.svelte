<script lang="ts">
	import Slideover from '$lib/components/ui/Slideover.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import StockBadge from '$lib/components/ui/StockBadge.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { glo } from '$nostr/store.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { TYPE, type StockAdjustment, type Order } from '$lib/domain';
	import { formatMoney, relativeTime } from '$lib/utils/format';

	let {
		product = $bindable(),
		open = $bindable(false)
	}: {
		product: { id: string; data: Record<string, unknown> } | null;
		open: boolean;
	} = $props();

	type DetailTab = 'overview' | 'stock' | 'orders';
	let detailTab = $state<DetailTab>('overview');

	const currency = $derived(tenant.state.currency);

	const d = $derived(product?.data ?? null);

	// Build a de-duplicated image list: `images[]` with a legacy single
	// `image` promoted to the front for backward compatibility.
	const images = $derived.by(() => {
		if (!d) return [];
		const arr = Array.isArray((d as { images?: unknown }).images)
			? ((d as { images?: string[] }).images as string[])
			: [];
		const single = (d as { image?: string }).image ? String((d as { image?: string }).image) : null;
		const all = single && !arr.includes(single) ? [single, ...arr] : [...arr];
		return all.filter(Boolean);
	});

	let activeImageIdx = $state(0);
	// Reset the active thumbnail when the viewed product changes.
	$effect(() => {
		void product?.id;
		activeImageIdx = 0;
	});

	const stockHistory = $derived(
		product
			? glo
					.all<StockAdjustment, typeof TYPE.adjustment>(TYPE.adjustment)
					.filter((a) => a.data.productId === product.id)
					.sort((a, b) => new Date(b.data.occurredAt ?? 0).getTime() - new Date(a.data.occurredAt ?? 0).getTime())
			: []
	);

	const orderHistory = $derived(
		product
			? glo
					.all<Order, typeof TYPE.order>(TYPE.order)
					.filter((o) => {
						const lines = (o.data as Record<string, unknown>).lines ?? [];
						return Array.isArray(lines) && lines.some((l: Record<string, unknown>) => l.productId === product.id);
					})
					.slice(0, 20)
			: []
	);

	function catName(id: string): string {
		const c = glo.get(TYPE.category, id);
		return (c?.data as Record<string, unknown> | undefined)?.name as string ?? id;
	}

	function unitName(id: string): string {
		const u = glo.get(TYPE.unit, id);
		return (u?.data as Record<string, unknown> | undefined)?.symbol as string ?? id;
	}
</script>

<Slideover bind:open title="Product detail" subtitle={d?.name ? String(d.name) : undefined} width="w-[30rem]">
	{#if d}
		<!-- Tabs -->
		<div class="segmented inline-flex w-fit gap-1 p-1 mx-5 mt-4">
			<button
				type="button"
				onclick={() => (detailTab = 'overview')}
				class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-semibold transition-colors {detailTab === 'overview' ? 'bg-[var(--ui-bg-elevated)] text-[var(--ui-text)] shadow-sm' : 'text-[var(--ui-text-muted)]'}"
			>
				<Icon name="lucide:info" class="size-3.5" />Overview
			</button>
			<button
				type="button"
				onclick={() => (detailTab = 'stock')}
				class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-semibold transition-colors {detailTab === 'stock' ? 'bg-[var(--ui-bg-elevated)] text-[var(--ui-text)] shadow-sm' : 'text-[var(--ui-text-muted)]'}"
			>
				<Icon name="lucide:history" class="size-3.5" />Stock history
			</button>
			<button
				type="button"
				onclick={() => (detailTab = 'orders')}
				class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-semibold transition-colors {detailTab === 'orders' ? 'bg-[var(--ui-bg-elevated)] text-[var(--ui-text)] shadow-sm' : 'text-[var(--ui-text-muted)]'}"
			>
				<Icon name="lucide:receipt" class="size-3.5" />Orders
			</button>
		</div>

		<!-- Overview tab -->
		{#if detailTab === 'overview'}
			<div class="space-y-4 px-5 py-4">
				<!-- Image gallery -->
				{#if images.length > 0}
					{@const ai = images[Math.min(activeImageIdx, images.length - 1)]}
					<div class="space-y-2">
						<div class="relative aspect-video w-full overflow-hidden rounded-xl bg-[var(--ui-bg-muted)]">
							<img src={ai} alt={String(d.name ?? '')} class="h-full w-full object-cover" />
							{#if images.length > 1}
								<span class="absolute right-2 bottom-2 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
									{Math.min(activeImageIdx, images.length - 1) + 1}/{images.length}
								</span>
							{/if}
						</div>
						{#if images.length > 1}
							<div class="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
								{#each images as img, i (img + '-' + i)}
									<button
										type="button"
										onclick={() => (activeImageIdx = i)}
										class="size-12 shrink-0 overflow-hidden rounded-lg border-2 transition-all {Math.min(activeImageIdx, images.length - 1) === i ? 'border-primary-500' : 'border-transparent opacity-70 hover:opacity-100'}"
									>
										<img src={img} alt={`View ${i + 1}`} class="h-full w-full object-cover" loading="lazy" />
									</button>
								{/each}
							</div>
						{/if}
					</div>
				{/if}

				<!-- Basic info -->
				<div class="space-y-2">
					<div class="flex items-center gap-2">
						<h3 class="font-display text-[16px] font-bold tracking-tight">{d.name ?? 'Unnamed product'}</h3>
					</div>
					<div class="flex flex-wrap gap-1.5">
						{#if d.isPublic !== false}
							<Badge color="primary"><Icon name="lucide:globe" class="size-2.5" />Public</Badge>
						{:else}
							<Badge color="neutral"><Icon name="lucide:lock" class="size-2.5" />Private</Badge>
						{/if}
						{#if d.available !== false}
							<Badge color="success">Available</Badge>
						{:else}
							<Badge color="error">Unavailable</Badge>
						{/if}
						{#if d.trackInventory}
							<Badge color="info">Track inventory</Badge>
						{/if}
					</div>
				</div>

				<!-- Price section -->
				<div class="grid grid-cols-3 gap-3 rounded-lg bg-[var(--ui-bg-accented)] p-3">
					<div>
						<p class="text-[10.5px] text-[var(--ui-text-dimmed)]">Price</p>
						<p class="font-bold tabular-nums">{formatMoney(Number(d.price ?? 0), (d.currency as string) ?? currency)}</p>
					</div>
					<div>
						<p class="text-[10.5px] text-[var(--ui-text-dimmed)]">Cost</p>
						<p class="font-semibold tabular-nums">{d.costPrice != null ? formatMoney(Number(d.costPrice), (d.currency as string) ?? currency) : '—'}</p>
					</div>
					<div>
						<p class="text-[10.5px] text-[var(--ui-text-dimmed)]">Compare-at</p>
						<p class="font-semibold tabular-nums">{d.compareAtPrice != null ? formatMoney(Number(d.compareAtPrice), (d.currency as string) ?? currency) : '—'}</p>
					</div>
				</div>

				<!-- Stock level -->
				{#if d.trackInventory}
					<div class="flex items-center justify-between rounded-lg border border-[var(--ui-border-muted)] p-3">
						<span class="text-[12px] font-semibold text-[var(--ui-text-muted)]">Stock level</span>
						<StockBadge level={Number(d.stockLevel ?? 0)} threshold={Number((d.inventory as Record<string, unknown> | undefined)?.lowStockThreshold ?? 5)} />
					</div>
				{/if}

				<!-- Details grid -->
				<div class="grid grid-cols-2 gap-x-4 gap-y-3 text-[12.5px]">
					{#if d.sku}
						<div><span class="text-[var(--ui-text-dimmed)]">SKU</span><p class="font-mono font-semibold">{d.sku}</p></div>
					{/if}
					{#if d.barcode}
						<div><span class="text-[var(--ui-text-dimmed)]">Barcode</span><p class="font-mono font-semibold">{d.barcode}</p></div>
					{/if}
					{#if d.categoryId}
						<div><span class="text-[var(--ui-text-dimmed)]">Category</span><p class="font-semibold">{catName(String(d.categoryId))}</p></div>
					{/if}
					{#if d.unitId}
						<div><span class="text-[var(--ui-text-dimmed)]">Unit</span><p class="font-semibold">{unitName(String(d.unitId))}</p></div>
					{/if}
					{#if d.prepTime != null}
						<div><span class="text-[var(--ui-text-dimmed)]">Prep time</span><p class="font-semibold">{d.prepTime} min</p></div>
					{/if}
					{#if d.sortOrder != null}
						<div><span class="text-[var(--ui-text-dimmed)]">Sort order</span><p class="font-semibold tabular-nums">{d.sortOrder}</p></div>
					{/if}
				</div>

				<!-- Tags -->
				{#if Array.isArray(d.tags) && d.tags.length > 0}
					<div>
						<span class="text-[11px] font-semibold text-[var(--ui-text-muted)]">Tags</span>
						<div class="mt-1 flex flex-wrap gap-1">
							{#each d.tags as tag}
								<Badge color="neutral">{tag}</Badge>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Description -->
				{#if d.description}
					<div>
						<span class="text-[11px] font-semibold text-[var(--ui-text-muted)]">Description</span>
						<p class="mt-1 text-[12.5px] leading-relaxed text-[var(--ui-text)]">{d.description}</p>
					</div>
				{/if}

				<!-- Variants -->
				{#if Array.isArray(d.variants) && d.variants.length > 0}
					<div>
						<span class="text-[11px] font-semibold text-[var(--ui-text-muted)]">Variants ({d.variants.length})</span>
						<ul class="mt-1 space-y-1">
							{#each d.variants as v}
								<li class="flex items-center justify-between rounded-lg border border-[var(--ui-border-muted)] px-2.5 py-1.5 text-[12px]">
									<span class="font-semibold">{v.name}</span>
									<span class="tabular-nums text-[var(--ui-text-muted)]">{v.priceModifier ?? 0}</span>
								</li>
							{/each}
						</ul>
					</div>
				{/if}
			</div>
		{:else if detailTab === 'stock'}
			<!-- Stock history timeline -->
			<div class="px-5 py-4">
				{#if stockHistory.length === 0}
					<div class="py-8 text-center text-[12px] text-[var(--ui-text-dimmed)]">
						<Icon name="lucide:package-x" class="mx-auto mb-2 size-8 opacity-50" />
						No stock adjustments recorded
					</div>
				{:else}
					<div class="space-y-0">
						{#each stockHistory as item}
							<div class="flex items-start gap-3 pb-4 border-l-2 border-[var(--ui-border-muted)] pl-4 ml-2 relative">
								<div class="absolute -left-[7px] top-0 size-3.5 rounded-full border-2 border-[var(--surface-bg)] {item.data.type === 'increase' ? 'bg-emerald-500' : 'bg-rose-500'}"></div>
								<div class="flex-1 min-w-0">
									<div class="flex items-center gap-2">
										<span class="text-[13px] font-bold">{item.data.type === 'increase' ? '↑ Stock in' : '↓ Stock out'}</span>
										<span class="text-[12px] font-semibold text-[var(--ui-text-muted)]">{item.data.quantity}</span>
									</div>
									<p class="text-[11.5px] text-[var(--ui-text-dimmed)]">{item.data.reason ?? 'No reason'}</p>
									<p class="text-[11px] text-[var(--ui-text-dimmed)]">{relativeTime(item.data.occurredAt ?? '')}</p>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{:else if detailTab === 'orders'}
			<!-- Order history -->
			<div class="px-5 py-4">
				{#if orderHistory.length === 0}
					<div class="py-8 text-center text-[12px] text-[var(--ui-text-dimmed)]">
						<Icon name="lucide:receipt" class="mx-auto mb-2 size-8 opacity-50" />
						No orders containing this product
					</div>
				{:else}
					<ul class="space-y-2">
						{#each orderHistory as order}
							{@const lines = (order.data as Record<string, unknown>).lines as Array<Record<string, unknown>> | undefined}
							{@const matchingLines = Array.isArray(lines) ? lines.filter((l) => l.productId === product?.id) : []}
							{@const qty = matchingLines.reduce((sum, l) => sum + Number(l.quantity ?? 0), 0)}
							{@const total = matchingLines.reduce((sum, l) => sum + Number(l.total ?? l.lineTotal ?? 0), 0)}
							<li class="flex items-center justify-between rounded-lg border border-[var(--ui-border-muted)] px-3 py-2">
								<div class="min-w-0">
									<span class="font-semibold text-[12.5px]">#{(order.data as Record<string, unknown>).orderNumber ?? order.id.slice(0, 8)}</span>
									<span class="ml-2 text-[11px] text-[var(--ui-text-dimmed)]">{relativeTime((order.data as Record<string, unknown>).createdAt as string ?? '')}</span>
								</div>
								<div class="flex items-center gap-3 text-right">
									<span class="text-[11px] text-[var(--ui-text-muted)]">Qty: <span class="font-semibold tabular-nums">{qty}</span></span>
									<span class="text-[12px] font-bold tabular-nums">{formatMoney(total, (order.data as Record<string, unknown>).currency as string ?? currency)}</span>
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/if}
	{:else}
		<div class="py-12 text-center text-[12px] text-[var(--ui-text-dimmed)]">No product selected</div>
	{/if}
</Slideover>
