<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { t } from '$lib/i18n/i18n.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import DateRangePicker from '$lib/components/ui/DateRangePicker.svelte';
	import { glo } from '$nostr/store.svelte';
	import { dataSync } from '$nostr/sync.svelte';
	import { formatMoney, formatInt } from '$lib/utils/format';
	import type { GloObject, GloOrder, GloPayment, GloProduct } from '@bitos/bnos-core/glo';
	import { TYPE, type Refund } from '$lib/domain';
	import {
		buildReportSnapshot,
		fromMinorUnits,
		type ReportGranularity,
		type ReportSnapshot
	} from '$lib/domain/report-snapshot';
	import {
		backfillDailySnapshots,
		pruneHourlySnapshots,
		publishReportSnapshot
	} from '$lib/reports/snapshot-service';
	import { loadHourlyRetentionDays, saveHourlyRetentionDays } from '$lib/reports/snapshot-settings';
	import { logActivity } from '$lib/audit.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { confirm } from '$lib/stores/confirm.svelte';

	type SnapshotRow = {
		object: GloObject<ReportSnapshot, string>;
		data: ReportSnapshot;
	};

	onMount(() => {
		glo.hydrate(TYPE.reportSnapshot);
		glo.hydrate(TYPE.location);
		glo.hydrate(TYPE.organization);
		glo.hydrate('commerce.order');
		glo.hydrate('commerce.payment');
		glo.hydrate(TYPE.refund);
		glo.hydrate('catalog.product');
		dataSync.pageSync([TYPE.reportSnapshot], { scope: 'snapshots' });
	});

	const rows = $derived.by<SnapshotRow[]>(() =>
		glo
			.all<ReportSnapshot, typeof TYPE.reportSnapshot>(TYPE.reportSnapshot)
			.map((object) => ({ object, data: object.data }))
			.sort(
				(a, b) =>
					Date.parse(b.data.periodStart) - Date.parse(a.data.periodStart) ||
					Date.parse(b.data.generatedAt) - Date.parse(a.data.generatedAt)
			)
	);
	const locations = $derived(glo.all<{ name?: string }, typeof TYPE.location>(TYPE.location));

	let granularity = $state<'all' | ReportGranularity>('all');
	let locationFilter = $state('all');
	let currencyFilter = $state('all');
	let fromDate = $state('');
	let toDate = $state('');
	let expandedId = $state<string | null>(null);
	let busy = $state<'sync' | 'backfill' | 'prune' | null>(null);
	let retentionDays = $state(loadHourlyRetentionDays());

	const granularityOptions = $derived([
		{ value: 'all', label: t('reports.snapshot.allTypes') },
		{ value: 'hour', label: t('reports.snapshot.hourly') },
		{ value: 'day', label: t('reports.snapshot.daily') },
		{ value: 'week', label: t('reports.snapshot.weekly') },
		{ value: 'month', label: t('reports.snapshot.monthly') }
	]);

	const locationOptions = $derived([
		{ value: 'all', label: t('reports.snapshot.allScopes') },
		{ value: 'org', label: t('reports.snapshot.orgWide') },
		...locations.map((location) => ({
			value: location.id,
			label: location.data.name ?? location.id.slice(0, 8)
		}))
	]);
	const currencyOptions = $derived([
		{ value: 'all', label: t('reports.snapshot.allCurrencies') },
		...[...new Set(rows.map((row) => row.data.currency))].map((currency) => ({
			value: currency,
			label: currency
		}))
	]);

	const filtered = $derived.by(() => {
		const from = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : -Infinity;
		const to = toDate ? new Date(`${toDate}T23:59:59`).getTime() : Infinity;
		return rows.filter((row) => {
			const data = row.data;
			if (granularity !== 'all' && data.granularity !== granularity) return false;
			if (currencyFilter !== 'all' && data.currency !== currencyFilter) return false;
			if (locationFilter === 'org' && data.locationId) return false;
			if (
				locationFilter !== 'all' &&
				locationFilter !== 'org' &&
				data.locationId !== locationFilter
			)
				return false;
			const start = Date.parse(data.periodStart);
			return Number.isFinite(start) && start >= from && start <= to;
		});
	});
	const expandedRow = $derived(filtered.find((row) => row.object.id === expandedId) ?? null);
	const expandedDrift = $derived.by(() => {
		const row = expandedRow;
		if (!row) return null;
		const periodStart = Date.parse(row.data.periodStart);
		const periodEnd = Date.parse(row.data.periodEnd);
		if (!Number.isFinite(periodStart) || !Number.isFinite(periodEnd)) return null;
		const generatedAt = Date.parse(row.data.generatedAt);
		const live = buildReportSnapshot({
			periodStart,
			periodEnd,
			granularity: row.data.granularity,
			orders: glo.all<GloOrder, 'commerce.order'>('commerce.order'),
			payments: glo.all<GloPayment, 'commerce.payment'>('commerce.payment'),
			refunds: glo.all<Refund, typeof TYPE.refund>(TYPE.refund),
			products: glo.all<GloProduct, 'catalog.product'>('catalog.product'),
			currency: row.data.currency,
			locationId: row.data.locationId,
			timezone: row.data.timezone,
			now: Number.isFinite(generatedAt) ? generatedAt : undefined
		});
		return {
			net: live.netMinor - row.data.netMinor,
			orders: live.ordersCount - row.data.ordersCount,
			items: live.itemsCount - row.data.itemsCount
		};
	});

	function updateRetention() {
		retentionDays = saveHourlyRetentionDays(retentionDays);
	}

	function relativeTime(iso: string): string {
		const at = Date.parse(iso);
		if (!Number.isFinite(at)) return '—';
		const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
		if (seconds < 60) return t('reports.snapshot.justNow');
		const minutes = Math.round(seconds / 60);
		if (minutes < 60) return t('reports.snapshot.minutesAgo', { n: minutes });
		const hours = Math.round(minutes / 60);
		if (hours < 24) return t('reports.snapshot.hoursAgo', { n: hours });
		return t('reports.snapshot.daysAgo', { n: Math.round(hours / 24) });
	}

	function formatPeriod(data: ReportSnapshot): string {
		const start = new Date(data.periodStart);
		if (!Number.isFinite(start.getTime())) return '—';
		try {
			return new Intl.DateTimeFormat(undefined, {
				year: 'numeric',
				month: 'short',
				day: 'numeric',
				timeZone: data.timezone
			}).format(start);
		} catch {
			return start.toLocaleDateString();
		}
	}

	function scopeLabel(data: ReportSnapshot): string {
		if (!data.locationId) return t('reports.snapshot.allLocations');
		const location = locations.find((entry) => entry.id === data.locationId);
		return location?.data.name ?? data.locationId.slice(0, 8);
	}

	function published(object: SnapshotRow['object']): boolean {
		return Boolean((object as { __eventId?: string }).__eventId);
	}

	function download(name: string, content: string, type: string) {
		const blob = new Blob([content], { type });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = name;
		link.click();
		URL.revokeObjectURL(url);
	}

	function exportJson() {
		download(
			`bnos_snapshots_${new Date().toISOString().slice(0, 10)}.json`,
			JSON.stringify(
				filtered.map((row) => row.data),
				null,
				2
			),
			'application/json'
		);
	}

	function csvCell(value: unknown): string {
		const text = String(value ?? '');
		return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
	}

	function exportCsv() {
		const header = [
			'period_start',
			'period_end',
			'granularity',
			'location_id',
			'timezone',
			'currency',
			'gross',
			'net',
			'tax',
			'discount',
			'refund',
			'orders',
			'items',
			'avg_ticket',
			'generated_at',
			'id'
		];
		const lines = [header.join(',')];
		for (const { object, data } of filtered) {
			lines.push(
				[
					data.periodStart,
					data.periodEnd,
					data.granularity,
					data.locationId ?? '',
					data.timezone ?? '',
					data.currency,
					fromMinorUnits(data.grossMinor, data.currency),
					fromMinorUnits(data.netMinor, data.currency),
					fromMinorUnits(data.taxMinor, data.currency),
					fromMinorUnits(data.discountMinor, data.currency),
					fromMinorUnits(data.refundMinor, data.currency),
					data.ordersCount,
					data.itemsCount,
					fromMinorUnits(data.avgTicketMinor, data.currency),
					data.generatedAt,
					object.id
				]
					.map(csvCell)
					.join(',')
			);
		}
		download(
			`bnos_snapshots_${new Date().toISOString().slice(0, 10)}.csv`,
			`\uFEFF${lines.join('\n')}`,
			'text/csv;charset=utf-8'
		);
	}

	async function syncNow() {
		busy = 'sync';
		try {
			const synced = await dataSync.syncTypes([TYPE.reportSnapshot], {
				force: true,
				silent: false,
				scope: 'snapshots'
			});
			if (synced) toast.success(t('reports.snapshot.synced'));
		} finally {
			busy = null;
		}
	}

	async function backfill() {
		busy = 'backfill';
		try {
			const result = await backfillDailySnapshots({ days: 30 });
			if (result.created > 0) {
				void logActivity({
					action: 'create',
					resource: 'report.snapshot',
					summary: `Backfilled ${result.created} daily report snapshot${result.created === 1 ? '' : 's'}`,
					meta: { days: 30, created: result.created, skipped: result.skipped }
				});
			}
			toast.success(
				t('reports.snapshot.backfillTitle'),
				t('reports.snapshot.backfillDone', {
					created: result.created,
					skipped: result.skipped
				})
			);
		} catch (error) {
			toast.error(
				t('reports.snapshot.backfillFailed'),
				error instanceof Error ? error.message : undefined
			);
		} finally {
			busy = null;
		}
	}

	async function pruneHourly() {
		if (
			!(await confirm({
				title: t('reports.snapshot.pruneTitle'),
				message: t('reports.snapshot.pruneMessage', { days: retentionDays }),
				tone: 'danger',
				icon: 'lucide:trash-2',
				confirmText: t('reports.snapshot.prune')
			}))
		)
			return;
		busy = 'prune';
		try {
			const removed = pruneHourlySnapshots({ olderThanMs: retentionDays * 86_400_000 });
			toast.success(
				t('reports.snapshot.pruneDone'),
				t('reports.snapshot.pruneCount', { n: removed })
			);
		} finally {
			busy = null;
		}
	}

	async function republish(data: ReportSnapshot) {
		busy = 'sync';
		try {
			await publishReportSnapshot({
				granularity: data.granularity,
				periodStart: Date.parse(data.periodStart),
				periodEnd: Date.parse(data.periodEnd),
				locationId: data.locationId ?? null,
				audit: true
			});
			toast.success(t('reports.snapshot.republished'));
		} catch (error) {
			toast.error(
				t('reports.snapshot.publishFailed'),
				error instanceof Error ? error.message : undefined
			);
		} finally {
			busy = null;
		}
	}

	async function copyId(id: string) {
		try {
			await navigator.clipboard.writeText(id);
			toast.success(t('reports.snapshot.idCopied'));
		} catch {
			toast.error(t('reports.snapshot.copyFailed'));
		}
	}
</script>

<svelte:head><title>{t('common.appName')} · {t('reports.snapshot.pageTitle')}</title></svelte:head>

<div class="space-y-5">
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div>
			<Button href={resolve('/reports')} color="neutral" variant="ghost" size="sm" class="-ml-2">
				<Icon name="lucide:arrow-left" class="size-4" />
				{t('reports.snapshot.reportsBack')}
			</Button>
			<h1 class="mt-1 font-display text-xl font-bold tracking-tight">
				{t('reports.snapshot.pageTitle')}
			</h1>
			<p class="text-[12.5px] text-(--ui-text-muted)">
				{t('reports.snapshot.pageDescription')}
			</p>
		</div>
		<div class="flex flex-wrap items-center gap-2">
			<Button color="neutral" variant="subtle" size="sm" onclick={syncNow} disabled={busy !== null}>
				<Icon name="lucide:refresh-cw" class="size-4" />
				{busy === 'sync' ? t('reports.snapshot.syncing') : t('reports.snapshot.syncRelays')}
			</Button>
			<Button
				color="neutral"
				variant="subtle"
				size="sm"
				onclick={backfill}
				disabled={busy !== null}
			>
				<Icon name="lucide:history" class="size-4" />
				{busy === 'backfill'
					? t('reports.snapshot.backfilling')
					: t('reports.snapshot.backfill30d')}
			</Button>
		</div>
	</div>

	<div class="surface-card flex flex-wrap items-end gap-2 p-3">
		<Select
			bind:value={granularity}
			options={granularityOptions}
			size="sm"
			aria-label={t('reports.snapshot.type')}
		/>
		<Select
			bind:value={locationFilter}
			options={locationOptions}
			size="sm"
			aria-label={t('reports.snapshot.scope')}
		/>
		<Select
			bind:value={currencyFilter}
			options={currencyOptions}
			size="sm"
			aria-label={t('reports.snapshot.allCurrencies')}
		/>
		<DateRangePicker bind:from={fromDate} bind:to={toDate} />
		<div class="ml-auto flex items-center gap-2">
			<span class="text-[11px] text-(--ui-text-dimmed)">
				{t('reports.snapshot.filteredOf', { filtered: filtered.length, total: rows.length })}
			</span>
			<Button
				color="neutral"
				variant="ghost"
				size="sm"
				onclick={exportJson}
				disabled={!filtered.length}
			>
				<Icon name="lucide:file-json" class="size-4" />
				{t('reports.snapshot.exportJson')}
			</Button>
			<Button
				color="neutral"
				variant="ghost"
				size="sm"
				onclick={exportCsv}
				disabled={!filtered.length}
			>
				<Icon name="lucide:download" class="size-4" />
				{t('reports.snapshot.exportCsv')}
			</Button>
		</div>
	</div>

	<div class="surface-card flex flex-wrap items-center justify-between gap-2 px-3 py-2">
		<label class="flex items-center gap-2 text-[12px] text-(--ui-text-muted)">
			<Icon name="lucide:trash-2" class="size-4 text-(--ui-text-dimmed)" />
			{t('reports.snapshot.retention')}
			<input
				type="number"
				min="1"
				max="3650"
				bind:value={retentionDays}
				onchange={updateRetention}
				aria-label={t('reports.snapshot.retentionDays')}
				class="h-8 w-20 rounded-lg border border-(--ui-border) bg-(--ui-bg-muted) px-2 text-right text-[12px] tabular-nums"
			/>
			{t('reports.snapshot.daysShort')}
		</label>
		<div class="flex flex-wrap items-center gap-2">
			<span class="text-[11px] text-(--ui-text-dimmed)">
				{t('reports.snapshot.retainedTypes')}
			</span>
			<Button
				color="neutral"
				variant="subtle"
				size="sm"
				onclick={pruneHourly}
				disabled={busy !== null}
			>
				<Icon name="lucide:trash-2" class="size-4" />
				{busy === 'prune' ? t('reports.snapshot.pruning') : t('reports.snapshot.prune')}
			</Button>
		</div>
	</div>

	<div class="surface-card overflow-hidden">
		{#if !filtered.length}
			<div class="flex flex-col items-center justify-center gap-2 px-5 py-14 text-center">
				<Icon name="lucide:file-chart-column" class="size-8 text-(--ui-text-dimmed)" />
				<p class="text-[13px] font-semibold">{t('reports.snapshot.noMatchTitle')}</p>
				<p class="text-[12px] text-(--ui-text-muted)">
					{t('reports.snapshot.noMatchHint')}
				</p>
			</div>
		{:else}
			<div class="overflow-x-auto">
				<table class="w-full min-w-[980px] text-[12px]">
					<thead class="bg-(--ui-bg-muted)/50">
						<tr class="text-left text-(--ui-text-dimmed)">
							<th class="px-4 py-2.5 font-semibold">{t('reports.snapshot.period')}</th>
							<th class="px-3 py-2.5 font-semibold">{t('reports.snapshot.type')}</th>
							<th class="px-3 py-2.5 font-semibold">{t('reports.snapshot.scope')}</th>
							<th class="px-3 py-2.5 text-right font-semibold">{t('reports.snapshot.gross')}</th>
							<th class="px-3 py-2.5 text-right font-semibold">{t('reports.snapshot.net')}</th>
							<th class="px-3 py-2.5 text-right font-semibold">{t('reports.snapshot.orders')}</th>
							<th class="px-3 py-2.5 font-semibold">{t('reports.snapshot.generated')}</th>
							<th class="px-3 py-2.5 font-semibold">{t('reports.snapshot.status')}</th>
							<th class="px-4 py-2.5 text-right font-semibold">{t('reports.snapshot.actions')}</th>
						</tr>
					</thead>
					<tbody>
						{#each filtered as row (row.object.id)}
							<tr
								class="border-t border-(--ui-border)/50 transition-colors hover:bg-(--ui-bg-accented)/40"
							>
								<td class="px-4 py-2.5 font-semibold whitespace-nowrap">
									{formatPeriod(row.data)}
								</td>
								<td class="px-3 py-2.5"><Badge color="neutral">{row.data.granularity}</Badge></td>
								<td class="px-3 py-2.5 text-(--ui-text-muted)">{scopeLabel(row.data)}</td>
								<td class="px-3 py-2.5 text-right tabular-nums">
									{formatMoney(
										fromMinorUnits(row.data.grossMinor, row.data.currency),
										row.data.currency
									)}
								</td>
								<td class="px-3 py-2.5 text-right font-semibold tabular-nums">
									{formatMoney(
										fromMinorUnits(row.data.netMinor, row.data.currency),
										row.data.currency
									)}
								</td>
								<td class="px-3 py-2.5 text-right tabular-nums"
									>{formatInt(row.data.ordersCount)}</td
								>
								<td class="px-3 py-2.5 whitespace-nowrap text-(--ui-text-muted)">
									{relativeTime(row.data.generatedAt)}
								</td>
								<td class="px-3 py-2.5">
									<Badge color={published(row.object) ? 'success' : 'neutral'}>
										{published(row.object)
											? t('reports.snapshot.published')
											: t('reports.snapshot.local')}
									</Badge>
								</td>
								<td class="px-4 py-2.5">
									<div class="flex items-center justify-end gap-1">
										<Button
											color="neutral"
											variant="ghost"
											size="icon-sm"
											aria-label={expandedId === row.object.id
												? t('reports.snapshot.hideDetails')
												: t('reports.snapshot.viewDetails')}
											title={expandedId === row.object.id
												? t('reports.snapshot.hideDetails')
												: t('reports.snapshot.viewDetails')}
											onclick={() =>
												(expandedId = expandedId === row.object.id ? null : row.object.id)}
										>
											<Icon
												name={expandedId === row.object.id
													? 'lucide:chevron-up'
													: 'lucide:chevron-down'}
												class="size-4"
											/>
										</Button>
										<Button
											color="neutral"
											variant="ghost"
											size="icon-sm"
											aria-label={t('reports.snapshot.republish')}
											title={t('reports.snapshot.republish')}
											onclick={() => republish(row.data)}
											disabled={busy !== null}
										>
											<Icon name="lucide:refresh-cw" class="size-4" />
										</Button>
										<Button
											color="neutral"
											variant="ghost"
											size="icon-sm"
											aria-label={t('reports.snapshot.copyId')}
											title={t('reports.snapshot.copyId')}
											onclick={() => copyId(row.object.id)}
										>
											<Icon name="lucide:copy" class="size-4" />
										</Button>
									</div>
								</td>
							</tr>
							{#if expandedId === row.object.id}
								<tr class="border-t border-(--ui-border)/50 bg-(--ui-bg-muted)/30">
									<td colspan="9" class="px-4 py-4">
										<div class="grid gap-4 lg:grid-cols-3">
											<div>
												<div
													class="mb-1.5 text-[11px] font-semibold text-(--ui-text-dimmed) uppercase"
												>
													{t('reports.snapshot.totals')}
												</div>
												<dl class="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
													<dt class="text-(--ui-text-dimmed)">{t('reports.snapshot.tax')}</dt>
													<dd class="text-right tabular-nums">
														{formatMoney(
															fromMinorUnits(row.data.taxMinor, row.data.currency),
															row.data.currency
														)}
													</dd>
													<dt class="text-(--ui-text-dimmed)">{t('reports.snapshot.discount')}</dt>
													<dd class="text-right tabular-nums">
														{formatMoney(
															fromMinorUnits(row.data.discountMinor, row.data.currency),
															row.data.currency
														)}
													</dd>
													<dt class="text-(--ui-text-dimmed)">{t('reports.snapshot.refund')}</dt>
													<dd class="text-right tabular-nums">
														{formatMoney(
															fromMinorUnits(row.data.refundMinor, row.data.currency),
															row.data.currency
														)}
													</dd>
													<dt class="text-(--ui-text-dimmed)">{t('reports.snapshot.items')}</dt>
													<dd class="text-right tabular-nums">{formatInt(row.data.itemsCount)}</dd>
													<dt class="text-(--ui-text-dimmed)">{t('reports.snapshot.avgTicket')}</dt>
													<dd class="text-right tabular-nums">
														{formatMoney(
															fromMinorUnits(row.data.avgTicketMinor, row.data.currency),
															row.data.currency
														)}
													</dd>
												</dl>
											</div>
											<div>
												<div
													class="mb-1.5 text-[11px] font-semibold text-(--ui-text-dimmed) uppercase"
												>
													{t('reports.snapshot.payments')}
												</div>
												{#if Object.keys(row.data.payments).length}
													<dl class="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
														{#each Object.entries(row.data.payments) as [method, amount] (method)}
															<dt class="text-(--ui-text-dimmed) capitalize">{method}</dt>
															<dd class="text-right tabular-nums">
																{formatMoney(
																	fromMinorUnits(amount, row.data.currency),
																	row.data.currency
																)}
															</dd>
														{/each}
													</dl>
												{:else}
													<p class="text-[12px] text-(--ui-text-dimmed)">
														{t('reports.snapshot.noPayments')}
													</p>
												{/if}
												<div
													class="mt-3 mb-1.5 text-[11px] font-semibold text-(--ui-text-dimmed) uppercase"
												>
													{t('reports.snapshot.statuses')}
												</div>
												<div class="flex flex-wrap gap-1">
													{#each Object.entries(row.data.orderStatus) as [status, count] (status)}
														<Badge color="neutral">{status} {formatInt(count)}</Badge>
													{/each}
												</div>
											</div>
											<div>
												<div
													class="mb-1.5 text-[11px] font-semibold text-(--ui-text-dimmed) uppercase"
												>
													{t('reports.snapshot.topProducts')}
												</div>
												{#if row.data.topProducts.length}
													<table class="w-full text-[12px]">
														<tbody>
															{#each row.data.topProducts.slice(0, 10) as product (product.productId)}
																<tr class="border-b border-(--ui-border)/40 last:border-0">
																	<td
																		class="py-1 pr-2 font-mono text-[11px] text-(--ui-text-muted)"
																	>
																		{product.productId}
																	</td>
																	<td class="py-1 text-right tabular-nums"
																		>{formatInt(product.qty)}×</td
																	>
																	<td class="py-1 pl-3 text-right tabular-nums">
																		{formatMoney(
																			fromMinorUnits(product.revenueMinor, row.data.currency),
																			row.data.currency
																		)}
																	</td>
																</tr>
															{/each}
														</tbody>
													</table>
												{:else}
													<p class="text-[12px] text-(--ui-text-dimmed)">
														{t('reports.snapshot.noProducts')}
													</p>
												{/if}
											</div>
										</div>
										<div
											class="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-(--ui-text-dimmed)"
										>
											<span class="font-mono">{row.object.id}</span>
											{#if row.data.timezone}<span>· {row.data.timezone}</span>{/if}
											<span>· {formatPeriod(row.data)}</span>
											{#if expandedDrift}
												{#if expandedDrift.net === 0 && expandedDrift.orders === 0 && expandedDrift.items === 0}
													<Badge color="success">{t('reports.snapshot.matchesLocal')}</Badge>
												{:else}
													<Badge color="warning">{t('reports.snapshot.differsLocal')}</Badge>
													<span>
														· {t('reports.snapshot.localDelta', {
															orders: `${expandedDrift.orders >= 0 ? '+' : ''}${expandedDrift.orders}`,
															net: `${expandedDrift.net >= 0 ? '+' : '−'}${formatMoney(
																fromMinorUnits(Math.abs(expandedDrift.net), row.data.currency),
																row.data.currency
															)}`,
															items: `${expandedDrift.items >= 0 ? '+' : ''}${expandedDrift.items}`
														})}
													</span>
												{/if}
											{/if}
										</div>
									</td>
								</tr>
							{/if}
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
</div>
