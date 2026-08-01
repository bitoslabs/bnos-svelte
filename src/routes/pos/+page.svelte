<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Menu from '$lib/components/ui/Menu.svelte';
	import MenuItem from '$lib/components/ui/MenuItem.svelte';
	import MenuDivider from '$lib/components/ui/MenuDivider.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { glo } from '$nostr/store.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatInt, formatMoney } from '$lib/utils/format';
	import {
		TYPE,
		type Product,
		type ProductVariant,
		type ModifierGroup,
		type GloObject
	} from '$lib/domain';
	import { cart, type OrderType, type CartModifier } from '$lib/pos/cart.svelte';
	import { computeStock, availableFor, canSell } from '$lib/pos/stock';

	let now = $state(new Date());

	onMount(() => {
		glo.hydrate(TYPE.product);
		glo.hydrate(TYPE.category);
		glo.hydrate(TYPE.modifierGroup);
		glo.hydrate(TYPE.adjustment);
		void glo.syncAll([TYPE.product, TYPE.category, TYPE.modifierGroup, TYPE.adjustment]);

		const timer = window.setInterval(() => {
			now = new Date();
		}, 60_000);

		return () => window.clearInterval(timer);
	});

	const currency = $derived(tenant.state.currency);
	const products = $derived(glo.all<Product, typeof TYPE.product>(TYPE.product));
	const modifiers = $derived(glo.all<ModifierGroup, typeof TYPE.modifierGroup>(TYPE.modifierGroup));
	const branchId = $derived(tenant.state.locationId ?? undefined);
	const stockMap = $derived(computeStock(glo.all(TYPE.adjustment), branchId));

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
			const sellable = p.data.status !== 'inactive' && p.data.status !== 'archived';
			return matchesCat && matchesQuery && sellable;
		})
	);
	const trackedProducts = $derived(products.filter((p) => p.data.trackInventory).length);
	const lowStockCount = $derived(
		products.filter((p) => {
			const threshold = p.data.inventory?.lowStockThreshold ?? 0;
			return p.data.trackInventory && threshold > 0 && availableFor(stockMap, p.id) <= threshold;
		}).length
	);
	const clockLabel = $derived(
		new Intl.DateTimeFormat('en-US', {
			hour: 'numeric',
			minute: '2-digit'
		}).format(now)
	);
	const dateLabel = $derived(
		new Intl.DateTimeFormat('en-US', {
			weekday: 'short',
			month: 'short',
			day: 'numeric'
		}).format(now)
	);

	// ── product → modifier groups resolver ──
	function groupsFor(p: Product): ModifierGroup[] {
		const ids = p.modifierGroupIds ?? [];
		if (!ids.length) return [];
		return modifiers.filter((m) => m.data && ids.includes(m.id)).map((m) => m.data);
	}
	function variants(p: Product) {
		return p.variants ?? [];
	}

	// ── selection modals ──
	type SelProduct = { obj: GloObject<Product, typeof TYPE.product>; data: Product };
	let sizeSel = $state<SelProduct | null>(null);
	let modSel = $state<SelProduct | null>(null);
	let chosenVariant = $state<string>('');
	let chosenMods = $state<Record<string, Set<string>>>({});
	let pendingNote = $state('');
	let pendingModVariant: { variantId: string; variantName: string; unitPrice: number } | null =
		null;

	function variantPrice(base: number, v: ProductVariant): number {
		if (!v) return base;
		return v.priceModifierType === 'relative'
			? base * (1 + (v.priceModifier ?? 0) / 100)
			: base + (v.priceModifier ?? 0);
	}

	function tapProduct(p: GloObject<Product, typeof TYPE.product>) {
		const data = p.data;
		if (variants(data).length) {
			sizeSel = { obj: p, data };
			chosenVariant = '';
			pendingNote = '';
			return;
		}
		if (groupsFor(data).length) {
			modSel = { obj: p, data };
			chosenMods = {};
			pendingNote = '';
			return;
		}
		addPlain(p);
	}

	function addPlain(p: GloObject<Product, typeof TYPE.product>) {
		const d = p.data;
		const available = availableFor(stockMap, p.id);
		const check = canSell({
			trackInventory: d.trackInventory,
			denySaleWhenOutOfStock: d.inventory?.denySaleWhenOutOfStock,
			allowBackorder: d.inventory?.allowBackorder,
			available,
			requested: 1
		});
		if (!check.ok) return toast.warning(check.reason);
		cart.add({ productId: p.id, name: d.name, unitPrice: d.price ?? 0 });
	}

	function confirmVariant() {
		if (!sizeSel) return;
		const v = variants(sizeSel.data).find((x) => x.id === chosenVariant);
		if (!v) return toast.warning('Pick a size');
		const price = variantPrice(sizeSel.data.price ?? 0, v);
		const available = availableFor(stockMap, sizeSel.obj.id, v.id);
		const check = canSell({
			trackInventory: sizeSel.data.trackInventory,
			denySaleWhenOutOfStock: sizeSel.data.inventory?.denySaleWhenOutOfStock,
			allowBackorder: sizeSel.data.inventory?.allowBackorder,
			available,
			requested: 1
		});
		if (!check.ok) return toast.warning(check.reason);
		const obj = sizeSel.obj;
		const variantId = v.id;
		const variantName = v.name;
		sizeSel = null;
		if (groupsFor(obj.data).length) {
			modSel = { obj, data: obj.data };
			chosenMods = {};
			pendingModVariant = { variantId, variantName, unitPrice: price };
			return;
		}
		cart.add({ productId: obj.id, name: obj.data.name, unitPrice: price, variantId, variantName });
	}

	function selectedModifierList(): CartModifier[] {
		if (!modSel) return [];
		const out: CartModifier[] = [];
		for (const g of groupsFor(modSel.data)) {
			const picked = chosenMods[g.name ?? ''] ?? new Set<string>();
			for (const opt of g.modifiers ?? g.options ?? []) {
				if (picked.has(opt.name)) {
					out.push({
						groupId: g.name,
						modifierId: opt.id ?? opt.name,
						name: opt.name,
						priceAdjustment: opt.priceAdjustment ?? opt.price ?? 0
					});
				}
			}
		}
		return out;
	}

	function toggleMod(group: string, name: string, single: boolean) {
		const set = new Set(chosenMods[group] ?? []);
		if (set.has(name)) set.delete(name);
		else {
			if (single) set.clear();
			set.add(name);
		}
		chosenMods = { ...chosenMods, [group]: set };
	}

	function confirmModifiers() {
		if (!modSel) return;
		const mods = selectedModifierList();
		const ctx = pendingModVariant;
		pendingModVariant = null;
		const obj = modSel.obj;
		modSel = null;
		cart.add({
			productId: obj.id,
			name: obj.data.name,
			unitPrice: ctx?.unitPrice ?? obj.data.price ?? 0,
			variantId: ctx?.variantId,
			variantName: ctx?.variantName,
			modifiers: mods.length ? mods : undefined,
			note: pendingNote.trim() || undefined
		});
		pendingNote = '';
	}

	// ── checkout ──
	let method = $state<'cash' | 'card' | 'qr' | 'lightning'>('cash');
	let tendered = $state<number | ''>('');
	let processing = $state(false);
	const change = $derived(
		Math.max(0, (typeof tendered === 'number' ? tendered : 0) - cart.totals.total)
	);

	async function checkout() {
		if (cart.isEmpty) return;
		processing = true;
		try {
			const sale = await cart.checkout(method, typeof tendered === 'number' ? tendered : 0);
			if (sale) {
				toast.success(
					'Sale complete',
					`${formatMoney(sale.totals.total, currency)} · ${sale.number}`
				);
				tendered = '';
				cartOpen = false;
				receiptOpen = true;
			}
		} catch (e) {
			toast.error('Checkout failed', e instanceof Error ? e.message : undefined);
		} finally {
			processing = false;
		}
	}

	// ── mobile cart panel + line note ──
	let cartOpen = $state(false);
	let noteOpen = $state(false);
	let noteKey = $state<string | null>(null);
	let noteText = $state('');
	// Auto-close the mobile panel when the cart empties (checkout / hold / clear).
	$effect(() => {
		if (cart.isEmpty) cartOpen = false;
	});
	function openNote(key: string) {
		const l = cart.items.find((i) => i.key === key);
		noteKey = key;
		noteText = l?.note ?? '';
		noteOpen = true;
	}
	function saveNote() {
		if (noteKey) cart.setNote(noteKey, noteText.trim());
		noteOpen = false;
		noteKey = null;
	}

	// ── discount modal ──
	let discountOpen = $state(false);
	let dType = $state<'percent' | 'fixed'>('percent');
	let dValue = $state<number | ''>('');
	function applyDiscount() {
		cart.setDiscount({
			type: dType,
			value: typeof dValue === 'number' ? dValue : Number(dValue) || 0
		});
		discountOpen = false;
	}

	// ── held orders + receipt modals ──
	let heldOpen = $state(false);
	let receiptOpen = $state(false);

	const orderTypes: { value: OrderType; label: string; icon: string }[] = [
		{ value: 'takeaway', label: 'Takeaway', icon: 'lucide:shopping-bag' },
		{ value: 'dine_in', label: 'Dine-in', icon: 'lucide:utensils' },
		{ value: 'delivery', label: 'Delivery', icon: 'lucide:bike' },
		{ value: 'pickup', label: 'Pickup', icon: 'lucide:package' }
	];
	const payMethods: ['cash', 'card', 'qr', 'lightning'] = ['cash', 'card', 'qr', 'lightning'];
	const payIcon: Record<string, string> = {
		cash: 'lucide:banknote',
		card: 'lucide:credit-card',
		qr: 'lucide:qr-code',
		lightning: 'lucide:zap'
	};

	function startNewSale() {
		if (cart.isEmpty) return;
		cart.clear();
		toast.info('Started a new sale');
	}
</script>

<svelte:head><title>BNOS · Point of Sale</title></svelte:head>

<div class="flex h-dvh min-h-0 flex-col overflow-hidden bg-[var(--ui-bg)]">
	<header class="app-chrome border-b border-[var(--glass-border)] px-4 py-3 sm:px-5 lg:px-6">
		<div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
			<div class="flex min-w-0 items-center gap-3">
				<a
					href="/"
					aria-label="Back to dashboard"
					class="grid size-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-primary-400 to-primary-600 text-white shadow-sm shadow-primary-500/25"
				>
					<Icon name="lucide:scan-line" class="size-5" />
				</a>
				<div class="min-w-0">
					<div class="flex items-center gap-2">
						<h1 class="font-display text-lg font-bold tracking-tight sm:text-xl">POS Terminal</h1>
						<Badge color={cart.isEmpty ? 'neutral' : 'primary'}>
							{cart.isEmpty ? 'Ready' : `${cart.itemCount} items`}
						</Badge>
					</div>
					<p class="truncate text-[12.5px] text-[var(--ui-text-muted)]">
						{tenant.state.organizationName || 'BNOS'} · {tenant.state.locationName || 'Main branch'} ·
						{dateLabel} · {clockLabel}
					</p>
				</div>
			</div>

			<div class="flex flex-wrap items-center gap-2">
				<Badge color={lowStockCount > 0 ? 'warning' : 'success'}>
					<Icon name="lucide:boxes" class="size-3.5" />
					{formatInt(trackedProducts)} tracked
				</Badge>
				{#if lowStockCount > 0}
					<Badge color="warning">
						<Icon name="lucide:triangle-alert" class="size-3.5" />
						{lowStockCount} low stock
					</Badge>
				{/if}
				{#if cart.lastCompleted}
					<Button
						color="neutral"
						variant="subtle"
						size="sm"
						icon="lucide:receipt"
						onclick={() => (receiptOpen = true)}
					>
						Last receipt
					</Button>
				{/if}
				<Button
					color="neutral"
					variant="subtle"
					size="sm"
					icon="lucide:list-ordered"
					href="/orders"
				>
					Orders
				</Button>
				<Button color="neutral" variant="subtle" size="sm" icon="lucide:package" href="/catalog">
					Catalog
				</Button>
				<Button
					color="neutral"
					variant="subtle"
					size="sm"
					icon="lucide:pause"
					onclick={() => (heldOpen = true)}
				>
					Held ({cart.held.length})
				</Button>
				<Button
					color="neutral"
					variant="soft"
					size="sm"
					icon="lucide:badge-plus"
					disabled={cart.isEmpty}
					onclick={startNewSale}
				>
					New sale
				</Button>
			</div>
		</div>
	</header>

	<div class="min-h-0 flex-1 overflow-hidden">
		<div
			class="grid h-full min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_26rem]"
		>
			<!-- Product browser -->
			<section class="flex min-h-0 min-w-0 flex-col overflow-hidden">
				<div class="px-4 py-4 sm:px-5 lg:px-6">
					<div class="flex flex-wrap items-center gap-2">
						<Input
							bind:value={query}
							icon="lucide:search"
							placeholder="Search products..."
							class="min-w-[12rem] flex-1"
						/>
						<Button
							color="neutral"
							variant="soft"
							size="sm"
							icon="lucide:funnel"
							onclick={() => (activeCat = 'all')}
						>
							All items
						</Button>
					</div>
					<div class="mt-3 flex flex-wrap items-center justify-between gap-2">
						<div class="no-scrollbar flex gap-1.5 overflow-x-auto pb-1">
							{#each categories as cat (cat)}
								<button
									type="button"
									onclick={() => (activeCat = cat)}
									class="shrink-0 rounded-full px-3 py-1.5 text-[12.5px] font-semibold capitalize transition-colors {activeCat ===
									cat
										? 'bg-primary-500 text-white'
										: 'bg-[var(--ui-bg-muted)] text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)]'}"
								>
									{cat}
								</button>
							{/each}
						</div>
						<div class="flex items-center gap-2 text-[12px] text-[var(--ui-text-dimmed)]">
							<span>{formatInt(filtered.length)} visible</span>
							<span class="h-1 w-1 rounded-full bg-[var(--ui-text-dimmed)]"></span>
							<span>{formatMoney(cart.totals.total, currency)} cart</span>
						</div>
					</div>
				</div>

				<div class="min-h-0 flex-1 overflow-y-auto px-4 pb-4 sm:px-5 sm:pb-5 lg:px-6 lg:pb-6">
					{#if filtered.length === 0}
						<EmptyState
							icon="lucide:package"
							title="No products"
							description="Add products in Catalog, or seed samples from Setup -> Catalog to start selling."
						>
							{#snippet actions()}
								<Button color="primary" size="sm" icon="lucide:plus" href="/catalog"
									>Add product</Button
								>
							{/snippet}
						</EmptyState>
					{:else}
						<div
							class="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-5"
							class:pb-24={!cart.isEmpty}
						>
							{#each filtered as p (p.id)}
								{@const avail = availableFor(stockMap, p.id)}
								{@const lowStock =
									p.data.trackInventory && p.data.inventory?.lowStockThreshold
										? avail <= (p.data.inventory.lowStockThreshold ?? 0)
										: false}
								{@const outOfStock =
									p.data.trackInventory &&
									p.data.inventory?.denySaleWhenOutOfStock &&
									!p.data.inventory.allowBackorder &&
									avail <= 0}
								<button
									type="button"
									onclick={() => tapProduct(p)}
									disabled={outOfStock}
									class="surface-card group relative flex flex-col gap-2 p-2.5 text-left transition-all enabled:hover:-translate-y-0.5 enabled:hover:border-primary-500/40 enabled:active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40"
								>
									<div
										class="relative grid aspect-square w-full place-items-center rounded-xl bg-[var(--ui-bg-accented)] text-[var(--ui-text-dimmed)]"
									>
										<Icon name="lucide:cup-soda" class="size-6 sm:size-7" />
										{#if p.data.variants?.length}
											<span
												class="absolute top-1.5 right-1.5 rounded-full bg-black/45 px-1.5 py-0.5 text-[8.5px] font-bold text-white"
												>{p.data.variants.length} sizes</span
											>
										{:else if groupsFor(p.data).length}
											<span
												class="absolute top-1.5 right-1.5 grid size-4.5 place-items-center rounded-full bg-black/45 text-white"
												><Icon name="lucide:sliders-horizontal" class="size-2.5" /></span
											>
										{/if}
										{#if outOfStock}
											<span
												class="absolute inset-0 grid place-items-center rounded-xl bg-black/40 text-[9px] font-bold tracking-wide text-white uppercase"
												>Sold out</span
											>
										{/if}
									</div>
									<div class="min-w-0">
										<div class="truncate text-[12.5px] font-semibold">{p.data.name}</div>
										<div class="text-[12.5px] font-bold text-primary-600 dark:text-primary-400">
											{formatMoney(p.data.price ?? 0, p.data.currency ?? currency)}
										</div>
										{#if p.data.trackInventory}
											<div
												class="mt-0.5 text-[10px] {lowStock
													? 'text-[var(--tone-warning-text)]'
													: 'text-[var(--ui-text-dimmed)]'}"
											>
												{avail} in stock
											</div>
										{/if}
									</div>
								</button>
							{/each}
						</div>
						{#if !cart.isEmpty}<div class="h-24 lg:hidden"></div>{/if}
					{/if}
				</div>
			</section>

			<!-- Desktop cart sidebar (lg+) -->
			<aside
				class="hidden min-h-0 flex-col overflow-hidden border-l border-[var(--ui-border-muted)] bg-[var(--surface-bg)] lg:flex"
			>
				<header
					class="flex items-center justify-between border-b border-[var(--ui-border-muted)] px-4 py-3"
				>
					<div class="flex items-center gap-2">
						<Icon name="lucide:shopping-cart" class="size-4 text-primary-500" />
						<h2 class="font-display text-[15px] font-semibold tracking-tight">Current sale</h2>
						{#if cart.itemCount}<Badge color="primary">{cart.itemCount}</Badge>{/if}
					</div>
					{#if !cart.isEmpty}
						<button
							type="button"
							class="text-[11.5px] font-semibold text-[var(--tone-error-text)] hover:underline"
							onclick={() => cart.clear()}>Clear</button
						>
					{/if}
				</header>
				{#if cart.isEmpty}
					<div class="px-4 py-10 text-center text-[12.5px] text-[var(--ui-text-dimmed)]">
						Tap a product to start a sale.
					</div>
				{:else}
					<div class="min-h-0 flex-1 overflow-y-auto">
						{@render cartContent()}
					</div>
					{@render tenderBlock()}
				{/if}
			</aside>
		</div>
	</div>
</div>

<!-- Mobile floating "view cart" bar (sits above the bottom tab bar) -->
{#if !cart.isEmpty}
	<div
		class="pointer-events-none fixed inset-x-0 z-40 px-4 lg:hidden"
		style="bottom: calc(1rem + env(safe-area-inset-bottom))"
	>
		<button
			type="button"
			onclick={() => (cartOpen = true)}
			class="pointer-events-auto flex w-full items-center gap-3 rounded-full bg-primary-500 px-4 py-3 text-white shadow-lg shadow-primary-500/30 transition-transform active:scale-[0.98]"
		>
			<span
				class="grid size-6 place-items-center rounded-full bg-white/25 text-[12px] font-bold tabular-nums"
				>{cart.itemCount}</span
			>
			<span class="text-[13px] font-semibold">View cart</span>
			<span class="ml-auto font-display text-[15px] font-bold tabular-nums"
				>{formatMoney(cart.totals.total, currency)}</span
			>
			<Icon name="lucide:chevron-up" class="size-4 opacity-80" />
		</button>
	</div>
{/if}

<!-- Mobile full-page cart panel -->
{#if cartOpen}
	<button
		type="button"
		aria-label="Close cart"
		tabindex="-1"
		class="animate-fade fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px] lg:hidden"
		onclick={() => (cartOpen = false)}
	></button>
	<div
		class="fixed inset-0 z-50 flex flex-col bg-[var(--ui-bg)] lg:hidden"
		role="dialog"
		aria-modal="true"
	>
		<header
			class="app-chrome flex items-center justify-between border-b border-[var(--ui-border-muted)] px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-top))]"
		>
			<div class="flex items-center gap-2">
				<button
					type="button"
					onclick={() => (cartOpen = false)}
					class="grid size-8 place-items-center rounded-lg text-[var(--ui-text-dimmed)] hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]"
					aria-label="Close"
				>
					<Icon name="lucide:x" class="size-4" />
				</button>
				<h2 class="font-display text-[15px] font-semibold tracking-tight">Current sale</h2>
				{#if cart.itemCount}<Badge color="primary">{cart.itemCount}</Badge>{/if}
			</div>
			{#if !cart.isEmpty}
				<button
					type="button"
					class="text-[11.5px] font-semibold text-[var(--tone-error-text)] hover:underline"
					onclick={() => cart.clear()}>Clear</button
				>
			{/if}
		</header>
		<div class="min-h-0 flex-1 overflow-y-auto">
			{@render cartContent()}
		</div>
		<div class="border-t border-[var(--ui-border-muted)] pb-[env(safe-area-inset-bottom)]">
			{@render tenderBlock()}
		</div>
	</div>
{/if}

<!-- ───────────────────────── Snippets (shared by desktop sidebar + mobile panel) ───────────────────────── -->

{#snippet cartContent()}
	<div class="space-y-3 px-4 py-3">
		<ul class="divide-y divide-[var(--ui-border-muted)]">
			{#each cart.items as line (line.key)}
				<li class="py-2.5">
					<div class="flex items-center gap-2">
						<div class="min-w-0 flex-1">
							<div class="truncate text-[13px] font-semibold">
								{line.name}{#if line.variantName}
									<span class="font-normal text-[var(--ui-text-dimmed)]">· {line.variantName}</span
									>{/if}
							</div>
							<div class="text-[11.5px] text-[var(--ui-text-dimmed)]">
								{formatMoney(line.unitPrice, currency)} each{#if line.modifiers?.length}
									· +{formatMoney(
										line.modifiers.reduce((s, m) => s + m.priceAdjustment, 0),
										currency
									)}{/if}
							</div>
							{#if line.note}
								<div class="mt-0.5 text-[11px] text-[var(--ui-text-muted)] italic">
									“{line.note}”
								</div>
							{/if}
						</div>
						<div class="flex items-center gap-1">
							<button
								type="button"
								onclick={() => cart.dec(line.key)}
								class="grid size-7 place-items-center rounded-md bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]"
								aria-label="Decrease"><Icon name="lucide:minus" class="size-3.5" /></button
							>
							<span class="w-6 text-center text-[13px] font-semibold tabular-nums"
								>{line.quantity}</span
							>
							<button
								type="button"
								onclick={() => cart.inc(line.key)}
								class="grid size-7 place-items-center rounded-md bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]"
								aria-label="Increase"><Icon name="lucide:plus" class="size-3.5" /></button
							>
						</div>
						<div class="w-20 text-right text-[13px] font-semibold tabular-nums">
							{formatMoney(cart.lineAmount(line), currency)}
						</div>
					</div>
					<div class="mt-1 flex justify-end">
						<Menu
							id={`cart-line-${line.key}`}
							label="Line actions"
							placement="bottom-end"
							triggerClass="grid size-6 place-items-center rounded-md text-[var(--ui-text-dimmed)] transition-colors hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]"
							triggerActiveClass="bg-[var(--ui-bg-accented)] text-[var(--ui-text)]"
						>
							{#snippet trigger()}<Icon name="lucide:ellipsis" class="size-3.5" />{/snippet}
							<MenuItem icon="lucide:pencil-line" onclick={() => openNote(line.key)}
								>Edit note</MenuItem
							>
							<MenuDivider />
							<MenuItem tone="danger" icon="lucide:trash-2" onclick={() => cart.remove(line.key)}
								>Remove</MenuItem
							>
						</Menu>
					</div>
				</li>
			{/each}
		</ul>

		<!-- order context -->
		<div class="space-y-2 border-t border-[var(--ui-border-muted)] pt-3">
			<div class="grid grid-cols-4 gap-1">
				{#each orderTypes as ot (ot.value)}
					<button
						type="button"
						onclick={() => cart.setOrderType(ot.value)}
						class="flex flex-col items-center gap-0.5 rounded-lg border py-1.5 text-[10px] font-semibold capitalize transition-colors {cart.orderType ===
						ot.value
							? 'border-primary-500 bg-primary-500/10 text-primary-600 dark:text-primary-300'
							: 'border-[var(--ui-border)] text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)]'}"
						><Icon name={ot.icon} class="size-4" />{ot.label.replace('-', ' ')}</button
					>
				{/each}
			</div>
			<Input
				bind:value={cart.customerName}
				icon="lucide:user"
				placeholder="Customer name (optional)"
				class="w-full"
			/>
			{#if cart.orderType === 'dine_in'}
				<div class="grid grid-cols-2 gap-2">
					<Input
						bind:value={cart.tableId}
						icon="lucide:layout-grid"
						placeholder="Table"
						class="w-full"
					/>
					<Input
						type="number"
						min="1"
						value={cart.covers}
						oninput={(e) => cart.setCovers(Number((e.target as HTMLInputElement).value))}
						icon="lucide:users"
						placeholder="Covers"
						class="w-full"
					/>
				</div>
			{/if}
			<button
				type="button"
				onclick={() => {
					dType = cart.discount.type;
					dValue = cart.discount.value || '';
					discountOpen = true;
				}}
				class="flex w-full items-center justify-between rounded-lg border border-dashed border-[var(--ui-border)] px-3 py-1.5 text-[12px] font-semibold text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)]"
			>
				<span><Icon name="lucide:tag" class="mr-1 inline size-3.5" />Discount</span>
				{#if cart.totals.discountAmount > 0}<span class="text-[var(--tone-success-text)]"
						>−{formatMoney(cart.totals.discountAmount, currency)}</span
					>{:else}<span class="text-[var(--ui-text-dimmed)]">None</span>{/if}
			</button>
		</div>

		<!-- totals -->
		<div class="space-y-1.5 border-t border-[var(--ui-border-muted)] pt-3 text-[13px]">
			<div class="flex justify-between text-[var(--ui-text-muted)]">
				<span>Subtotal</span><span class="tabular-nums"
					>{formatMoney(cart.totals.subtotal, currency)}</span
				>
			</div>
			{#if cart.totals.discountAmount > 0}
				<div class="flex justify-between text-[var(--tone-success-text)]">
					<span>Discount</span><span class="tabular-nums"
						>−{formatMoney(cart.totals.discountAmount, currency)}</span
					>
				</div>
			{/if}
			<div class="flex justify-between text-[var(--ui-text-muted)]">
				<span
					>Tax ({tenant.state.defaultTaxRate}%{tenant.state.taxIncludedInPrice
						? ', incl.'
						: ''})</span
				><span class="tabular-nums">{formatMoney(cart.totals.tax, currency)}</span>
			</div>
			<div class="flex justify-between pt-1 font-display text-[17px] font-bold">
				<span>Total</span><span class="text-primary-600 tabular-nums dark:text-primary-400"
					>{formatMoney(cart.totals.total, currency)}</span
				>
			</div>
		</div>
	</div>
{/snippet}

{#snippet tenderBlock()}
	<div class="space-y-2 border-t border-[var(--ui-border-muted)] px-4 py-3">
		<div class="grid grid-cols-4 gap-1.5">
			{#each payMethods as m (m)}
				<button
					type="button"
					onclick={() => (method = m)}
					class="flex flex-col items-center gap-0.5 rounded-lg border py-1.5 text-[10.5px] font-semibold capitalize transition-colors {method ===
					m
						? 'border-primary-500 bg-primary-500/10 text-primary-600 dark:text-primary-300'
						: 'border-[var(--ui-border)] text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)]'}"
					><Icon name={payIcon[m]} class="size-4" />{m}</button
				>
			{/each}
		</div>
		{#if method === 'cash'}
			<Input
				bind:value={tendered}
				type="number"
				icon="lucide:banknote"
				placeholder="Cash tendered"
				min="0"
				step="0.01"
			/>
			{#if typeof tendered === 'number' && tendered > 0}
				<div class="flex justify-between text-[12.5px]">
					<span class="text-[var(--ui-text-muted)]">Change</span><span
						class="font-semibold tabular-nums">{formatMoney(change, currency)}</span
					>
				</div>
			{/if}
			<!-- quick cash buttons -->
			<div class="grid grid-cols-4 gap-1.5">
				{#each [cart.totals.total, Math.ceil(cart.totals.total / 10000) * 10000, 50000, 100000] as quick (quick)}
					<button
						type="button"
						onclick={() => (tendered = quick)}
						class="rounded-lg border border-[var(--ui-border)] py-1.5 text-[11px] font-semibold text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)]"
						>{formatMoney(quick, currency).replace(/\.00$/, '')}</button
					>
				{/each}
			</div>
		{/if}
		<div class="grid grid-cols-2 gap-2">
			<Button
				color="neutral"
				variant="subtle"
				icon="lucide:pause"
				disabled={processing}
				onclick={() => cart.hold()}>Hold</Button
			>
			<Button color="primary" disabled={processing} onclick={checkout}
				>{#if processing}<Icon
						name="lucide:loader-circle"
						class="size-4 animate-spin"
					/>…{:else}<Icon name="lucide:check-circle" class="size-4" />Charge{/if}</Button
			>
		</div>
	</div>
{/snippet}

<!-- Size / variant selector -->
<Dialog open={!!sizeSel} title={sizeSel?.data.name ?? 'Select'} size="sm">
	{#if sizeSel}
		<div class="space-y-2">
			{#each variants(sizeSel.data) as v (v.id)}
				<button
					type="button"
					onclick={() => (chosenVariant = v.id)}
					class="flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left text-[13px] transition-colors {chosenVariant ===
					v.id
						? 'border-primary-500 bg-primary-500/10'
						: 'border-[var(--ui-border)] hover:bg-[var(--ui-bg-accented)]'}"
				>
					<span class="font-semibold">{v.name}</span>
					<span class="font-bold tabular-nums"
						>{formatMoney(variantPrice(sizeSel.data.price ?? 0, v), currency)}</span
					>
				</button>
			{/each}
		</div>
	{/if}
	{#snippet footer()}
		<Button color="neutral" variant="ghost" onclick={() => (sizeSel = null)}>Cancel</Button>
		<Button color="primary" icon="lucide:check" onclick={confirmVariant}>Add</Button>
	{/snippet}
</Dialog>

<!-- Modifier selector -->
<Dialog open={!!modSel} title={modSel?.data.name ?? 'Options'} size="md">
	{#if modSel}
		<div class="space-y-4">
			{#each groupsFor(modSel.data) as g (g.name)}
				<div>
					<div class="mb-1.5 flex items-center justify-between">
						<span class="text-[12.5px] font-semibold">{g.name}</span>
						<span class="text-[10.5px] tracking-wide text-[var(--ui-text-dimmed)] uppercase"
							>{g.selectionType === 'single' || g.singleChoice ? 'pick one' : 'pick any'}{g.required
								? ' · required'
								: ''}</span
						>
					</div>
					<div class="space-y-1.5">
						{#each g.modifiers ?? g.options ?? [] as opt (opt.name)}
							{@const picked = (chosenMods[g.name ?? ''] ?? new Set()).has(opt.name)}
							<button
								type="button"
								onclick={() =>
									toggleMod(
										g.name ?? '',
										opt.name,
										g.selectionType === 'single' || !!g.singleChoice
									)}
								class="flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-[13px] transition-colors {picked
									? 'border-primary-500 bg-primary-500/10'
									: 'border-[var(--ui-border)] hover:bg-[var(--ui-bg-accented)]'}"
							>
								<span class="flex items-center gap-2"
									><span
										class="grid size-4 place-items-center rounded-full border {picked
											? 'border-primary-500 bg-primary-500 text-white'
											: 'border-[var(--ui-border-muted)]'}"
										>{#if picked}<Icon name="lucide:check" class="size-2.5" />{/if}</span
									>{opt.name}</span
								>
								{#if (opt.priceAdjustment ?? opt.price ?? 0) > 0}<span
										class="text-[11.5px] text-[var(--ui-text-muted)]"
										>+{formatMoney(opt.priceAdjustment ?? opt.price ?? 0, currency)}</span
									>{/if}
							</button>
						{/each}
					</div>
				</div>
			{/each}
			<Input
				bind:value={pendingNote}
				icon="lucide:pencil-line"
				placeholder="Line note (e.g. no ice)"
				class="w-full"
			/>
		</div>
	{/if}
	{#snippet footer()}
		<Button
			color="neutral"
			variant="ghost"
			onclick={() => {
				modSel = null;
				pendingModVariant = null;
			}}>Cancel</Button
		>
		<Button color="primary" icon="lucide:check" onclick={confirmModifiers}>Add to sale</Button>
	{/snippet}
</Dialog>

<!-- Line note -->
<Dialog bind:open={noteOpen} title="Line note" size="sm">
	<Input bind:value={noteText} placeholder="e.g. extra hot, no onions" class="w-full" />
	{#snippet footer()}
		<Button color="neutral" variant="ghost" onclick={() => (noteOpen = false)}>Cancel</Button>
		<Button color="primary" icon="lucide:check" onclick={saveNote}>Save</Button>
	{/snippet}
</Dialog>

<!-- Discount -->
<Dialog bind:open={discountOpen} title="Cart discount" size="sm">
	<div class="space-y-3">
		<div class="grid grid-cols-2 gap-2">
			{#each [['percent', 'Percent'], ['fixed', 'Fixed']] as [v, lbl] (v)}
				<button
					type="button"
					onclick={() => (dType = v as 'percent' | 'fixed')}
					class="rounded-lg border py-2 text-[12.5px] font-semibold transition-colors {dType === v
						? 'border-primary-500 bg-primary-500/10 text-primary-600 dark:text-primary-300'
						: 'border-[var(--ui-border)] text-[var(--ui-text-muted)]'}">{lbl}</button
				>
			{/each}
		</div>
		<Input
			bind:value={dValue}
			type="number"
			min="0"
			step="0.01"
			icon="lucide:tag"
			placeholder={dType === 'percent' ? 'Percentage (e.g. 10)' : `Amount in ${currency}`}
			class="w-full"
		/>
		{#if cart.totals.discountAmount > 0}
			<button
				type="button"
				class="text-[11.5px] font-semibold text-[var(--tone-error-text)] hover:underline"
				onclick={() => {
					cart.setDiscount({ type: 'percent', value: 0 });
					discountOpen = false;
				}}>Remove discount</button
			>
		{/if}
	</div>
	{#snippet footer()}
		<Button color="neutral" variant="ghost" onclick={() => (discountOpen = false)}>Cancel</Button>
		<Button color="primary" icon="lucide:check" onclick={applyDiscount}>Apply</Button>
	{/snippet}
</Dialog>

<!-- Held orders -->
<Dialog bind:open={heldOpen} title="Held orders" size="md">
	{#if cart.held.length === 0}
		<EmptyState
			icon="lucide:pause"
			title="No held orders"
			description="Park a sale with Hold to finish it later."
		/>
	{:else}
		<ul class="divide-y divide-[var(--ui-border-muted)]">
			{#each cart.held as h (h.id)}
				{@const heldTotal = h.items.reduce(
					(s, l) =>
						s +
						(l.unitPrice + (l.modifiers?.reduce((a, m) => a + m.priceAdjustment, 0) ?? 0)) *
							l.quantity,
					0
				)}
				<li class="flex items-center justify-between py-2.5">
					<div class="min-w-0">
						<div class="text-[13px] font-semibold capitalize">
							{h.orderType.replace('_', '-')} · {h.items.length} items
						</div>
						<div class="text-[11.5px] text-[var(--ui-text-dimmed)]">
							{h.customerName ?? 'Walk-in'} · {formatMoney(heldTotal, currency)}
						</div>
					</div>
					<div class="flex gap-1.5">
						<Button
							size="sm"
							color="primary"
							variant="subtle"
							disabled={!cart.isEmpty}
							onclick={() => {
								cart.recall(h.id);
								heldOpen = false;
							}}>Recall</Button
						>
						<Button
							size="icon-sm"
							color="neutral"
							variant="ghost"
							icon="lucide:trash-2"
							onclick={() => cart.deleteHeld(h.id)}
							aria-label="Delete"
						/>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</Dialog>

<!-- Receipt -->
<Dialog bind:open={receiptOpen} title="Sale complete" size="sm">
	{#if cart.lastCompleted}
		{@const s = cart.lastCompleted}
		<div class="text-center">
			<div
				class="mx-auto grid size-12 place-items-center rounded-full bg-[var(--tone-success-bg)] text-[var(--tone-success-text)]"
			>
				<Icon name="lucide:check" class="size-6" />
			</div>
			<div class="mt-2 font-mono text-[14px] font-bold">{s.number}</div>
			<div class="font-display text-2xl font-bold tabular-nums">
				{formatMoney(s.totals.total, currency)}
			</div>
			<div class="text-[11.5px] text-[var(--ui-text-muted)] capitalize">
				{s.method} · {s.orderType.replace('_', '-')}{#if s.change > 0}
					· change {formatMoney(s.change, currency)}{/if}
			</div>
		</div>
		<ul class="mt-3 divide-y divide-[var(--ui-border-muted)] text-[12.5px]">
			{#each s.items as it (it.key)}
				<li class="flex justify-between py-1.5">
					<span class="min-w-0 truncate"
						>{it.quantity}× {it.name}{#if it.variantName}
							({it.variantName}){/if}</span
					><span class="tabular-nums"
						>{formatMoney(
							(it.unitPrice + (it.modifiers?.reduce((a, m) => a + m.priceAdjustment, 0) ?? 0)) *
								it.quantity,
							currency
						)}</span
					>
				</li>
			{/each}
		</ul>
	{/if}
	{#snippet footer()}
		<Button color="primary" block onclick={() => (receiptOpen = false)}>New sale</Button>
	{/snippet}
</Dialog>
