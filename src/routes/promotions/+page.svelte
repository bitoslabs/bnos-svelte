<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Pagination from '$lib/components/list/Pagination.svelte';
	import { createListControls } from '$lib/utils/list.svelte';
	import { glo } from '$nostr/store.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { relativeTime } from '$lib/utils/format';
	import { TYPE, statusColor, type Coupon, type Promotion } from '$lib/domain';

	type Tab = 'coupons' | 'promotions';
	let tab = $state<Tab>('coupons');
	onMount(() => { glo.hydrate(TYPE.coupon); glo.hydrate(TYPE.promotion); void glo.syncAll([TYPE.coupon, TYPE.promotion]); });

	const currency = $derived(tenant.state.currency);
	const coupons = $derived(glo.all<Coupon, typeof TYPE.coupon>(TYPE.coupon));
	const promos = $derived(glo.all<Promotion, typeof TYPE.promotion>(TYPE.promotion));

	const cCtrl = createListControls<{ id: string; data: Coupon }>({ items: () => coupons, search: (c, q) => (c.data.code ?? '').toLowerCase().includes(q), sortOptions: () => [{ key: 'code', label: 'Code', value: (c) => c.data.code }, { key: 'uses', label: 'Uses', value: (c) => c.data.uses ?? 0 }, { key: 'status', label: 'Status', value: (c) => c.data.status }], defaultSortKey: 'code', defaultViewMode: 'grid', storageKey: 'promos-coupons' });
	const pCtrl = createListControls<{ id: string; data: Promotion }>({ items: () => promos, search: (p, q) => (p.data.name ?? '').toLowerCase().includes(q), sortOptions: () => [{ key: 'name', label: 'Name', value: (p) => p.data.name }, { key: 'status', label: 'Status', value: (p) => p.data.status }], defaultSortKey: 'name', defaultViewMode: 'grid', storageKey: 'promos-promos' });

	let open = $state(false); let dlgTab = $state<Tab>('coupons');
	let cCode = $state(''); let cType = $state<'percent' | 'fixed' | 'bogo'>('percent'); let cValue = $state<number | ''>(''); let cMax = $state<number | ''>('');
	let pName = $state(''); let pType = $state<'percent' | 'fixed' | 'bogo' | 'bundle'>('percent'); let pValue = $state<number | ''>(''); let pDesc = $state('');

	function openCreate(t: Tab) { dlgTab = t; cCode = ''; cType = 'percent'; cValue = ''; cMax = ''; pName = ''; pType = 'percent'; pValue = ''; pDesc = ''; open = true; }
	async function save() {
		if (dlgTab === 'coupons') {
			if (!cCode.trim()) return toast.warning('Code required');
			await glo.upsert<Coupon>(TYPE.coupon, { code: cCode.trim().toUpperCase(), type: cType, value: typeof cValue === 'number' ? cValue : Number(cValue) || 0, currency, maxUses: typeof cMax === 'number' ? cMax : Number(cMax) || undefined, uses: 0, status: 'active' });
		} else {
			if (!pName.trim()) return toast.warning('Name required');
			await glo.upsert<Promotion>(TYPE.promotion, { name: pName.trim(), type: pType, value: typeof pValue === 'number' ? pValue : Number(pValue) || 0, description: pDesc.trim() || undefined, status: 'active' });
		}
		toast.success('Saved'); open = false;
	}
	function badge(v: { type: string; value: number }) { return v.type === 'percent' ? `${v.value}%` : v.type === 'bogo' ? 'BOGO' : `${v.value}`; }
</script>

<svelte:head><title>bdGo OS · Promotions</title></svelte:head>

<div class="space-y-4">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div><h1 class="font-display text-xl font-bold tracking-tight">Promotions</h1><p class="text-[12.5px] text-[var(--ui-text-muted)]">Coupons & promotions · kinds 30310/30313</p></div>
		<Button color="primary" icon="lucide:plus" onclick={() => openCreate(tab)}>New {tab === 'coupons' ? 'coupon' : 'promotion'}</Button>
	</div>
	<div class="segmented inline-flex w-fit gap-1 p-1">
		{#each [{ id: 'coupons' as Tab, label: 'Coupons', icon: 'lucide:ticket', n: coupons.length }, { id: 'promotions' as Tab, label: 'Promotions', icon: 'lucide:megaphone', n: promos.length }] as t (t.id)}
			<button type="button" onclick={() => (tab = t.id)} class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-semibold transition-colors {tab === t.id ? 'bg-[var(--ui-bg-elevated)] text-[var(--ui-text)] shadow-sm' : 'text-[var(--ui-text-muted)]'}"><Icon name={t.icon} class="size-3.5" />{t.label}<span class="rounded bg-[var(--ui-bg-accented)] px-1.5 text-[10px] tabular-nums">{t.n}</span></button>
		{/each}
	</div>

	{#if tab === 'coupons'}
		{#if coupons.length === 0}<EmptyState icon="lucide:ticket" title="No coupons" description="Create discount codes for checkout.">{#snippet actions()}<Button color="primary" size="sm" icon="lucide:plus" onclick={() => openCreate('coupons')}>New coupon</Button>{/snippet}</EmptyState>
		{:else}
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{#each cCtrl.pagedList as c (c.id)}
					<div class="accent-bar surface-card p-5" style="--accent:var(--color-amber-accent);">
						<div class="flex items-start justify-between"><div class="grid size-10 place-items-center rounded-xl bg-[var(--tone-warning-bg)] text-[var(--tone-warning-text)]"><Icon name="lucide:ticket" class="size-5" /></div><Badge color={statusColor(c.data.status)}>{c.data.status}</Badge></div>
						<div class="mt-3 font-mono text-lg font-bold tracking-wider">{c.data.code}</div>
						<div class="font-display text-2xl font-bold tabular-nums text-[var(--tone-warning-text)]">{badge(c.data)}</div>
						<div class="mt-1 text-[11.5px] text-[var(--ui-text-muted)]">{c.data.uses ?? 0}{#if c.data.maxUses}/{c.data.maxUses}{/if} uses</div>
						<div class="mt-3 flex justify-end"><Button color="neutral" variant="ghost" size="icon-sm" icon="lucide:trash-2" onclick={() => { glo.remove(TYPE.coupon, c.id); toast.info('Removed'); }} /></div>
					</div>
				{/each}
			</div>
			<Pagination controls={cCtrl} />
		{/if}
	{:else}
		{#if promos.length === 0}<EmptyState icon="lucide:megaphone" title="No promotions" description="Run sales campaigns, bundles & BOGO offers.">{#snippet actions()}<Button color="primary" size="sm" icon="lucide:plus" onclick={() => openCreate('promotions')}>New promotion</Button>{/snippet}</EmptyState>
		{:else}
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{#each pCtrl.pagedList as p (p.id)}
					<div class="accent-bar surface-card p-5" style="--accent:var(--color-pink-accent);">
						<div class="flex items-start justify-between"><div class="grid size-10 place-items-center rounded-xl bg-pink-500/10 text-pink-500"><Icon name="lucide:megaphone" class="size-5" /></div><Badge color={statusColor(p.data.status)}>{p.data.status}</Badge></div>
						<div class="mt-3 font-display text-lg font-bold">{p.data.name}</div>
						<div class="font-display text-2xl font-bold tabular-nums text-pink-500">{badge(p.data)}</div>
						{#if p.data.description}<div class="mt-1 text-[11.5px] text-[var(--ui-text-muted)]">{p.data.description}</div>{/if}
						<div class="mt-3 flex justify-end"><Button color="neutral" variant="ghost" size="icon-sm" icon="lucide:trash-2" onclick={() => { glo.remove(TYPE.promotion, p.id); toast.info('Removed'); }} /></div>
					</div>
				{/each}
			</div>
			<Pagination controls={pCtrl} />
		{/if}
	{/if}
</div>

<Dialog bind:open={open} title={dlgTab === 'coupons' ? 'New coupon' : 'New promotion'}>
	{#if dlgTab === 'coupons'}
		<div class="space-y-3">
			<label class="block"><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Code</span><Input bind:value={cCode} placeholder="SUMMER20" class="w-full font-mono uppercase" /></label>
			<div class="grid grid-cols-2 gap-3">
				<label class="block"><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Type</span><Select bind:value={cType} options={[{ value: 'percent', label: 'Percent' }, { value: 'fixed', label: 'Fixed amount' }, { value: 'bogo', label: 'Buy one get one' }]} class="w-full" /></label>
				<label class="block"><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Value {cType === 'percent' ? '(%)' : `(${currency})`}</span><Input bind:value={cValue} type="number" min="0" class="w-full" /></label>
			</div>
			<label class="block"><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Max uses (optional)</span><Input bind:value={cMax} type="number" min="0" class="w-full" /></label>
		</div>
	{:else}
		<div class="space-y-3">
			<label class="block"><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Name</span><Input bind:value={pName} placeholder="Happy Hour" class="w-full" /></label>
			<div class="grid grid-cols-2 gap-3">
				<label class="block"><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Type</span><Select bind:value={pType} options={[{ value: 'percent', label: 'Percent' }, { value: 'fixed', label: 'Fixed' }, { value: 'bogo', label: 'BOGO' }, { value: 'bundle', label: 'Bundle' }]} class="w-full" /></label>
				<label class="block"><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Value {pType === 'percent' ? '(%)' : `(${currency})`}</span><Input bind:value={pValue} type="number" min="0" class="w-full" /></label>
			</div>
			<label class="block"><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Description</span><Input bind:value={pDesc} class="w-full" /></label>
		</div>
	{/if}
	{#snippet footer()}<Button color="neutral" variant="ghost" onclick={() => (open = false)}>Cancel</Button><Button color="primary" icon="lucide:check" onclick={save}>Save</Button>{/snippet}
</Dialog>
