<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { glo } from '$nostr/store.svelte';
	import { dataSync } from '$nostr/sync.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { TYPE, type Activity, type ActivityAction, type GloObject } from '$lib/domain';
	import { formatMoney, relativeTime, titleCase } from '$lib/utils/format';
	import { resolve } from '$app/paths';

	type ActivityObject = GloObject<Activity, typeof TYPE.activity>;

	type BadgeColor = 'neutral' | 'primary' | 'success' | 'info' | 'warning' | 'error';
	const ACTION_META: Record<ActivityAction, { icon: string; tone: BadgeColor; color: string }> = {
		refund: { icon: 'lucide:undo-2', tone: 'error', color: 'text-[var(--tone-error-text)]' },
		void: { icon: 'lucide:ban', tone: 'error', color: 'text-[var(--tone-error-text)]' },
		discount: { icon: 'lucide:tag', tone: 'info', color: 'text-[var(--tone-info-text)]' },
		promotion: {
			icon: 'lucide:ticket-percent',
			tone: 'primary',
			color: 'text-primary-600 dark:text-primary-400'
		},
		loyalty_redeem: {
			icon: 'lucide:award',
			tone: 'warning',
			color: 'text-[var(--tone-warning-text)]'
		},
		loyalty_earn: {
			icon: 'lucide:sparkles',
			tone: 'warning',
			color: 'text-[var(--tone-warning-text)]'
		},
		cash_event: { icon: 'lucide:banknote', tone: 'info', color: 'text-[var(--tone-info-text)]' },
		shift_open: {
			icon: 'lucide:lock-open',
			tone: 'success',
			color: 'text-[var(--tone-success-text)]'
		},
		shift_close: { icon: 'lucide:lock', tone: 'neutral', color: 'text-[var(--ui-text-muted)]' },
		delete: { icon: 'lucide:trash-2', tone: 'error', color: 'text-[var(--tone-error-text)]' },
		create: { icon: 'lucide:plus', tone: 'success', color: 'text-[var(--tone-success-text)]' },
		update: { icon: 'lucide:pencil', tone: 'neutral', color: 'text-[var(--ui-text-muted)]' },
		export: { icon: 'lucide:download', tone: 'neutral', color: 'text-[var(--ui-text-muted)]' },
		login: { icon: 'lucide:log-in', tone: 'neutral', color: 'text-[var(--ui-text-muted)]' }
	};

	const FILTERS: { value: ActivityAction | 'all'; label: string }[] = [
		{ value: 'all', label: 'All' },
		{ value: 'refund', label: 'Refunds' },
		{ value: 'void', label: 'Voids' },
		{ value: 'discount', label: 'Discounts' },
		{ value: 'promotion', label: 'Promotions' },
		{ value: 'loyalty_redeem', label: 'Loyalty' },
		{ value: 'cash_event', label: 'Cash' },
		{ value: 'shift_open', label: 'Shifts' }
	];

	let filter = $state<ActivityAction | 'all'>('all');
	let query = $state('');

	const currency = $derived(tenant.state.currency);

	onMount(() => {
		dataSync.pageSync([TYPE.activity], { scope: 'activity' });
	});

	const all = $derived(glo.all<Activity, typeof TYPE.activity>(TYPE.activity));
	const activities = $derived(
		all
			.slice()
			.sort((a, b) => (b.data.at ?? '').localeCompare(a.data.at ?? ''))
			.filter((a) => (filter === 'all' ? true : a.data.action === filter))
			.filter((a) => {
				const q = query.trim().toLowerCase();
				if (!q) return true;
				return (
					(a.data.summary ?? '').toLowerCase().includes(q) ||
					(a.data.actorName ?? '').toLowerCase().includes(q)
				);
			})
			.slice(0, 200)
	);

	const counts = $derived.by(() => {
		const c: Record<string, number> = {};
		for (const a of all) c[a.data.action] = (c[a.data.action] ?? 0) + 1;
		return c;
	});

	function initials(name?: string): string {
		return (name ?? '?')
			.split(/\s+/)
			.map((w) => w[0])
			.slice(0, 2)
			.join('')
			.toUpperCase();
	}
	function gotoResource(a: ActivityObject) {
		const d = a.data;
		if (d.resource === 'order' && d.resourceId) {
			window.open(resolve('/orders/[id]', { id: d.resourceId }), '_self');
		}
	}
</script>

<svelte:head><title>Activity · BNOS</title></svelte:head>

<div class="space-y-5">
	<PageHeader
		icon="lucide:shield-check"
		title="Activity"
		description="Who did what — refunds, voids, discounts, cash & shift events"
	/>

	<!-- Filters -->
	<div class="flex flex-wrap items-center gap-2">
		<div class="no-scrollbar flex gap-1.5 overflow-x-auto">
			{#each FILTERS as f (f.value)}
				<button
					type="button"
					onclick={() => (filter = f.value)}
					class="flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition-colors {filter ===
					f.value
						? 'bg-primary-500 text-white'
						: 'bg-[var(--ui-bg-muted)] text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)]'}"
				>
					{f.label}
					{#if f.value !== 'all' && counts[f.value]}
						<span class="rounded-full bg-black/10 px-1.5 text-[10px] dark:bg-white/20"
							>{counts[f.value]}</span
						>
					{/if}
				</button>
			{/each}
		</div>
		<input
			bind:value={query}
			placeholder="Search activity…"
			class="ml-auto h-9 w-56 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg)] px-3 text-[13px] outline-none focus:border-primary-500"
		/>
	</div>

	<!-- Feed -->
	{#if activities.length === 0}
		<EmptyState
			icon="lucide:shield-check"
			title="No activity yet"
			description="Refunds, voided orders, discounts, cash movements and shift events will appear here for accountability."
		/>
	{:else}
		<div class="surface-card divide-y divide-[var(--ui-border-muted)]">
			{#each activities as a (a.id)}
				{@const d = a.data}
				{@const meta = ACTION_META[d.action]}
				<button
					type="button"
					onclick={() => gotoResource(a)}
					class="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--ui-bg-accented)] {d.resource ===
					'order'
						? 'cursor-pointer'
						: 'cursor-default'}"
				>
					<!-- actor avatar -->
					<div
						class="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--ui-bg-muted)] text-[10.5px] font-bold text-[var(--ui-text-muted)]"
						title={d.actorName}
					>
						{initials(d.actorName)}
					</div>
					<!-- action icon -->
					<div
						class="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--ui-bg-muted)] {meta.color}"
					>
						<Icon name={meta.icon} class="size-4" />
					</div>
					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-2">
							<span class="truncate text-[13px] font-semibold">{d.summary}</span>
							<Badge color={meta.tone}>{titleCase(d.action.replace('_', ' '))}</Badge>
						</div>
						<div
							class="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-[var(--ui-text-dimmed)]"
						>
							<span class="font-medium text-[var(--ui-text-muted)]">{d.actorName ?? 'System'}</span>
							{#if d.actorRole}<span>·</span><span class="capitalize">{d.actorRole}</span>{/if}
							<span>·</span>
							<span>{relativeTime(d.at)}</span>
						</div>
					</div>
					{#if d.amount != null && d.amount !== 0}
						<span class="shrink-0 font-display text-[14px] font-bold tabular-nums {meta.color}">
							{d.action === 'refund' || d.action === 'loyalty_redeem' ? '−' : ''}{formatMoney(
								d.amount,
								d.currency ?? currency
							)}
						</span>
					{/if}
				</button>
			{/each}
		</div>
		<p class="text-center text-[11px] text-[var(--ui-text-dimmed)]">
			Showing {activities.length} of {all.length} entries
		</p>
	{/if}
</div>
