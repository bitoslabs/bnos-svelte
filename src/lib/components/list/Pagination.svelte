<script lang="ts">
	/** Sticky bottom pagination bar. Reads state from a createListControls() instance. */
	import Icon from '$lib/components/ui/Icon.svelte';
	import { t } from '$lib/i18n/i18n.svelte';
	import { cn } from '$lib/utils/cn';
	import type { ListControls } from '$lib/utils/list.svelte';

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	type AnyListControls = ListControls<any>;

	let {
		controls,
		class: className
	}: {
		controls: AnyListControls;
		class?: string;
	} = $props();

	const pageNumbers = $derived.by(() => {
		const total = controls.totalPages;
		const cur = controls.page;
		const out: (number | '…')[] = [];
		if (total <= 7) {
			for (let i = 1; i <= total; i++) out.push(i);
			return out;
		}
		out.push(1);
		const start = Math.max(2, cur - 1);
		const end = Math.min(total - 1, cur + 1);
		if (start > 2) out.push('…');
		for (let i = start; i <= end; i++) out.push(i);
		if (end < total - 1) out.push('…');
		out.push(total);
		return out;
	});
</script>

<div
	class={cn(
		'sticky bottom-0 z-20 border-t border-[var(--ui-border-muted)] bg-[var(--surface-bg)] px-5 py-3 backdrop-blur',
		className
	)}
>
	<div class="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
		<!-- rows-per-page + range -->
		<div class="flex items-center gap-3 text-[12px] text-[var(--ui-text-muted)]">
			<label class="flex items-center gap-2">
				<span>Rows</span>
				<div
					class="relative inline-flex items-center rounded-md border border-[var(--ui-border)] bg-[var(--ui-bg-muted)]"
				>
					<select
						value={controls.pageSize}
						onchange={(e) =>
							controls.setPageSize(Number((e.currentTarget as HTMLSelectElement).value))}
						class="h-7 appearance-none rounded-md bg-transparent py-0 pr-7 pl-2.5 text-[12px] font-semibold tabular-nums focus:outline-none"
						aria-label="Rows per page"
					>
						{#each controls.pageSizeOptions as opt (opt)}
							<option value={opt}>{opt}</option>
						{/each}
					</select>
					<Icon
						name="lucide:chevron-down"
						class="pointer-events-none absolute right-1.5 size-3 text-[var(--ui-text-dimmed)]"
					/>
				</div>
			</label>
			<span class="whitespace-nowrap tabular-nums">
				{#if controls.total === 0}
					No rows
				{:else}
					{controls.rangeStart}–{controls.rangeEnd} of {controls.total}
				{/if}
			</span>
		</div>

		<!-- pager -->
		<div class="flex items-center gap-1">
			<button
				type="button"
				class="grid size-8 place-items-center rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)] disabled:pointer-events-none disabled:opacity-40"
				title={t('common.previous')}
				aria-label="Previous page"
				disabled={controls.page <= 1}
				onclick={() => controls.prevPage()}
			>
				<Icon name="lucide:chevron-left" class="size-4" />
			</button>

			{#each pageNumbers as p (p)}
				{#if p === '…'}
					<span class="px-1 text-[12px] text-[var(--ui-text-dimmed)]">…</span>
				{:else}
					<button
						type="button"
						class="grid size-8 min-w-8 place-items-center rounded-lg px-2 text-[12px] font-semibold tabular-nums transition-colors {p ===
						controls.page
							? 'bg-primary-500 text-white'
							: 'border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]'}"
						onclick={() => controls.setPage(p)}
						aria-current={p === controls.page ? 'page' : undefined}
						aria-label="Page {p}"
					>
						{p}
					</button>
				{/if}
			{/each}

			<button
				type="button"
				class="grid size-8 place-items-center rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)] disabled:pointer-events-none disabled:opacity-40"
				title="Next"
				aria-label="Next page"
				disabled={controls.page >= controls.totalPages}
				onclick={() => controls.nextPage()}
			>
				<Icon name="lucide:chevron-right" class="size-4" />
			</button>
		</div>
	</div>
</div>
