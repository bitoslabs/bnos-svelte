<script lang="ts">
	/**
	 * Shipping — a kanban fulfillment board for channel orders, grouped by
	 * ShippingInfo.shippingStatus. Advances status inline; deep-links to the
	 * order detail for full shipping/tracking edits.
	 */
	import { resolve } from '$app/paths';
	import { t } from '$lib/i18n/i18n.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { glo } from '$nostr/store.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatMoney, relativeTime } from '$lib/utils/format';
	import {
		TYPE,
		isRemoteSource,
		SHIPPING_STATUSES,
		shippingStatusLabel,
		sourceLabel,
		sourceIcon
	} from '$lib/domain';
	import type { ShippingInfo } from '$lib/domain';
	import type { DashboardOrder } from '$lib/dashboard/metrics';

	const currency = $derived(tenant.state.currency);
	const orders = $derived(glo.all<DashboardOrder, 'commerce.order'>('commerce.order'));

	// Channel orders that need fulfillment (have/need shipping)
	type FulfillRow = {
		id: string;
		number: string;
		source?: string;
		customerName: string;
		total: number;
		atMs: number;
		shipping?: ShippingInfo;
	};

	const fulfillable = $derived(
		orders
			.filter((o) => isRemoteSource(o.data.source))
			.map((o) => ({
				id: o.id,
				number: String((o.data.orderNumber as string | number | undefined) ?? o.data.number ?? o.id.slice(0, 8)),
				source: o.data.source as string | undefined,
				customerName: o.data.customerName ?? '',
				total: o.data.total ?? 0,
				atMs: new Date(o.data.occurredAt || 0).getTime(),
				shipping: o.data.shipping as ShippingInfo | undefined
			}))
			.filter((o) => {
				const s = o.shipping?.shippingStatus ?? 'pending';
				return ['pending', 'packed', 'shipped', 'in_transit', 'delivered', 'failed', 'returned'].includes(s);
			})
	);

	// Columns (kanban). Merge failed + returned into a single "issues" lane.
	const COLUMNS: { status: string; label: string; icon: string; tone: string }[] = [
		{ status: 'pending', label: 'To pack', icon: 'lucide:clock', tone: 'text-amber-500' },
		{ status: 'packed', label: 'Packed', icon: 'lucide:package-check', tone: 'text-blue-500' },
		{ status: 'shipped', label: 'Shipped', icon: 'lucide:truck', tone: 'text-violet-500' },
		{ status: 'in_transit', label: 'In transit', icon: 'lucide:route', tone: 'text-cyan-500' },
		{ status: 'delivered', label: 'Delivered', icon: 'lucide:circle-check', tone: 'text-emerald-500' },
		{ status: 'issues', label: 'Issues', icon: 'lucide:triangle-alert', tone: 'text-red-500' }
	];

	function columnFor(row: FulfillRow): string {
		const s = row.shipping?.shippingStatus ?? 'pending';
		if (s === 'failed' || s === 'returned') return 'issues';
		return s;
	}

	function rowsFor(colStatus: string): FulfillRow[] {
		return fulfillable
			.filter((r) => columnFor(r) === colStatus)
			.sort((a, b) => b.atMs - a.atMs);
	}

	// Advance status: pending → packed → shipped → in_transit → delivered
	const NEXT: Record<string, string> = {
		pending: 'packed',
		packed: 'shipped',
		shipped: 'in_transit',
		in_transit: 'delivered'
	};
	const NEXT_LABEL: Record<string, string> = {
		pending: 'Mark packed',
		packed: 'Mark shipped',
		shipped: 'Mark in transit',
		in_transit: 'Mark delivered'
	};

	async function advance(row: FulfillRow) {
		const cur = row.shipping?.shippingStatus ?? 'pending';
		const next = NEXT[cur];
		if (!next) return;
		const obj = orders.find((o) => o.id === row.id);
		if (!obj) return;
		const shipping: ShippingInfo = { ...(obj.data.shipping as ShippingInfo | undefined), shippingStatus: next as ShippingInfo['shippingStatus'] };
		await glo.upsert('commerce.order', { ...obj.data, shipping }, { id: row.id });
		toast.success(`${row.number} → ${shippingStatusLabel(next)}`);
	}

	const totalToShip = $derived(rowsFor('pending').length + rowsFor('packed').length);
</script>

<svelte:head><title>{t('nav.marketplace')} · {t('nav.shipping')}</title></svelte:head>

<div class="space-y-4">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h2 class="font-display text-lg font-bold tracking-tight">Shipping & Fulfillment</h2>
			<p class="text-[12px] text-[var(--ui-text-muted)]">
				{fulfillable.length} channel orders · {totalToShip} to ship
			</p>
		</div>
	</div>

	{#if fulfillable.length === 0}
		<EmptyState
			icon="lucide:truck"
			title={t('restaurant.nothingToFulfill')}
			description="Channel orders awaiting shipment will appear here in a board. Connect a channel and receive orders to get started."
		/>
	{:else}
		<!-- Kanban board (horizontal scroll on small screens) -->
		<div class="no-scrollbar -mx-5 overflow-x-auto px-5 pb-2 sm:mx-0 sm:px-0">
			<div class="flex min-w-max gap-3">
				{#each COLUMNS as col (col.status)}
					{@const rows = rowsFor(col.status)}
					<div class="flex w-72 shrink-0 flex-col rounded-2xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)]/50">
						<!-- Column header -->
						<div class="flex items-center justify-between px-3.5 py-3">
							<div class="flex items-center gap-2">
								<Icon name={col.icon} class="size-4 {col.tone}" />
								<span class="text-[12.5px] font-bold">{col.label}</span>
							</div>
							<span class="grid size-5 min-w-5 place-items-center rounded-full bg-[var(--ui-bg-accented)] px-1 text-[10px] font-bold tabular-nums">{rows.length}</span>
						</div>
						<!-- Cards -->
						<div class="flex-1 space-y-2 px-2 pb-2">
							{#each rows as row (row.id)}
								<div class="group rounded-xl border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] p-3 shadow-sm transition-shadow hover:shadow-sm">
									<div class="flex items-center justify-between">
										<a href={resolve(`/orders/${row.id}`)} class="font-mono text-[12px] font-bold hover:text-primary-500">{row.number}</a>
										<span class="inline-flex items-center gap-0.5 text-[10px] text-[var(--ui-text-dimmed)]">
											<Icon name={sourceIcon(row.source)} class="size-2.5" />{sourceLabel(row.source)}
										</span>
									</div>
									{#if row.customerName}
										<p class="mt-1 truncate text-[11.5px] text-[var(--ui-text-muted)]">{row.customerName}</p>
									{/if}
									{#if row.shipping?.address}
										<p class="mt-0.5 truncate text-[10.5px] text-[var(--ui-text-dimmed)]">{row.shipping.address}</p>
									{/if}
									{#if row.shipping?.trackingNumber}
										<p class="mt-1 inline-flex items-center gap-1 font-mono text-[10px] text-[var(--ui-text-muted)]">
											<Icon name="lucide:package-search" class="size-2.5" />{row.shipping.trackingNumber}
										</p>
									{/if}
									<div class="mt-2.5 flex items-center justify-between border-t border-[var(--ui-border-muted)] pt-2">
										<span class="text-[11px] text-[var(--ui-text-dimmed)]">{relativeTime(row.atMs)}</span>
										<div class="flex items-center gap-1.5">
											<span class="font-semibold tabular-nums text-[11.5px]">{formatMoney(row.total, currency)}</span>
											{#if NEXT[row.shipping?.shippingStatus ?? 'pending']}
												<button
													type="button"
													onclick={() => advance(row)}
													class="inline-flex items-center gap-1 rounded-lg bg-primary-500/10 px-2 py-1 text-[10px] font-bold text-primary-600 transition-colors hover:bg-primary-500/20 dark:text-primary-300"
													title={NEXT_LABEL[row.shipping?.shippingStatus ?? 'pending']}
												>
													<Icon name="lucide:chevron-right" class="size-3" />
													{NEXT_LABEL[row.shipping?.shippingStatus ?? 'pending'].replace('Mark ', '')}
												</button>
											{/if}
										</div>
									</div>
								</div>
							{/each}
							{#if rows.length === 0}
								<div class="rounded-xl border border-dashed border-[var(--ui-border-muted)] py-6 text-center">
									<span class="text-[10.5px] text-[var(--ui-text-dimmed)]">Empty</span>
								</div>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}
</div>
