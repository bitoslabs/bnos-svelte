<script lang="ts">
	import { onMount } from 'svelte';
	import { t } from '$lib/i18n/i18n.svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import RawDataDialog from '$lib/components/ui/RawDataDialog.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { glo } from '$nostr/store.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatMoney, relativeTime } from '$lib/utils/format';
	import { TYPE, statusColor, type Order, type Payment, type GloObject } from '$lib/domain';

	const id = $derived(page.params.id);

	onMount(() => {
		glo.hydrate(TYPE.order);
		glo.hydrate(TYPE.payment);
	});

	// Try to find as order first, then as payment
	let rawOpen = $state(false);
	let rawItem = $state<any>(null);
	const order = $derived(glo.get(TYPE.order, id ?? '') as GloObject<Order, typeof TYPE.order> | undefined);
	const payment = $derived(glo.get(TYPE.payment, id ?? '') as GloObject<Payment, typeof TYPE.payment> | undefined);
	const currency = $derived(tenant.state.currency);

	const txType = $derived(order ? 'order' : payment ? 'payment' : null);
	const txData = $derived(order?.data ?? payment?.data);
	const txAmount = $derived((order?.data as any)?.total ?? (payment?.data as any)?.amount ?? 0);
	const txStatus = $derived((order?.data as any)?.status ?? (payment?.data as any)?.status ?? 'unknown');
	const txDate = $derived((order?.data as any)?.occurredAt ?? (payment?.data as any)?.occurredAt);

	// For orders: find related payments
	const orderPayments = $derived(
		order ? glo.all<Payment, typeof TYPE.payment>(TYPE.payment).filter((p) => p.data.orderId === id) : []
	);
</script>

<svelte:head><title>Transaction {(id ?? '').slice(0, 8)} · BNOS</title></svelte:head>

{#if !txType}
	<EmptyState icon="lucide:search-x" title={t('transactions.notFound')} description="This transaction may have been deleted or hasn't synced yet.">
		{#snippet actions()}<Button color="neutral" variant="subtle" size="sm" icon="lucide:arrow-left" href="/transactions">Back to transactions</Button>{/snippet}
	</EmptyState>
{:else}
	<div class="space-y-4">
		<!-- Header -->
		<div class="flex flex-wrap items-start justify-between gap-3">
			<div class="flex items-center gap-3">
				<Button color="neutral" variant="ghost" size="icon-sm" icon="lucide:arrow-left" onclick={() => goto('/transactions')} />
				<div>
					<div class="flex items-center gap-2">
						<h1 class="font-display text-xl font-bold tracking-tight">#{(id ?? '').slice(0, 10)}</h1>
						<Badge color={statusColor(txStatus)}>{txStatus}</Badge>
					</div>
					<p class="text-[12px] text-[var(--ui-text-muted)] capitalize">{txType} · {txDate ? relativeTime(txDate as string) : '—'}</p>
				</div>
			</div>
			{#if txType === 'order'}
				<Button color="neutral" variant="subtle" size="sm" icon="lucide:receipt-text" href="/orders/{id}">{t('orders.viewOrder')}</Button>
			{/if}
			<Button color="neutral" variant="subtle" size="sm" icon="lucide:code" onclick={() => {
				rawItem = (order ?? payment) as any;
				rawOpen = true;
			}}>{t('common.viewRaw')}</Button>
		</div>

		<div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
			<!-- Main info -->
			<div class="lg:col-span-2 space-y-4">
				<!-- Amount card -->
				<div class="surface-card accent-bar p-6" style="--accent: var(--ui-color-primary-500);">
					<div class="flex items-center gap-4">
						<div class="grid size-12 shrink-0 place-items-center rounded-xl bg-primary-500/10 text-primary-600 dark:text-primary-400">
							<Icon name={txType === 'order' ? 'lucide:receipt-text' : 'lucide:credit-card'} class="size-6" />
						</div>
						<div>
							<div class="text-[12px] font-semibold text-[var(--ui-text-muted)]">{t('common.amount')}</div>
							<div class="font-display text-2xl font-bold tabular-nums">{formatMoney(txAmount ?? 0, currency)}</div>
						</div>
					</div>
				</div>

				<!-- Details -->
				<div class="surface-card divide-y divide-[var(--ui-border-muted)]">
					<div class="px-5 py-3"><h2 class="font-display text-[14px] font-semibold">{t('common.details')}</h2></div>
					<div class="divide-y divide-[var(--ui-border-muted)] text-[13px]">
						<div class="flex items-center gap-3 px-5 py-3"><Icon name="lucide:hash" class="size-4 text-[var(--ui-text-dimmed)]" /><span class="text-[var(--ui-text-muted)]">ID</span><span class="ml-auto font-mono text-[12px]">{(id ?? '').slice(0, 16)}</span></div>
						<div class="flex items-center gap-3 px-5 py-3"><Icon name="lucide:type" class="size-4 text-[var(--ui-text-dimmed)]" /><span class="text-[var(--ui-text-muted)]">{t('common.type')}</span><span class="ml-auto font-semibold capitalize">{txType}</span></div>
						<div class="flex items-center gap-3 px-5 py-3"><Icon name="lucide:circle-dot" class="size-4 text-[var(--ui-text-dimmed)]" /><span class="text-[var(--ui-text-muted)]">{t('common.status')}</span><span class="ml-auto"><Badge color={statusColor(txStatus)}>{txStatus}</Badge></span></div>
						<div class="flex items-center gap-3 px-5 py-3"><Icon name="lucide:clock" class="size-4 text-[var(--ui-text-dimmed)]" /><span class="text-[var(--ui-text-muted)]">{t('common.date')}</span><span class="ml-auto font-semibold">{txDate ? relativeTime(txDate as string) : '—'}</span></div>
						{#if txType === 'order' && order?.data.type}<div class="flex items-center gap-3 px-5 py-3"><Icon name="lucide:utensils" class="size-4 text-[var(--ui-text-dimmed)]" /><span class="text-[var(--ui-text-muted)]">Order type</span><span class="ml-auto font-semibold capitalize">{(order.data as any).type?.replace(/_/g, ' ')}</span></div>{/if}
						{#if txType === 'payment' && payment?.data.method}<div class="flex items-center gap-3 px-5 py-3"><Icon name="lucide:wallet" class="size-4 text-[var(--ui-text-dimmed)]" /><span class="text-[var(--ui-text-muted)]">{t('common.method')}</span><span class="ml-auto font-semibold capitalize">{(payment.data as any).method}</span></div>{/if}
						{#if txType === 'order' && order?.data.customerName}<div class="flex items-center gap-3 px-5 py-3"><Icon name="lucide:user" class="size-4 text-[var(--ui-text-dimmed)]" /><span class="text-[var(--ui-text-muted)]">{t('common.customer')}</span><span class="ml-auto font-semibold">{order.data.customerName}</span></div>{/if}
					</div>
				</div>

				<!-- Line items (if order) -->
				{#if txType === 'order' && order?.data.lines?.length}
					<div class="surface-card">
						<div class="px-5 py-3"><h2 class="font-display text-[14px] font-semibold">{t('common.items')}</h2></div>
						<table class="w-full text-left text-[13px]">
							<thead><tr><th class="px-5 py-2.5">{t('common.item')}</th><th class="px-5 py-2.5 text-center">{t('common.qty')}</th><th class="px-5 py-2.5 text-right">{t('common.total')}</th></tr></thead>
							<tbody class="divide-y divide-[var(--ui-border-muted)]">
								{#each order.data.lines as line (line.id)}
									<tr><td class="px-5 py-3 font-semibold">{line.name}</td><td class="px-5 py-3 text-center tabular-nums">{line.quantity}</td><td class="px-5 py-3 text-right tabular-nums">{formatMoney((line.unitPrice ?? line.price ?? 0) * line.quantity, currency)}</td></tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</div>

			<!-- Sidebar -->
			<div class="space-y-4">
				<!-- Totals (if order) -->
				{#if txType === 'order' && order}
					<div class="surface-card divide-y divide-[var(--ui-border-muted)]">
						<div class="px-5 py-3"><h2 class="font-display text-[14px] font-semibold">{t('orders.summary')}</h2></div>
						<div class="space-y-2 px-5 py-4 text-[13px]">
							<div class="flex justify-between"><span class="text-[var(--ui-text-muted)]">{t('common.subtotal')}</span><span class="tabular-nums">{formatMoney((order.data as any).subtotal ?? 0, currency)}</span></div>
							{#if order.data.taxAmount}<div class="flex justify-between"><span class="text-[var(--ui-text-muted)]">{t('common.tax')}</span><span class="tabular-nums">{formatMoney((order.data as any).taxAmount ?? 0, currency)}</span></div>{/if}
							{#if order.data.discount}<div class="flex justify-between"><span class="text-[var(--ui-text-muted)]">{t('common.discount')}</span><span class="tabular-nums text-[var(--tone-error-text)]">−{formatMoney((order.data as any).discount ?? 0, currency)}</span></div>{/if}
							<div class="flex justify-between border-t border-[var(--ui-border-muted)] pt-2 font-display text-[15px] font-bold"><span>{t('common.total')}</span><span class="tabular-nums">{formatMoney((order.data as any).total ?? 0, currency)}</span></div>
						</div>
					</div>
				{/if}

				<!-- Related payments -->
				{#if orderPayments.length > 0}
					<div class="surface-card divide-y divide-[var(--ui-border-muted)]">
						<div class="px-5 py-3"><h2 class="font-display text-[14px] font-semibold">Payments</h2></div>
						{#each orderPayments as p (p.id)}
							<div class="px-5 py-3 text-[13px]">
								<div class="flex items-center justify-between"><span class="capitalize text-[var(--ui-text-muted)]">{(p.data as any).method}</span><Badge color={statusColor(p.data.status ?? 'paid')}>{p.data.status ?? 'paid'}</Badge></div>
								<div class="mt-1 flex justify-between"><span class="text-[var(--ui-text-dimmed)]">{relativeTime((p.data as any).occurredAt ?? '')}</span><span class="font-semibold tabular-nums">{formatMoney((p.data as any).amount ?? 0, currency)}</span></div>
							</div>
						{/each}
					</div>
				{/if}

				<!-- Payment details (if payment) -->
				{#if txType === 'payment' && payment}
					<div class="surface-card divide-y divide-[var(--ui-border-muted)]">
						<div class="px-5 py-3"><h2 class="font-display text-[14px] font-semibold">Payment info</h2></div>
						<div class="divide-y divide-[var(--ui-border-muted)] text-[13px]">
							{#if payment.data.orderId}<div class="flex items-center gap-3 px-5 py-3"><Icon name="lucide:link" class="size-4 text-[var(--ui-text-dimmed)]" /><span class="text-[var(--ui-text-muted)]">{t('common.order')}</span><a href="/transactions/{payment.data.orderId}" class="ml-auto font-mono text-[12px] text-primary-500">{payment.data.orderId.slice(0, 12)}</a></div>{/if}
							{#if payment.data.cashReceived}<div class="flex items-center gap-3 px-5 py-3"><Icon name="lucide:banknote" class="size-4 text-[var(--ui-text-dimmed)]" /><span class="text-[var(--ui-text-muted)]">Cash received</span><span class="ml-auto tabular-nums">{formatMoney(payment.data.cashReceived, currency)}</span></div>{/if}
							{#if payment.data.changeGiven}<div class="flex items-center gap-3 px-5 py-3"><Icon name="lucide:coins" class="size-4 text-[var(--ui-text-dimmed)]" /><span class="text-[var(--ui-text-muted)]">{t('pos.change')}</span><span class="ml-auto tabular-nums">{formatMoney(payment.data.changeGiven, currency)}</span></div>{/if}
						</div>
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}

<RawDataDialog bind:open={rawOpen} data={rawItem} title={t('common.transactionRawData')} />
