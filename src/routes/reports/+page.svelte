<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { glo } from '$nostr/store.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { formatMoney, formatInt } from '$lib/utils/format';
	import type { GloOrder, GloProduct } from '@bitos/bnos-core/glo';

	onMount(() => {
		glo.hydrate('commerce.order');
		glo.hydrate('catalog.product');
	});

	const orders = $derived(glo.all<GloOrder, 'commerce.order'>('commerce.order'));
	const products = $derived(glo.all<GloProduct, 'catalog.product'>('catalog.product'));
	const currency = $derived(tenant.state.currency);

	// last 7 days revenue
	const last7 = $derived.by(() => {
		const days: { label: string; total: number }[] = [];
		const now = new Date();
		for (let i = 6; i >= 0; i--) {
			const d = new Date(now);
			d.setHours(0, 0, 0, 0);
			d.setDate(d.getDate() - i);
			const start = d.getTime();
			const end = start + 86_400_000;
			const total = orders
				.filter((o) => {
					const t = new Date(o.data.occurredAt || 0).getTime();
					return t >= start && t < end;
				})
				.reduce((s, o) => s + (o.data.total ?? 0), 0);
			days.push({ label: d.toLocaleDateString('en-US', { weekday: 'short' }), total });
		}
		return days;
	});
	const maxDay = $derived(Math.max(1, ...last7.map((d) => d.total)));

	// top products by quantity sold
	const topProducts = $derived.by(() => {
		const qty = new Map<string, number>();
		for (const o of orders)
			for (const l of o.data.lines ?? []) {
				qty.set(l.productId ?? l.name, (qty.get(l.productId ?? l.name) ?? 0) + l.quantity);
			}
		return [...qty.entries()]
			.map(([id, count]) => {
				const p = products.find((x) => x.id === id);
				return { name: p?.data.name ?? id, count };
			})
			.sort((a, b) => b.count - a.count)
			.slice(0, 5);
	});
	const maxQty = $derived(Math.max(1, ...topProducts.map((p) => p.count)));
	const totalRevenue = $derived(orders.reduce((s, o) => s + (o.data.total ?? 0), 0));
</script>

<svelte:head><title>bdGo OS · Reports</title></svelte:head>

<div class="space-y-4">
	<div>
		<h1 class="font-display text-xl font-bold tracking-tight">Reports</h1>
		<p class="text-[12.5px] text-[var(--ui-text-muted)]">Derived live from signed order records</p>
	</div>

	<div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
		<!-- 7-day revenue -->
		<div class="surface-card p-5">
			<div class="mb-4 flex items-center justify-between">
				<h2 class="font-display text-[15px] font-semibold tracking-tight">Revenue · last 7 days</h2>
				<span class="font-display text-lg font-bold tabular-nums text-primary-600 dark:text-primary-400">
					{formatMoney(last7.reduce((s, d) => s + d.total, 0), currency)}
				</span>
			</div>
			<div class="flex h-40 items-end justify-between gap-2">
				{#each last7 as day (day.label)}
					<div class="flex flex-1 flex-col items-center gap-1.5">
						<div
							class="w-full rounded-t-md bg-gradient-to-t from-primary-500/40 to-primary-500 transition-all"
							style="height: {Math.max(4, (day.total / maxDay) * 140)}px"
							title={formatMoney(day.total, currency)}
						></div>
						<span class="text-[10.5px] font-semibold text-[var(--ui-text-dimmed)]">{day.label}</span>
					</div>
				{/each}
			</div>
		</div>

		<!-- Top products -->
		<div class="surface-card p-5">
			<h2 class="mb-4 font-display text-[15px] font-semibold tracking-tight">Top products</h2>
			{#if topProducts.length === 0}
				<div class="flex h-40 flex-col items-center justify-center gap-2 text-center text-[12.5px] text-[var(--ui-text-dimmed)]">
					<Icon name="lucide:chart-no-axes-column" class="size-6" />
					Sell a few orders to see best sellers here.
				</div>
			{:else}
				<ul class="space-y-3">
					{#each topProducts as p (p.name)}
						<li>
							<div class="mb-1 flex items-center justify-between text-[13px]">
								<span class="truncate font-semibold">{p.name}</span>
								<span class="tabular-nums text-[var(--ui-text-muted)]">{formatInt(p.count)} sold</span>
							</div>
							<div class="h-2 overflow-hidden rounded-full bg-[var(--ui-bg-accented)]">
								<div class="h-full rounded-full bg-primary-500" style="width: {(p.count / maxQty) * 100}%"></div>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</div>

	<div class="accent-bar surface-card p-5">
		<div class="flex items-center gap-3">
			<Icon name="lucide:trending-up" class="size-5 text-primary-500" />
			<div>
				<div class="text-[12px] font-semibold text-[var(--ui-text-muted)]">Total revenue (all time)</div>
				<div class="font-display text-2xl font-bold tabular-nums">{formatMoney(totalRevenue, currency)}</div>
			</div>
		</div>
	</div>
</div>
