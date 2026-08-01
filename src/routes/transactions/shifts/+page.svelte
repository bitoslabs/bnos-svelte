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
	import { formatMoney, relativeTime } from '$lib/utils/format';
	import { TYPE, statusColor, type Shift, type CashEvent } from '$lib/domain';

	onMount(() => { glo.hydrate(TYPE.shift); glo.hydrate(TYPE.cashEvent); void glo.syncAll([TYPE.shift, TYPE.cashEvent]); });

	const currency = $derived(tenant.state.currency);
	const shifts = $derived(glo.all<Shift, typeof TYPE.shift>(TYPE.shift));
	const events = $derived(glo.all<CashEvent, typeof TYPE.cashEvent>(TYPE.cashEvent));
	const activeShift = $derived(shifts.find((s) => s.data.status === 'active'));

	let opening = $state<number | ''>('');
	let cashAmt = $state<number | ''>('');
	let cashType = $state<'cash_in' | 'cash_out' | 'paid_out' | 'bank_deposit'>('cash_in');
	let cashReason = $state('');

	async function openShift() {
		await glo.upsert<Shift>(TYPE.shift, { number: 'SFT-' + Date.now().toString().slice(-6), status: 'active', openingCash: typeof opening === 'number' ? opening : Number(opening) || 0, currency, openedAt: new Date().toISOString() });
		toast.success('Shift opened'); opening = '';
	}
	async function closeShift() {
		if (!activeShift) return;
		await glo.upsert<Shift>(TYPE.shift, { ...activeShift.data, status: 'closed', closingCash: activeShift.data.openingCash, expectedCash: activeShift.data.openingCash, difference: 0, closedAt: new Date().toISOString() }, { id: activeShift.id });
		toast.success('Shift closed');
	}
	async function addCashEvent() {
		if (!activeShift) return toast.warning('Open a shift first');
		await glo.upsert<CashEvent>(TYPE.cashEvent, { shiftId: activeShift.id, type: cashType, amount: typeof cashAmt === 'number' ? cashAmt : Number(cashAmt) || 0, currency, reason: cashReason.trim() || undefined, occurredAt: new Date().toISOString() });
		toast.success('Cash event recorded'); cashAmt = ''; cashReason = '';
	}
</script>

<svelte:head><title>BNOS · Shifts</title></svelte:head>

<div class="space-y-4">
	<div><h1 class="font-display text-xl font-bold tracking-tight">Shifts & cash drawer</h1><p class="text-[12.5px] text-[var(--ui-text-muted)]">Open/close shifts, record cash movements · kinds 30520/30521</p></div>

	<!-- active shift / open -->
	{#if activeShift}
		<div class="accent-bar surface-card flex flex-wrap items-center justify-between gap-3 p-5" style="--accent:var(--tone-success-text);">
			<div class="flex items-center gap-3"><div class="grid size-10 place-items-center rounded-xl bg-[var(--tone-success-bg)] text-[var(--tone-success-text)]"><Icon name="lucide:lock-open" class="size-5" /></div><div><div class="text-[11px] font-semibold uppercase tracking-wider text-[var(--ui-text-dimmed)]">Active shift</div><div class="font-mono text-[14px] font-semibold">{activeShift.data.number}</div><div class="text-[11.5px] text-[var(--ui-text-muted)]">Opened {relativeTime(activeShift.data.openedAt)} · {formatMoney(activeShift.data.openingCash, currency)}</div></div></div>
			<Button color="neutral" variant="subtle" icon="lucide:lock" onclick={closeShift}>Close shift</Button>
		</div>
	{:else}
		<div class="surface-card flex flex-wrap items-end gap-3 p-5">
			<div class="flex-1"><div class="mb-1.5 text-[12px] font-semibold text-[var(--ui-text-muted)]">Opening cash float</div><Input bind:value={opening} type="number" icon="lucide:banknote" min="0" placeholder="0.00" class="w-full" /></div>
			<Button color="primary" icon="lucide:lock-open" onclick={openShift}>Open shift</Button>
		</div>
	{/if}

	<!-- cash event entry -->
	<div class="surface-card flex flex-wrap items-end gap-2 p-4">
		<div class="min-w-[10rem] flex-1"><Input bind:value={cashAmt} type="number" icon="lucide:banknote" min="0" placeholder="Amount" class="w-full" /></div>
		<div class="relative inline-flex items-center rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)]"><select bind:value={cashType} class="h-9 appearance-none rounded-lg bg-transparent py-0 pr-8 pl-3 text-[13px] font-medium focus:outline-none"><option value="cash_in">Cash in</option><option value="cash_out">Cash out</option><option value="paid_out">Paid out</option><option value="bank_deposit">Bank deposit</option></select><Icon name="lucide:chevron-down" class="pointer-events-none absolute right-2 size-3.5 text-[var(--ui-text-dimmed)]" /></div>
		<div class="min-w-[10rem] flex-1"><Input bind:value={cashReason} placeholder="Reason (optional)" class="w-full" /></div>
		<Button color="neutral" variant="subtle" icon="lucide:plus" onclick={addCashEvent}>Add</Button>
	</div>

	<!-- cash events -->
	{#if events.length === 0}
		<EmptyState icon="lucide:banknote" title="No cash movements" description="Cash in/out, paid outs and bank deposits appear here." />
	{:else}
		<div class="data-panel">
			<table class="table-surface w-full text-left">
				<thead><tr><th class="px-5 py-2.5">Type</th><th class="px-5 py-2.5">Reason</th><th class="px-5 py-2.5 text-right">Amount</th><th class="px-5 py-2.5 text-right">When</th></tr></thead>
				<tbody class="divide-y divide-[var(--ui-border-muted)] text-[13px]">
					{#each events.slice(0, 50) as e (e.id)}<tr><td class="px-5 py-3"><Badge color={e.data.type === 'cash_in' ? 'success' : 'info'}>{e.data.type.replace('_', ' ')}</Badge></td><td class="px-5 py-3 text-[var(--ui-text-muted)]">{e.data.reason ?? '—'}</td><td class="px-5 py-3 text-right font-semibold tabular-nums {e.data.type === 'cash_in' ? 'text-[var(--tone-success-text)]' : 'text-[var(--tone-error-text)]'}">{e.data.type === 'cash_in' ? '+' : '−'}{formatMoney(e.data.amount, e.data.currency || currency)}</td><td class="px-5 py-3 text-right text-[12px] text-[var(--ui-text-dimmed)]">{relativeTime(e.data.occurredAt)}</td></tr>{/each}
				</tbody>
			</table>
		</div>
	{/if}

	<!-- shift history -->
	{#if shifts.length}
		<div class="data-panel">
			<div class="border-b border-[var(--ui-border-muted)] px-5 py-3 text-[13px] font-semibold">Shift history</div>
			<table class="table-surface w-full text-left">
				<thead><tr><th class="px-5 py-2.5">Shift</th><th class="px-5 py-2.5">Status</th><th class="px-5 py-2.5 text-right">Opening</th><th class="px-5 py-2.5 text-right">Closed</th></tr></thead>
				<tbody class="divide-y divide-[var(--ui-border-muted)] text-[13px]">
					{#each shifts as s (s.id)}<tr><td class="px-5 py-3 font-mono text-[12.5px]">{s.data.number}</td><td class="px-5 py-3"><Badge color={statusColor(s.data.status)}>{s.data.status}</Badge></td><td class="px-5 py-3 text-right tabular-nums">{formatMoney(s.data.openingCash, s.data.currency || currency)}</td><td class="px-5 py-3 text-right text-[12px] text-[var(--ui-text-dimmed)]">{s.data.closedAt ? relativeTime(s.data.closedAt) : '—'}</td></tr>{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
