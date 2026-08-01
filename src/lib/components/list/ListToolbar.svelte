<script lang="ts">
	/**
	 * Toolbar for list/data-table pages: search, sort-key dropdown, asc/desc
	 * toggle, and grid/table/list view-mode switcher. A `filters` snippet lets
	 * pages inject extra filter controls (status select, date range, …).
	 */
	import type { Snippet } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { cn } from '$lib/utils/cn';
	import type { SortOption } from '$lib/utils/list.svelte';

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	type AnySortOption = SortOption<any>;

	let {
		search = $bindable(''),
		sortKey = $bindable(''),
		sortDir = $bindable<'asc' | 'desc'>('asc'),
		viewMode = $bindable<'grid' | 'table' | 'list'>('table'),
		sortItems = [],
		searchPlaceholder = 'Search…',
		allowViewModes = ['grid', 'table'] as ('grid' | 'table' | 'list')[],
		applySort,
		setViewMode,
		filters,
		class: className
	}: {
		search?: string;
		sortKey?: string;
		sortDir?: 'asc' | 'desc';
		viewMode?: 'grid' | 'table' | 'list';
		sortItems?: AnySortOption[];
		searchPlaceholder?: string;
		allowViewModes?: ('grid' | 'table' | 'list')[];
		applySort?: (key: string) => void;
		setViewMode?: (mode: 'grid' | 'table' | 'list') => void;
		filters?: Snippet;
		class?: string;
	} = $props();
</script>

<div class={cn('flex flex-wrap items-center gap-2', className)}>
	<!-- search -->
	<div
		class="relative inline-flex min-w-[180px] flex-1 items-center rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] transition-colors focus-within:border-[var(--ui-color-primary-500)]"
	>
		<Icon name="lucide:search" class="pointer-events-none absolute left-3 size-4 text-[var(--ui-text-dimmed)]" />
		<input
			bind:value={search}
			placeholder={searchPlaceholder}
			class="h-9 w-full rounded-lg bg-transparent pr-3 pl-9 text-[13.5px] text-[var(--ui-text)] placeholder:text-[var(--ui-text-dimmed)] focus:outline-none"
		/>
	</div>

	<!-- extra filters (status select, etc.) -->
	{#if filters}
		{@render filters()}
	{/if}

	<div class="ml-auto flex items-center gap-2">
		<!-- sort key -->
		{#if sortItems.length > 1}
			<div
				class="relative inline-flex items-center rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)]"
			>
				<select
					bind:value={sortKey}
					class="h-9 appearance-none rounded-lg bg-transparent py-0 pr-8 pl-3 text-[13px] font-medium text-[var(--ui-text)] focus:outline-none"
					onchange={(e) => applySort?.((e.currentTarget as HTMLSelectElement).value)}
				>
					{#each sortItems as opt (opt.key)}
						<option value={opt.key}>{opt.label}</option>
					{/each}
				</select>
				<Icon
					name="lucide:chevron-down"
					class="pointer-events-none absolute right-2 size-3.5 text-[var(--ui-text-dimmed)]"
				/>
			</div>
		{/if}

		<!-- direction toggle -->
		<button
			type="button"
			class="grid size-9 place-items-center rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]"
			title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
			onclick={() => applySort?.(sortKey)}
		>
			<Icon
				name={sortDir === 'asc' ? 'lucide:arrow-up-narrow-wide' : 'lucide:arrow-down-narrow-wide'}
				class="size-4"
			/>
		</button>

		<!-- view modes -->
		{#if setViewMode && allowViewModes.length > 1}
			<div class="segmented flex items-center gap-0.5">
				{#if allowViewModes.includes('grid')}
					<button
						type="button"
						class={cn(
							'grid size-8 place-items-center rounded-md transition-colors',
							viewMode === 'grid'
								? 'bg-[var(--ui-bg-elevated)] text-[var(--ui-text)] shadow-sm'
								: 'text-[var(--ui-text-dimmed)] hover:text-[var(--ui-text)]'
						)}
						title="Grid view"
						onclick={() => setViewMode('grid')}
					>
						<Icon name="lucide:layout-grid" class="size-4" />
					</button>
				{/if}
				{#if allowViewModes.includes('table')}
					<button
						type="button"
						class={cn(
							'grid size-8 place-items-center rounded-md transition-colors',
							viewMode === 'table'
								? 'bg-[var(--ui-bg-elevated)] text-[var(--ui-text)] shadow-sm'
								: 'text-[var(--ui-text-dimmed)] hover:text-[var(--ui-text)]'
						)}
						title="Table view"
						onclick={() => setViewMode('table')}
					>
						<Icon name="lucide:table" class="size-4" />
					</button>
				{/if}
				{#if allowViewModes.includes('list')}
					<button
						type="button"
						class={cn(
							'grid size-8 place-items-center rounded-md transition-colors',
							viewMode === 'list'
								? 'bg-[var(--ui-bg-elevated)] text-[var(--ui-text)] shadow-sm'
								: 'text-[var(--ui-text-dimmed)] hover:text-[var(--ui-text)]'
						)}
						title="List view"
						onclick={() => setViewMode('list')}
					>
						<Icon name="lucide:list" class="size-4" />
					</button>
				{/if}
			</div>
		{/if}
	</div>
</div>
