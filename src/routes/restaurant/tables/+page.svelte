<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { glo } from '$nostr/store.svelte';
	import { toast } from '$lib/stores/toast.svelte';

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

	const STATUS_OPTIONS: { value: TableStatus; label: string; color: 'success' | 'error' | 'warning' | 'info' }[] = [
		{ value: 'available', label: 'Available', color: 'success' },
		{ value: 'occupied', label: 'Occupied', color: 'error' },
		{ value: 'reserved', label: 'Reserved', color: 'warning' },
		{ value: 'cleaning', label: 'Cleaning', color: 'info' }
	];

	const statusColor = (s: TableStatus) =>
		s === 'available' ? 'success' : s === 'occupied' ? 'error' : s === 'reserved' ? 'warning' : 'info';

	const statusBg = (s: TableStatus) =>
		s === 'available'
			? 'border-emerald-200 dark:border-emerald-900/30 bg-emerald-50 dark:bg-emerald-950/20'
			: s === 'occupied'
				? 'border-red-200 dark:border-red-900/30 bg-red-50 dark:bg-red-950/20'
				: s === 'reserved'
					? 'border-amber-200 dark:border-amber-900/30 bg-amber-50 dark:bg-amber-950/20'
					: 'border-blue-200 dark:border-blue-900/30 bg-blue-50 dark:bg-blue-950/20';

	const statusDot = (s: TableStatus) =>
		s === 'available'
			? 'bg-emerald-500'
			: s === 'occupied'
				? 'bg-red-500'
				: s === 'reserved'
					? 'bg-amber-500'
					: 'bg-blue-500';

	// ── Load tables from glo or localStorage fallback ──
	function loadTables(): Table[] {
		const gloData = glo.all<Table>(TABLE_TYPE);
		if (gloData.length > 0) return gloData.map((g) => g.data);
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (raw) return JSON.parse(raw);
		} catch { /* noop */ }
		return [];
	}

	function saveTables(list: Table[]) {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
		for (const t of list) {
			void glo.upsert(TABLE_TYPE, t, { id: t.id });
		}
	}

	onMount(() => {
		glo.hydrate(TABLE_TYPE);
		glo.hydrate('commerce.order');
	});

	// ── State ──
	let tables = $state<Table[]>(loadTables());
	let filterStatus = $state<TableStatus | 'all'>('all');
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

	// ── Derived ──
	const areas = $derived([...new Set(tables.map((t) => t.area || 'Main'))].sort());

	const filteredTables = $derived(
		tables.filter((t) => {
			const matchesStatus = filterStatus === 'all' || t.status === filterStatus;
			const matchesArea = filterArea === 'all' || (t.area || 'Main') === filterArea;
			return matchesStatus && matchesArea;
		})
	);



	const stats = $derived({
		total: tables.length,
		available: tables.filter((t) => t.status === 'available').length,
		occupied: tables.filter((t) => t.status === 'occupied').length,
		reserved: tables.filter((t) => t.status === 'reserved').length,
		cleaning: tables.filter((t) => t.status === 'cleaning').length
	});

	const filterTabs = $derived([
		{ status: 'all' as const, label: 'All', count: stats.total, dotColor: '' },
		{ status: 'available' as const, label: 'Available', count: stats.available, dotColor: 'bg-emerald-500' },
		{ status: 'occupied' as const, label: 'Occupied', count: stats.occupied, dotColor: 'bg-red-500' },
		{ status: 'reserved' as const, label: 'Reserved', count: stats.reserved, dotColor: 'bg-amber-500' },
		{ status: 'cleaning' as const, label: 'Cleaning', count: stats.cleaning, dotColor: 'bg-blue-500' }
	]);

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
				t.id === editId ? { ...t, name: formName.trim(), seats: formSeats, area: formArea, status: formStatus } : t
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
			{ id: crypto.randomUUID(), name: 'T1', seats: 2, status: 'available', area: 'Main', orderInfo: null },
			{ id: crypto.randomUUID(), name: 'T2', seats: 4, status: 'occupied', area: 'Main', orderInfo: { number: '#1042', total: 28.5 } },
			{ id: crypto.randomUUID(), name: 'T3', seats: 4, status: 'available', area: 'Main', orderInfo: null },
			{ id: crypto.randomUUID(), name: 'T4', seats: 6, status: 'reserved', area: 'Main', orderInfo: null },
			{ id: crypto.randomUUID(), name: 'T5', seats: 2, status: 'cleaning', area: 'Main', orderInfo: null },
			{ id: crypto.randomUUID(), name: 'Patio A', seats: 8, status: 'available', area: 'Patio', orderInfo: null },
			{ id: crypto.randomUUID(), name: 'Patio B', seats: 8, status: 'occupied', area: 'Patio', orderInfo: { number: '#1043', total: 52.0 } },
			{ id: crypto.randomUUID(), name: 'VIP 1', seats: 10, status: 'reserved', area: 'VIP', orderInfo: null }
		];
		tables = demo;
		saveTables(demo);
		toast.success('Demo tables added');
	}

	const areaList = $derived((() => {
		const groups: Record<string, Table[]> = {};
		for (const t of filteredTables) {
			const a = t.area || 'Main';
			(groups[a] ??= []).push(t);
		}
		return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
	})());
</script>

<svelte:head><title>BNOS · Tables</title></svelte:head>

<!-- Click-away for status popover -->
{#if openPopoverId}
	<div class="fixed inset-0 z-20" onclick={() => (openPopoverId = null)} role="presentation"></div>
{/if}

<div class="space-y-4">
	<!-- Header -->
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h1 class="font-display text-xl font-bold tracking-tight">Floor &amp; tables</h1>
			<p class="text-[12.5px] text-[var(--ui-text-muted)]">Table layout &amp; live status · kind 30610</p>
		</div>
		<Button color="primary" variant="solid" icon="lucide:plus" onclick={openAdd}>Add table</Button>
	</div>

	<!-- Stats bar -->
	<div class="flex flex-wrap items-center gap-3">
		{#each [
			{ label: 'Total', value: stats.total, color: 'neutral' as const, dot: 'bg-[var(--ui-text-dimmed)]' },
			{ label: 'Available', value: stats.available, color: 'success' as const, dot: 'bg-emerald-500' },
			{ label: 'Occupied', value: stats.occupied, color: 'error' as const, dot: 'bg-red-500' },
			{ label: 'Reserved', value: stats.reserved, color: 'warning' as const, dot: 'bg-amber-500' },
			{ label: 'Cleaning', value: stats.cleaning, color: 'info' as const, dot: 'bg-blue-500' }
		] as stat (stat.label)}
			<div class="flex items-center gap-2 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-3 py-1.5">
				<span class="size-2 rounded-full {stat.dot}"></span>
				<span class="text-[12px] font-semibold text-[var(--ui-text-muted)]">{stat.label}</span>
				<span class="text-[14px] font-bold tabular-nums">{stat.value}</span>
			</div>
		{/each}
	</div>

	<!-- Filter bar -->
	<div class="flex flex-wrap items-center gap-2">
		<!-- Status filter pills -->
		<div class="flex flex-wrap items-center gap-1.5">
			{#each filterTabs as ft (ft.status)}
				<button
					type="button"
					class="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition-colors
						{filterStatus === ft.status
						? 'border-primary-500/30 bg-primary-500/10 text-primary-700 dark:text-primary-300'
						: 'border-[var(--ui-border)] text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]'}"
					onclick={() => (filterStatus = ft.status)}
				>
					{#if ft.dotColor}
						<span class="size-2 rounded-full {ft.dotColor}"></span>
					{/if}
					{ft.label}
					<span class="ml-0.5 rounded-md bg-[var(--ui-bg-accented)] px-1.5 py-0.5 text-[10px] font-bold tabular-nums">{ft.count}</span>
				</button>
			{/each}
		</div>

		<!-- Area filter -->
		{#if areas.length > 1}
			<div class="ml-auto">
				<Select
					size="sm"
					value={filterArea}
					options={[{ value: 'all', label: 'All areas' }, ...areas.map((a) => ({ value: a, label: a }))]}
					onchange={(e: Event) => (filterArea = (e.currentTarget as HTMLSelectElement).value)}
				/>
			</div>
		{/if}
	</div>

	<!-- Table grid -->
	{#if tables.length === 0}
		<EmptyState icon="lucide:armchair" title="No tables configured" description="Add tables to manage your floor plan and track live status.">
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
						<span class="text-[11px] font-extrabold uppercase tracking-widest text-[var(--ui-text-dimmed)]">{areaName}</span>
						<span class="rounded bg-[var(--ui-bg-accented)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--ui-text-muted)]">{areaTables.length}</span>
					</div>

					<!-- Cards -->
					<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
						{#each areaTables as t (t.id)}
							<div
								class="relative flex flex-col rounded-2xl border p-4 min-h-[160px] transition-all duration-200 cursor-pointer select-none
								{openPopoverId === t.id ? 'z-30 ring-2 ring-primary-500 border-transparent scale-[1.02] shadow-lg' : 'hover:-translate-y-0.5 hover:shadow-md'}
								{statusBg(t.status)}"
								role="button"
								tabindex="0"
								onclick={() => (openPopoverId = openPopoverId === t.id ? null : t.id)}
								onkeydown={(e) => e.key === 'Enter' && (openPopoverId = openPopoverId === t.id ? null : t.id)}
							>
								<!-- Card top -->
								<div class="mb-2 flex items-center justify-between">
									<span class="font-display text-[15px] font-bold truncate">{t.name}</span>
									<span class="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider
										{t.status === 'available' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
										: t.status === 'occupied' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
										: t.status === 'reserved' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
										: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'}">
										<span class="size-1.5 rounded-full {statusDot(t.status)}"></span>
										{t.status}
									</span>
								</div>

								<!-- Card body -->
								<div class="flex flex-1 flex-col items-center justify-center py-2">
									<div class="flex items-center gap-1.5 text-[var(--ui-text-muted)]">
										<Icon name="lucide:users" class="size-4" />
										<span class="text-[20px] font-bold tabular-nums text-[var(--ui-text)]">{t.seats}</span>
										<span class="text-[11px] font-medium">seats</span>
									</div>
									{#if t.status === 'occupied' && t.orderInfo}
										<div class="mt-2 rounded-md bg-[var(--ui-bg-elevated)]/80 px-2.5 py-1 text-center">
											<div class="font-mono text-[11px] font-bold">{t.orderInfo.number}</div>
											<div class="text-[11px] text-[var(--ui-text-muted)]">${t.orderInfo.total.toFixed(2)}</div>
										</div>
									{:else if t.status === 'reserved'}
										<div class="mt-2 text-center text-[11px] text-[var(--ui-text-muted)]">
											<Icon name="lucide:clock" class="mr-1 inline size-3" />
											Reserved
										</div>
									{:else if t.status === 'cleaning'}
										<div class="mt-2 text-center text-[11px] text-[var(--ui-text-muted)]">
											<Icon name="lucide:sparkles" class="mr-1 inline size-3" />
											Cleaning…
										</div>
									{/if}
								</div>

								<!-- Status change popover -->
								{#if openPopoverId === t.id}
									<div
										class="absolute inset-x-0 bottom-full z-40 mb-2 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg-elevated)] p-2 shadow-xl"
										role="menu"
									>
										<div class="mb-1.5 flex items-center justify-between px-1">
											<span class="text-[11px] font-bold text-[var(--ui-text-muted)]">Set status</span>
											<div class="flex items-center gap-1">
												<button
													type="button"
													class="grid size-6 place-items-center rounded text-[var(--ui-text-dimmed)] hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]"
													title="Edit"
													onclick={(e) => { e.stopPropagation(); openEdit(t); }}
												>
													<Icon name="lucide:pencil" class="size-3.5" />
												</button>
												<button
													type="button"
													class="grid size-6 place-items-center rounded text-[var(--tone-error-text)] hover:bg-[var(--tone-error-bg)]"
													title="Delete"
													onclick={(e) => { e.stopPropagation(); deleteTable(t.id); }}
												>
													<Icon name="lucide:trash-2" class="size-3.5" />
												</button>
											</div>
										</div>
										<div class="grid grid-cols-2 gap-1">
											{#each STATUS_OPTIONS as opt (opt.value)}
												<button
													type="button"
													class="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-colors hover:bg-[var(--ui-bg-accented)]
														{t.status === opt.value ? 'bg-[var(--ui-bg-accented)] text-[var(--ui-text)]' : 'text-[var(--ui-text-muted)]'}"
													onclick={(e) => { e.stopPropagation(); setStatus(t.id, opt.value); }}
													role="menuitem"
												>
													<span class="size-2 rounded-full {statusDot(opt.value)}"></span>
													{opt.label}
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
<Dialog bind:open={dialogOpen} title={editMode ? 'Edit table' : 'Add table'} size="md">
	<div class="space-y-3">
		<div>
			<label class="mb-1 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Name</label>
			<Input bind:value={formName} placeholder="e.g. T1, Patio A" />
		</div>
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label class="mb-1 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Seats</label>
				<Input type="number" min="1" max="50" bind:value={formSeats} />
			</div>
			<div>
				<label class="mb-1 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Area</label>
				<Input bind:value={formArea} placeholder="Main, Patio, VIP…" />
			</div>
		</div>
		<div>
			<label class="mb-1 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Status</label>
			<Select
				value={formStatus}
				options={STATUS_OPTIONS.map((s) => ({ value: s.value, label: s.label }))}
				onchange={(e: Event) => (formStatus = (e.currentTarget as HTMLSelectElement).value as TableStatus)}
			/>
		</div>
	</div>
	{#snippet footer()}
		<Button variant="ghost" onclick={() => (dialogOpen = false)}>Cancel</Button>
		<Button color="primary" onclick={saveTable}>{editMode ? 'Save' : 'Add table'}</Button>
	{/snippet}
</Dialog>
