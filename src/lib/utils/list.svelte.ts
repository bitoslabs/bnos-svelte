import { browser } from '$app/environment';

export interface SortOption<T> {
	key: string;
	label: string;
	value: (item: T) => string | number;
}

export interface ListControlsOptions<T> {
	items: () => T[];
	search: (item: T, query: string) => boolean;
	sortOptions: () => SortOption<T>[];
	defaultSortKey: string;
	defaultSortDir?: 'asc' | 'desc';
	/** Default presentation. `grid` = card grid, `table` = data table, `list` = rows. */
	defaultViewMode?: 'grid' | 'table' | 'list';
	defaultPageSize?: number;
	pageSizeOptions?: number[];
	storageKey: string;
}

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 20, 50];

/**
 * Reactive search + sort + view-mode + pagination controls for list/data-table
 * pages. Ported from garden-os-svelte. All preferences are persisted to
 * localStorage so a user's sort/view/page-size sticks across visits.
 */
export function createListControls<T>(opts: ListControlsOptions<T>) {
	const pageSizeOptions = opts.pageSizeOptions ?? DEFAULT_PAGE_SIZE_OPTIONS;

	let search = $state('');
	let sortKey = $state(opts.defaultSortKey);
	let sortDir = $state<'asc' | 'desc'>(opts.defaultSortDir ?? 'asc');
	let viewMode = $state<'grid' | 'table' | 'list'>(opts.defaultViewMode ?? 'table');
	let pageSize = $state(opts.defaultPageSize ?? 10);
	let page = $state(1);

	if (browser) {
		try {
			const raw = localStorage.getItem(`bnos-os:list:${opts.storageKey}`);
			if (raw) {
				const saved = JSON.parse(raw);
				if (saved.sortKey) sortKey = saved.sortKey;
				if (saved.sortDir) sortDir = saved.sortDir;
				if (saved.viewMode) viewMode = saved.viewMode;
				if (saved.pageSize && Number.isFinite(saved.pageSize)) pageSize = saved.pageSize;
			}
		} catch {
			/* ignore */
		}
	}

	function persist() {
		if (!browser) return;
		localStorage.setItem(
			`bnos-os:list:${opts.storageKey}`,
			JSON.stringify({ sortKey, sortDir, viewMode, pageSize })
		);
	}

	const sortItems = $derived(opts.sortOptions());

	const list = $derived.by(() => {
		const items = opts.items();
		const q = search.trim().toLowerCase();
		const filtered = q ? items.filter((item) => opts.search(item, q)) : [...items];

		const option = opts.sortOptions().find((o) => o.key === sortKey);
		if (option) {
			const dir = sortDir === 'asc' ? 1 : -1;
			filtered.sort((a, b) => {
				const va = option.value(a);
				const vb = option.value(b);
				if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
				return String(va).localeCompare(String(vb)) * dir;
			});
		}
		return filtered;
	});

	const totalPages = $derived(Math.max(1, Math.ceil(list.length / pageSize)));
	const currentPage = $derived(Math.min(Math.max(1, page), totalPages));
	const rangeStart = $derived(list.length === 0 ? 0 : (currentPage - 1) * pageSize + 1);
	const rangeEnd = $derived(Math.min(currentPage * pageSize, list.length));
	const pagedList = $derived(list.slice((currentPage - 1) * pageSize, currentPage * pageSize));

	$effect(() => {
		const tp = totalPages;
		if (page < 1) page = 1;
		else if (page > tp) page = tp;
	});

	function applySort(key: string) {
		if (sortKey === key) {
			sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		} else {
			sortKey = key;
			sortDir = 'asc';
		}
		page = 1;
		persist();
	}

	function setViewMode(mode: 'grid' | 'table' | 'list') {
		viewMode = mode;
		persist();
	}

	function setPageSize(n: number) {
		pageSize = n;
		page = 1;
		persist();
	}

	function setPage(n: number) {
		page = Math.min(Math.max(1, n), totalPages);
	}
	function nextPage() {
		setPage(page + 1);
	}
	function prevPage() {
		setPage(page - 1);
	}

	return {
		get search() {
			return search;
		},
		set search(v: string) {
			search = v;
			page = 1;
		},
		get sortKey() {
			return sortKey;
		},
		get sortDir() {
			return sortDir;
		},
		get viewMode() {
			return viewMode;
		},
		get sortItems() {
			return sortItems;
		},
		get list() {
			return list;
		},
		get total() {
			return list.length;
		},
		get pageSize() {
			return pageSize;
		},
		get pageSizeOptions() {
			return pageSizeOptions;
		},
		get page() {
			return currentPage;
		},
		get totalPages() {
			return totalPages;
		},
		get rangeStart() {
			return rangeStart;
		},
		get rangeEnd() {
			return rangeEnd;
		},
		get pagedList() {
			return pagedList;
		},
		applySort,
		setViewMode,
		setPageSize,
		setPage,
		nextPage,
		prevPage
	};
}

export type ListControls<T> = ReturnType<typeof createListControls<T>>;
