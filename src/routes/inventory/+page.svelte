<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import ListToolbar from '$lib/components/list/ListToolbar.svelte';
	import SortableTh from '$lib/components/list/SortableTh.svelte';
	import Pagination from '$lib/components/list/Pagination.svelte';
	import RowActions from '$lib/components/list/RowActions.svelte';
	import { createListControls } from '$lib/utils/list.svelte';
	import { glo } from '$nostr/store.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatMoney, relativeTime } from '$lib/utils/format';
	import { TYPE, statusColor, type StockAdjustment, type Supplier, type PurchaseOrder } from '$lib/domain';

	type Tab = 'adjustments' | 'suppliers' | 'orders';
	let tab = $state<Tab>('adjustments');

	onMount(() => {
		glo.hydrate(TYPE.adjustment);
		glo.hydrate(TYPE.supplier);
		glo.hydrate(TYPE.purchaseOrder);
		void glo.syncAll([TYPE.adjustment, TYPE.supplier, TYPE.purchaseOrder]);
	});

	const currency = $derived(tenant.state.currency);
	const tabs: { id: Tab; label: string; icon: string; count: () => number }[] = [
		{ id: 'adjustments', label: 'Adjustments', icon: 'lucide:arrow-up-down', count: () => glo.all(TYPE.adjustment).length },
		{ id: 'suppliers', label: 'Suppliers', icon: 'lucide:truck', count: () => glo.all(TYPE.supplier).length },
		{ id: 'orders', label: 'Purchase Orders', icon: 'lucide:clipboard-list', count: () => glo.all(TYPE.purchaseOrder).length }
	];

	const adjustments = $derived(glo.all<StockAdjustment, typeof TYPE.adjustment>(TYPE.adjustment));
	const suppliers = $derived(glo.all<Supplier, typeof TYPE.supplier>(TYPE.supplier));
	const orders = $derived(glo.all<PurchaseOrder, typeof TYPE.purchaseOrder>(TYPE.purchaseOrder));

	const adjCtrl = createListControls<{ id: string; data: StockAdjustment }>({
		items: () => adjustments, search: (a, q) => (a.data.productName ?? '').toLowerCase().includes(q),
		sortOptions: () => [{ key: 'product', label: 'Product', value: (a) => a.data.productName }, { key: 'date', label: 'Date', value: (a) => a.data.occurredAt }],
		defaultSortKey: 'date', defaultSortDir: 'desc', defaultViewMode: 'table', storageKey: 'inv-adjustments'
	});
	const supCtrl = createListControls<{ id: string; data: Supplier }>({
		items: () => suppliers, search: (s, q) => (s.data.name ?? '').toLowerCase().includes(q),
		sortOptions: () => [{ key: 'name', label: 'Name', value: (s) => s.data.name }, { key: 'status', label: 'Status', value: (s) => s.data.status ?? 'active' }],
		defaultSortKey: 'name', defaultViewMode: 'table', storageKey: 'inv-suppliers'
	});
	const poCtrl = createListControls<{ id: string; data: PurchaseOrder }>({
		items: () => orders, search: (o, q) => (o.data.number ?? '').toLowerCase().includes(q),
		sortOptions: () => [{ key: 'number', label: 'Number', value: (o) => o.data.number }, { key: 'total', label: 'Total', value: (o) => o.data.total }, { key: 'status', label: 'Status', value: (o) => o.data.status }],
		defaultSortKey: 'number', defaultSortDir: 'desc', defaultViewMode: 'table', storageKey: 'inv-pos'
	});

	// forms
	let dlgOpen = $state(false);
	let dlgKind = $state<Tab>('adjustments');
	let aProduct = $state(''); let aQty = $state(1); let aType = $state<'increase' | 'decrease'>('increase'); let aReason = $state('');
	let sName = $state(''); let sContact = $state(''); let sPhone = $state(''); let sTerms = $state('');
	let poSupplier = $state(''); let poLines = $state(''); // "Product x5@1000" lines

	function openCreate(t: Tab) { dlgKind = t; aProduct = ''; aQty = 1; aType = 'increase'; aReason = ''; sName = sContact = sPhone = sTerms = ''; poSupplier = ''; poLines = ''; dlgOpen = true; }

	async function save() {
		try {
			if (dlgKind === 'adjustments') {
				if (!aProduct.trim()) return toast.warning('Product required');
				await glo.upsert<StockAdjustment>(TYPE.adjustment, { productName: aProduct.trim(), type: aType, quantity: Number(aQty) || 0, reason: aReason.trim() || 'Manual adjustment', occurredAt: new Date().toISOString() });
			} else if (dlgKind === 'suppliers') {
				if (!sName.trim()) return toast.warning('Name required');
				await glo.upsert<Supplier>(TYPE.supplier, { name: sName.trim(), contactName: sContact.trim() || undefined, phone: sPhone.trim() || undefined, paymentTerms: sTerms.trim() || undefined, status: 'active' });
			} else {
				const lines = poLines.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
					const m = l.match(/^(.+?)\s*x\s*(\d+)\s*@\s*([\d.]+)$/i);
					const qty = m ? Number(m[2]) : 1; const price = m ? Number(m[3]) : 0; const name = m ? m[1].trim() : l;
					return { name, quantity: qty, unitPrice: price, total: qty * price };
				});
				await glo.upsert<PurchaseOrder>(TYPE.purchaseOrder, { number: 'PO-' + Date.now().toString().slice(-6), supplierName: poSupplier.trim() || undefined, status: 'sent', lines, total: lines.reduce((s, l) => s + l.total, 0), currency, orderedAt: new Date().toISOString() });
			}
			toast.success('Saved'); dlgOpen = false;
		} catch (e) { toast.error('Save failed', e instanceof Error ? e.message : undefined); }
	}
	function del(t: string, id: string) { glo.remove(t, id); toast.info('Removed'); }
	const dlgTitle = $derived({ adjustments: 'New stock adjustment', suppliers: 'Add supplier', orders: 'New purchase order' }[dlgKind]);
</script>

<svelte:head><title>bdGo OS · Inventory</title></svelte:head>

<div class="space-y-4">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h1 class="font-display text-xl font-bold tracking-tight">Inventory</h1>
			<p class="text-[12.5px] text-[var(--ui-text-muted)]">Stock, suppliers & purchase orders</p>
		</div>
		<Button color="primary" icon="lucide:plus" onclick={() => openCreate(tab)}>New {tab === 'adjustments' ? 'adjustment' : tab === 'suppliers' ? 'supplier' : 'order'}</Button>
	</div>

	<div class="segmented inline-flex w-fit gap-1 p-1">
		{#each tabs as t (t.id)}
			<button type="button" onclick={() => (tab = t.id)} class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-semibold transition-colors {tab === t.id ? 'bg-[var(--ui-bg-elevated)] text-[var(--ui-text)] shadow-sm' : 'text-[var(--ui-text-muted)]'}">
				<Icon name={t.icon} class="size-3.5" />{t.label}<span class="rounded bg-[var(--ui-bg-accented)] px-1.5 text-[10px] tabular-nums">{t.count()}</span>
			</button>
		{/each}
	</div>

	{#if tab === 'adjustments'}
		{#if adjustments.length || adjCtrl.search}<ListToolbar bind:search={adjCtrl.search} bind:sortKey={adjCtrl.sortKey} bind:sortDir={adjCtrl.sortDir} viewMode={adjCtrl.viewMode} sortItems={adjCtrl.sortItems} allowViewModes={['table']} applySort={adjCtrl.applySort} searchPlaceholder="Search product…" />{/if}
		{#if adjCtrl.list.length === 0}
			<EmptyState icon="lucide:arrow-up-down" title="No stock adjustments" description="Record increases or decreases to keep stock accurate.">
				{#snippet actions()}<Button color="primary" size="sm" icon="lucide:plus" onclick={() => openCreate('adjustments')}>New adjustment</Button>{/snippet}
			</EmptyState>
		{:else}
			<div class="data-panel">
				<table class="table-surface w-full text-left">
					<thead><tr>
						<SortableTh column="product" active={adjCtrl.sortKey === 'product'} direction={adjCtrl.sortDir} applySort={adjCtrl.applySort}>Product</SortableTh>
						<th class="px-5 py-2.5">Type</th><th class="px-5 py-2.5 text-right">Qty</th>
						<SortableTh column="date" active={adjCtrl.sortKey === 'date'} direction={adjCtrl.sortDir} align="right" applySort={adjCtrl.applySort}>When</SortableTh>
						<th class="w-10 px-5 py-2.5"></th>
					</tr></thead>
					<tbody class="divide-y divide-[var(--ui-border-muted)] text-[13px]">
						{#each adjCtrl.pagedList as a (a.id)}
							<tr>
								<td class="px-5 py-3"><div class="font-semibold">{a.data.productName}</div><div class="text-[11.5px] text-[var(--ui-text-dimmed)]">{a.data.reason}</div></td>
								<td class="px-5 py-3"><Badge color={a.data.type === 'increase' ? 'success' : 'error'}>{a.data.type}</Badge></td>
								<td class="px-5 py-3 text-right tabular-nums">{a.data.type === 'increase' ? '+' : '−'}{a.data.quantity}</td>
								<td class="px-5 py-3 text-right text-[12px] text-[var(--ui-text-dimmed)]">{relativeTime(a.data.occurredAt)}</td>
								<td class="px-5 py-3 text-right"><RowActions actions={[[{ label: 'Delete', icon: 'lucide:trash-2', danger: true, onSelect: () => del(TYPE.adjustment, a.id) }]]} /></td>
							</tr>
						{/each}
					</tbody>
				</table>
				<Pagination controls={adjCtrl} />
			</div>
		{/if}
	{:else if tab === 'suppliers'}
		{#if suppliers.length || supCtrl.search}<ListToolbar bind:search={supCtrl.search} bind:sortKey={supCtrl.sortKey} bind:sortDir={supCtrl.sortDir} viewMode={supCtrl.viewMode} sortItems={supCtrl.sortItems} allowViewModes={['table']} applySort={supCtrl.applySort} searchPlaceholder="Search supplier…" />{/if}
		{#if supCtrl.list.length === 0}
			<EmptyState icon="lucide:truck" title="No suppliers" description="Add suppliers to raise purchase orders.">
				{#snippet actions()}<Button color="primary" size="sm" icon="lucide:plus" onclick={() => openCreate('suppliers')}>Add supplier</Button>{/snippet}
			</EmptyState>
		{:else}
			<div class="data-panel">
				<table class="table-surface w-full text-left">
					<thead><tr>
						<SortableTh column="name" active={supCtrl.sortKey === 'name'} direction={supCtrl.sortDir} applySort={supCtrl.applySort}>Supplier</SortableTh>
						<th class="px-5 py-2.5">Contact</th>
						<SortableTh column="status" active={supCtrl.sortKey === 'status'} direction={supCtrl.sortDir} applySort={supCtrl.applySort}>Status</SortableTh>
						<th class="w-10 px-5 py-2.5"></th>
					</tr></thead>
					<tbody class="divide-y divide-[var(--ui-border-muted)] text-[13px]">
						{#each supCtrl.pagedList as s (s.id)}
							<tr>
								<td class="px-5 py-3 font-semibold">{s.data.name}{#if s.data.paymentTerms}<div class="text-[11px] text-[var(--ui-text-dimmed)]">{s.data.paymentTerms}</div>{/if}</td>
								<td class="px-5 py-3 text-[var(--ui-text-muted)]">{s.data.contactName ?? s.data.phone ?? '—'}</td>
								<td class="px-5 py-3"><Badge color={statusColor(s.data.status ?? 'active')}>{s.data.status ?? 'active'}</Badge></td>
								<td class="px-5 py-3 text-right"><RowActions actions={[[{ label: 'Delete', icon: 'lucide:trash-2', danger: true, onSelect: () => del(TYPE.supplier, s.id) }]]} /></td>
							</tr>
						{/each}
					</tbody>
				</table>
				<Pagination controls={supCtrl} />
			</div>
		{/if}
	{:else}
		{#if orders.length || poCtrl.search}<ListToolbar bind:search={poCtrl.search} bind:sortKey={poCtrl.sortKey} bind:sortDir={poCtrl.sortDir} viewMode={poCtrl.viewMode} sortItems={poCtrl.sortItems} allowViewModes={['table']} applySort={poCtrl.applySort} searchPlaceholder="Search PO no…" />{/if}
		{#if poCtrl.list.length === 0}
			<EmptyState icon="lucide:clipboard-list" title="No purchase orders" description="Raise POs to your suppliers.">
				{#snippet actions()}<Button color="primary" size="sm" icon="lucide:plus" onclick={() => openCreate('orders')}>New order</Button>{/snippet}
			</EmptyState>
		{:else}
			<div class="data-panel">
				<table class="table-surface w-full text-left">
					<thead><tr>
						<SortableTh column="number" active={poCtrl.sortKey === 'number'} direction={poCtrl.sortDir} applySort={poCtrl.applySort}>PO</SortableTh>
						<th class="px-5 py-2.5">Supplier</th>
						<SortableTh column="status" active={poCtrl.sortKey === 'status'} direction={poCtrl.sortDir} applySort={poCtrl.applySort}>Status</SortableTh>
						<SortableTh column="total" active={poCtrl.sortKey === 'total'} direction={poCtrl.sortDir} align="right" applySort={poCtrl.applySort}>Total</SortableTh>
						<th class="w-10 px-5 py-2.5"></th>
					</tr></thead>
					<tbody class="divide-y divide-[var(--ui-border-muted)] text-[13px]">
						{#each poCtrl.pagedList as o (o.id)}
							<tr>
								<td class="px-5 py-3 font-mono text-[12.5px]">{o.data.number}</td>
								<td class="px-5 py-3 text-[var(--ui-text-muted)]">{o.data.supplierName ?? '—'}</td>
								<td class="px-5 py-3"><Badge color={statusColor(o.data.status)}>{o.data.status}</Badge></td>
								<td class="px-5 py-3 text-right font-semibold tabular-nums">{formatMoney(o.data.total, o.data.currency || currency)}</td>
								<td class="px-5 py-3 text-right"><RowActions actions={[[{ label: 'Delete', icon: 'lucide:trash-2', danger: true, onSelect: () => del(TYPE.purchaseOrder, o.id) }]]} /></td>
							</tr>
						{/each}
					</tbody>
				</table>
				<Pagination controls={poCtrl} />
			</div>
		{/if}
	{/if}
</div>

<Dialog bind:open={dlgOpen} title={dlgTitle}>
	{#if dlgKind === 'adjustments'}
		<div class="space-y-3">
			<label class="block"><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Product</span><Input bind:value={aProduct} class="w-full" /></label>
			<div class="grid grid-cols-2 gap-3">
				<label class="block"><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Type</span>
					<div class="segmented flex gap-1 p-1">
						<button type="button" onclick={() => (aType = 'increase')} class="flex-1 rounded-md px-3 py-1.5 text-[12px] font-semibold {aType === 'increase' ? 'bg-[var(--ui-bg-elevated)]' : 'text-[var(--ui-text-muted)]'}">Increase</button>
						<button type="button" onclick={() => (aType = 'decrease')} class="flex-1 rounded-md px-3 py-1.5 text-[12px] font-semibold {aType === 'decrease' ? 'bg-[var(--ui-bg-elevated)]' : 'text-[var(--ui-text-muted)]'}">Decrease</button>
					</div>
				</label>
				<label class="block"><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Quantity</span><Input bind:value={aQty} type="number" min="0" class="w-full" /></label>
			</div>
			<label class="block"><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Reason</span><Input bind:value={aReason} class="w-full" /></label>
		</div>
	{:else if dlgKind === 'suppliers'}
		<div class="space-y-3">
			<label class="block"><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Name</span><Input bind:value={sName} class="w-full" /></label>
			<div class="grid grid-cols-2 gap-3">
				<label class="block"><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Contact</span><Input bind:value={sContact} class="w-full" /></label>
				<label class="block"><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Phone</span><Input bind:value={sPhone} class="w-full" /></label>
			</div>
			<label class="block"><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Payment terms</span><Input bind:value={sTerms} placeholder="Net 30" class="w-full" /></label>
		</div>
	{:else}
		<div class="space-y-3">
			<label class="block"><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Supplier</span><Input bind:value={poSupplier} list="sups" class="w-full" /><datalist id="sups">{#each suppliers as s (s.id)}<option value={s.data.name}></option>{/each}</datalist></label>
			<label class="block"><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Lines (one per line: <code>Name xQty@Price</code>)</span><Input bind:value={poLines} textarea placeholder="Coffee Beans x10@35000&#10;Milk x20@8000" class="w-full font-mono text-[12px]" /></label>
		</div>
	{/if}
	{#snippet footer()}<Button color="neutral" variant="ghost" onclick={() => (dlgOpen = false)}>Cancel</Button><Button color="primary" icon="lucide:check" onclick={save}>Save</Button>{/snippet}
</Dialog>
