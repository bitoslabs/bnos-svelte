<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import RawDataDialog from '$lib/components/ui/RawDataDialog.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { glo } from '$nostr/store.svelte';
	import { dataSync } from '$nostr/sync.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatMoney, relativeTime, titleCase } from '$lib/utils/format';
	import { TYPE, statusColor, type Order, type Payment, type GloObject } from '$lib/domain';

	const id = $derived(page.params.id);

	onMount(() => {
		dataSync.pageSync([TYPE.order, TYPE.payment], { scope: 'order-detail' });
	});

	const order = $derived(glo.get(TYPE.order, id ?? '') as GloObject<Order, typeof TYPE.order> | undefined);
	const payments = $derived(glo.all<Payment, typeof TYPE.payment>(TYPE.payment).filter((p) => p.data.orderId === id));
	const currency = $derived(tenant.state.currency);

	// ── Status flow ──────────────────────────────────────────
	const statusFlow: { status: string; label: string; icon: string }[] = [
		{ status: 'pending', label: 'Pending', icon: 'lucide:clock' },
		{ status: 'confirmed', label: 'Confirmed', icon: 'lucide:check' },
		{ status: 'preparing', label: 'Preparing', icon: 'lucide:chef-hat' },
		{ status: 'ready', label: 'Ready', icon: 'lucide:bell-ring' },
		{ status: 'completed', label: 'Completed', icon: 'lucide:circle-check' }
	];

	const currentIndex = $derived(order ? statusFlow.findIndex((s) => s.status === order.data.status) : -1);
	let showAllStatuses = $state(false);

	// Quick status actions (context-aware next steps)
	const quickStatusActions = $derived(() => {
		if (!order || currentIndex < 0) return [];
		const next = statusFlow[currentIndex + 1];
		return next ? [next] : [];
	});

	// ── Order metadata ───────────────────────────────────────
	const orderType = $derived((order?.data as any)?.type ?? '');
	const orderSource = $derived((order?.data as any)?.source ?? '');
	const orderPriority = $derived((order?.data as any)?.priority ?? 'normal');
	const tableId = $derived((order?.data as any)?.tableId ?? '');
	const covers = $derived((order?.data as any)?.covers);
	const tags = $derived((order?.data as any)?.tags ?? []);
	const shipping = $derived((order?.data as any)?.shipping);
	const pickup = $derived((order?.data as any)?.pickup);
	const customerDisplayName = $derived(order?.data?.customerName ?? '');
	const orderNotes = $derived((order?.data as any)?.notes ?? '');

	function typeIcon(type: string): string {
		switch (type) {
			case 'dine_in': return 'lucide:utensils';
			case 'takeaway': return 'lucide:shopping-bag';
			case 'delivery': return 'lucide:truck';
			case 'pickup': return 'lucide:package';
			default: return 'lucide:receipt';
		}
	}

	function typeBadgeColor(type: string): 'success' | 'info' | 'warning' | 'neutral' {
		switch (type) {
			case 'dine_in': return 'info';
			case 'takeaway': return 'warning';
			case 'delivery': return 'success';
			case 'pickup': return 'neutral';
			default: return 'neutral';
		}
	}

	function priorityBadgeColor(p: string): 'error' | 'warning' | 'neutral' {
		if (p === 'rush') return 'error';
		if (p === 'vip') return 'warning';
		return 'neutral';
	}

	function sourceLabel(src: string): string {
		const map: Record<string, string> = {
			orders_page: 'Orders Page', pos: 'POS', online: 'Online', phone: 'Phone',
			whatsapp: 'WhatsApp', tiktok: 'TikTok', facebook: 'Facebook', website: 'Website'
		};
		return map[src] ?? titleCase(src) ?? '—';
	}

	// ── Payment summary ──────────────────────────────────────
	const paidAmount = $derived(payments.reduce((s, p) => s + ((p.data as any).amount ?? 0), 0));
	const totalAmount = $derived((order?.data as any)?.total ?? 0);
	const remainingBalance = $derived(totalAmount - paidAmount);

	// ── Activity log (simplified from order fields) ─────────
	const activityLog = $derived(() => {
		if (!order) return [];
		const log: { label: string; time: string; icon: string }[] = [];
		const d = order.data as any;
		if (d.occurredAt) log.push({ label: 'Order created', time: d.occurredAt, icon: 'lucide:plus-circle' });
		if (d.confirmedAt) log.push({ label: 'Order confirmed', time: d.confirmedAt, icon: 'lucide:check' });
		if (d.preparingAt) log.push({ label: 'Started preparing', time: d.preparingAt, icon: 'lucide:chef-hat' });
		if (d.readyAt) log.push({ label: 'Marked ready', time: d.readyAt, icon: 'lucide:bell-ring' });
		if (d.completedAt) log.push({ label: 'Order completed', time: d.completedAt, icon: 'lucide:circle-check' });
		if (d.cancelledAt) log.push({ label: 'Order cancelled', time: d.cancelledAt, icon: 'lucide:x-circle' });
		// Fallback: if no explicit timestamps, show created
		if (log.length === 0 && d.occurredAt) {
			log.push({ label: 'Order created', time: d.occurredAt, icon: 'lucide:plus-circle' });
		}
		return log;
	});

	// ── Actions ──────────────────────────────────────────────
	async function updateStatus(newStatus: string) {
		if (!order) return;
		const updates: any = { ...order.data, status: newStatus };
		// Set timestamp for the status change
		const now = new Date().toISOString();
		if (newStatus === 'confirmed') updates.confirmedAt = now;
		if (newStatus === 'preparing') updates.preparingAt = now;
		if (newStatus === 'ready') updates.readyAt = now;
		if (newStatus === 'completed') updates.completedAt = now;
		if (newStatus === 'cancelled') updates.cancelledAt = now;
		await glo.upsert<Order>(TYPE.order, updates);
		toast.success(`Status → ${titleCase(newStatus)}`);
	}

	async function cancelOrder() {
		if (!order) return;
		if (!confirm('Cancel this order?')) return;
		await updateStatus('cancelled');
		toast.info('Order cancelled');
	}

	async function deleteOrder() {
		if (!order) return;
		if (!confirm('Delete this order? This cannot be undone.')) return;
		glo.remove(TYPE.order, id ?? '');
		toast.info('Order deleted');
		goto('/orders');
	}

	function printReceipt() {
		if (!order) return;
		const d = order.data as any;
		const w = window.open('', '_blank', 'width=400,height=600');
		if (!w) return;
		const itemsHtml = (d.lines || []).map((l: any) =>
			`<tr><td>${l.quantity}× ${l.name || l.productName || ''}</td><td style="text-align:right">${formatMoney((l.total ?? (l.unitPrice * l.quantity)) || 0, currency)}</td></tr>`
		).join('');
		const paymentsHtml = payments.map((p) => {
			const pd = p.data as any;
			return `<tr><td>${pd.method}</td><td style="text-align:right">${formatMoney(pd.amount ?? 0, currency)}</td></tr>`;
		}).join('');
		w.document.write(
			`<html><head><title>Receipt ${d.number ?? ''}</title><style>body{font-family:monospace;padding:16px;font-size:12px}h2{text-align:center}table{width:100%}td{padding:2px 0}.total{font-weight:bold;font-size:14px;border-top:1px dashed #000;padding-top:8px}</style></head><body><h2>${tenant.state.organizationName || 'BNOS'}</h2><p style="text-align:center">${d.number ?? ''}</p><p style="text-align:center;font-size:10px;color:#666">${new Date(d.occurredAt ?? Date.now()).toLocaleString()}</p><hr><table>${itemsHtml}</table><hr><table><tr class="total"><td>TOTAL</td><td style="text-align:right">${formatMoney(totalAmount, currency)}</td></tr></table>${paymentsHtml ? `<hr><table>${paymentsHtml}</table>` : ''}<p style="text-align:center;margin-top:16px">Thank you!</p></body></html>`
		);
		w.document.close();
		w.print();
	}

	// ── Add payment ──────────────────────────────────────────
	let showAddPayment = $state(false);
	let newPaymentMethod = $state('cash');
	let newPaymentAmount = $state(0);

	// Raw data viewer
	let rawOpen = $state(false);

	async function addPayment() {
		if (!order || newPaymentAmount <= 0) return;
		await glo.upsert<Payment>(TYPE.payment, {
			orderId: id,
			method: newPaymentMethod,
			amount: newPaymentAmount,
			status: 'completed',
			currency: currency,
			occurredAt: new Date().toISOString()
		});
		toast.success(`Payment of ${formatMoney(newPaymentAmount, currency)} added`);
		showAddPayment = false;
		newPaymentAmount = 0;
	}

	const PAYMENT_METHODS = (() => {
		try {
			const stored = JSON.parse(localStorage.getItem('bnos-os:payment-methods') || '[]');
			if (Array.isArray(stored) && stored.length) {
				return stored.map((m: any) => ({ value: m.id || m.value || 'cash', label: m.label || m.name || 'Cash', icon: m.icon || 'lucide:banknote' }));
			}
		} catch { /* ignore */ }
		return [
			{ value: 'cash', label: 'Cash', icon: 'lucide:banknote' },
			{ value: 'card', label: 'Card', icon: 'lucide:credit-card' },
			{ value: 'qr', label: 'QR', icon: 'lucide:qr-code' },
			{ value: 'lightning', label: 'Lightning', icon: 'lucide:zap' }
		];
	})();
</script>

<svelte:head><title>Order {(id ?? '').slice(0, 8)} · BNOS</title></svelte:head>

{#if !order}
	<EmptyState icon="lucide:receipt-text" title="Order not found" description="This order may have been deleted or hasn't synced yet.">
		{#snippet actions()}<Button color="neutral" variant="subtle" size="sm" icon="lucide:arrow-left" href="/orders">Back to orders</Button>{/snippet}
	</EmptyState>
{:else}
	<div class="space-y-4">
		<!-- ═══ Header ═══ -->
		<div class="flex flex-wrap items-start justify-between gap-3">
			<div class="flex items-center gap-3">
				<Button color="neutral" variant="ghost" size="icon-sm" icon="lucide:arrow-left" onclick={() => goto('/orders')} />
				<div>
					<div class="flex flex-wrap items-center gap-2">
						<h1 class="font-display text-xl font-bold tracking-tight">{order.data.orderNumber ?? ('#' + (id ?? '').slice(0, 8))}</h1>
						<Badge color={statusColor(order.data.status)}>{titleCase(order.data.status)}</Badge>
						{#if orderType}
							<Badge color={typeBadgeColor(orderType)}>
								<span class="inline-flex items-center gap-1">
									<Icon name={typeIcon(orderType)} class="size-3" />
									{titleCase(orderType)}
								</span>
							</Badge>
						{/if}
						{#if orderPriority !== 'normal'}
							<Badge color={priorityBadgeColor(orderPriority)}>{titleCase(orderPriority)}</Badge>
						{/if}
					</div>
					<p class="mt-0.5 text-[12px] text-[var(--ui-text-muted)]">
						{relativeTime((order.data as any).occurredAt ?? '')}
						{#if orderSource} · {sourceLabel(orderSource)}{/if}
					</p>
				</div>
			</div>
			<div class="flex gap-2">
				<Button color="neutral" variant="subtle" size="sm" icon="lucide:pencil" href="/orders/{id}/edit">Edit</Button>
				<Button color="neutral" variant="subtle" size="sm" icon="lucide:printer" onclick={printReceipt}>Print</Button>
				<Button color="neutral" variant="ghost" size="sm" icon="lucide:code" onclick={() => (rawOpen = true)} title="View raw data"></Button>
				{#if order.data.status !== 'cancelled' && order.data.status !== 'completed'}
					<Button color="error" variant="subtle" size="sm" icon="lucide:x" onclick={cancelOrder}>Cancel</Button>
				{/if}
				<Button color="error" variant="ghost" size="sm" icon="lucide:trash-2" onclick={deleteOrder}></Button>
			</div>
		</div>

		<!-- ═══ Status Flow / Progress ═══ -->
		{#if order.data.status !== 'cancelled' && currentIndex >= 0}
			<div class="surface-card p-5">
				<div class="flex items-center justify-between">
					{#each statusFlow as s, i (s.status)}
						<div class="flex flex-1 flex-col items-center gap-1.5">
							<div class="grid size-9 place-items-center rounded-full transition-colors {i <= currentIndex ? 'bg-primary-500 text-white' : 'bg-[var(--ui-bg-muted)] text-[var(--ui-text-dimmed)]'}">
								<Icon name={s.icon} class="size-4" />
							</div>
							<span class="text-[10.5px] font-semibold {i <= currentIndex ? 'text-[var(--ui-text)]' : 'text-[var(--ui-text-dimmed)]'}">{s.label}</span>
						</div>
						{#if i < statusFlow.length - 1}
							<div class="h-0.5 flex-1 rounded-full {i < currentIndex ? 'bg-primary-500' : 'bg-[var(--ui-bg-muted)]'}"></div>
						{/if}
					{/each}
				</div>
				<!-- Quick status action -->
				{#if quickStatusActions().length > 0}
					<div class="mt-4 flex justify-center gap-2">
						{#each quickStatusActions() as action (action.status)}
							<Button color="primary" size="sm" icon={action.icon} onclick={() => updateStatus(action.status)}>
								Mark as {action.label}
							</Button>
						{/each}
						<Button color="neutral" variant="soft" size="sm" icon="lucide:check-circle" onclick={() => updateStatus('completed')}>
							Complete
						</Button>
					</div>
				{/if}
				<!-- All statuses -->
				{#if showAllStatuses}
					<div class="mt-3 flex flex-wrap justify-center gap-1.5 border-t border-[var(--ui-border-muted)] pt-3">
						{#each statusFlow as s (s.status)}
							<button
								class="rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-all {order.data.status === s.status ? 'bg-primary-500 text-white' : 'border border-[var(--ui-border)] text-[var(--ui-text-muted)]'}"
								onclick={() => updateStatus(s.status)}
								disabled={order.data.status === s.status}
							>
								{s.label}
							</button>
						{/each}
						<button
							class="rounded-lg px-2.5 py-1 text-[11px] font-semibold text-red-600 transition-all border border-red-300 hover:bg-red-500/10"
							onclick={() => updateStatus('cancelled')}
						>
							Cancel
						</button>
					</div>
				{/if}
				<div class="mt-2 text-center">
					<button class="text-[11px] text-[var(--ui-text-dimmed)] hover:text-[var(--ui-text)]" onclick={() => { showAllStatuses = !showAllStatuses; }}>
						{showAllStatuses ? 'Show less' : 'Show all statuses'}
					</button>
				</div>
			</div>
		{/if}

		<!-- ═══ Two column layout ═══ -->
		<div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
			<!-- ═══ LEFT: Items + Shipping/Pickup + Notes ═══ -->
			<div class="space-y-4 lg:col-span-2">
				<!-- Line Items -->
				<div class="surface-card divide-y divide-[var(--ui-border-muted)]">
					<div class="px-5 py-3 flex items-center justify-between">
						<div class="flex items-center gap-2">
							<Icon name="lucide:shopping-cart" class="size-4 text-primary-500" />
							<h2 class="font-display text-[14px] font-semibold">Items</h2>
							<span class="inline-flex items-center justify-center rounded-md bg-[var(--ui-bg-muted)] px-1.5 py-0.5 text-[10px] font-bold">
								{order.data.lines?.reduce((s, l) => s + l.quantity, 0) ?? 0}
							</span>
						</div>
					</div>
					<table class="w-full text-left text-[13px]">
						<thead>
							<tr>
								<th class="px-5 py-2.5">Item</th>
								<th class="px-5 py-2.5 text-center">Qty</th>
								<th class="px-5 py-2.5 text-right">Price</th>
								<th class="px-5 py-2.5 text-right">Total</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-[var(--ui-border-muted)]">
							{#each order.data.lines ?? [] as line (line.id)}
								<tr>
									<td class="px-5 py-3">
										<div class="font-semibold">{line.name ?? line.productName}</div>
										{#if line.variantName}<div class="text-[11px] text-[var(--ui-text-dimmed)]">{line.variantName}</div>{/if}
										{#if line.modifiers?.length}<div class="text-[11px] text-[var(--ui-text-dimmed)]">{line.modifiers.map((m: any) => m.name).join(', ')}</div>{/if}
										{#if line.notes}<div class="text-[11px] italic text-[var(--ui-text-dimmed)]">"{line.notes}"</div>{/if}
									</td>
									<td class="px-5 py-3 text-center tabular-nums">{line.quantity}</td>
									<td class="px-5 py-3 text-right tabular-nums">{formatMoney(line.unitPrice ?? line.price ?? 0, currency)}</td>
									<td class="px-5 py-3 text-right font-semibold tabular-nums">{formatMoney((line.unitPrice ?? line.price ?? 0) * line.quantity, currency)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>

				<!-- Shipping info -->
				{#if shipping}
					<div class="surface-card divide-y divide-[var(--ui-border-muted)]">
						<div class="px-5 py-3 flex items-center gap-2">
							<Icon name="lucide:truck" class="size-4 text-primary-500" />
							<h2 class="font-display text-[14px] font-semibold">Shipping / Delivery</h2>
						</div>
						<div class="px-5 py-3 grid grid-cols-1 gap-3 text-[13px] sm:grid-cols-2">
							{#if shipping.recipientName}
								<div class="flex items-start gap-2">
									<Icon name="lucide:user" class="size-4 shrink-0 text-[var(--ui-text-dimmed)]" />
									<div>
										<p class="text-[11px] uppercase tracking-wider text-[var(--ui-text-dimmed)]">Recipient</p>
										<p class="font-medium">{shipping.recipientName}</p>
									</div>
								</div>
							{/if}
							{#if shipping.phone}
								<div class="flex items-start gap-2">
									<Icon name="lucide:phone" class="size-4 shrink-0 text-[var(--ui-text-dimmed)]" />
									<div>
										<p class="text-[11px] uppercase tracking-wider text-[var(--ui-text-dimmed)]">Phone</p>
										<p class="font-medium">{shipping.phone}</p>
									</div>
								</div>
							{/if}
							{#if shipping.address}
								<div class="flex items-start gap-2 sm:col-span-2">
									<Icon name="lucide:map-pin" class="size-4 shrink-0 text-[var(--ui-text-dimmed)]" />
									<div>
										<p class="text-[11px] uppercase tracking-wider text-[var(--ui-text-dimmed)]">Address</p>
										<p class="font-medium">{shipping.address}{#if shipping.city}, {shipping.city}{/if}</p>
									</div>
								</div>
							{/if}
							{#if shipping.deliveryProvider}
								<div class="flex items-start gap-2">
									<Icon name="lucide:truck" class="size-4 shrink-0 text-[var(--ui-text-dimmed)]" />
									<div>
										<p class="text-[11px] uppercase tracking-wider text-[var(--ui-text-dimmed)]">Provider</p>
										<p class="font-medium">{shipping.deliveryProvider}</p>
									</div>
								</div>
							{/if}
							{#if shipping.trackingNumber}
								<div class="flex items-start gap-2">
									<Icon name="lucide:hash" class="size-4 shrink-0 text-[var(--ui-text-dimmed)]" />
									<div>
										<p class="text-[11px] uppercase tracking-wider text-[var(--ui-text-dimmed)]">Tracking</p>
										<p class="font-mono text-[12px]">{shipping.trackingNumber}</p>
									</div>
								</div>
							{/if}
							{#if shipping.deliveryFee}
								<div class="flex items-start gap-2">
									<Icon name="lucide:wallet" class="size-4 shrink-0 text-[var(--ui-text-dimmed)]" />
									<div>
										<p class="text-[11px] uppercase tracking-wider text-[var(--ui-text-dimmed)]">Delivery Fee</p>
										<p class="font-medium">{formatMoney(shipping.deliveryFee, currency)}</p>
									</div>
								</div>
							{/if}
						</div>
					</div>
				{/if}

				<!-- Pickup info -->
				{#if pickup}
					<div class="surface-card divide-y divide-[var(--ui-border-muted)]">
						<div class="px-5 py-3 flex items-center gap-2">
							<Icon name="lucide:package" class="size-4 text-primary-500" />
							<h2 class="font-display text-[14px] font-semibold">Pickup Info</h2>
						</div>
						<div class="px-5 py-3 grid grid-cols-1 gap-3 text-[13px] sm:grid-cols-2">
							{#if pickup.pickupName}
								<div class="flex items-start gap-2">
									<Icon name="lucide:user" class="size-4 shrink-0 text-[var(--ui-text-dimmed)]" />
									<div>
										<p class="text-[11px] uppercase tracking-wider text-[var(--ui-text-dimmed)]">Name</p>
										<p class="font-medium">{pickup.pickupName}</p>
									</div>
								</div>
							{/if}
							{#if pickup.phone}
								<div class="flex items-start gap-2">
									<Icon name="lucide:phone" class="size-4 shrink-0 text-[var(--ui-text-dimmed)]" />
									<div>
										<p class="text-[11px] uppercase tracking-wider text-[var(--ui-text-dimmed)]">Phone</p>
										<p class="font-medium">{pickup.phone}</p>
									</div>
								</div>
							{/if}
							{#if pickup.pickupLocation}
								<div class="flex items-start gap-2">
									<Icon name="lucide:map-pin" class="size-4 shrink-0 text-[var(--ui-text-dimmed)]" />
									<div>
										<p class="text-[11px] uppercase tracking-wider text-[var(--ui-text-dimmed)]">Location</p>
										<p class="font-medium">{pickup.pickupLocation}</p>
									</div>
								</div>
							{/if}
							{#if pickup.pickupTime}
								<div class="flex items-start gap-2">
									<Icon name="lucide:clock" class="size-4 shrink-0 text-[var(--ui-text-dimmed)]" />
									<div>
										<p class="text-[11px] uppercase tracking-wider text-[var(--ui-text-dimmed)]">Ready Time</p>
										<p class="font-medium">{pickup.pickupTime}</p>
									</div>
								</div>
							{/if}
						</div>
					</div>
				{/if}

				<!-- Notes -->
				{#if orderNotes}
					<div class="surface-card divide-y divide-[var(--ui-border-muted)]">
						<div class="px-5 py-3 flex items-center gap-2">
							<Icon name="lucide:file-text" class="size-4 text-primary-500" />
							<h2 class="font-display text-[14px] font-semibold">Notes</h2>
						</div>
						<div class="px-5 py-3">
							<p class="whitespace-pre-wrap text-[13px] text-[var(--ui-text-muted)]">{orderNotes}</p>
						</div>
					</div>
				{/if}

				<!-- Activity Log -->
				<div class="surface-card divide-y divide-[var(--ui-border-muted)]">
					<div class="px-5 py-3 flex items-center gap-2">
						<Icon name="lucide:history" class="size-4 text-primary-500" />
						<h2 class="font-display text-[14px] font-semibold">Activity</h2>
					</div>
					<div class="px-5 py-4">
						<ol class="relative space-y-3 border-l border-[var(--ui-border-muted)] pl-4">
							{#each activityLog() as event (event.label)}
								<li class="relative">
									<span class="absolute -left-[21px] grid size-5 place-items-center rounded-full bg-primary-500/10">
										<Icon name={event.icon} class="size-3 text-primary-600 dark:text-primary-400" />
									</span>
									<div class="flex items-center justify-between">
										<span class="text-[13px] font-medium">{event.label}</span>
										<span class="text-[11px] text-[var(--ui-text-dimmed)]">{relativeTime(event.time)}</span>
									</div>
								</li>
							{/each}
						</ol>
					</div>
				</div>
			</div>

			<!-- ═══ RIGHT: Summary sidebar ═══ -->
			<div class="space-y-4">
				<!-- Payment & Totals -->
				<div class="surface-card divide-y divide-[var(--ui-border-muted)]">
					<div class="px-5 py-3 flex items-center gap-2">
						<Icon name="lucide:wallet" class="size-4 text-primary-500" />
						<h2 class="font-display text-[14px] font-semibold">Payment</h2>
					</div>
					<div class="space-y-2 px-5 py-4 text-[13px]">
						<div class="flex justify-between"><span class="text-[var(--ui-text-muted)]">Subtotal</span><span class="tabular-nums">{formatMoney((order.data as any).subtotal ?? 0, currency)}</span></div>
						{#if (order.data as any).discount}
							<div class="flex justify-between"><span class="text-[var(--ui-text-muted)]">Discount</span><span class="tabular-nums text-red-600">−{formatMoney((order.data as any).discount ?? 0, currency)}</span></div>
						{/if}
						{#if order.data.taxAmount}
							<div class="flex justify-between"><span class="text-[var(--ui-text-muted)]">Tax</span><span class="tabular-nums">{formatMoney((order.data.taxAmount as number | undefined) ?? 0, currency)}</span></div>
						{/if}
						{#if (order.data as any).tip}
							<div class="flex justify-between"><span class="text-[var(--ui-text-muted)]">Tip</span><span class="tabular-nums">{formatMoney((order.data as any).tip ?? 0, currency)}</span></div>
						{/if}
						<div class="flex justify-between border-t border-[var(--ui-border-muted)] pt-2 font-display text-[15px] font-bold">
							<span>Total</span><span class="tabular-nums">{formatMoney(totalAmount, currency)}</span>
						</div>

						<!-- Payments list -->
						{#if payments.length > 0}
							<div class="border-t border-[var(--ui-border-muted)] pt-3">
								<p class="mb-2 text-[11px] font-bold uppercase tracking-wider text-[var(--ui-text-muted)]">Payments</p>
								<div class="space-y-2">
									{#each payments as p (p.id)}
										<div class="flex items-center justify-between">
											<div class="flex items-center gap-1.5">
												<span class="text-[12px] capitalize text-[var(--ui-text-muted)]">{p.data.method}</span>
												<span class="text-[10px] text-[var(--ui-text-dimmed)]">{relativeTime((p.data as any).occurredAt ?? '')}</span>
											</div>
											<span class="font-semibold tabular-nums">{formatMoney((p.data as any).amount ?? 0, currency)}</span>
										</div>
									{/each}
								</div>
								{#if remainingBalance > 0}
									<div class="mt-2 flex justify-between border-t border-[var(--ui-border-muted)] pt-2">
										<span class="text-[12px] text-[var(--ui-text-muted)]">Remaining</span>
										<span class="font-bold text-red-600 tabular-nums">{formatMoney(remainingBalance, currency)}</span>
									</div>
								{:else if remainingBalance <= 0 && paidAmount > 0}
									<div class="mt-2 flex items-center gap-1.5">
										<Icon name="lucide:circle-check" class="size-4 text-emerald-500" />
										<span class="text-[12px] font-semibold text-emerald-600">Fully paid</span>
									</div>
								{/if}
							</div>
						{/if}

						<!-- Add payment -->
						{#if showAddPayment}
							<div class="border-t border-[var(--ui-border-muted)] pt-3 space-y-2">
								<div class="flex gap-1.5">
									{#each PAYMENT_METHODS as pm (pm.value)}
										<button
											class="flex-1 rounded-lg border px-2 py-1.5 text-[11px] font-medium transition-all {newPaymentMethod === pm.value ? 'border-primary-500 bg-primary-500/10 text-primary-700 dark:text-primary-300' : 'border-[var(--ui-border)] text-[var(--ui-text-muted)]'}"
											onclick={() => (newPaymentMethod = pm.value)}
										>
											{pm.label}
										</button>
									{/each}
								</div>
								<input bind:value={newPaymentAmount} type="number" min="0" step="0.01" class="w-full rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-3 py-1.5 text-right text-[13px] focus:outline-none" placeholder="Amount" />
								<div class="flex gap-2">
									<Button size="sm" color="neutral" variant="ghost" block onclick={() => (showAddPayment = false)}>Cancel</Button>
									<Button size="sm" color="primary" block onclick={addPayment}>Add</Button>
								</div>
							</div>
						{:else}
							<Button size="sm" color="neutral" variant="soft" block icon="lucide:plus" onclick={() => { showAddPayment = true; newPaymentAmount = remainingBalance > 0 ? remainingBalance : 0; }}>
								Add Payment
							</Button>
						{/if}
					</div>
				</div>

				<!-- Customer & Details -->
				<div class="surface-card divide-y divide-[var(--ui-border-muted)]">
					<div class="px-5 py-3 flex items-center gap-2">
						<Icon name="lucide:user" class="size-4 text-primary-500" />
						<h2 class="font-display text-[14px] font-semibold">Details</h2>
					</div>
					<div class="px-5 py-3 space-y-3 text-[13px]">
						{#if customerDisplayName}
							<div class="flex items-center gap-2">
								<Icon name="lucide:user" class="size-4 shrink-0 text-[var(--ui-text-dimmed)]" />
								<div>
									<p class="text-[11px] uppercase tracking-wider text-[var(--ui-text-dimmed)]">Customer</p>
									<p class="font-medium">{customerDisplayName}</p>
								</div>
							</div>
						{/if}
						{#if tableId}
							<div class="flex items-center gap-2">
								<Icon name="lucide:coffee" class="size-4 shrink-0 text-[var(--ui-text-dimmed)]" />
								<div>
									<p class="text-[11px] uppercase tracking-wider text-[var(--ui-text-dimmed)]">Table</p>
									<p class="font-medium">{tableId}</p>
								</div>
							</div>
						{/if}
						{#if covers}
							<div class="flex items-center gap-2">
								<Icon name="lucide:users" class="size-4 shrink-0 text-[var(--ui-text-dimmed)]" />
								<div>
									<p class="text-[11px] uppercase tracking-wider text-[var(--ui-text-dimmed)]">Covers</p>
									<p class="font-medium">{covers}</p>
								</div>
							</div>
						{/if}
						{#if orderSource}
							<div class="flex items-center gap-2">
								<Icon name="lucide:globe" class="size-4 shrink-0 text-[var(--ui-text-dimmed)]" />
								<div>
									<p class="text-[11px] uppercase tracking-wider text-[var(--ui-text-dimmed)]">Source</p>
									<p class="font-medium">{sourceLabel(orderSource)}</p>
								</div>
							</div>
						{/if}
						{#if customerDisplayName || tableId || orderSource}
							<div class="border-t border-[var(--ui-border-muted)]" />
						{/if}
						<div class="flex items-center gap-2">
							<Icon name="lucide:calendar" class="size-4 shrink-0 text-[var(--ui-text-dimmed)]" />
							<div>
								<p class="text-[11px] uppercase tracking-wider text-[var(--ui-text-dimmed)]">Created</p>
								<p class="text-[12px] text-[var(--ui-text-muted)]">{relativeTime((order.data as any).occurredAt ?? '')}</p>
							</div>
						</div>
						{#if (order.data as any).completedAt}
							<div class="flex items-center gap-2">
								<Icon name="lucide:circle-check" class="size-4 shrink-0 text-[var(--ui-text-dimmed)]" />
								<div>
									<p class="text-[11px] uppercase tracking-wider text-[var(--ui-text-dimmed)]">Completed</p>
									<p class="text-[12px] text-[var(--ui-text-muted)]">{relativeTime((order.data as any).completedAt ?? '')}</p>
								</div>
							</div>
						{/if}
					</div>
				</div>

				<!-- Tags -->
				{#if tags.length > 0}
					<div class="surface-card divide-y divide-[var(--ui-border-muted)]">
						<div class="px-5 py-3 flex items-center gap-2">
							<Icon name="lucide:tag" class="size-4 text-primary-500" />
							<h2 class="font-display text-[14px] font-semibold">Tags</h2>
						</div>
						<div class="flex flex-wrap gap-1.5 px-5 py-3">
							{#each tags as tag (tag)}
								<span class="inline-flex items-center rounded-lg bg-[var(--ui-bg-muted)] px-2 py-1 text-[11px] font-semibold text-[var(--ui-text-muted)]">{tag}</span>
							{/each}
						</div>
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}

<RawDataDialog bind:open={rawOpen} data={order} title="Order Raw Data" />
