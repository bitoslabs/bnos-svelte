<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { t } from '$lib/i18n/i18n.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { glo } from '$nostr/store.svelte';
	import { dataSync } from '$nostr/sync.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { relativeTime } from '$lib/utils/format';

	type QueueStatus = 'waiting' | 'seated' | 'cancelled';

	interface QueueEntry {
		id: string;
		name: string;
		phone: string;
		partySize: number;
		tablePreference: string;
		status: QueueStatus;
		arrivedAt: string;
		seatedAt?: string;
		notes?: string;
	}

	const QUEUE_TYPE = 'restaurant.queue';
	const STORAGE_KEY = 'bnos-os:queue';

	let tick = $state(0);
	let timer: ReturnType<typeof setInterval>;

	onMount(() => {
		dataSync.pageSync([QUEUE_TYPE, 'restaurant.table'], { scope: 'restaurant-queue' });
		timer = setInterval(() => tick++, 30_000);
	});
	onDestroy(() => clearInterval(timer));

	// ── Load from glo or localStorage ──
	function loadQueue(): QueueEntry[] {
		const gloData = glo.all<QueueEntry>(QUEUE_TYPE);
		if (gloData.length > 0) return gloData.map((g) => g.data);
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (raw) return JSON.parse(raw);
		} catch { /* noop */ }
		return [];
	}

	function saveQueue(list: QueueEntry[]) {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
		for (const q of list) void glo.upsert(QUEUE_TYPE, q, { id: q.id });
	}

	let queue = $state<QueueEntry[]>(loadQueue());
	let activeTab = $state<QueueStatus | 'all'>('waiting');

	// Add dialog
	let dialogOpen = $state(false);
	let formName = $state('');
	let formPhone = $state('');
	let formPartySize = $state(2);
	let formTablePref = $state('');
	let formNotes = $state('');

	// ── Derived ──
	const filtered = $derived(
		queue
			.filter((q) => activeTab === 'all' || q.status === activeTab)
			.sort((a, b) => new Date(b.arrivedAt).getTime() - new Date(a.arrivedAt).getTime())
	);

	const stats = $derived({
		waiting: queue.filter((q) => q.status === 'waiting').length,
		seated: queue.filter((q) => q.status === 'seated').length,
		cancelled: queue.filter((q) => q.status === 'cancelled').length
	});

	const avgWait = $derived((() => {
		const waiting = queue.filter((q) => q.status === 'waiting');
		if (waiting.length === 0) return 0;
		const total = waiting.reduce((sum, q) => {
			const m = Math.floor((Date.now() - new Date(q.arrivedAt).getTime()) / 60_000);
			return sum + Math.max(0, m);
		}, 0);
		return Math.round(total / waiting.length);
	})());

	const tabs = [
		{ key: 'waiting' as const, label: 'Waiting', count: stats.waiting },
		{ key: 'seated' as const, label: 'Seated', count: stats.seated },
		{ key: 'all' as const, label: 'All', count: queue.length }
	];

	// ── Actions ──
	function openAdd() {
		formName = '';
		formPhone = '';
		formPartySize = 2;
		formTablePref = '';
		formNotes = '';
		dialogOpen = true;
	}

	function addParty() {
		if (!formName.trim()) {
			toast.error('Name required');
			return;
		}
		const entry: QueueEntry = {
			id: crypto.randomUUID(),
			name: formName.trim(),
			phone: formPhone.trim(),
			partySize: formPartySize,
			tablePreference: formTablePref.trim(),
			status: 'waiting',
			arrivedAt: new Date().toISOString(),
			notes: formNotes.trim() || undefined
		};
		queue = [entry, ...queue];
		saveQueue(queue);
		dialogOpen = false;
		toast.success(`${entry.name} added to queue`);
	}

	function seatParty(id: string) {
		queue = queue.map((q) =>
			q.id === id ? { ...q, status: 'seated', seatedAt: new Date().toISOString() } : q
		);
		saveQueue(queue);
		toast.success('Party seated');
	}

	function cancelParty(id: string) {
		queue = queue.map((q) => (q.id === id ? { ...q, status: 'cancelled' } : q));
		saveQueue(queue);
		toast.info('Removed from queue');
	}

	function callParty(id: string) {
		const entry = queue.find((q) => q.id === id);
		if (entry) toast.info(`Calling ${entry.name}…`, entry.phone || 'No phone');
	}

	function removeEntry(id: string) {
		queue = queue.filter((q) => q.id !== id);
		glo.remove(QUEUE_TYPE, id);
		saveQueue(queue);
		toast.info('Entry removed');
	}

	function waitMin(arrivedAt: string): number {
		return Math.max(0, Math.floor((Date.now() - new Date(arrivedAt).getTime()) / 60_000));
	}

	function waitColor(arrivedAt: string): string {
		const m = waitMin(arrivedAt);
		if (m > 20) return 'text-red-500';
		if (m > 10) return 'text-amber-500';
		return 'text-emerald-500';
	}

	void tick;
</script>

<svelte:head><title>{t('common.appName')} · {t('nav.orderQueue')}</title></svelte:head>

<div class="space-y-4">
	<!-- Header -->
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h1 class="font-display text-xl font-bold tracking-tight">Waitlist &amp; queue</h1>
			<p class="text-[12.5px] text-[var(--ui-text-muted)]">Manage parties waiting for a table</p>
		</div>
		<Button color="primary" icon="lucide:user-plus" onclick={openAdd}>{t('common.add') + ' ' + t('common.party')}</Button>
	</div>

	<!-- Stats bar -->
	<div class="flex flex-wrap items-center gap-3">
		<div class="flex items-center gap-2 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-3 py-1.5">
			<Icon name="lucide:users" class="size-4 text-[var(--ui-text-dimmed)]" />
			<span class="text-[12px] font-semibold text-[var(--ui-text-muted)]">Waiting</span>
			<span class="text-[14px] font-bold tabular-nums">{stats.waiting}</span>
		</div>
		<div class="flex items-center gap-2 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-3 py-1.5">
			<Icon name="lucide:clock" class="size-4 text-[var(--ui-text-dimmed)]" />
			<span class="text-[12px] font-semibold text-[var(--ui-text-muted)]">Avg wait</span>
			<span class="text-[14px] font-bold tabular-nums">{avgWait}m</span>
		</div>
		<div class="flex items-center gap-2 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-3 py-1.5">
			<Icon name="lucide:check-circle" class="size-4 text-[var(--ui-text-dimmed)]" />
			<span class="text-[12px] font-semibold text-[var(--ui-text-muted)]">Seated</span>
			<span class="text-[14px] font-bold tabular-nums">{stats.seated}</span>
		</div>
	</div>

	<!-- Tabs -->
	<div class="flex items-center gap-1">
		{#each tabs as tab (tab.key)}
			<button
				type="button"
				class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-bold transition-colors
					{activeTab === tab.key
					? 'bg-primary-500/10 text-primary-700 dark:text-primary-300'
					: 'text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]'}"
				onclick={() => (activeTab = tab.key)}
			>
				{tab.label}
				<span class="rounded-md bg-[var(--ui-bg-accented)] px-1.5 py-0.5 text-[10px] tabular-nums">{tab.count}</span>
			</button>
		{/each}
	</div>

	<!-- Queue list -->
	{#if filtered.length === 0}
		<EmptyState icon="lucide:clipboard-list" title={t('common.queueEmpty')} description="Add parties to the waitlist when you're at capacity." />
	{:else}
		<ol class="space-y-2">
			{#each filtered as entry, i (entry.id)}
				<li class="surface-card flex items-center gap-3 p-4">
					<!-- Position number -->
					{#if entry.status === 'waiting'}
						<span class="grid size-9 shrink-0 place-items-center rounded-full bg-primary-500/10 text-[13px] font-bold text-primary-600 dark:text-primary-400">
							{i + 1}
						</span>
					{:else}
						<span class="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--ui-bg-accented)] text-[13px] font-bold text-[var(--ui-text-dimmed)]">
							<Icon name={entry.status === 'seated' ? 'lucide:check' : 'lucide:x'} class="size-4" />
						</span>
					{/if}

					<!-- Info -->
					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-2">
							<span class="font-semibold truncate">{entry.name}</span>
							<span class="flex items-center gap-0.5 text-[11px] text-[var(--ui-text-muted)]">
								<Icon name="lucide:users" class="size-3" />
								{entry.partySize}
							</span>
							{#if entry.tablePreference}
								<span class="text-[11px] text-[var(--ui-text-muted)]">· prefers {entry.tablePreference}</span>
							{/if}
						</div>
						<div class="flex items-center gap-2 text-[11px] text-[var(--ui-text-muted)]">
							{#if entry.phone}
								<span class="flex items-center gap-0.5"><Icon name="lucide:phone" class="size-3" />{entry.phone}</span>
							{/if}
							<span>· arrived {relativeTime(entry.arrivedAt)}</span>
							{#if entry.notes}
								<span>· "{entry.notes}"</span>
							{/if}
						</div>
					</div>

					<!-- Wait time / status -->
					{#if entry.status === 'waiting'}
						<div class="flex shrink-0 flex-col items-end">
							<span class="font-mono text-[14px] font-bold tabular-nums {waitColor(entry.arrivedAt)}">{waitMin(entry.arrivedAt)}m</span>
							<span class="text-[10px] text-[var(--ui-text-dimmed)]">waiting</span>
						</div>
					{:else}
						<Badge color={entry.status === 'seated' ? 'success' : 'neutral'}>{entry.status}</Badge>
					{/if}

					<!-- Actions -->
					{#if entry.status === 'waiting'}
						<div class="flex shrink-0 items-center gap-1">
							<Button size="icon-sm" variant="ghost" title={t('restaurant.call')} onclick={() => callParty(entry.id)}>
								<Icon name="lucide:bell" class="size-4" />
							</Button>
							<Button size="sm" color="primary" variant="soft" onclick={() => seatParty(entry.id)}>Seat</Button>
							<Button size="icon-sm" variant="ghost" color="error" title={t('common.cancel')} onclick={() => cancelParty(entry.id)}>
								<Icon name="lucide:x" class="size-4" />
							</Button>
						</div>
					{:else}
						<Button size="icon-sm" variant="ghost" color="error" title={t('common.remove')} onclick={() => removeEntry(entry.id)}>
							<Icon name="lucide:trash-2" class="size-4" />
						</Button>
					{/if}
				</li>
			{/each}
		</ol>
	{/if}
</div>

<!-- Add party dialog -->
<Dialog bind:open={dialogOpen} title={t('restaurant.addParty')} size="md">
	<div class="space-y-3">
		<div>
			<label class="mb-1 block text-[12px] font-semibold text-[var(--ui-text-muted)]">{t('common.name')}</label>
			<Input bind:value={formName} placeholder="Party name" />
		</div>
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label class="mb-1 block text-[12px] font-semibold text-[var(--ui-text-muted)]">{t('common.phone')}</label>
				<Input bind:value={formPhone} placeholder="+856…" icon="lucide:phone" />
			</div>
			<div>
				<label class="mb-1 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Party size</label>
				<Input type="number" min="1" max="30" bind:value={formPartySize} />
			</div>
		</div>
		<div>
			<label class="mb-1 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Table preference (optional)</label>
			<Input bind:value={formTablePref} placeholder="e.g. Patio, Window, VIP…" />
		</div>
		<div>
			<label class="mb-1 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Notes (optional)</label>
			<Input bind:value={formNotes} placeholder="Birthday, high chair, etc." />
		</div>
	</div>
	{#snippet footer()}
		<Button variant="ghost" onclick={() => (dialogOpen = false)}>{t('common.cancel')}</Button>
		<Button color="primary" onclick={addParty}>Add to queue</Button>
	{/snippet}
</Dialog>
