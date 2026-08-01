<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import ListToolbar from '$lib/components/list/ListToolbar.svelte';
	import SortableTh from '$lib/components/list/SortableTh.svelte';
	import Pagination from '$lib/components/list/Pagination.svelte';
	import RowActions, { type RowAction } from '$lib/components/list/RowActions.svelte';
	import { createListControls } from '$lib/utils/list.svelte';
	import { glo } from '$nostr/store.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatMoney } from '$lib/utils/format';
	import {
		TYPE,
		statusColor,
		type Product,
		type ProductVariant,
		type CatalogCategory,
		type CatalogUnit,
		type ModifierGroup
	} from '$lib/domain';

	type Tab = 'products' | 'categories' | 'units' | 'modifiers';
	let tab = $state<Tab>('products');

	onMount(() => {
		glo.hydrate(TYPE.product);
		glo.hydrate(TYPE.category);
		glo.hydrate(TYPE.unit);
		glo.hydrate(TYPE.modifierGroup);
		void glo.syncAll([TYPE.product, TYPE.category, TYPE.unit, TYPE.modifierGroup]);
	});

	const currency = $derived(tenant.state.currency);
	const tabs: { id: Tab; label: string; icon: string; count: () => number }[] = [
		{
			id: 'products',
			label: 'Products',
			icon: 'lucide:package',
			count: () => glo.all(TYPE.product).length
		},
		{
			id: 'categories',
			label: 'Categories',
			icon: 'lucide:folder',
			count: () => glo.all(TYPE.category).length
		},
		{ id: 'units', label: 'Units', icon: 'lucide:ruler', count: () => glo.all(TYPE.unit).length },
		{
			id: 'modifiers',
			label: 'Modifiers',
			icon: 'lucide:sliders-horizontal',
			count: () => glo.all(TYPE.modifierGroup).length
		}
	];

	// ── Products ──
	const products = $derived(glo.all<Product, typeof TYPE.product>(TYPE.product));
	const prodCtrl = createListControls<{ id: string; data: Product }>({
		items: () => products,
		search: (p, q) => (p.data.name ?? '').toLowerCase().includes(q),
		sortOptions: () => [
			{ key: 'name', label: 'Name', value: (p) => p.data.name ?? '~' },
			{ key: 'price', label: 'Price', value: (p) => p.data.price ?? 0 },
			{ key: 'category', label: 'Category', value: (p) => p.data.categoryId ?? '~' }
		],
		defaultSortKey: 'name',
		defaultViewMode: 'table',
		storageKey: 'catalog-products'
	});

	// ── Categories ──
	const categories = $derived(glo.all<CatalogCategory, typeof TYPE.category>(TYPE.category));
	const catCtrl = createListControls<{ id: string; data: CatalogCategory }>({
		items: () => categories,
		search: (c, q) => (c.data.name ?? '').toLowerCase().includes(q),
		sortOptions: () => [
			{ key: 'name', label: 'Name', value: (c) => c.data.name },
			{ key: 'order', label: 'Order', value: (c) => c.data.sortOrder ?? 0 }
		],
		defaultSortKey: 'name',
		defaultViewMode: 'table',
		storageKey: 'catalog-categories'
	});

	// ── Units ──
	const units = $derived(glo.all<CatalogUnit, typeof TYPE.unit>(TYPE.unit));
	const unitCtrl = createListControls<{ id: string; data: CatalogUnit }>({
		items: () => units,
		search: (u, q) =>
			(u.data.name ?? '').toLowerCase().includes(q) ||
			(u.data.symbol ?? '').toLowerCase().includes(q),
		sortOptions: () => [
			{ key: 'name', label: 'Name', value: (u) => u.data.name },
			{ key: 'symbol', label: 'Symbol', value: (u) => u.data.symbol }
		],
		defaultSortKey: 'name',
		defaultViewMode: 'table',
		storageKey: 'catalog-units'
	});

	// ── Modifiers ──
	const modifiers = $derived(glo.all<ModifierGroup, typeof TYPE.modifierGroup>(TYPE.modifierGroup));
	const modCtrl = createListControls<{ id: string; data: ModifierGroup }>({
		items: () => modifiers,
		search: (m, q) => (m.data.name ?? '').toLowerCase().includes(q),
		sortOptions: () => [{ key: 'name', label: 'Name', value: (m) => m.data.name }],
		defaultSortKey: 'name',
		defaultViewMode: 'table',
		storageKey: 'catalog-modifiers'
	});

	// ── Create dialogs + forms ──
	let dlgOpen = $state(false);
	let dlgKind = $state<Tab>('products');
	// product form
	let pName = $state('');
	let pPrice = $state<number | ''>('');
	let pCat = $state('');
	let pSku = $state('');
	let pVariants = $state<{ name: string; price: number }[]>([]);
	let pVariantName = $state('');
	let pVariantPrice = $state<number | ''>('');
	let pModGroupIds = $state<string[]>([]);
	let pTrackInv = $state(false);
	let pLowStock = $state<number | ''>('');
	let pDenyOos = $state(false);
	// category form
	let cName = $state('');
	let cDesc = $state('');
	let cIcon = $state('');
	let cOrder = $state(0);
	// unit form
	let uName = $state('');
	let uSymbol = $state('');
	let uType = $state<CatalogUnit['type']>('count');
	// modifier form
	let mName = $state('');
	let mOpt = $state('');

	function openCreate(t: Tab) {
		dlgKind = t;
		pName = pCat = pSku = '';
		pPrice = '';
		cName = cDesc = cIcon = '';
		cOrder = 0;
		uName = uSymbol = '';
		uType = 'count';
		mName = mOpt = '';
		pVariants = [];
		pVariantName = '';
		pVariantPrice = '';
		pModGroupIds = [];
		pTrackInv = false;
		pLowStock = '';
		pDenyOos = false;
		dlgOpen = true;
	}

	async function save() {
		try {
			if (dlgKind === 'products') {
				if (!pName.trim()) return toast.warning('Name required');
				const variants: ProductVariant[] = pVariants.map((v, i) => ({
					id: `${pName
						.trim()
						.slice(0, 12)
						.toLowerCase()
						.replace(/[^a-z0-9]+/g, '-')}-${i + 1}`,
					name: v.name,
					shortName: v.name,
					priceModifier: v.price,
					priceModifierType: 'fixed',
					available: true
				}));
				await glo.upsert<Product>(TYPE.product, {
					name: pName.trim(),
					price: typeof pPrice === 'number' ? pPrice : Number(pPrice) || 0,
					currency,
					categoryId: pCat.trim() || undefined,
					sku: pSku.trim() || undefined,
					status: 'active',
					available: true,
					type: variants.length ? 'variable' : 'standard',
					hasVariants: variants.length > 0,
					variants: variants.length ? variants : undefined,
					modifierGroupIds: pModGroupIds.length ? pModGroupIds : undefined,
					trackInventory: pTrackInv,
					inventory: pTrackInv
						? {
								lowStockThreshold: typeof pLowStock === 'number' ? pLowStock : undefined,
								denySaleWhenOutOfStock: pDenyOos,
								allowBackorder: !pDenyOos
							}
						: undefined
				});
			} else if (dlgKind === 'categories') {
				if (!cName.trim()) return toast.warning('Name required');
				await glo.upsert<CatalogCategory>(TYPE.category, {
					name: cName.trim(),
					description: cDesc.trim() || undefined,
					icon: cIcon.trim() || undefined,
					sortOrder: cOrder,
					status: 'active'
				});
			} else if (dlgKind === 'units') {
				if (!uName.trim() || !uSymbol.trim()) return toast.warning('Name and symbol required');
				await glo.upsert<CatalogUnit>(TYPE.unit, {
					name: uName.trim(),
					symbol: uSymbol.trim(),
					type: uType
				});
			} else {
				if (!mName.trim()) return toast.warning('Name required');
				const opts = mOpt
					.split(',')
					.map((s) => s.trim())
					.filter(Boolean)
					.map((name) => ({ name }));
				await glo.upsert<ModifierGroup>(TYPE.modifierGroup, {
					name: mName.trim(),
					options: opts,
					singleChoice: true,
					status: 'active'
				});
			}
			toast.success('Saved');
			dlgOpen = false;
		} catch (e) {
			toast.error('Save failed', e instanceof Error ? e.message : undefined);
		}
	}

	function addVariant() {
		if (!pVariantName.trim()) return;
		pVariants = [
			...pVariants,
			{
				name: pVariantName.trim(),
				price: typeof pVariantPrice === 'number' ? pVariantPrice : Number(pVariantPrice) || 0
			}
		];
		pVariantName = '';
		pVariantPrice = '';
	}
	function removeVariant(i: number) {
		pVariants = pVariants.filter((_, idx) => idx !== i);
	}
	function toggleModGroup(id: string) {
		pModGroupIds = pModGroupIds.includes(id)
			? pModGroupIds.filter((x) => x !== id)
			: [...pModGroupIds, id];
	}

	function remove(t: string, id: string) {
		glo.remove(t, id);
		toast.info('Removed');
	}
	function prodActions(p: { id: string }): RowAction[][] {
		return [
			[
				{
					label: 'Delete',
					icon: 'lucide:trash-2',
					danger: true,
					onSelect: () => remove(TYPE.product, p.id)
				}
			]
		];
	}
	const dlgTitle = $derived(
		{
			products: 'Add product',
			categories: 'Add category',
			units: 'Add unit',
			modifiers: 'Add modifier group'
		}[dlgKind]
	);
</script>

<svelte:head><title>BNOS · Catalog</title></svelte:head>

<div class="space-y-4">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h1 class="font-display text-xl font-bold tracking-tight">Catalog</h1>
			<p class="text-[12.5px] text-[var(--ui-text-muted)]">
				Products, categories, units & modifiers · kinds 30100–30103
			</p>
		</div>
		<Button color="primary" icon="lucide:plus" onclick={() => openCreate(tab)}
			>Add {tab === 'products'
				? 'product'
				: tab === 'categories'
					? 'category'
					: tab === 'units'
						? 'unit'
						: 'modifier'}</Button
		>
	</div>

	<!-- tabs -->
	<div class="segmented inline-flex w-fit gap-1 p-1">
		{#each tabs as t (t.id)}
			<button
				type="button"
				onclick={() => (tab = t.id)}
				class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-semibold transition-colors {tab ===
				t.id
					? 'bg-[var(--ui-bg-elevated)] text-[var(--ui-text)] shadow-sm'
					: 'text-[var(--ui-text-muted)]'}"
			>
				<Icon name={t.icon} class="size-3.5" />{t.label}
				<span class="rounded bg-[var(--ui-bg-accented)] px-1.5 text-[10px] tabular-nums"
					>{t.count()}</span
				>
			</button>
		{/each}
	</div>

	<!-- PRODUCTS -->
	{#if tab === 'products'}
		{#if products.length || prodCtrl.search}
			<ListToolbar
				bind:search={prodCtrl.search}
				bind:sortKey={prodCtrl.sortKey}
				bind:sortDir={prodCtrl.sortDir}
				bind:viewMode={prodCtrl.viewMode}
				sortItems={prodCtrl.sortItems}
				applySort={prodCtrl.applySort}
				setViewMode={prodCtrl.setViewMode}
				searchPlaceholder="Search products…"
			/>
		{/if}
		{#if prodCtrl.list.length === 0}
			<EmptyState
				icon="lucide:package"
				title="No products"
				description="Add your first product to start selling."
			>
				{#snippet actions()}<Button
						color="primary"
						size="sm"
						icon="lucide:plus"
						onclick={() => openCreate('products')}>Add product</Button
					>{/snippet}
			</EmptyState>
		{:else}
			<div class="data-panel">
				<div class="overflow-x-auto">
					<table class="table-surface w-full text-left">
						<thead
							><tr>
								<SortableTh
									column="name"
									active={prodCtrl.sortKey === 'name'}
									direction={prodCtrl.sortDir}
									applySort={prodCtrl.applySort}>Product</SortableTh
								>
								<SortableTh
									column="category"
									active={prodCtrl.sortKey === 'category'}
									direction={prodCtrl.sortDir}
									applySort={prodCtrl.applySort}>Category</SortableTh
								>
								<SortableTh
									column="price"
									active={prodCtrl.sortKey === 'price'}
									direction={prodCtrl.sortDir}
									align="right"
									applySort={prodCtrl.applySort}>Price</SortableTh
								>
								<th class="w-10 px-5 py-2.5"></th>
							</tr></thead
						>
						<tbody class="divide-y divide-[var(--ui-border-muted)] text-[13px]">
							{#each prodCtrl.pagedList as p (p.id)}
								<tr>
									<td class="px-5 py-3"
										><div class="font-semibold">{p.data.name}</div>
										{#if p.data.sku}<div class="font-mono text-[11px] text-[var(--ui-text-dimmed)]">
												{p.data.sku}
											</div>{/if}
										<div class="mt-0.5 flex flex-wrap gap-1">
											{#if p.data.hasVariants}<Badge color="info"
													>{p.data.variants?.length ?? 0} variants</Badge
												>{/if}{#if p.data.modifierGroupIds?.length}<Badge color="info"
													>{p.data.modifierGroupIds.length} mods</Badge
												>{/if}{#if p.data.trackInventory}<Badge color="neutral">stock</Badge>{/if}
										</div></td
									>
									<td class="px-5 py-3"
										>{#if p.data.categoryId}<Badge>{p.data.categoryId}</Badge>{:else}<span
												class="text-[var(--ui-text-dimmed)]">—</span
											>{/if}</td
									>
									<td class="px-5 py-3 text-right font-semibold tabular-nums"
										>{formatMoney(p.data.price ?? 0, p.data.currency ?? currency)}</td
									>
									<td class="px-5 py-3 text-right"><RowActions actions={prodActions(p)} /></td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				<Pagination controls={prodCtrl} />
			</div>
		{/if}
	{:else if tab === 'categories'}
		{#if categories.length || catCtrl.search}
			<ListToolbar
				bind:search={catCtrl.search}
				bind:sortKey={catCtrl.sortKey}
				bind:sortDir={catCtrl.sortDir}
				viewMode={catCtrl.viewMode}
				sortItems={catCtrl.sortItems}
				allowViewModes={['table']}
				applySort={catCtrl.applySort}
				searchPlaceholder="Search categories…"
			/>
		{/if}
		{#if catCtrl.list.length === 0}
			<EmptyState
				icon="lucide:folder"
				title="No categories"
				description="Group your products with categories."
			>
				{#snippet actions()}<Button
						color="primary"
						size="sm"
						icon="lucide:plus"
						onclick={() => openCreate('categories')}>Add category</Button
					>{/snippet}
			</EmptyState>
		{:else}
			<div class="data-panel">
				<table class="table-surface w-full text-left">
					<thead
						><tr>
							<SortableTh
								column="name"
								active={catCtrl.sortKey === 'name'}
								direction={catCtrl.sortDir}
								applySort={catCtrl.applySort}>Category</SortableTh
							>
							<SortableTh
								column="order"
								active={catCtrl.sortKey === 'order'}
								direction={catCtrl.sortDir}
								align="right"
								applySort={catCtrl.applySort}>Order</SortableTh
							>
							<th class="w-10 px-5 py-2.5"></th>
						</tr></thead
					>
					<tbody class="divide-y divide-[var(--ui-border-muted)] text-[13px]">
						{#each catCtrl.pagedList as c (c.id)}
							<tr>
								<td class="px-5 py-3"
									><div class="flex items-center gap-2 font-semibold">
										{#if c.data.icon}<Icon
												name={c.data.icon}
												class="size-4 text-[var(--ui-text-dimmed)]"
											/>{/if}{c.data.name}
									</div>
									{#if c.data.description}<div class="text-[11.5px] text-[var(--ui-text-dimmed)]">
											{c.data.description}
										</div>{/if}</td
								>
								<td class="px-5 py-3 text-right text-[var(--ui-text-muted)] tabular-nums"
									>{c.data.sortOrder ?? 0}</td
								>
								<td class="px-5 py-3 text-right"
									><RowActions
										actions={[
											[
												{
													label: 'Delete',
													icon: 'lucide:trash-2',
													danger: true,
													onSelect: () => remove(TYPE.category, c.id)
												}
											]
										]}
									/></td
								>
							</tr>
						{/each}
					</tbody>
				</table>
				<Pagination controls={catCtrl} />
			</div>
		{/if}
	{:else if tab === 'units'}
		{#if units.length || unitCtrl.search}
			<ListToolbar
				bind:search={unitCtrl.search}
				bind:sortKey={unitCtrl.sortKey}
				bind:sortDir={unitCtrl.sortDir}
				viewMode={unitCtrl.viewMode}
				sortItems={unitCtrl.sortItems}
				allowViewModes={['table']}
				applySort={unitCtrl.applySort}
				searchPlaceholder="Search units…"
			/>
		{/if}
		{#if unitCtrl.list.length === 0}
			<EmptyState
				icon="lucide:ruler"
				title="No units"
				description="Define units of measure (kg, liter, piece…)."
			>
				{#snippet actions()}<Button
						color="primary"
						size="sm"
						icon="lucide:plus"
						onclick={() => openCreate('units')}>Add unit</Button
					>{/snippet}
			</EmptyState>
		{:else}
			<div class="data-panel">
				<table class="table-surface w-full text-left">
					<thead
						><tr>
							<SortableTh
								column="name"
								active={unitCtrl.sortKey === 'name'}
								direction={unitCtrl.sortDir}
								applySort={unitCtrl.applySort}>Unit</SortableTh
							>
							<SortableTh
								column="symbol"
								active={unitCtrl.sortKey === 'symbol'}
								direction={unitCtrl.sortDir}
								applySort={unitCtrl.applySort}>Symbol</SortableTh
							>
							<th class="px-5 py-2.5">Type</th>
							<th class="w-10 px-5 py-2.5"></th>
						</tr></thead
					>
					<tbody class="divide-y divide-[var(--ui-border-muted)] text-[13px]">
						{#each unitCtrl.pagedList as u (u.id)}
							<tr>
								<td class="px-5 py-3 font-semibold">{u.data.name}</td>
								<td class="px-5 py-3 font-mono text-[var(--ui-text-muted)]">{u.data.symbol}</td>
								<td class="px-5 py-3 text-[var(--ui-text-muted)] capitalize"
									>{u.data.type ?? 'count'}</td
								>
								<td class="px-5 py-3 text-right"
									><RowActions
										actions={[
											[
												{
													label: 'Delete',
													icon: 'lucide:trash-2',
													danger: true,
													onSelect: () => remove(TYPE.unit, u.id)
												}
											]
										]}
									/></td
								>
							</tr>
						{/each}
					</tbody>
				</table>
				<Pagination controls={unitCtrl} />
			</div>
		{/if}
	{:else}
		{#if modifiers.length || modCtrl.search}
			<ListToolbar
				bind:search={modCtrl.search}
				bind:sortKey={modCtrl.sortKey}
				bind:sortDir={modCtrl.sortDir}
				viewMode={modCtrl.viewMode}
				sortItems={modCtrl.sortItems}
				allowViewModes={['table']}
				applySort={modCtrl.applySort}
				searchPlaceholder="Search modifiers…"
			/>
		{/if}
		{#if modCtrl.list.length === 0}
			<EmptyState
				icon="lucide:sliders-horizontal"
				title="No modifier groups"
				description="Create modifier groups like sizes or toppings."
			>
				{#snippet actions()}<Button
						color="primary"
						size="sm"
						icon="lucide:plus"
						onclick={() => openCreate('modifiers')}>Add modifier</Button
					>{/snippet}
			</EmptyState>
		{:else}
			<div class="data-panel">
				<table class="table-surface w-full text-left">
					<thead
						><tr>
							<SortableTh
								column="name"
								active={modCtrl.sortKey === 'name'}
								direction={modCtrl.sortDir}
								applySort={modCtrl.applySort}>Modifier group</SortableTh
							>
							<th class="px-5 py-2.5">Options</th>
							<th class="w-10 px-5 py-2.5"></th>
						</tr></thead
					>
					<tbody class="divide-y divide-[var(--ui-border-muted)] text-[13px]">
						{#each modCtrl.pagedList as m (m.id)}
							<tr>
								<td class="px-5 py-3 font-semibold"
									>{m.data.name}{#if m.data.singleChoice}<span
											class="ml-2 text-[10px] text-[var(--ui-text-dimmed)]">single</span
										>{/if}</td
								>
								<td class="px-5 py-3 text-[var(--ui-text-muted)]"
									>{m.data.options?.map((o) => o.name).join(', ') || '—'}</td
								>
								<td class="px-5 py-3 text-right"
									><RowActions
										actions={[
											[
												{
													label: 'Delete',
													icon: 'lucide:trash-2',
													danger: true,
													onSelect: () => remove(TYPE.modifierGroup, m.id)
												}
											]
										]}
									/></td
								>
							</tr>
						{/each}
					</tbody>
				</table>
				<Pagination controls={modCtrl} />
			</div>
		{/if}
	{/if}
</div>

<Dialog bind:open={dlgOpen} title={dlgTitle}>
	{#if dlgKind === 'products'}
		<div class="space-y-3">
			<label class="block"
				><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Name</span
				><Input bind:value={pName} icon="lucide:package" class="w-full" /></label
			>
			<div class="grid grid-cols-2 gap-3">
				<label class="block"
					><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>Price ({currency})</span
					><Input
						bind:value={pPrice}
						type="number"
						icon="lucide:banknote"
						min="0"
						step="0.01"
						class="w-full"
					/></label
				>
				<label class="block"
					><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>Category</span
					><Input bind:value={pCat} icon="lucide:folder" list="cats" class="w-full" /></label
				>
			</div>
			<datalist id="cats"
				>{#each categories as c (c.id)}<option value={c.data.name}></option>{/each}</datalist
			>
			<label class="block"
				><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">SKU</span
				><Input bind:value={pSku} icon="lucide:barcode" class="w-full" /></label
			>

			<!-- Variants -->
			<div>
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
					>Variants (sizes)</span
				>
				{#if pVariants.length}
					<ul class="mb-2 space-y-1">
						{#each pVariants as v, i (i)}
							<li
								class="flex items-center gap-2 rounded-lg border border-[var(--ui-border-muted)] px-2.5 py-1.5 text-[12.5px]"
							>
								<span class="flex-1 font-semibold">{v.name}</span><span
									class="text-[var(--ui-text-muted)] tabular-nums"
									>{v.price >= 0 ? '+' : ''}{v.price}</span
								><button
									type="button"
									class="text-[var(--tone-error-text)]"
									onclick={() => removeVariant(i)}
									aria-label="Remove"><Icon name="lucide:x" class="size-3.5" /></button
								>
							</li>
						{/each}
					</ul>
				{/if}
				<div class="flex gap-2">
					<Input bind:value={pVariantName} placeholder="Large" class="flex-1" />
					<Input bind:value={pVariantPrice} type="number" placeholder="price adj." class="w-28" />
					<Button
						color="neutral"
						variant="subtle"
						size="icon"
						icon="lucide:plus"
						onclick={addVariant}
						aria-label="Add variant"
					/>
				</div>
			</div>

			<!-- Modifier groups -->
			{#if modifiers.length}
				<div>
					<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>Modifier groups</span
					>
					<div class="flex flex-wrap gap-1.5">
						{#each modifiers as m (m.id)}
							<button
								type="button"
								onclick={() => toggleModGroup(m.id)}
								class="rounded-full border px-2.5 py-1 text-[11.5px] font-semibold transition-colors {pModGroupIds.includes(
									m.id
								)
									? 'border-primary-500 bg-primary-500/10 text-primary-600 dark:text-primary-300'
									: 'border-[var(--ui-border)] text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)]'}"
								>{m.data.name}</button
							>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Inventory policy -->
			<div>
				<label class="flex cursor-pointer items-center gap-2"
					><input
						type="checkbox"
						bind:checked={pTrackInv}
						class="size-4 rounded border-[var(--ui-border)]"
					/><span class="text-[12.5px] font-semibold">Track inventory & show stock in POS</span
					></label
				>
				{#if pTrackInv}
					<div class="mt-2 grid grid-cols-2 gap-2">
						<Input
							bind:value={pLowStock}
							type="number"
							min="0"
							icon="lucide:alert-triangle"
							placeholder="Low-stock alert at"
							class="w-full"
						/>
						<label
							class="flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--ui-border-muted)] px-2.5 py-2"
							><input
								type="checkbox"
								bind:checked={pDenyOos}
								class="size-4 rounded border-[var(--ui-border)]"
							/><span class="text-[11.5px] font-semibold">Block sale when out of stock</span></label
						>
					</div>
				{/if}
			</div>
		</div>
	{:else if dlgKind === 'categories'}
		<div class="space-y-3">
			<label class="block"
				><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Name</span
				><Input bind:value={cName} icon="lucide:folder" class="w-full" /></label
			>
			<label class="block"
				><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
					>Description</span
				><Input bind:value={cDesc} class="w-full" /></label
			>
			<div class="grid grid-cols-2 gap-3">
				<label class="block"
					><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>Icon (lucide)</span
					><Input
						bind:value={cIcon}
						icon="lucide:star"
						placeholder="lucide:coffee"
						class="w-full"
					/></label
				>
				<label class="block"
					><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>Sort order</span
					><Input bind:value={cOrder} type="number" class="w-full" /></label
				>
			</div>
		</div>
	{:else if dlgKind === 'units'}
		<div class="space-y-3">
			<div class="grid grid-cols-2 gap-3">
				<label class="block"
					><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>Name</span
					><Input bind:value={uName} placeholder="Kilogram" class="w-full" /></label
				>
				<label class="block"
					><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>Symbol</span
					><Input bind:value={uSymbol} placeholder="kg" class="w-full" /></label
				>
			</div>
			<label class="block"
				><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Type</span
				>
				<Select
					bind:value={uType}
					options={[
						{ value: 'count', label: 'Count' },
						{ value: 'weight', label: 'Weight' },
						{ value: 'volume', label: 'Volume' },
						{ value: 'length', label: 'Length' },
						{ value: 'time', label: 'Time' }
					]}
					class="w-full"
				/>
			</label>
		</div>
	{:else}
		<div class="space-y-3">
			<label class="block"
				><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
					>Group name</span
				><Input bind:value={mName} placeholder="Size" class="w-full" /></label
			>
			<label class="block"
				><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
					>Options (comma separated)</span
				><Input bind:value={mOpt} placeholder="Small, Medium, Large" class="w-full" /></label
			>
		</div>
	{/if}
	{#snippet footer()}
		<Button color="neutral" variant="ghost" onclick={() => (dlgOpen = false)}>Cancel</Button>
		<Button color="primary" icon="lucide:check" onclick={save}>Save</Button>
	{/snippet}
</Dialog>
