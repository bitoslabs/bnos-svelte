<script lang="ts">
	import { onDestroy } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { cn } from '$lib/utils/cn';
	import { relays } from '$nostr/relay.svelte';
	import { testRelay, type RelayTestResult } from '$nostr/relay-test';
	import {
		RELAY_DIRECTORY,
		RELAY_REGIONS,
		type DirectoryRelay,
		type RelayRegion
	} from '$nostr/relay-directory';
	import { t } from '$lib/i18n/i18n.svelte';

	/**
	 * "Recommended relays" picker. Surfaces a curated, metadata-rich directory of
	 * Nostr relays with on-demand latency probing (concurrency-limited), region
	 * + search filters, and one-click add / set-primary. Relays already in the
	 * store are hidden by default (toggle to reveal) so the list stays focused
	 * on discovery.
	 */
	let {
		autoTest = false,
		class: cls
	}: {
		/** Run a latency pass automatically once on mount. */
		autoTest?: boolean;
		class?: string;
	} = $props();

	type RegionFilter = 'all' | RelayRegion;
	type Sort = 'recommended' | 'latency' | 'name';

	let query = $state('');
	let region = $state<RegionFilter>('all');
	let sort = $state<Sort>('recommended');
	let showAdded = $state(false);

	// --- Pagination (limit + offset) -----------------------------------------
	const PAGE_SIZE_OPTIONS = [5, 10, 20] as const;
	let page = $state(1);
	let pageSize = $state<number>(PAGE_SIZE_OPTIONS[0]);

	/** Per-URL live latency results (populated by `testRelay`). */
	let results = $state<Record<string, RelayTestResult>>({});
	let testing = $state(false);
	let didTest = $state(false);

	let destroyed = false;
	onDestroy(() => {
		destroyed = true;
	});

	const addedSet = $derived(new Set(relays.normalized));

	/** Rank used for "fastest" sorting: reachable first (by ms), then untested,
	 *  testing, then failed last. */
	function latencyRank(url: string): number {
		const s = results[url];
		if (s?.status === 'ok') return s.ms ?? 99_999;
		if (s?.status === 'testing') return 70_000;
		if (s?.status === 'failed') return 90_000;
		return 80_000; // idle / untested
	}

	const filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		const list = RELAY_DIRECTORY.filter((r) => {
			if (!showAdded && addedSet.has(r.url)) return false;
			if (region !== 'all' && r.region !== region) return false;
			if (q && !`${r.name} ${r.url} ${r.description}`.toLowerCase().includes(q)) return false;
			return true;
		});
		if (sort === 'name') return [...list].sort((a, b) => a.name.localeCompare(b.name));
		if (sort === 'latency')
			return [...list].sort((a, b) => latencyRank(a.url) - latencyRank(b.url));
		return list; // 'recommended' keeps curated order
	});

	const totalPages = $derived(Math.max(1, Math.ceil(filtered.length / pageSize)));
	/** Clamped page so the view never points past the last page. */
	const safePage = $derived(Math.min(Math.max(1, page), totalPages));
	const pageItems = $derived(filtered.slice((safePage - 1) * pageSize, safePage * pageSize));
	const rangeFrom = $derived(filtered.length === 0 ? 0 : (safePage - 1) * pageSize + 1);
	const rangeTo = $derived(Math.min(safePage * pageSize, filtered.length));

	function gotoPage(n: number) {
		page = Math.min(Math.max(1, n), totalPages);
	}

	const reachableCount = $derived(
		Object.values(results).filter((r) => r.status === 'ok').length
	);
	const testedFreeCount = $derived(
		RELAY_DIRECTORY.filter((r) => r.tier !== 'paid').length
	);

	interface LatencyMeta {
		label: string;
		color: 'neutral' | 'success' | 'info' | 'warning' | 'error';
		spin: boolean;
	}
	function latencyMeta(url: string): LatencyMeta {
		const s = results[url];
		if (!s || s.status === 'idle')
			return { label: t('relayDirectory.notTested'), color: 'neutral', spin: false };
		if (s.status === 'testing')
			return { label: t('relayDirectory.testing'), color: 'info', spin: true };
		if (s.status === 'ok') {
			const ms = s.ms ?? 0;
			const color =
				ms < 120 ? 'success' : ms < 300 ? 'info' : ms < 600 ? 'warning' : 'error';
			return { label: `${ms} ms`, color, spin: false };
		}
		return { label: t('relayDirectory.failed'), color: 'error', spin: false };
	}

	const regionLabel = $derived<Record<RelayRegion, string>>({
		global: t('relayDirectory.regionGlobal'),
		eu: t('relayDirectory.regionEu'),
		us: t('relayDirectory.regionUs'),
		asia: t('relayDirectory.regionAsia')
	});
	const kindLabel = $derived<Record<DirectoryRelay['kind'], string>>({
		general: t('relayDirectory.kindGeneral'),
		index: t('relayDirectory.kindIndex'),
		fast: t('relayDirectory.kindFast'),
		community: t('relayDirectory.kindCommunity')
	});

	/** Map latency tone → status-dot color used on the leading dot. */
	function dotClass(url: string): string {
		const s = results[url];
		if (s?.status === 'ok') {
			const ms = s.ms ?? 0;
			if (ms < 120) return 'bg-emerald-500';
			if (ms < 300) return 'bg-sky-500';
			if (ms < 600) return 'bg-amber-500';
			return 'bg-rose-500';
		}
		if (s?.status === 'testing') return 'bg-sky-400 animate-pulse';
		if (s?.status === 'failed') return 'bg-rose-500';
		return 'bg-[var(--ui-text-dimmed)]';
	}

	// --- Latency probing (concurrency-limited) -------------------------------
	const CONCURRENCY = 5;
	async function forEachLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
		let i = 0;
		const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
			while (i < items.length) await fn(items[i++]);
		});
		await Promise.all(workers);
	}

	async function probeOne(r: DirectoryRelay) {
		// Paid relays require NIP-42 auth — skip live probing.
		if (r.tier === 'paid') return;
		if (!destroyed) results = { ...results, [r.url]: { status: 'testing' } };
		const result = await testRelay(r.url, 6000);
		if (destroyed) return;
		results = { ...results, [r.url]: result };
	}

	async function testAll() {
		if (testing) return;
		testing = true;
		didTest = true;
		try {
			await forEachLimited(RELAY_DIRECTORY, CONCURRENCY, probeOne);
		} finally {
			if (!destroyed) testing = false;
		}
	}

	// Optional auto-probe (e.g. settings page). Deferred so the view paints first.
	$effect(() => {
		if (!autoTest || didTest) return;
		const id = setTimeout(() => void testAll(), 300);
		return () => clearTimeout(id);
	});

	// Reset to the first page whenever filters, page size or the result count
	// shift (e.g. after adding a relay hides it). Does not read `page`, so it
	// can't loop; assigning the same value is a no-op.
	$effect(() => {
		void `${query}¦${region}¦${sort}¦${showAdded}¦${pageSize}¦${filtered.length}`;
		page = 1;
	});

	const regionFilters = $derived<{ value: RegionFilter; label: string }[]>([
		{ value: 'all', label: t('relayDirectory.regionAll') },
		...RELAY_REGIONS.map((value) => ({ value, label: regionLabel[value] }))
	]);
	const sortOptions = $derived<{ value: Sort; label: string; icon: string }[]>([
		{ value: 'recommended', label: t('relayDirectory.sortRecommended'), icon: 'lucide:sparkles' },
		{ value: 'latency', label: t('relayDirectory.sortLatency'), icon: 'lucide:gauge' },
		{ value: 'name', label: t('relayDirectory.sortName'), icon: 'lucide:arrow-down-a-z' }
	]);
</script>

<section class={cn('surface-card overflow-hidden', cls)}>
	<!-- Header -->
	<div class="flex flex-wrap items-center gap-3 border-b border-[var(--ui-border-muted)] px-5 py-3.5">
		<div class="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-500/10 text-primary-600 dark:text-primary-400">
			<Icon name="lucide:telescope" class="size-5" />
		</div>
		<div class="min-w-0 flex-1">
			<h3 class="font-display text-[14px] font-semibold text-[var(--ui-text)]">
				{t('relayDirectory.title')}
			</h3>
			<p class="mt-0.5 text-[11.5px] text-[var(--ui-text-dimmed)]">
				{t('relayDirectory.description')}
			</p>
		</div>
		<Button
			size="sm"
			color="primary"
			variant="subtle"
			icon={testing ? 'lucide:loader-circle' : 'lucide:gauge'}
			onclick={testAll}
			disabled={testing}
		>
			{testing ? t('relayDirectory.testing') : t('relayDirectory.testAll')}
		</Button>
	</div>

	<!-- Toolbar -->
	<div class="flex flex-wrap items-center gap-2 border-b border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-4 py-2.5">
		<label class="relative inline-flex h-8 flex-1 min-w-[160px] items-center gap-2 rounded-lg border border-[var(--ui-border)] bg-[var(--surface-bg)] px-2.5 transition-colors focus-within:border-[var(--ui-color-primary-500)]">
			<Icon name="lucide:search" class="size-3.5 shrink-0 text-[var(--ui-text-dimmed)]" />
			<input
				bind:value={query}
				type="text"
				placeholder={t('relayDirectory.search')}
				class="min-w-0 flex-1 bg-transparent text-[12.5px] text-[var(--ui-text)] placeholder:text-[var(--ui-text-dimmed)] focus:outline-none"
			/>
			{#if query}
				<button
					type="button"
					onclick={() => (query = '')}
					class="grid size-5 place-items-center rounded text-[var(--ui-text-dimmed)] hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]"
					aria-label={t('common.resetFilters')}
				>
					<Icon name="lucide:x" class="size-3.5" />
				</button>
			{/if}
		</label>

		<!-- Region segmented control -->
		<div class="inline-flex items-center rounded-lg border border-[var(--ui-border)] bg-[var(--surface-bg)] p-0.5">
			{#each regionFilters as opt (opt.value)}
				<button
					type="button"
					onclick={() => (region = opt.value)}
					class={cn(
						'inline-flex h-7 items-center rounded-md px-2 text-[11.5px] font-semibold transition-colors',
						region === opt.value
							? 'bg-primary-500 text-white'
							: 'text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]'
					)}
				>
					{opt.label}
				</button>
			{/each}
		</div>

		<!-- Sort -->
		<div class="inline-flex items-center gap-1">
			{#each sortOptions as opt (opt.value)}
				<button
					type="button"
					onclick={() => (sort = opt.value)}
					title={opt.label}
					class={cn(
						'inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11.5px] font-semibold transition-colors',
						sort === opt.value
							? 'border-primary-500/40 bg-primary-500/10 text-primary-600 dark:text-primary-400'
							: 'border-[var(--ui-border)] bg-[var(--surface-bg)] text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]'
					)}
				>
					<Icon name={opt.icon} class="size-3.5" />
					<span class="hidden sm:inline">{opt.label}</span>
				</button>
			{/each}
		</div>
	</div>

	<!-- Directory list -->
	{#if filtered.length === 0}
		<div class="px-5 py-10 text-center">
			<Icon name="lucide:party-popper" class="mx-auto mb-2 size-6 text-emerald-500" />
			<p class="text-[13px] font-semibold text-[var(--ui-text-muted)]">
				{t('relayDirectory.empty')}
			</p>
			<p class="mt-1 text-[11.5px] text-[var(--ui-text-dimmed)]">
				{t('relayDirectory.emptyHint')}
			</p>
		</div>
	{:else}
		<ul class="divide-y divide-[var(--ui-border-muted)]">
			{#each pageItems as r (r.url)}
				{@const added = addedSet.has(r.url)}
				{@const isPrimary = relays.primaryRelay === r.url}
				{@const meta = r.tier === 'paid' ? null : latencyMeta(r.url)}
				{@const dot = dotClass(r.url)}
				<li class="group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-[var(--ui-bg-muted)]">
					<!-- Latency/status dot -->
					<span class="mt-1.5 size-2.5 shrink-0 rounded-full {dot}" aria-hidden="true"></span>

					<div class="min-w-0 flex-1">
						<!-- Name + identity badges -->
						<div class="flex flex-wrap items-center gap-1.5">
							<span class="text-[13px] font-semibold text-[var(--ui-text)]">{r.name}</span>
							{#if isPrimary}
								<Badge color="primary"><Icon name="lucide:star" class="size-3" />{t('common.primary')}</Badge>
							{/if}
							{#if added}
								<Badge color="success"><Icon name="lucide:check" class="size-3" />{t('relayDirectory.added')}</Badge>
							{/if}
							{#if r.tier === 'paid'}
								<Badge color="warning"><Icon name="lucide:crown" class="size-3" />{t('relayDirectory.premium')}</Badge>
							{/if}
						</div>

						<p class="mt-0.5 truncate font-mono text-[11px] text-[var(--ui-text-dimmed)]">{r.url}</p>
						<p class="mt-1 text-[11.5px] text-[var(--ui-text-muted)]">{r.description}</p>

						<!-- Meta + latency -->
						<div class="mt-2 flex flex-wrap items-center gap-1.5">
							<Badge variant="outline" color="neutral">
								<Icon name="lucide:globe" class="size-3" />{regionLabel[r.region]}
							</Badge>
							<Badge variant="outline" color="info">{kindLabel[r.kind]}</Badge>
							{#if r.tier !== 'paid'}
								<span
									class={cn(
										'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold',
										`tone-${meta!.color}`
									)}
								>
									{#if meta!.spin}
										<Icon name="lucide:loader-circle" class="size-3 animate-spin" />
									{:else if meta!.color === 'success'}
										<Icon name="lucide:zap" class="size-3" />
									{/if}
									{meta!.label}
								</span>
							{/if}
						</div>
					</div>

					<!-- Actions -->
					<div class="flex shrink-0 flex-col items-end gap-2">
						{#if added}
							{#if !isPrimary}
								<Button
									size="sm"
									color="neutral"
									variant="ghost"
									icon="lucide:star"
									onclick={() => relays.setPrimary(r.url)}
									title={t('common.setPrimary')}
								/>
							{/if}
						{:else}
							<Button
								size="sm"
								color="primary"
								variant="subtle"
								icon="lucide:plus"
								onclick={() => relays.add(r.url)}
							>
								{t('relayDirectory.add')}
							</Button>
							{#if r.tier !== 'paid' && !testing}
								<button
									type="button"
									onclick={() => probeOne(r)}
									class="inline-flex items-center gap-1 text-[10.5px] font-semibold text-[var(--ui-text-dimmed)] transition-colors hover:text-[var(--ui-text)]"
								>
									<Icon name="lucide:activity" class="size-3" />
									{t('common.test')}
								</button>
							{/if}
						{/if}
					</div>
				</li>
			{/each}
		</ul>

		<!-- Footer: range + pagination (limit/offset) -->
		<div
			class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-4 py-2.5 text-[11px] text-[var(--ui-text-dimmed)]"
		>
			<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
				<span class="inline-flex items-center gap-1.5">
					<Icon name="lucide:list-checks" class="size-3.5" />
					{t('relayDirectory.range', { from: rangeFrom, to: rangeTo, total: filtered.length })}
				</span>
				{#if didTest}
					<span class="inline-flex items-center gap-1.5">
						<Icon name="lucide:wifi" class="size-3.5 text-emerald-500" />
						{t('relayDirectory.reachable', { ok: reachableCount, total: testedFreeCount })}
					</span>
				{/if}
			</div>

			<div class="flex flex-wrap items-center gap-x-3 gap-y-2">
				<!-- Per-page (limit) selector -->
				<span class="inline-flex items-center gap-1.5">
					<span class="hidden sm:inline">{t('relayDirectory.perPage')}</span>
					<span
						class="inline-flex items-center rounded-md border border-[var(--ui-border)] bg-[var(--surface-bg)] p-0.5"
					>
						{#each PAGE_SIZE_OPTIONS as opt (opt)}
							<button
								type="button"
								onclick={() => (pageSize = opt)}
								class={cn(
									'inline-flex h-6 min-w-6 items-center justify-center rounded px-1.5 text-[11px] font-bold transition-colors',
									pageSize === opt
										? 'bg-primary-500 text-white'
										: 'text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]'
								)}
							>
								{opt}
							</button>
						{/each}
					</span>
				</span>

				{#if totalPages > 1}
					<!-- Pager (prev / page / next) -->
					<span class="inline-flex items-center gap-1">
						<button
							type="button"
							onclick={() => gotoPage(safePage - 1)}
							disabled={safePage <= 1}
							aria-label={t('relayDirectory.prev')}
							title={t('relayDirectory.prev')}
							class="grid size-6 place-items-center rounded-md border border-[var(--ui-border)] bg-[var(--surface-bg)] text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)] disabled:cursor-not-allowed disabled:opacity-40"
						>
							<Icon name="lucide:chevron-left" class="size-3.5" />
						</button>
						<span
							class="min-w-[64px] text-center text-[11px] font-semibold text-[var(--ui-text-muted)]"
						>
							{t('relayDirectory.page', { page: safePage, total: totalPages })}
						</span>
						<button
							type="button"
							onclick={() => gotoPage(safePage + 1)}
							disabled={safePage >= totalPages}
							aria-label={t('relayDirectory.next')}
							title={t('relayDirectory.next')}
							class="grid size-6 place-items-center rounded-md border border-[var(--ui-border)] bg-[var(--surface-bg)] text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)] disabled:cursor-not-allowed disabled:opacity-40"
						>
							<Icon name="lucide:chevron-right" class="size-3.5" />
						</button>
					</span>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Show-added toggle -->
	<label
		class="flex cursor-pointer items-center gap-2 px-4 py-2.5 text-[11.5px] font-medium text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--ui-bg-muted)]"
	>
		<input
			type="checkbox"
			bind:checked={showAdded}
			class="size-3.5 accent-[var(--ui-color-primary-500)]"
		/>
		{t('relayDirectory.showAdded')}
	</label>
</section>
