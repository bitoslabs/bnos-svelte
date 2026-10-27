<script lang="ts">
	import { onMount } from 'svelte';
	import { t } from '$lib/i18n/i18n.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import FilterChips from '$lib/components/ui/FilterChips.svelte';
	import { glo } from '$nostr/store.svelte';
	import { dataSync } from '$nostr/sync.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatMoney } from '$lib/utils/format';

	// ── Types ──
	type TableStatus = 'available' | 'occupied' | 'reserved' | 'cleaning';
	type Table = {
		id: string;
		name: string;
		seats: number;
		status: TableStatus;
		area: string;
		orderInfo?: { number: string; total: number } | null;
	};

	const TABLE_TYPE = 'restaurant.table';
	const STORAGE_KEY = 'bnos-os:tables';

	const STATUS_ORDER: TableStatus[] = ['available', 'occupied', 'reserved', 'cleaning'];

	const STATUS_META: Record<
		TableStatus,
		{ labelKey: string; dot: string; card: string; badge: string }
	> = {
		available: {
			labelKey: 'restaurant.available',
			dot: 'bg-emerald-500',
			card: 'border-emerald-200 dark:border-emerald-900/30 bg-emerald-50 dark:bg-emerald-950/20',
			badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
		},
		occupied: {
			labelKey: 'restaurant.occupied',
			dot: 'bg-red-500',
			card: 'border-red-200 dark:border-red-900/30 bg-red-50 dark:bg-red-950/20',
			badge: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
		},
		reserved: {
			labelKey: 'restaurant.reserved',
			dot: 'bg-amber-500',
			card: 'border-amber-200 dark:border-amber-900/30 bg-amber-50 dark:bg-amber-950/20',
			badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
		},
		cleaning: {
			labelKey: 'restaurant.cleaning',
			dot: 'bg-blue-500',
			card: 'border-blue-200 dark:border-blue-900/30 bg-blue-50 dark:bg-blue-950/20',
			badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
		}
	};

	// ── Load tables from glo or localStorage fallback ──
	function loadTables(): Table[] {
		const gloData = glo.all<Table>(TABLE_TYPE);
		if (gloData.length > 0) return gloData.map((g) => g.data);
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (raw) return JSON.parse(raw);
		} catch {
			/* noop */
		}
		return [];
	}

	function saveTables(list: Table[]) {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
		for (const t of list) {
			void glo.upsert(TABLE_TYPE, t, { id: t.id });
		}
	}

	onMount(() => {
		dataSync.pageSync([TABLE_TYPE, 'commerce.order'], { scope: 'restaurant-tables' });
	});

	// ── State ──
	let tables = $state<Table[]>(loadTables());
	let filterStatus = $state<string>('all');
	let filterArea = $state<string>('all');

	// Add/Edit dialog
	let dialogOpen = $state(false);
	let editMode = $state(false);
	let editId = $state('');
	let formName = $state('');
	let formSeats = $state(4);
	let formArea = $state('Main');
	let formStatus = $state<TableStatus>('available');

	// Status popover
	let openPopoverId = $state<string | null>(null);
	const currency = $derived(tenant.state.currency);

	// ── Derived ──
	const areas = $derived([...new Set(tables.map((t) => t.area || 'Main'))].sort());

	const filteredTables = $derived(
		tables.filter((t) => {
			const matchesStatus = filterStatus === 'all' || t.status === filterStatus;
			const matchesArea = filterArea === 'all' || (t.area || 'Main') === filterArea;
			return matchesStatus && matchesArea;
		})
	);

	const stats = $derived.by(() => {
		const counts = { total: tables.length, available: 0, occupied: 0, reserved: 0, cleaning: 0 };
		for (const table of tables) {
			if (table.status === 'available') counts.available++;
			else if (table.status === 'occupied') counts.occupied++;
			else if (table.status === 'reserved') counts.reserved++;
			else if (table.status === 'cleaning') counts.cleaning++;
		}
		return counts;
	});

	const filterChipOptions = $derived([
		{ value: 'all', label: t('common.all'), count: stats.total },
		...STATUS_ORDER.map((s) => ({
			value: s,
			label: t(STATUS_META[s].labelKey),
			count: stats[s],
			dot: STATUS_META[s].dot
		}))
	]);

	const statusOptions = $derived(
		STATUS_ORDER.map((s) => ({ value: s, label: t(STATUS_META[s].labelKey) }))
	);

	// ── Actions ──
	function openAdd() {
		editMode = false;
		editId = '';
		formName = '';
		formSeats = 4;
		formArea = areas[0] ?? 'Main';
		formStatus = 'available';
		dialogOpen = true;
	}

	function openEdit(table: Table) {
		editMode = true;
		editId = table.id;
		formName = table.name;
		formSeats = table.seats;
		formArea = table.area || 'Main';
		formStatus = table.status;
		dialogOpen = true;
	}

	function saveTable() {
		if (!formName.trim()) {
			toast.error('Table name required');
			return;
		}
		if (editMode && editId) {
			tables = tables.map((t) =>
				t.id === editId
					? { ...t, name: formName.trim(), seats: formSeats, area: formArea, status: formStatus }
					: t
			);
			toast.success('Table updated');
		} else {
			const newTable: Table = {
				id: crypto.randomUUID(),
				name: formName.trim(),
				seats: formSeats,
				area: formArea || 'Main',
				status: formStatus,
				orderInfo: null
			};
			tables = [newTable, ...tables];
			toast.success('Table added');
		}
		saveTables(tables);
		dialogOpen = false;
	}

	function deleteTable(id: string) {
		tables = tables.filter((t) => t.id !== id);
		glo.remove(TABLE_TYPE, id);
		saveTables(tables);
		toast.info('Table deleted');
	}

	function setStatus(id: string, status: TableStatus) {
		tables = tables.map((t) => (t.id === id ? { ...t, status } : t));
		saveTables(tables);
		openPopoverId = null;
		toast.success(`Marked ${status}`);
	}

	function seedDemo() {
		const demo: Table[] = [
			{
				id: crypto.randomUUID(),
				name: 'T1',
				seats: 2,
				status: 'available',
				area: 'Main',
				orderInfo: null
			},
			{
				id: crypto.randomUUID(),
				name: 'T2',
				seats: 4,
				status: 'occupied',
				area: 'Main',
				orderInfo: { number: '#1042', total: 28.5 }
			},
			{
				id: crypto.randomUUID(),
				name: 'T3',
				seats: 4,
				status: 'available',
				area: 'Main',
				orderInfo: null
			},
			{
				id: crypto.randomUUID(),
				name: 'T4',
				seats: 6,
				status: 'reserved',
				area: 'Main',
				orderInfo: null
			},
			{
				id: crypto.randomUUID(),
				name: 'T5',
				seats: 2,
				status: 'cleaning',
				area: 'Main',
				orderInfo: null
			},
			{
				id: crypto.randomUUID(),
				name: 'Patio A',
				seats: 8,
				status: 'available',
				area: 'Patio',
				orderInfo: null
			},
			{
				id: crypto.randomUUID(),
				name: 'Patio B',
				seats: 8,
				status: 'occupied',
				area: 'Patio',
				orderInfo: { number: '#1043', total: 52.0 }
			},
			{
				id: crypto.randomUUID(),
				name: 'VIP 1',
				seats: 10,
				status: 'reserved',
				area: 'VIP',
				orderInfo: null
			}
		];
		tables = demo;
		saveTables(demo);
		toast.success('Demo tables added');
	}

	const areaList = $derived(
		(() => {
			const groups: Record<string, Table[]> = {};
			for (const t of filteredTables) {
				const a = t.area || 'Main';
				(groups[a] ??= []).push(t);
			}
			return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
		})()
	);
</script>

<svelte:head><title>{t('common.appName')} · {t('nav.tables')}</title></svelte:head>

<!-- Click-away for status popover -->
{#if openPopoverId}
	<div class="fixed inset-0 z-20" onclick={() => (openPopoverId = null)} role="presentation"></div>
{/if}

<div class="space-y-4">
	<!-- Header -->
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h1 class="font-display text-xl font-bold tracking-tight">{t('restaurant.floorTables')}</h1>
			<p class="text-[12.5px] text-(--ui-text-muted)">{t('restaurant.floorTablesDesc')}</p>
		</div>
		<Button color="primary" variant="solid" icon="lucide:plus" onclick={openAdd}
			>{t('common.add') + ' ' + t('common.table')}</Button
		>
	</div>

	<!-- Filter bar -->
	<div class="flex flex-wrap items-center gap-2">
		<!-- Status filter chips -->
		<FilterChips bind:value={filterStatus} options={filterChipOptions} label={t('common.status')} />

		<!-- Area filter -->
		{#if areas.length > 1}
			<div class="ml-auto">
				<Select
					size="sm"
					value={filterArea}
					options={[
						{ value: 'all', label: t('restaurant.allAreas') },
						...areas.map((a) => ({ value: a, label: a }))
					]}
					onchange={(e: Event) => (filterArea = (e.currentTarget as HTMLSelectElement).value)}
				/>
			</div>
		{/if}
	</div>

	<!-- Table grid -->
	{#if tables.length === 0}
		<EmptyState
			icon="lucide:armchair"
			title={t('restaurant.noTables')}
			description={t('restaurant.noTablesDesc')}
		>
			{#snippet actions()}
				<Button color="primary" variant="soft" size="sm" onclick={seedDemo}>Add demo tables</Button>
			{/snippet}
		</EmptyState>
	{:else}
		<div class="space-y-6">
			{#each areaList as [areaName, areaTables] (areaName)}
				<div class="space-y-3">
					<!-- Area label -->
					<div class="flex items-center gap-2 px-1">
						<span
							class="text-[11px] font-extrabold tracking-widest text-(--ui-text-dimmed) uppercase"
							>{areaName}</span
						>
						<span
							class="rounded bg-(--ui-bg-accented) px-1.5 py-0.5 text-[10px] font-bold text-(--ui-text-muted)"
							>{areaTables.length}</span
						>
					</div>

					<!-- Cards -->
					<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
						{#each areaTables as tbl (tbl.id)}
							<div
								class="focus-ring relative flex min-h-[160px] cursor-pointer flex-col rounded-2xl border p-4 transition-all duration-200 select-none
								{openPopoverId === tbl.id
									? 'z-30 scale-[1.02] border-transparent shadow-lg ring-2 ring-primary-500'
									: 'hover:-translate-y-0.5 hover:shadow-md'}
								{STATUS_META[tbl.status].card}"
								role="button"
								tabindex="0"
								onclick={() => (openPopoverId = openPopoverId === tbl.id ? null : tbl.id)}
								onkeydown={(e) =>
									e.key === 'Enter' && (openPopoverId = openPopoverId === tbl.id ? null : tbl.id)}
							>
								<!-- Card top -->
								<div class="mb-2 flex items-center justify-between">
									<span class="truncate font-display text-[15px] font-bold">{tbl.name}</span>
									<span
										class="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase
										{STATUS_META[tbl.status].badge}"
									>
										<span class="size-1.5 rounded-full {STATUS_META[tbl.status].dot}"></span>
										{t(STATUS_META[tbl.status].labelKey)}
									</span>
								</div>

								<!-- Card body -->
								<div class="flex flex-1 flex-col items-center justify-center py-2">
									<div class="flex items-center gap-1.5 text-(--ui-text-muted)">
										<Icon name="lucide:users" class="size-4" />
										<span class="text-[20px] font-bold text-(--ui-text) tabular-nums"
											>{tbl.seats}</span
										>
										<span class="text-[11px] font-medium">{t('restaurant.seats')}</span>
									</div>
									{#if tbl.status === 'occupied' && tbl.orderInfo}
										<div class="mt-2 rounded-md bg-(--ui-bg-elevated)/80 px-2.5 py-1 text-center">
											<div class="font-mono text-[11px] font-bold">{tbl.orderInfo.number}</div>
											<div class="text-[11px] text-(--ui-text-muted)">
												{formatMoney(tbl.orderInfo.total, currency)}
											</div>
										</div>
									{:else if tbl.status === 'reserved'}
										<div class="mt-2 text-center text-[11px] text-(--ui-text-muted)">
											<Icon name="lucide:clock" class="mr-1 inline size-3" />
											{t('restaurant.reserved')}
										</div>
									{:else if tbl.status === 'cleaning'}
										<div class="mt-2 text-center text-[11px] text-(--ui-text-muted)">
											<Icon name="lucide:sparkles" class="mr-1 inline size-3" />
											{t('restaurant.cleaning')}…
										</div>
									{/if}
								</div>

								<!-- Status change popover -->
								{#if openPopoverId === tbl.id}
									<div
										class="absolute inset-x-0 bottom-full z-40 mb-2 rounded-xl border border-(--ui-border) bg-(--ui-bg-elevated) p-2 shadow-xl"
										role="menu"
									>
										<div class="mb-1.5 flex items-center justify-between px-1">
											<span class="text-[11px] font-bold text-(--ui-text-muted)"
												>{t('restaurant.setStatus')}</span
											>
											<div class="flex items-center gap-1">
												<button
													type="button"
													class="grid size-6 place-items-center rounded text-(--ui-text-dimmed) hover:bg-(--ui-bg-accented) hover:text-(--ui-text)"
													title={t('common.edit')}
													onclick={(e) => {
														e.stopPropagation();
														openEdit(tbl);
													}}
												>
													<Icon name="lucide:pencil" class="size-3.5" />
												</button>
												<button
													type="button"
													class="grid size-6 place-items-center rounded text-(--tone-error-text) hover:bg-(--tone-error-bg)"
													title={t('common.delete')}
													onclick={(e) => {
														e.stopPropagation();
														deleteTable(tbl.id);
													}}
												>
													<Icon name="lucide:trash-2" class="size-3.5" />
												</button>
											</div>
										</div>
										<div class="grid grid-cols-2 gap-1">
											{#each STATUS_ORDER as status (status)}
												<button
													type="button"
													class="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-colors hover:bg-(--ui-bg-accented)
														{tbl.status === status ? 'bg-(--ui-bg-accented) text-(--ui-text)' : 'text-(--ui-text-muted)'}"
													onclick={(e) => {
														e.stopPropagation();
														setStatus(tbl.id, status);
													}}
													role="menuitem"
												>
													<span class="size-2 rounded-full {STATUS_META[status].dot}"></span>
													{t(STATUS_META[status].labelKey)}
												</button>
											{/each}
										</div>
									</div>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<!-- Add / Edit Dialog -->
<Dialog
	bind:open={dialogOpen}
	title={editMode
		? t('common.edit') + ' ' + t('common.table')
		: t('common.add') + ' ' + t('common.table')}
	size="md"
>
	<div class="space-y-3">
		<div>
			<label for="table-name" class="mb-1 block text-[12px] font-semibold text-(--ui-text-muted)"
				>{t('common.name')}</label
			>
			<Input id="table-name" bind:value={formName} placeholder="e.g. T1, Patio A" />
		</div>
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label for="table-seats" class="mb-1 block text-[12px] font-semibold text-(--ui-text-muted)"
					>{t('restaurant.seats')}</label
				>
				<Input id="table-seats" type="number" min="1" max="50" bind:value={formSeats} />
			</div>
			<div>
				<label for="table-area" class="mb-1 block text-[12px] font-semibold text-(--ui-text-muted)"
					>{t('restaurant.area')}</label
				>
				<Input id="table-area" bind:value={formArea} placeholder="Main, Patio, VIP…" />
			</div>
		</div>
		<div>
			<label for="table-status" class="mb-1 block text-[12px] font-semibold text-(--ui-text-muted)"
				>{t('common.status')}</label
			>
			<Select
				id="table-status"
				value={formStatus}
				options={statusOptions}
				onchange={(e: Event) =>
					(formStatus = (e.currentTarget as HTMLSelectElement).value as TableStatus)}
			/>
		</div>
	</div>
	{#snippet footer()}
		<Button variant="ghost" onclick={() => (dialogOpen = false)}>{t('common.cancel')}</Button>
		<Button color="primary" onclick={saveTable}
			>{editMode ? t('common.save') : t('common.add') + ' ' + t('common.table')}</Button
		>
	{/snippet}
</Dialog>
