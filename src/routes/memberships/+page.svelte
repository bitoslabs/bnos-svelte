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
	import { formatMoney, relativeTime } from '$lib/utils/format';
	import { TYPE, statusColor, type Membership, type MembershipSubscription, type MembershipCheckIn } from '$lib/domain';

	type Tab = 'plans' | 'subscriptions' | 'checkins';
	let tab = $state<Tab>('plans');
	onMount(() => { glo.hydrate(TYPE.membership); glo.hydrate(TYPE.membershipSubscription); glo.hydrate(TYPE.membershipCheckIn); void glo.syncAll([TYPE.membership, TYPE.membershipSubscription, TYPE.membershipCheckIn]); });

	const currency = $derived(tenant.state.currency);
	const plans = $derived(glo.all<Membership, typeof TYPE.membership>(TYPE.membership));
	const subs = $derived(glo.all<MembershipSubscription, typeof TYPE.membershipSubscription>(TYPE.membershipSubscription));
	const checkins = $derived(glo.all<MembershipCheckIn, typeof TYPE.membershipCheckIn>(TYPE.membershipCheckIn));

	const planCtrl = createListControls<{ id: string; data: Membership }>({ items: () => plans, search: (m, q) => (m.data.name ?? '').toLowerCase().includes(q), sortOptions: () => [{ key: 'name', label: 'Name', value: (m) => m.data.name }, { key: 'price', label: 'Price', value: (m) => m.data.price }], defaultSortKey: 'name', defaultViewMode: 'grid', storageKey: 'memberships-plans' });
	const subCtrl = createListControls<{ id: string; data: MembershipSubscription }>({ items: () => subs, search: (s, q) => (s.data.customerName ?? '').toLowerCase().includes(q), sortOptions: () => [{ key: 'customer', label: 'Customer', value: (s) => s.data.customerName ?? '~' }, { key: 'status', label: 'Status', value: (s) => s.data.status }], defaultSortKey: 'customer', defaultViewMode: 'table', storageKey: 'memberships-subs' });
	const ciCtrl = createListControls<{ id: string; data: MembershipCheckIn }>({ items: () => checkins, search: (c, q) => (c.data.customerName ?? '').toLowerCase().includes(q), sortOptions: () => [{ key: 'date', label: 'Date', value: (c) => c.data.occurredAt }], defaultSortKey: 'date', defaultSortDir: 'desc', defaultViewMode: 'table', storageKey: 'memberships-checkins' });

	let open = $state(false); let dlgTab = $state<Tab>('plans');
	let mName = $state(''); let mMode = $state<Membership['mode']>('normal'); let mPrice = $state<number | ''>(''); let mPeriod = $state<Membership['period']>('monthly'); let mDays = $state(30);
	let subCust = $state(''); let subPlan = $state('');
	let ciCust = $state(''); let ciResult = $state<'allowed' | 'denied' | 'override'>('allowed');

	function openCreate(t: Tab) { dlgTab = t; mName = ''; mMode = 'normal'; mPrice = ''; mPeriod = 'monthly'; mDays = 30; subCust = ''; subPlan = ''; ciCust = ''; ciResult = 'allowed'; open = true; }
	async function save() {
		if (dlgTab === 'plans') {
			if (!mName.trim()) return toast.warning('Name required');
			await glo.upsert<Membership>(TYPE.membership, { name: mName.trim(), mode: mMode, price: typeof mPrice === 'number' ? mPrice : Number(mPrice) || 0, currency, period: mPeriod, durationDays: mDays, status: 'active' });
		} else if (dlgTab === 'subscriptions') {
			if (!subCust.trim()) return toast.warning('Customer required');
			const plan = plans.find((p) => p.data.name === subPlan);
			const now = new Date(); const end = new Date(now.getTime() + ((plan?.data.durationDays ?? 30) * 86_400_000));
			await glo.upsert<MembershipSubscription>(TYPE.membershipSubscription, { customerName: subCust.trim(), membershipName: subPlan || plan?.data.name, status: 'active', startsAt: now.toISOString(), endsAt: end.toISOString() });
		} else {
			if (!ciCust.trim()) return toast.warning('Customer required');
			await glo.upsert<MembershipCheckIn>(TYPE.membershipCheckIn, { customerName: ciCust.trim(), result: ciResult, occurredAt: new Date().toISOString() });
		}
		toast.success('Saved'); open = false;
	}
	const tabs = [{ id: 'plans' as Tab, label: 'Plans', icon: 'lucide:layers' }, { id: 'subscriptions' as Tab, label: 'Subscriptions', icon: 'lucide:badge-check' }, { id: 'checkins' as Tab, label: 'Check-ins', icon: 'lucide:door-open' }];
</script>

<svelte:head><title>BNOS · Memberships</title></svelte:head>

<div class="space-y-4">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div><h1 class="font-display text-xl font-bold tracking-tight">Memberships</h1><p class="text-[12.5px] text-[var(--ui-text-muted)]">Tiers, subscriptions & check-ins · kinds 30311–30315</p></div>
		<Button color="primary" icon="lucide:plus" onclick={() => openCreate(tab)}>New {tab === 'plans' ? 'plan' : tab === 'subscriptions' ? 'subscription' : 'check-in'}</Button>
	</div>
	<div class="segmented inline-flex w-fit gap-1 p-1">
		{#each tabs as t (t.id)}<button type="button" onclick={() => (tab = t.id)} class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-semibold transition-colors {tab === t.id ? 'bg-[var(--ui-bg-elevated)] text-[var(--ui-text)] shadow-sm' : 'text-[var(--ui-text-muted)]'}"><Icon name={t.icon} class="size-3.5" />{t.label}<span class="rounded bg-[var(--ui-bg-accented)] px-1.5 text-[10px] tabular-nums">{t.id === 'plans' ? plans.length : t.id === 'subscriptions' ? subs.length : checkins.length}</span></button>{/each}
	</div>

	{#if tab === 'plans'}
		{#if plans.length === 0}<EmptyState icon="lucide:layers" title="No membership plans" description="Create tiers for gyms, clubs or VIP customers.">{#snippet actions()}<Button color="primary" size="sm" icon="lucide:plus" onclick={() => openCreate('plans')}>New plan</Button>{/snippet}</EmptyState>
		{:else}
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{#each planCtrl.pagedList as p (p.id)}
					<div class="accent-bar surface-card p-5" style="--accent:var(--ui-color-primary-500);">
						<div class="flex items-start justify-between"><div class="grid size-10 place-items-center rounded-xl bg-primary-500/10 text-primary-600 dark:text-primary-400"><Icon name={p.data.mode === 'gym' ? 'lucide:dumbbell' : 'lucide:crown'} class="size-5" /></div><Badge color={statusColor(p.data.status)}>{p.data.status}</Badge></div>
						<div class="mt-3 font-display text-lg font-bold">{p.data.name}</div>
						<div class="font-display text-2xl font-bold tabular-nums">{formatMoney(p.data.price, p.data.currency || currency)}<span class="text-[12px] font-medium text-[var(--ui-text-dimmed)]">/{p.data.period}</span></div>
						<div class="mt-1 text-[11.5px] text-[var(--ui-text-muted)] capitalize">{p.data.mode} · {p.data.durationDays ?? '∞'} days</div>
						<div class="mt-3 flex justify-end"><Button color="neutral" variant="ghost" size="icon-sm" icon="lucide:trash-2" onclick={() => { glo.remove(TYPE.membership, p.id); toast.info('Removed'); }} /></div>
					</div>
				{/each}
			</div>
			<Pagination controls={planCtrl} />
		{/if}
	{:else if tab === 'subscriptions'}
		{#if subs.length === 0}<EmptyState icon="lucide:badge-check" title="No subscriptions" description="Enroll customers into a membership plan.">{#snippet actions()}<Button color="primary" size="sm" icon="lucide:plus" onclick={() => openCreate('subscriptions')}>New subscription</Button>{/snippet}</EmptyState>
		{:else}
			<div class="data-panel">
				<table class="table-surface w-full text-left"><thead><tr><th class="px-5 py-2.5">Customer</th><th class="px-5 py-2.5">Plan</th><th class="px-5 py-2.5">Status</th><th class="px-5 py-2.5 text-right">Ends</th><th class="w-10 px-5 py-2.5"></th></tr></thead>
					<tbody class="divide-y divide-[var(--ui-border-muted)] text-[13px]">
						{#each subCtrl.pagedList as s (s.id)}<tr><td class="px-5 py-3 font-semibold">{s.data.customerName ?? '—'}</td><td class="px-5 py-3 text-[var(--ui-text-muted)]">{s.data.membershipName ?? '—'}</td><td class="px-5 py-3"><Badge color={statusColor(s.data.status)}>{s.data.status}</Badge></td><td class="px-5 py-3 text-right text-[12px] text-[var(--ui-text-dimmed)]">{s.data.endsAt ? relativeTime(s.data.endsAt) : '—'}</td><td class="px-5 py-3 text-right"><Button color="neutral" variant="ghost" size="icon-sm" icon="lucide:trash-2" onclick={() => { glo.remove(TYPE.membershipSubscription, s.id); toast.info('Removed'); }} /></td></tr>{/each}
					</tbody>
				</table>
				<Pagination controls={subCtrl} />
			</div>
		{/if}
	{:else}
		{#if checkins.length === 0}<EmptyState icon="lucide:door-open" title="No check-ins" description="Record gym/club attendance.">{#snippet actions()}<Button color="primary" size="sm" icon="lucide:plus" onclick={() => openCreate('checkins')}>New check-in</Button>{/snippet}</EmptyState>
		{:else}
			<div class="data-panel">
				<table class="table-surface w-full text-left"><thead><tr><th class="px-5 py-2.5">Customer</th><th class="px-5 py-2.5">Result</th><th class="px-5 py-2.5 text-right">When</th><th class="w-10 px-5 py-2.5"></th></tr></thead>
					<tbody class="divide-y divide-[var(--ui-border-muted)] text-[13px]">
						{#each ciCtrl.pagedList as c (c.id)}<tr><td class="px-5 py-3 font-semibold">{c.data.customerName ?? '—'}</td><td class="px-5 py-3"><Badge color={statusColor(c.data.result)}>{c.data.result}</Badge></td><td class="px-5 py-3 text-right text-[12px] text-[var(--ui-text-dimmed)]">{relativeTime(c.data.occurredAt)}</td><td class="px-5 py-3 text-right"><Button color="neutral" variant="ghost" size="icon-sm" icon="lucide:trash-2" onclick={() => { glo.remove(TYPE.membershipCheckIn, c.id); toast.info('Removed'); }} /></td></tr>{/each}
					</tbody>
				</table>
				<Pagination controls={ciCtrl} />
			</div>
		{/if}
	{/if}
</div>

<Dialog bind:open={open} title={dlgTab === 'plans' ? 'New plan' : dlgTab === 'subscriptions' ? 'New subscription' : 'New check-in'}>
	{#if dlgTab === 'plans'}
		<div class="space-y-3">
			<label class="block"><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Plan name</span><Input bind:value={mName} class="w-full" /></label>
			<div class="grid grid-cols-2 gap-3">
				<label class="block"><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Mode</span><Select bind:value={mMode} options={[{ value: 'normal', label: 'Normal' }, { value: 'gym', label: 'Gym' }, { value: 'hybrid', label: 'Hybrid' }]} class="w-full" /></label>
				<label class="block"><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Period</span><Select bind:value={mPeriod} options={[{ value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }, { value: 'yearly', label: 'Yearly' }]} class="w-full" /></label>
			</div>
			<div class="grid grid-cols-2 gap-3">
				<label class="block"><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Price ({currency})</span><Input bind:value={mPrice} type="number" min="0" class="w-full" /></label>
				<label class="block"><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Duration (days)</span><Input bind:value={mDays} type="number" min="1" class="w-full" /></label>
			</div>
		</div>
	{:else if dlgTab === 'subscriptions'}
		<div class="space-y-3">
			<label class="block"><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Customer</span><Input bind:value={subCust} class="w-full" /></label>
			<label class="block"><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Plan</span><Input bind:value={subPlan} list="planslist" class="w-full" /><datalist id="planslist">{#each plans as p (p.id)}<option value={p.data.name}></option>{/each}</datalist></label>
		</div>
	{:else}
		<div class="space-y-3">
			<label class="block"><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Customer</span><Input bind:value={ciCust} class="w-full" /></label>
			<label class="block"><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Result</span><Select bind:value={ciResult} options={[{ value: 'allowed', label: 'Allowed' }, { value: 'denied', label: 'Denied' }, { value: 'override', label: 'Override' }]} class="w-full" /></label>
		</div>
	{/if}
	{#snippet footer()}<Button color="neutral" variant="ghost" onclick={() => (open = false)}>Cancel</Button><Button color="primary" icon="lucide:check" onclick={save}>Save</Button>{/snippet}
</Dialog>
