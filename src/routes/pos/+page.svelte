<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { glo } from '$nostr/store.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatMoney } from '$lib/utils/format';
	import type { GloProduct, GloOrder, GloOrderLine, GloObject } from '@bitos/bnos-core/glo';
	import type { DashboardOrder } from '$lib/dashboard/metrics';

	onMount(() => {
		glo.hydrate('catalog.product');
		glo.hydrate('commerce.order');
		void glo.sync('catalog.product');
	});

	const products = $derived(glo.all<GloProduct, 'catalog.product'>('catalog.product'));
	const currency = $derived(tenant.state.currency);

	let query = $state('');
	let activeCat = $state<string>('all');

	const categories = $derived.by(() => {
		const set = new Set<string>();
		for (const p of products) if (p.data.categoryId) set.add(p.data.categoryId);
		return ['all', ...set];
	});

	const filtered = $derived(
		products.filter((p) => {
			const matchesCat = activeCat === 'all' || p.data.categoryId === activeCat;
			const q = query.trim().toLowerCase();
			const matchesQuery = !q || (p.data.name ?? '').toLowerCase().includes(q);
			return matchesCat && matchesQuery && p.data.status !== 'inactive';
		})
	);

	type CartLine = { productId: string; name: string; unitPrice: number; qty: number };
	let cart = $state<CartLine[]>([]);

	function addToCart(p: GloObject<GloProduct, 'catalog.product'>) {
		const line = cart.find((c) => c.productId === p.id);
		if (line) line.qty += 1;
		else cart = [...cart, { productId: p.id, name: p.data.name, unitPrice: p.data.price ?? 0, qty: 1 }];
	}
	function inc(id: string) {
		const l = cart.find((c) => c.productId === id);
		if (l) l.qty += 1;
	}
	function dec(id: string) {
		const l = cart.find((c) => c.productId === id);
		if (!l) return;
		if (l.qty <= 1) cart = cart.filter((c) => c.productId !== id);
		else l.qty -= 1;
	}
	function clearCart() {
		cart = [];
	}

	const subtotal = $derived(cart.reduce((s, l) => s + l.unitPrice * l.qty, 0));
	const taxRate = tenant.state.defaultTaxRate / 100;
	const taxIncluded = $derived(tenant.state.taxIncludedInPrice);
	// When prices are tax-inclusive, subtotal already contains tax; split it out.
	const tax = $derived(
		taxIncluded ? Math.round(subtotal - subtotal / (1 + taxRate)) : Math.round(subtotal * taxRate)
	);
	const total = $derived(taxIncluded ? subtotal : subtotal + tax);
	const itemCount = $derived(cart.reduce((s, l) => s + l.qty, 0));

	let tendered = $state(0);
	let method = $state<'cash' | 'card' | 'qr' | 'lightning'>('cash');
	let processing = $state(false);
	const change = $derived(Math.max(0, tendered - total));

	async function checkout() {
		if (!cart.length) return;
		processing = true;
		try {
			const lines: GloOrderLine[] = cart.map((l) => ({
				id: l.productId,
				productId: l.productId,
				name: l.name,
				quantity: l.qty,
				unitPrice: l.unitPrice,
				total: l.unitPrice * l.qty
			}));
			const order: DashboardOrder = {
				number: 'ORD-' + Date.now().toString().slice(-6),
				status: 'paid',
				currency,
				lines,
				subtotal,
				tax,
				total,
				paymentStatus: 'paid',
				fulfillmentType: 'pos',
				method,
				occurredAt: new Date().toISOString()
			};
			await glo.upsert<GloOrder>('commerce.order', order);
			toast.success('Sale complete', `${formatMoney(total, currency)} · ${order.number}`);
			clearCart();
			tendered = 0;
			method = 'cash';
		} catch (e) {
			toast.error('Checkout failed', e instanceof Error ? e.message : undefined);
		} finally {
			processing = false;
		}
	}
</script>

<svelte:head><title>bdGo OS · Point of Sale</title></svelte:head>

<div class="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_22rem] xl:grid-cols-[1fr_26rem]">
	<!-- Product browser -->
	<section class="flex min-h-0 flex-col">
		<div class="mb-3 flex flex-wrap items-center gap-2">
			<Input bind:value={query} icon="lucide:search" placeholder="Search products…" class="min-w-[14rem] flex-1" />
		</div>
		<div class="no-scrollbar mb-3 flex gap-1.5 overflow-x-auto pb-1">
			{#each categories as cat (cat)}
				<button
					type="button"
					onclick={() => (activeCat = cat)}
					class="shrink-0 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold capitalize transition-colors {activeCat ===
					cat
						? 'bg-primary-500 text-white'
						: 'bg-[var(--ui-bg-muted)] text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)]'}"
				>
					{cat}
				</button>
			{/each}
		</div>

		{#if filtered.length === 0}
			<EmptyState
				icon="lucide:package"
				title="No products"
				description="Add products in Catalog, or seed samples from Setup → Catalog to start selling."
			>
				{#snippet actions()}
					<Button color="primary" size="sm" icon="lucide:plus" href="/catalog">Add product</Button>
				{/snippet}
			</EmptyState>
		{:else}
			<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
				{#each filtered as p (p.id)}
					<button
						type="button"
						onclick={() => addToCart(p)}
						class="surface-card group flex flex-col gap-2 p-3 text-left transition-all hover:-translate-y-0.5 hover:border-primary-500/40 active:translate-y-0"
					>
						<div class="grid aspect-square w-full place-items-center rounded-lg bg-[var(--ui-bg-accented)] text-[var(--ui-text-dimmed)]">
							<Icon name="lucide:cup-soda" class="size-7" />
						</div>
						<div class="min-w-0">
							<div class="truncate text-[13px] font-semibold">{p.data.name}</div>
							<div class="text-[12px] font-bold text-primary-600 dark:text-primary-400">
								{formatMoney(p.data.price ?? 0, p.data.currency ?? currency)}
							</div>
						</div>
					</button>
				{/each}
			</div>
		{/if}
	</section>

	<!-- Cart -->
	<aside class="surface-card flex h-fit flex-col lg:sticky lg:top-20">
		<header class="flex items-center justify-between border-b border-[var(--ui-border-muted)] px-4 py-3">
			<div class="flex items-center gap-2">
				<Icon name="lucide:shopping-cart" class="size-4 text-primary-500" />
				<h2 class="font-display text-[15px] font-semibold tracking-tight">Current sale</h2>
				{#if itemCount}<Badge color="primary">{itemCount}</Badge>{/if}
			</div>
			{#if cart.length}
				<button
					type="button"
					class="text-[11.5px] font-semibold text-[var(--tone-error-text)] hover:underline"
					onclick={clearCart}>Clear</button
				>
			{/if}
		</header>

		{#if cart.length === 0}
			<div class="px-4 py-10 text-center text-[12.5px] text-[var(--ui-text-dimmed)]">
				Tap a product to start a sale.
			</div>
		{:else}
			<ul class="max-h-[40vh] divide-y divide-[var(--ui-border-muted)] overflow-y-auto lg:max-h-[36vh]">
				{#each cart as line (line.productId)}
					<li class="flex items-center gap-2 px-4 py-2.5">
						<div class="min-w-0 flex-1">
							<div class="truncate text-[13px] font-semibold">{line.name}</div>
							<div class="text-[11.5px] text-[var(--ui-text-dimmed)]">
								{formatMoney(line.unitPrice, currency)} each
							</div>
						</div>
						<div class="flex items-center gap-1">
							<button
								type="button"
								onclick={() => dec(line.productId)}
								class="grid size-6 place-items-center rounded-md bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]"
								aria-label="Decrease"
							>
								<Icon name="lucide:minus" class="size-3.5" />
							</button>
							<span class="w-6 text-center text-[13px] font-semibold tabular-nums">{line.qty}</span>
							<button
								type="button"
								onclick={() => inc(line.productId)}
								class="grid size-6 place-items-center rounded-md bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]"
								aria-label="Increase"
							>
								<Icon name="lucide:plus" class="size-3.5" />
							</button>
						</div>
						<div class="w-20 text-right text-[13px] font-semibold tabular-nums">
							{formatMoney(line.unitPrice * line.qty, currency)}
						</div>
					</li>
				{/each}
			</ul>

			<!-- Totals -->
			<div class="space-y-1.5 border-t border-[var(--ui-border-muted)] px-4 py-3 text-[13px]">
				<div class="flex justify-between text-[var(--ui-text-muted)]">
					<span>Subtotal</span><span class="tabular-nums">{formatMoney(subtotal, currency)}</span>
				</div>
				<div class="flex justify-between text-[var(--ui-text-muted)]">
					<span>Tax ({tenant.state.defaultTaxRate}%{taxIncluded ? ', incl.' : ''})</span
					><span class="tabular-nums">{formatMoney(tax, currency)}</span>
				</div>
				<div class="flex justify-between pt-1 font-display text-[17px] font-bold">
					<span>Total</span><span class="tabular-nums text-primary-600 dark:text-primary-400">{formatMoney(total, currency)}</span>
				</div>
			</div>

			<!-- Tender -->
			<div class="space-y-2 border-t border-[var(--ui-border-muted)] px-4 py-3">
				<div class="grid grid-cols-4 gap-1.5">
					{#each [['cash', 'lucide:banknote'], ['card', 'lucide:credit-card'], ['qr', 'lucide:qr-code'], ['lightning', 'lucide:zap']] as [m, ico] (m)}
						<button
							type="button"
							onclick={() => (method = m as typeof method)}
							class="flex flex-col items-center gap-0.5 rounded-lg border py-1.5 text-[10.5px] font-semibold capitalize transition-colors {method === m ? 'border-primary-500 bg-primary-500/10 text-primary-600 dark:text-primary-300' : 'border-[var(--ui-border)] text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)]'}"
						>
							<Icon name={ico} class="size-4" />
							{m}
						</button>
					{/each}
				</div>
				<Input
					bind:value={tendered}
					type="number"
					icon="lucide:banknote"
					placeholder="Amount tendered"
					min="0"
					step="0.01"
				/>
				{#if tendered > 0}
					<div class="flex justify-between text-[12.5px]">
						<span class="text-[var(--ui-text-muted)]">Change</span>
						<span class="font-semibold tabular-nums">{formatMoney(change, currency)}</span>
					</div>
				{/if}
				<Button color="primary" block size="lg" disabled={processing} onclick={checkout}>
					{#if processing}
						<Icon name="lucide:loader-circle" class="size-4 animate-spin" /> Processing…
					{:else}
						<Icon name="lucide:check-circle" class="size-4" /> Charge {formatMoney(total, currency)}
					{/if}
				</Button>
			</div>
		{/if}
	</aside>
</div>
