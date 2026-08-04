<script lang="ts">
	/**
	 * Listings — publish catalog products to sales channels.
	 * One MarketplaceProduct links a catalog product to ≥1 channels with
	 * optional per-channel pricing and live publish status.
	 */
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Switch from '$lib/components/ui/Switch.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Pagination from '$lib/components/list/Pagination.svelte';
	import { createListControls } from '$lib/utils/list.svelte';
	import { glo } from '$nostr/store.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatMoney, formatInt } from '$lib/utils/format';
	import { newRecordId } from '$lib/utils/record-id';
	import {
		TYPE,
		statusColor,
		channelMeta,
		listingStatusLabel,
		LISTING_STATUSES,
		type MarketplaceProduct,
		type MarketplaceConnection,
		type Product
	} from '$lib/domain';
	import { toPublicListing, redactListing } from '$lib/domain/marketplace-publish';

	const currency = $derived(tenant.state.currency);
	const connections = $derived(
		glo.all<MarketplaceConnection, typeof TYPE.marketplaceConnection>(TYPE.marketplaceConnection)
	);
	const products = $derived(glo.all<Product, typeof TYPE.product>(TYPE.product));
	const listings = $derived(
		glo.all<MarketplaceProduct, typeof TYPE.marketplaceProduct>(TYPE.marketplaceProduct)
	);

	// Catalog products not yet listed
	const listedProductIds = $derived(new Set(listings.map((l) => l.data.productId)));
	const availableProducts = $derived(products.filter((p) => !listedProductIds.has(p.id)));

	// ── Filters ─────────────────────────────────────────────
	let search = $state('');
	let statusFilter = $state('');
	let channelFilter = $state('');

	const filtered = $derived(
		listings.filter((l) => {
			if (statusFilter && l.data.status !== statusFilter) return false;
			if (channelFilter && !l.data.channelIds.includes(channelFilter)) return false;
			if (search.trim()) {
				const q = search.trim().toLowerCase();
				return (
					l.data.productName.toLowerCase().includes(q) ||
					(l.data.sku?.toLowerCase().includes(q) ?? false)
				);
			}
			return true;
		})
	);

	const controls = createListControls<{ id: string; data: MarketplaceProduct }>({
		items: () => filtered,
		search: () => true,
		sortOptions: () => [
			{ key: 'name', label: 'Name', value: (l) => l.data.productName },
			{ key: 'price', label: 'Price', value: (l) => l.data.price },
			{ key: 'stock', label: 'Stock', value: (l) => l.data.stock ?? 0 },
			{ key: 'views', label: 'Views', value: (l) => l.data.views ?? 0 }
		],
		defaultSortKey: 'name',
		defaultViewMode: 'list',
		storageKey: 'mp-listings'
	});

	// ── Stats ───────────────────────────────────────────────
	const activeCount = $derived(listings.filter((l) => l.data.status === 'active').length);
	const lowStockCount = $derived(
		listings.filter((l) => l.data.inventoryTracked && (l.data.stock ?? 0) <= 5).length
	);
	const totalViews = $derived(listings.reduce((s, l) => s + (l.data.views ?? 0), 0));

	// ── Create / edit modal ─────────────────────────────────
	let modalOpen = $state(false);
	let editingId = $state<string | null>(null);
	let saving = $state(false);

	let fProductId = $state('');
	let fChannelIds = $state<string[]>([]);
	let fPrice = $state<number | ''>('');
	let fCompareAt = $state<number | ''>('');
	let fStock = $state<number | ''>('');
	let fTrackInv = $state(true);
	let fStatus = $state<MarketplaceProduct['status']>('draft');
	let fDescription = $state('');
	let fImages = $state<string[]>([]);

	function productName(id: string) {
		return products.find((p) => p.id === id)?.data.name ?? 'Unknown product';
	}

	/** A product's images (gallery + legacy single image), de-duplicated. */
	function productImages(id: string): string[] {
		const p = products.find((x) => x.id === id);
		if (!p) return [];
		const d = p.data as { images?: string[]; image?: string };
		const arr = Array.isArray(d.images) ? d.images : [];
		const single = d.image ? String(d.image) : null;
		const all = single && !arr.includes(single) ? [single, ...arr] : [...arr];
		return all.filter(Boolean);
	}

	/** Cover image for a listing (its own images, else the source product's). */
	function listingCover(data: MarketplaceProduct): string {
		if (data.images?.length) return data.images[0];
		return productImages(data.productId)[0] ?? '';
	}

	function openCreate() {
		editingId = null;
		fProductId = availableProducts[0]?.id ?? '';
		fChannelIds = [];
		fPrice = availableProducts[0]?.data.price ?? '';
		fCompareAt = '';
		fStock = '';
		fTrackInv = true;
		fStatus = 'draft';
		fDescription = '';
		fImages = productImages(availableProducts[0]?.id ?? '');
		modalOpen = true;
	}

	function openEdit(id: string, data: MarketplaceProduct) {
		editingId = id;
		fProductId = data.productId;
		fChannelIds = data.channelIds.slice();
		fPrice = data.price;
		fCompareAt = data.compareAtPrice ?? '';
		fStock = data.stock ?? '';
		fTrackInv = data.inventoryTracked;
		fStatus = data.status;
		fDescription = data.description ?? '';
		fImages = data.images?.slice() ?? [];
		modalOpen = true;
	}

	function toggleChannel(id: string) {
		const i = fChannelIds.indexOf(id);
		if (i >= 0) fChannelIds.splice(i, 1);
		else fChannelIds.push(id);
	}

	function onProductChange() {
		const p = products.find((x) => x.id === fProductId);
		if (p && fPrice === '') fPrice = p.data.price ?? '';
		fImages = productImages(fProductId);
	}

	const canSave = $derived(
		fProductId !== '' && (typeof fPrice === 'number' ? fPrice : Number(fPrice)) >= 0
	);

	async function save() {
		if (!canSave || saving) return;
		saving = true;
		const num = (v: number | '') => (typeof v === 'number' ? v : Number(v) || 0);
		const product = products.find((x) => x.id === fProductId);
		const publishedAt = fStatus === 'active' ? new Date().toISOString() : undefined;
		// Build the listing via the leak-safe projection: only allowlisted public
		// fields are copied from the catalog product, so cost/supplier/reorder
		// thresholds can never reach a public channel. `redactListing` is
		// defense-in-depth in case a future field sneaks internal data in.
		const data: MarketplaceProduct = redactListing(
			toPublicListing(
				{ id: fProductId, data: (product?.data ?? { name: productName(fProductId) }) as Product },
				{
					channelIds: fChannelIds,
					price: num(fPrice),
					compareAtPrice: fCompareAt === '' ? undefined : num(fCompareAt),
					inventoryTracked: fTrackInv,
					stock: fTrackInv ? num(fStock) : undefined,
					description: fDescription.trim() || undefined,
					images: fImages,
					status: fStatus,
					publishedAt
				}
			)
		);
		try {
			if (editingId) {
				await glo.upsert<MarketplaceProduct>(TYPE.marketplaceProduct, data, { id: editingId });
				toast.success('Listing updated');
			} else {
				await glo.upsert<MarketplaceProduct>(TYPE.marketplaceProduct, data, {
					id: newRecordId('mp-listing')
				});
				toast.success('Listing created');
			}
			modalOpen = false;
		} catch {
			toast.error('Failed to save listing');
		} finally {
			saving = false;
		}
	}

	async function quickStatus(
		id: string,
		data: MarketplaceProduct,
		status: MarketplaceProduct['status']
	) {
		await glo.upsert<MarketplaceProduct>(TYPE.marketplaceProduct, { ...data, status }, { id });
		toast.success(`Marked ${listingStatusLabel(status)}`);
	}

	let confirmDeleteId = $state<string | null>(null);
	function doDelete() {
		if (!confirmDeleteId) return;
		glo.remove(TYPE.marketplaceProduct, confirmDeleteId);
		toast.info('Listing removed');
		confirmDeleteId = null;
	}

	const hasChannels = $derived(connections.length > 0);
</script>

<svelte:head><title>Marketplace · Listings</title></svelte:head>

<div class="space-y-4">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h2 class="font-display text-lg font-bold tracking-tight">Listings</h2>
			<p class="text-[12px] text-[var(--ui-text-muted)]">
				{formatInt(filtered.length)} listings across {connections.length} channels
			</p>
		</div>
		<Button
			color="primary"
			icon="lucide:plus"
			onclick={openCreate}
			disabled={!hasChannels || availableProducts.length === 0}
		>
			New listing
		</Button>
	</div>

	{#if !hasChannels}
		<EmptyState
			icon="lucide:radio"
			title="Connect a channel first"
			description="You need at least one sales channel before publishing listings."
		>
			{#snippet actions()}
				<Button color="primary" size="sm" icon="lucide:plus" href="/marketplace/channels"
					>Connect channel</Button
				>
			{/snippet}
		</EmptyState>
	{:else if listings.length === 0}
		<EmptyState
			icon="lucide:tags"
			title="No listings yet"
			description="Publish a catalog product to one or more channels to start selling."
		>
			{#snippet actions()}
				<Button
					color="primary"
					size="sm"
					icon="lucide:plus"
					onclick={openCreate}
					disabled={availableProducts.length === 0}
				>
					{availableProducts.length === 0 ? 'All products listed' : 'New listing'}
				</Button>
			{/snippet}
		</EmptyState>
	{:else}
		<!-- Stats -->
		<div class="grid grid-cols-3 gap-3">
			<div class="metric-card p-3.5">
				<p class="text-[10px] font-semibold text-[var(--ui-text-dimmed)] uppercase">Active</p>
				<p class="mt-0.5 text-xl font-black text-emerald-500 tabular-nums">{activeCount}</p>
			</div>
			<div class="metric-card p-3.5">
				<p class="text-[10px] font-semibold text-[var(--ui-text-dimmed)] uppercase">Low stock</p>
				<p class="mt-0.5 text-xl font-black text-amber-500 tabular-nums">{lowStockCount}</p>
			</div>
			<div class="metric-card p-3.5">
				<p class="text-[10px] font-semibold text-[var(--ui-text-dimmed)] uppercase">Views</p>
				<p class="mt-0.5 text-xl font-black tabular-nums">{formatInt(totalViews)}</p>
			</div>
		</div>

		<!-- Search + filters -->
		<div class="flex flex-wrap items-center gap-2">
			<div class="relative min-w-48 flex-1">
				<Icon
					name="lucide:search"
					class="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--ui-text-dimmed)]"
				/>
				<input
					bind:value={search}
					placeholder="Search listings…"
					class="w-full rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] py-2 pr-3 pl-9 text-[13px] placeholder:text-[var(--ui-text-dimmed)] focus:border-[var(--ui-color-primary-500)] focus:outline-none"
				/>
			</div>
			<div class="flex items-center gap-1 rounded-lg bg-[var(--ui-bg-accented)] p-1">
				<button
					type="button"
					onclick={() => (statusFilter = '')}
					class="rounded-md px-2.5 py-1 text-[11px] font-semibold transition-all {statusFilter ===
					''
						? 'bg-[var(--ui-bg-elevated)] text-[var(--ui-text)] shadow-sm'
						: 'text-[var(--ui-text-muted)]'}">All</button
				>
				{#each LISTING_STATUSES as s (s.value)}
					<button
						type="button"
						onclick={() => (statusFilter = statusFilter === s.value ? '' : s.value)}
						class="rounded-md px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap transition-all {statusFilter ===
						s.value
							? 'bg-[var(--ui-bg-elevated)] text-[var(--ui-text)] shadow-sm'
							: 'text-[var(--ui-text-muted)]'}">{s.label}</button
					>
				{/each}
			</div>
		</div>

		<!-- List -->
		<div
			class="overflow-hidden rounded-2xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-elevated)] shadow-sm"
		>
			<div class="divide-y divide-[var(--ui-border-muted)]">
				{#each controls.pagedList as l (l.id)}
					<div class="group p-4 transition-colors hover:bg-[var(--ui-bg-muted)] sm:p-5">
						<div class="flex items-start justify-between gap-3">
							<div class="flex min-w-0 items-start gap-3">
								<div
									class="grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)]"
								>
									{#if listingCover(l.data)}
										<img
											src={listingCover(l.data)}
											alt={l.data.productName}
											class="h-full w-full object-cover"
										/>
									{:else}
										<Icon name="lucide:package" class="size-5" />
									{/if}
								</div>
								<div class="min-w-0">
									<div class="flex flex-wrap items-center gap-2">
										<p class="truncate text-[14px] font-bold">{l.data.productName}</p>
										<Badge color={statusColor(l.data.status)}
											>{listingStatusLabel(l.data.status)}</Badge
										>
										{#if l.data.inventoryTracked && (l.data.stock ?? 0) <= 5}
											<Badge color="warning"
												>{(l.data.stock ?? 0) === 0 ? 'Out of stock' : 'Low stock'}</Badge
											>
										{/if}
									</div>
									{#if l.data.sku}
										<p class="mt-0.5 font-mono text-[11px] text-[var(--ui-text-dimmed)]">
											{l.data.sku}
										</p>
									{/if}
									<!-- Channel chips -->
									<div class="mt-1.5 flex flex-wrap items-center gap-1">
										{#each l.data.channelIds as cid (cid)}
											{@const conn = connections.find((c) => c.id === cid)}
											{@const m = conn ? channelMeta(conn.data.type) : null}
											<span
												class="inline-flex items-center gap-0.5 rounded-full bg-[var(--ui-bg-muted)] px-1.5 py-0.5 text-[9px] font-medium text-[var(--ui-text-muted)]"
											>
												{#if m}<Icon name={m.icon} class="size-2.5" />{/if}
												{conn?.data.name ?? cid.slice(0, 6)}
											</span>
										{/each}
										{#if l.data.channelIds.length === 0}
											<span class="text-[9px] text-[var(--ui-text-dimmed)]">No channels</span>
										{/if}
									</div>
								</div>
							</div>
							<div class="flex shrink-0 flex-col items-end gap-2">
								<div class="text-right">
									<div class="font-display text-[15px] font-bold tabular-nums">
										{formatMoney(l.data.price, currency)}
									</div>
									{#if l.data.compareAtPrice}
										<div class="text-[10px] text-[var(--ui-text-dimmed)] tabular-nums line-through">
											{formatMoney(l.data.compareAtPrice, currency)}
										</div>
									{/if}
								</div>
								<div class="flex items-center gap-1">
									{#if l.data.status === 'active'}
										<Button
											size="icon-sm"
											color="neutral"
											variant="ghost"
											icon="lucide:pause"
											title="Pause"
											onclick={() => quickStatus(l.id, l.data, 'paused')}
										/>
									{:else}
										<Button
											size="icon-sm"
											color="neutral"
											variant="ghost"
											icon="lucide:play"
											title="Activate"
											onclick={() => quickStatus(l.id, l.data, 'active')}
										/>
									{/if}
									<Button
										size="icon-sm"
										color="neutral"
										variant="ghost"
										icon="lucide:pencil"
										title="Edit"
										onclick={() => openEdit(l.id, l.data)}
									/>
									<Button
										size="icon-sm"
										color="neutral"
										variant="ghost"
										icon="lucide:trash-2"
										title="Delete"
										onclick={() => (confirmDeleteId = l.id)}
									/>
								</div>
							</div>
						</div>
					</div>
				{/each}
			</div>
		</div>
		<Pagination {controls} />
	{/if}
</div>

<!-- Create / edit modal -->
<Dialog bind:open={modalOpen} title={editingId ? 'Edit listing' : 'New listing'} size="lg">
	<div class="max-h-[70vh] space-y-4 overflow-y-auto">
		<!-- Product -->
		<label class="block">
			<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
				>Product <span class="text-red-500">*</span></span
			>
			{#if editingId}
				<div
					class="rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-3 py-2 text-[13px] font-medium"
				>
					{productName(fProductId)}
				</div>
			{:else}
				<div class="relative">
					<select
						bind:value={fProductId}
						onchange={onProductChange}
						class="w-full appearance-none rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] py-2.5 pr-9 pl-3 text-[13px] font-medium focus:border-[var(--ui-color-primary-500)] focus:outline-none"
					>
						{#each availableProducts as p (p.id)}
							<option value={p.id}
								>{p.data.name}{#if p.data.sku}
									({p.data.sku}){/if}</option
							>
						{/each}
					</select>
					<Icon
						name="lucide:chevron-down"
						class="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-[var(--ui-text-dimmed)]"
					/>
				</div>
			{/if}
		</label>

		<!-- Channels -->
		<div>
			<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
				>Publish to channels</span
			>
			<div class="flex flex-wrap gap-1.5">
				{#each connections as c (c.id)}
					{@const m = channelMeta(c.data.type)}
					<button
						type="button"
						onclick={() => toggleChannel(c.id)}
						class="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-all {fChannelIds.includes(
							c.id
						)
							? 'bg-primary-500/15 text-primary-600 ring-1 ring-primary-500/30 dark:text-primary-300'
							: 'bg-[var(--ui-bg-muted)] text-[var(--ui-text-muted)]'}"
					>
						{#if fChannelIds.includes(c.id)}<Icon name="lucide:check" class="size-3" />{:else}<Icon
								name={m.icon}
								class="size-3"
							/>{/if}
						{c.data.name}
					</button>
				{/each}
			</div>
		</div>

		<!-- Pricing -->
		<div class="grid grid-cols-2 gap-3">
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
					>Price ({currency}) <span class="text-red-500">*</span></span
				>
				<Input bind:value={fPrice} type="number" min="0" class="w-full" />
			</label>
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
					>Compare-at price</span
				>
				<Input bind:value={fCompareAt} type="number" min="0" placeholder="0.00" class="w-full" />
			</label>
		</div>

		<!-- Inventory -->
		<div class="space-y-3 rounded-xl bg-[var(--ui-bg-accented)] p-3">
			<div class="flex items-center justify-between">
				<div>
					<p class="text-[12px] font-semibold text-[var(--ui-text-muted)]">Track inventory</p>
					<p class="text-[10.5px] text-[var(--ui-text-dimmed)]">Sync stock across channels</p>
				</div>
				<Switch bind:checked={fTrackInv} />
			</div>
			{#if fTrackInv}
				<label class="block">
					<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>Stock quantity</span
					>
					<Input bind:value={fStock} type="number" min="0" class="w-full" />
				</label>
			{/if}
		</div>

		<!-- Status -->
		<div>
			<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Status</span>
			<div class="flex flex-wrap gap-1 rounded-lg bg-[var(--ui-bg-accented)] p-1">
				{#each LISTING_STATUSES as s (s.value)}
					<button
						type="button"
						onclick={() => (fStatus = s.value)}
						class="flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-all {fStatus ===
						s.value
							? 'bg-[var(--ui-bg-elevated)] text-[var(--ui-text)] shadow-sm'
							: 'text-[var(--ui-text-muted)]'}"
					>
						<Icon name={s.icon} class="size-3" />{s.label}
					</button>
				{/each}
			</div>
		</div>

		<label class="block">
			<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
				>Description</span
			>
			<Input
				bind:value={fDescription}
				textarea
				rows={2}
				placeholder="Listing copy shown on the channel…"
				class="w-full"
			/>
		</label>
	</div>

	{#snippet footer()}
		<Button color="neutral" variant="ghost" onclick={() => (modalOpen = false)}>Cancel</Button>
		<Button color="primary" icon="lucide:check" disabled={!canSave || saving} onclick={save}
			>{saving ? 'Saving…' : editingId ? 'Update' : 'Publish'}</Button
		>
	{/snippet}
</Dialog>

<!-- Delete confirm -->
{#if confirmDeleteId}
	<div class="fixed inset-0 z-[95] flex items-center justify-center p-4">
		<button
			type="button"
			tabindex="-1"
			class="fixed inset-0 bg-black/45 backdrop-blur-[2px]"
			onclick={() => (confirmDeleteId = null)}
			aria-label="Cancel"
		></button>
		<div
			class="animate-rise relative w-full max-w-sm rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-bg-elevated)] p-5 shadow-2xl"
		>
			<div class="flex items-center gap-3">
				<div class="grid size-10 place-items-center rounded-xl bg-red-500/10 text-red-500">
					<Icon name="lucide:trash-2" class="size-5" />
				</div>
				<div>
					<p class="font-display text-[14px] font-bold">Delete listing?</p>
					<p class="text-[11.5px] text-[var(--ui-text-dimmed)]">
						It will be unpublished from all channels.
					</p>
				</div>
			</div>
			<div class="mt-4 flex justify-end gap-2">
				<Button color="neutral" variant="ghost" size="sm" onclick={() => (confirmDeleteId = null)}
					>Cancel</Button
				>
				<Button color="error" size="sm" icon="lucide:trash-2" onclick={doDelete}>Delete</Button>
			</div>
		</div>
	</div>
{/if}
