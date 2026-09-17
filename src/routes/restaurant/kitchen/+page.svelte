<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { t } from '$lib/i18n/i18n.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { glo } from '$nostr/store.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { relativeTime } from '$lib/utils/format';
	import type { GloOrder, GloOrderLine } from '@bitos/bnos-core/glo';

	type TicketStatus = 'new' | 'preparing' | 'ready' | 'served';
	type Priority = 'normal' | 'rush' | 'vip';

	interface Ticket {
		id: string;
		orderId: string;
		orderNumber: string;
		tableId?: string;
		items: { name: string; quantity: number; notes?: string }[];
		status: TicketStatus;
		priority: Priority;
		createdAt: string;
		orderType?: string;
	}

	const COLUMNS: { status: TicketStatus; label: string; color: string; dotColor: string }[] = [
		{ status: 'new', label: 'New', color: 'border-t-amber-400', dotColor: 'bg-amber-400' },
		{ status: 'preparing', label: 'Preparing', color: 'border-t-blue-400', dotColor: 'bg-blue-400' },
		{ status: 'ready', label: 'Ready', color: 'border-t-emerald-400', dotColor: 'bg-emerald-400' },
		{ status: 'served', label: 'Served', color: 'border-t-gray-400', dotColor: 'bg-gray-400' }
	];

	let tick = $state(0);
	let timer: ReturnType<typeof setInterval>;

	onMount(() => {
		glo.hydrate('commerce.order');
		timer = setInterval(() => (tick++), 30_000); // refresh elapsed times
	});
	onDestroy(() => clearInterval(timer));

	function buildTickets(): Ticket[] {
		const orders = glo.all<GloOrder, 'commerce.order'>('commerce.order');
		const tickets: Ticket[] = [];
		for (const o of orders) {
			const status = (o.data.status ?? 'pending') as string;
			if (!['pending', 'confirmed', 'preparing', 'ready', 'served'].includes(status)) continue;
			const lines = o.data.lines ?? [];
			if (lines.length === 0) continue;

			let ticketStatus: TicketStatus;
			if (status === 'pending' || status === 'confirmed') ticketStatus = 'new';
			else if (status === 'preparing') ticketStatus = 'preparing';
			else if (status === 'ready') ticketStatus = 'ready';
			else if (status === 'served') ticketStatus = 'served';
			else continue;

			const priority: Priority = (o.data as { tags?: string[] }).tags?.includes('rush') ? 'rush'
				: (o.data as { tags?: string[] }).tags?.includes('vip') ? 'vip'
				: 'normal';

			tickets.push({
				id: o.id,
				orderId: o.id,
				orderNumber: String(o.data.number ?? o.id.slice(0, 6)),
				tableId: (o.data as { tableId?: string }).tableId,
				items: lines.map((l: GloOrderLine) => ({ name: l.name ?? 'Item', quantity: l.quantity, notes: l.notes })),
				status: ticketStatus,
				priority,
				createdAt: o.data.occurredAt ?? new Date().toISOString(),
				orderType: (o.data as { type?: string }).type
			});
		}
		return tickets.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
	}

	const tickets = $derived(buildTickets());
	// touch tick so derived re-evaluates on interval
	void tick;

	const stats = $derived({
		new: tickets.filter((t) => t.status === 'new').length,
		preparing: tickets.filter((t) => t.status === 'preparing').length,
		ready: tickets.filter((t) => t.status === 'ready').length,
		served: tickets.filter((t) => t.status === 'served').length
	});

	function elapsedMin(iso: string): number {
		const t = new Date(iso).getTime();
		if (!Number.isFinite(t)) return 0;
		return Math.floor((Date.now() - t) / 60_000);
	}

	function timerColor(iso: string): string {
		const m = elapsedMin(iso);
		if (m > 20) return 'text-red-500 dark:text-red-400';
		if (m > 10) return 'text-amber-500 dark:text-amber-400';
		return 'text-emerald-500 dark:text-emerald-400';
	}

	const NEXT: Record<TicketStatus, TicketStatus | null> = {
		new: 'preparing',
		preparing: 'ready',
		ready: 'served',
		served: null
	};

	async function advance(ticket: Ticket) {
		const next = NEXT[ticket.status];
		if (!next) return;
		const order = glo.get('commerce.order', ticket.orderId);
		if (!order) {
			toast.warning('Order not found locally');
			return;
		}
		const statusMap: Record<TicketStatus, string> = {
			new: 'preparing',
			preparing: 'ready',
			ready: 'served',
			served: 'served'
		};
		await glo.upsert('commerce.order', { ...(order.data as Record<string, unknown>), status: statusMap[next] }, { id: order.id });
		toast.success(`#${ticket.orderNumber} → ${next}`);
	}

	function playBeep() {
		try {
			const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			osc.connect(gain);
			gain.connect(ctx.destination);
			osc.frequency.value = 880;
			osc.type = 'sine';
			gain.gain.setValueAtTime(0.15, ctx.currentTime);
			gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
			osc.start();
			osc.stop(ctx.currentTime + 0.4);
		} catch { /* noop */ }
	}

	// Beep when new ticket arrives
	let prevNewCount = $state(0);
	$effect(() => {
		const count = stats.new;
		if (count > prevNewCount && prevNewCount !== 0) {
			playBeep();
		}
		prevNewCount = count;
	});

	const orderTypeBadge = (t?: string) =>
		t === 'dine_in' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
		: t === 'takeaway' ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300'
		: t === 'delivery' ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
		: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400';
</script>

<svelte:head><title>{t('common.appName')} · {t('nav.kitchen')}</title></svelte:head>

<div class="flex h-full flex-col space-y-3">
	<!-- Header -->
	<div class="flex items-center justify-between">
		<div>
			<h1 class="font-display text-xl font-bold tracking-tight">Kitchen display</h1>
			<p class="text-[12.5px] text-[var(--ui-text-muted)]">Prep tickets from active orders · kind 30211</p>
		</div>
		<div class="flex items-center gap-3 text-[10px] text-[var(--ui-text-dimmed)]">
			<span class="flex items-center gap-1"><span class="size-2 rounded-full bg-emerald-400"></span> &lt;10min</span>
			<span class="flex items-center gap-1"><span class="size-2 rounded-full bg-amber-400"></span> 10–20min</span>
			<span class="flex items-center gap-1"><span class="size-2 rounded-full bg-red-400"></span> &gt;20min</span>
		</div>
	</div>

	{#if tickets.length === 0}
		<EmptyState icon="lucide:chef-hat" title={t('restaurant.noActiveTickets')} description={t('restaurant.kitchenDesc')} />
	{:else}
		<!-- Kanban board -->
		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
			{#each COLUMNS as col (col.status)}
				{@const list = tickets.filter((t) => t.status === col.status)}
				<div class="flex flex-col rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg-muted)]">
					<!-- Column header -->
					<div class="flex items-center justify-between border-t-4 rounded-t-xl {col.color} px-3 py-2.5">
						<div class="flex items-center gap-2">
							<span class="size-2 rounded-full {col.dotColor}"></span>
							<span class="text-[13px] font-bold">{col.label}</span>
						</div>
						<span class="rounded-md bg-[var(--ui-bg-accented)] px-1.5 py-0.5 text-[11px] font-bold tabular-nums">{list.length}</span>
					</div>

					<!-- Column body -->
					<div class="flex-1 space-y-2 overflow-y-auto p-2" style="max-height: 70vh;">
						{#each list as t (t.id)}
							<div
								class="rounded-lg border bg-[var(--ui-bg-elevated)] p-3 transition-all hover:shadow-md
								{t.priority === 'rush' ? 'ring-2 ring-red-500' : ''}
								{t.priority === 'vip' ? 'ring-2 ring-amber-500' : ''}"
							>
								<!-- Ticket header -->
								<div class="mb-2 flex items-center justify-between">
									<div class="flex items-center gap-1.5 flex-wrap">
										<span class="text-[12px] font-bold">#{t.orderNumber}</span>
										{#if t.orderType}
											<span class="rounded-full px-1.5 py-0.5 text-[9px] font-bold {orderTypeBadge(t.orderType)}">
												{t.orderType === 'dine_in' ? 'Dine In' : t.orderType === 'takeaway' ? 'Takeaway' : t.orderType}
											</span>
										{/if}
										{#if t.tableId}
											<span class="rounded bg-blue-100 dark:bg-blue-900/30 px-1.5 py-0.5 text-[9px] font-bold text-blue-700 dark:text-blue-400">
												T:{t.tableId}
											</span>
										{/if}
										{#if t.priority === 'rush'}
											<span class="animate-pulse rounded bg-red-100 dark:bg-red-900/30 px-1.5 py-0.5 text-[9px] font-bold text-red-700 dark:text-red-400">RUSH</span>
										{/if}
										{#if t.priority === 'vip'}
											<span class="rounded bg-amber-100 dark:bg-amber-900/30 px-1.5 py-0.5 text-[9px] font-bold text-amber-700 dark:text-amber-400">VIP</span>
										{/if}
									</div>
									<span class="font-mono text-[10px] tabular-nums {timerColor(t.createdAt)}">
										{elapsedMin(t.createdAt)}m
									</span>
								</div>

								<!-- Items -->
								<ul class="space-y-1">
									{#each t.items as item (item.name + item.quantity)}
										<li class="flex items-baseline gap-1.5 text-[12px]">
											<span class="font-bold tabular-nums">×{item.quantity}</span>
											<span class="flex-1">{item.name}</span>
										</li>
										{#if item.notes}
											<li class="ml-5 text-[11px] italic text-[var(--ui-text-muted)]">"{item.notes}"</li>
										{/if}
									{/each}
								</ul>

								<!-- Action -->
								{#if NEXT[t.status]}
									<button
										type="button"
										class="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary-500/10 px-3 py-1.5 text-[12px] font-bold text-primary-700 transition-colors hover:bg-primary-500/20 dark:text-primary-300"
										onclick={() => advance(t)}
									>
										<Icon name="lucide:arrow-right" class="size-3.5" />
										{NEXT[t.status]!}
									</button>
								{/if}
							</div>
						{:else}
							<div class="py-6 text-center text-[12px] text-[var(--ui-text-dimmed)]">No tickets</div>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
