<script lang="ts">
	/**
	 * Customer picker for the POS cart — a combobox that searches existing
	 * customers, links one to the sale (for history / loyalty / delivery), or
	 * sets a quick walk-in name. Shows the linked customer as a chip with their
	 * segment + loyalty balance when provided.
	 */
	import Popover from '$lib/components/ui/Popover.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import { formatInt } from '$lib/utils/format';
	import { t } from '$lib/i18n/i18n.svelte';
	export type SelectedCustomer = {
		id: string;
		name: string;
		segment?: string;
		points?: number;
	};

	type CustomerLike = {
		id: string;
		data: { name?: string; phone?: string; segment?: string };
	};

	type Props = {
		selected: SelectedCustomer | null;
		customers: CustomerLike[];
		onPick: (id: string, name: string) => void;
		onClear: () => void;
	};

	let { selected, customers, onPick, onClear }: Props = $props();

	let open = $state(false);
	let q = $state('');
	let walkIn = $state('');

	const segmentColor = (
		s?: string
	): 'neutral' | 'primary' | 'success' | 'info' | 'warning' | 'error' =>
		s === 'vip'
			? 'warning'
			: s === 'wholesale' || s === 'corporate'
				? 'info'
				: s === 'at_risk' || s === 'inactive'
					? 'error'
					: 'neutral';

	const filtered = $derived.by(() => {
		const query = q.trim().toLowerCase();
		const list = query
			? customers.filter(
					(c) =>
						(c.data.name ?? '').toLowerCase().includes(query) ||
						(c.data.phone ?? '').toLowerCase().includes(query)
				)
			: customers;
		return list.slice(0, 8);
	});

	function pick(c: CustomerLike) {
		onPick(c.id, c.data.name ?? 'Customer');
		open = false;
		q = '';
	}
	function confirmWalkIn() {
		const name = walkIn.trim();
		if (!name) return;
		onPick('', name); // walk-in: no customer record
		open = false;
		walkIn = '';
		q = '';
	}
	function clear() {
		onClear();
		open = false;
		q = '';
	}
</script>

<Popover bind:open align="start" side="bottom" class="w-80 p-0">
	{#snippet trigger()}
		{#if selected}
			<div
				class="flex w-full items-center gap-2 rounded-lg border border-primary-500/40 bg-primary-500/5 px-2.5 py-1.5 text-left transition-colors hover:bg-primary-500/10"
			>
				<span
					class="grid size-7 shrink-0 place-items-center rounded-full bg-primary-500/15 text-primary-600 dark:text-primary-400"
				>
					<Icon name="lucide:user-check" class="size-4" />
				</span>
				<div class="min-w-0 flex-1">
					<div class="truncate text-[12px] font-bold text-[var(--ui-text)]">{selected.name}</div>
					<div
						class="flex items-center gap-1.5 text-[10.5px] font-semibold text-[var(--ui-text-muted)]"
					>
						{#if selected.segment}
							<span class="capitalize">{selected.segment.replace('_', ' ')}</span>
						{/if}
						{#if selected.points != null && selected.points > 0}
							<span class="inline-flex items-center gap-0.5 text-[var(--tone-warning-text)]">
								<Icon name="lucide:award" class="size-3" />
								{formatInt(selected.points)}
							</span>
						{/if}
					</div>
				</div>
				<button
					type="button"
					aria-label="Remove customer"
					onclick={(e) => {
						e.stopPropagation();
						clear();
					}}
					class="grid size-6 shrink-0 place-items-center rounded-md text-[var(--ui-text-dimmed)] transition-colors hover:bg-[var(--ui-bg-accented)] hover:text-[var(--tone-error-text)]"
				>
					<Icon name="lucide:x" class="size-3.5" />
				</button>
			</div>
		{:else}
			<div
				class="flex w-full items-center gap-2 rounded-lg border border-dashed border-[var(--ui-border)] px-2.5 py-1.5 text-[12px] font-semibold text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--ui-bg-accented)]"
			>
				<Icon name="lucide:user-plus" class="size-4" />
				Add customer
				<span class="ml-auto text-[10px] font-normal text-[var(--ui-text-dimmed)]">{t('common.optional_field')}</span>
			</div>
		{/if}
	{/snippet}

	{#snippet content()}
		<div class="w-80">
			<div class="border-b border-[var(--ui-border-muted)] p-2.5">
				<Input
					bind:value={q}
					icon="lucide:search"
					placeholder="Search name or phone…"
					class="w-full"
				/>
			</div>
			<div class="max-h-64 overflow-y-auto p-1.5">
				{#if filtered.length === 0}
					<p class="px-2 py-4 text-center text-[11.5px] text-[var(--ui-text-dimmed)]">
						No customers match “{q}”.
					</p>
				{:else}
					{#each filtered as c (c.id)}
						<button
							type="button"
							onclick={() => pick(c)}
							class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[var(--ui-bg-accented)]"
						>
							<span
								class="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--ui-bg-muted)] text-[var(--ui-text-dimmed)]"
							>
								<Icon name="lucide:user" class="size-4" />
							</span>
							<div class="min-w-0 flex-1">
								<div class="truncate text-[12.5px] font-semibold">{c.data.name ?? 'Unnamed'}</div>
								{#if c.data.phone}
									<div class="truncate text-[10.5px] text-[var(--ui-text-dimmed)]">
										{c.data.phone}
									</div>
								{/if}
							</div>
							{#if c.data.segment}
								<Badge color={segmentColor(c.data.segment)}>{c.data.segment}</Badge>
							{/if}
						</button>
					{/each}
				{/if}
			</div>
			<div class="flex items-center gap-1.5 border-t border-[var(--ui-border-muted)] p-2">
				<Input
					bind:value={walkIn}
					icon="lucide:user-plus"
					placeholder="Walk-in name…"
					class="flex-1"
					onkeydown={(e) => e.key === 'Enter' && confirmWalkIn()}
				/>
				<button
					type="button"
					onclick={confirmWalkIn}
					class="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-500 text-white transition-colors hover:bg-primary-400"
					aria-label="Add walk-in"
				>
					<Icon name="lucide:plus" class="size-4" />
				</button>
			</div>
		</div>
	{/snippet}
</Popover>
