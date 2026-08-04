<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { glo } from '$nostr/store.svelte';
	import { dataSync } from '$nostr/sync.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { permissions } from '$lib/permissions.svelte';
	import { formatMoney, relativeTime } from '$lib/utils/format';
	import { TYPE, statusColor, type Location } from '$lib/domain';
	import { shifts as shiftStore } from '$lib/pos/shifts.svelte';

	onMount(() => {
		dataSync.pageSync([TYPE.shift, TYPE.cashEvent], { scope: 'shifts' });
	});

	const currency = $derived(tenant.state.currency);

	// ── Branch scope ──────────────────────────────────────────────────────
	// Each branch owns its own active shift. Company-wide roles (owner/admin)
	// may inspect & operate any branch; branch-scoped roles stay on their own.
	type BranchOption = { id: string | null; label: string };
	const locations = $derived(glo.all<Location, typeof TYPE.location>(TYPE.location));
	const canManageAllBranches = $derived(
		tenant.state.activeRole === 'owner' || tenant.state.activeRole === 'admin'
	);

	const branchOptions = $derived.by<BranchOption[]>(() => {
		const opts: BranchOption[] = [];
		if (canManageAllBranches && locations.length > 0) {
			for (const loc of locations) {
				if (!permissions.canAccessBranch(loc.id)) continue;
				opts.push({ id: loc.id, label: loc.data.name ?? loc.id });
			}
		}
		// Always include the device's active branch (covers single-site tenants
		// where locationId is null — represented as the "Main" option).
		const current = tenant.state.locationId ?? null;
		if (!opts.some((o) => o.id === current)) {
			opts.unshift({ id: current, label: tenant.state.locationName || 'Main' });
		}
		return opts;
	});

	// The branch this page is currently operating on. Defaults to this device's
	// branch; company-wide roles can switch to another.
	let selectedBranchId = $state<string | null>(tenant.state.locationId ?? null);
	$effect(() => {
		// Keep selection valid as branches load.
		const valid = branchOptions.some((o) => o.id === selectedBranchId);
		if (!valid && branchOptions.length) selectedBranchId = branchOptions[0]!.id;
	});

	const branchId = $derived(selectedBranchId);
	const branchLabel = $derived(branchOptions.find((o) => o.id === branchId)?.label ?? 'Main');

	// ── Branch-scoped reactive lookups ────────────────────────────────────
	const allShifts = $derived(shiftStore.all);
	const activeShift = $derived(shiftStore.activeShiftFor(branchId));
	const branchShifts = $derived(
		allShifts
			.filter((s) => (s.data.branchId ?? null) === branchId)
			.slice()
			.sort((a, b) => (a.data.openedAt < b.data.openedAt ? 1 : -1))
	);
	const branchEvents = $derived(
		shiftStore.allCashEvents
			.filter((e) => {
				const parent = e.data.shiftId ? allShifts.find((s) => s.id === e.data.shiftId) : null;
				return parent ? (parent.data.branchId ?? null) === branchId : false;
			})
			.slice()
			.sort((a, b) => (a.data.occurredAt < b.data.occurredAt ? 1 : -1))
	);
	const summary = $derived(activeShift ? shiftStore.summaryFor(activeShift.id) : null);

	// ── Open / close / cash-event form state ──────────────────────────────
	let opening = $state<number | ''>('');
	let closing = $state(false); // close-dialog open flag
	let countedCash = $state<number | ''>('');
	let varianceNote = $state('');
	let cashAmt = $state<number | ''>('');
	let cashType = $state<'cash_in' | 'cash_out' | 'paid_out' | 'bank_deposit'>('cash_in');
	let cashReason = $state('');

	async function openShift() {
		const openingCash = typeof opening === 'number' ? opening : Number(opening) || 0;
		await shiftStore.openShift({ openingCash, branchId });
		opening = '';
	}
	async function closeShiftAction(force = false) {
		const cash = typeof countedCash === 'number' ? countedCash : Number(countedCash) || 0;
		const ok = await shiftStore.closeShift({
			closingCash: cash,
			note: varianceNote,
			branchId,
			force
		});
		if (ok) {
			closing = false;
			countedCash = '';
			varianceNote = '';
		}
	}
	async function addCashEvent() {
		const amount = typeof cashAmt === 'number' ? cashAmt : Number(cashAmt) || 0;
		const ok = await shiftStore.addCashEvent({
			type: cashType,
			amount,
			reason: cashReason,
			branchId
		});
		if (ok) {
			cashAmt = '';
			cashReason = '';
		}
	}

	const variance = $derived.by(() => {
		if (!summary) return 0;
		const counted = typeof countedCash === 'number' ? countedCash : Number(countedCash) || 0;
		return counted - (summary.expectedCash ?? 0);
	});
</script>

<svelte:head><title>BNOS · Shifts</title></svelte:head>

<div class="space-y-4">
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div>
			<h1 class="font-display text-xl font-bold tracking-tight">Shifts & cash drawer</h1>
			<p class="text-[12.5px] text-[var(--ui-text-muted)]">
				Open/close shifts per branch, record cash movements · GLO <code>shift</code> kind 30520 /
				<code>cash-event</code> kind 30521
			</p>
		</div>
		<!-- Branch scope selector (company-wide roles only) -->
		{#if canManageAllBranches && branchOptions.length > 1}
			<div
				class="relative inline-flex items-center rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg-muted)]"
			>
				<Icon
					name="lucide:map-pin"
					class="pointer-events-none absolute left-2.5 size-3.5 text-[var(--ui-text-dimmed)]"
				/>
				<select
					bind:value={selectedBranchId}
					class="h-9 appearance-none rounded-xl bg-transparent py-0 pr-8 pl-8 text-[13px] font-semibold focus:outline-none"
				>
					{#each branchOptions as opt (opt.id ?? 'main')}
						<option value={opt.id ?? ''}>{opt.label}</option>
					{/each}
				</select>
				<Icon
					name="lucide:chevron-down"
					class="pointer-events-none absolute right-2 size-3.5 text-[var(--ui-text-dimmed)]"
				/>
			</div>
		{:else}
			<span
				class="inline-flex items-center gap-1 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-2 py-1 text-[12px] font-semibold text-[var(--ui-text-muted)]"
			>
				<Icon name="lucide:map-pin" class="size-3.5" />
				{branchLabel}
			</span>
		{/if}
	</div>

	<!-- active shift / open -->
	{#if activeShift}
		{@const s = summary}
		<div class="accent-bar surface-card space-y-4 p-5" style="--accent:var(--tone-success-text);">
			<div class="flex flex-wrap items-center justify-between gap-3">
				<div class="flex items-center gap-3">
					<div
						class="grid size-10 place-items-center rounded-xl bg-[var(--tone-success-bg)] text-[var(--tone-success-text)]"
					>
						<Icon name="lucide:lock-open" class="size-5" />
					</div>
					<div>
						<div
							class="text-[11px] font-semibold tracking-wider text-[var(--ui-text-dimmed)] uppercase"
						>
							Active shift · {branchLabel}
						</div>
						<div class="font-mono text-[14px] font-semibold">{activeShift.data.number}</div>
						<div class="text-[11.5px] text-[var(--ui-text-muted)]">
							Opened {relativeTime(activeShift.data.openedAt)} · {formatMoney(
								activeShift.data.openingCash,
								currency
							)} float{activeShift.data.staffName ? ` · ${activeShift.data.staffName}` : ''}
						</div>
					</div>
				</div>
				<Button
					color="neutral"
					variant="subtle"
					size="sm"
					icon="lucide:lock"
					onclick={() => (closing = true)}>Close shift</Button
				>
			</div>

			<!-- Live shift summary (orders + tenders + cash flow + expected cash) -->
			{#if s}
				<div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
					{@render statBox('Orders', String(s.totalOrders), 'lucide:receipt')}
					{@render statBox('Sales', formatMoney(s.totalSales, currency), 'lucide:dollar-sign')}
					{@render statBox('Cash', formatMoney(s.cashSales, currency), 'lucide:banknote')}
					{@render statBox('Card', formatMoney(s.cardSales, currency), 'lucide:credit-card')}
					{@render statBox('Lightning', formatMoney(s.lightningSales, currency), 'lucide:zap')}
					{@render statBox(
						'In / Out',
						`${formatMoney(s.totalCashIn, currency)} / ${formatMoney(s.totalCashOut, currency)}`,
						'lucide:arrow-left-right'
					)}
				</div>
				<div
					class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)]/50 px-4 py-2.5 text-[13px]"
				>
					<span class="inline-flex items-center gap-1.5 text-[var(--ui-text-muted)]">
						<Icon name="lucide:calculator" class="size-3.5" />
						Expected cash in drawer
					</span>
					<span class="font-display text-[15px] font-bold tabular-nums">
						{formatMoney(s.expectedCash, currency)}
					</span>
				</div>
			{/if}
		</div>
	{:else}
		<div class="surface-card flex flex-wrap items-end gap-3 p-5">
			<div class="flex-1">
				<div class="mb-1.5 text-[12px] font-semibold text-[var(--ui-text-muted)]">
					Opening cash float · {branchLabel}
				</div>
				<Input
					bind:value={opening}
					type="number"
					icon="lucide:banknote"
					min="0"
					placeholder="0.00"
					class="w-full"
				/>
			</div>
			<Button color="primary" icon="lucide:lock-open" onclick={openShift}>Open shift</Button>
		</div>
	{/if}

	<!-- cash event entry (only when a shift is open on this branch) -->
	{#if activeShift}
		<div class="surface-card flex flex-wrap items-end gap-2 p-4">
			<div class="min-w-[10rem] flex-1">
				<Input
					bind:value={cashAmt}
					type="number"
					icon="lucide:banknote"
					min="0"
					placeholder="Amount"
					class="w-full"
				/>
			</div>
			<div
				class="relative inline-flex items-center rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)]"
			>
				<select
					bind:value={cashType}
					class="h-9 appearance-none rounded-lg bg-transparent py-0 pr-8 pl-3 text-[13px] font-medium focus:outline-none"
				>
					<option value="cash_in">Cash in</option>
					<option value="cash_out">Cash out</option>
					<option value="paid_out">Paid out</option>
					<option value="bank_deposit">Bank deposit</option>
				</select>
				<Icon
					name="lucide:chevron-down"
					class="pointer-events-none absolute right-2 size-3.5 text-[var(--ui-text-dimmed)]"
				/>
			</div>
			<div class="min-w-[10rem] flex-1">
				<Input bind:value={cashReason} placeholder="Reason (optional)" class="w-full" />
			</div>
			<Button color="neutral" variant="subtle" icon="lucide:plus" onclick={addCashEvent}>Add</Button
			>
		</div>
	{/if}

	<!-- cash events -->
	{#if branchEvents.length === 0}
		{#if activeShift}
			<EmptyState
				icon="lucide:banknote"
				title="No cash movements"
				description="Cash in/out, paid outs and bank deposits for this branch appear here."
			/>
		{/if}
	{:else}
		<div class="data-panel">
			<div class="border-b border-[var(--ui-border-muted)] px-5 py-3 text-[13px] font-semibold">
				Cash movements · {branchLabel}
			</div>
			<table class="table-surface w-full text-left">
				<thead>
					<tr>
						<th class="px-5 py-2.5">Type</th>
						<th class="px-5 py-2.5">Reason</th>
						<th class="px-5 py-2.5 text-right">Amount</th>
						<th class="px-5 py-2.5 text-right">When</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-[var(--ui-border-muted)] text-[13px]">
					{#each branchEvents.slice(0, 50) as e (e.id)}
						<tr>
							<td class="px-5 py-3">
								<Badge color={e.data.type === 'cash_in' ? 'success' : 'info'}>
									{e.data.type.replace('_', ' ')}
								</Badge>
							</td>
							<td class="px-5 py-3 text-[var(--ui-text-muted)]">{e.data.reason ?? '—'}</td>
							<td
								class="px-5 py-3 text-right font-semibold tabular-nums {e.data.type === 'cash_in'
									? 'text-[var(--tone-success-text)]'
									: 'text-[var(--tone-error-text)]'}"
							>
								{e.data.type === 'cash_in' ? '+' : '−'}{formatMoney(
									e.data.amount,
									e.data.currency || currency
								)}
							</td>
							<td class="px-5 py-3 text-right text-[12px] text-[var(--ui-text-dimmed)]">
								{relativeTime(e.data.occurredAt)}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}

	<!-- shift history -->
	{#if branchShifts.length}
		<div class="data-panel">
			<div class="border-b border-[var(--ui-border-muted)] px-5 py-3 text-[13px] font-semibold">
				Shift history · {branchLabel}
			</div>
			<table class="table-surface w-full text-left">
				<thead>
					<tr>
						<th class="px-5 py-2.5">Shift</th>
						<th class="px-5 py-2.5">Status</th>
						<th class="px-5 py-2.5 text-right">Opening</th>
						<th class="px-5 py-2.5 text-right">Sales</th>
						<th class="px-5 py-2.5 text-right">Variance</th>
						<th class="px-5 py-2.5 text-right">Closed</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-[var(--ui-border-muted)] text-[13px]">
					{#each branchShifts as s (s.id)}
						<tr>
							<td class="px-5 py-3 font-mono text-[12.5px]">{s.data.number}</td>
							<td class="px-5 py-3">
								<Badge color={statusColor(s.data.status)}>{s.data.status.replace('_', ' ')}</Badge>
							</td>
							<td class="px-5 py-3 text-right tabular-nums">
								{formatMoney(s.data.openingCash, s.data.currency || currency)}
							</td>
							<td class="px-5 py-3 text-right tabular-nums">
								{formatMoney(s.data.totalSales ?? 0, s.data.currency || currency)}
							</td>
							<td class="px-5 py-3 text-right tabular-nums">
								{#if s.data.difference != null}
									<span
										class={(s.data.difference ?? 0) >= 0
											? 'text-[var(--tone-success-text)]'
											: 'text-[var(--tone-error-text)]'}
									>
										{(s.data.difference ?? 0) >= 0 ? '+' : ''}{formatMoney(
											s.data.difference ?? 0,
											s.data.currency || currency
										)}
									</span>
								{:else}
									<span class="text-[var(--ui-text-dimmed)]">—</span>
								{/if}
							</td>
							<td class="px-5 py-3 text-right text-[12px] text-[var(--ui-text-dimmed)]">
								{s.data.closedAt ? relativeTime(s.data.closedAt) : '—'}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

<!-- Close-shift reconciliation dialog -->
{#if closing}
	<div class="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
		<div
			class="w-full max-w-md rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-bg-elevated)] p-5 shadow-2xl"
		>
			<div class="flex items-center gap-2">
				<Icon name="lucide:lock" class="size-4 text-primary-500" />
				<h2 class="font-display text-[15px] font-semibold">Close shift · {branchLabel}</h2>
			</div>
			<p class="mt-1 text-[12px] text-[var(--ui-text-muted)]">
				Count the cash in the drawer and enter the actual total. Variance is computed against the
				expected amount.
			</p>
			{#if summary}
				<div
					class="mt-3 flex items-center justify-between rounded-xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)]/50 px-3 py-2 text-[12.5px]"
				>
					<span class="text-[var(--ui-text-muted)]">Expected cash</span>
					<span class="font-bold tabular-nums">{formatMoney(summary.expectedCash, currency)}</span>
				</div>
			{/if}
			<label class="mt-3 block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
					>Counted cash</span
				>
				<Input
					bind:value={countedCash}
					type="number"
					icon="lucide:banknote"
					min="0"
					placeholder="0.00"
					class="w-full"
				/>
			</label>
			{#if summary}
				<div class="mt-2 flex items-center justify-between text-[12.5px]">
					<span class="text-[var(--ui-text-muted)]">Variance</span>
					<span
						class="font-bold tabular-nums {variance >= 0
							? 'text-[var(--tone-success-text)]'
							: 'text-[var(--tone-error-text)]'}"
					>
						{variance >= 0 ? '+' : ''}{formatMoney(variance, currency)}
					</span>
				</div>
			{/if}
			<label class="mt-3 block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
					>Variance note (optional)</span
				>
				<Input
					bind:value={varianceNote}
					placeholder="Explain any shortage / overage"
					class="w-full"
				/>
			</label>
			<div class="mt-4 flex items-center justify-end gap-2">
				<Button variant="ghost" color="neutral" onclick={() => (closing = false)}>Cancel</Button>
				<Button variant="ghost" color="neutral" onclick={() => closeShiftAction(true)}>
					Force close
				</Button>
				<Button color="primary" icon="lucide:check" onclick={() => closeShiftAction(false)}>
					Close shift
				</Button>
			</div>
		</div>
	</div>
{/if}

{#snippet statBox(label: string, value: string, icon: string)}
	<div
		class="rounded-xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)]/40 px-3 py-2"
	>
		<div class="flex items-center gap-1.5 text-[10.5px] font-semibold text-[var(--ui-text-dimmed)]">
			<Icon name={icon} class="size-3" />
			{label}
		</div>
		<div class="mt-0.5 text-[13.5px] font-bold tabular-nums">{value}</div>
	</div>
{/snippet}
