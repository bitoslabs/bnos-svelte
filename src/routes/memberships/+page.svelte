<script lang="ts">
	import { onMount } from 'svelte';
	import { t } from '$lib/i18n/i18n.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Switch from '$lib/components/ui/Switch.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import RawDataDialog from '$lib/components/ui/RawDataDialog.svelte';
	import Pagination from '$lib/components/list/Pagination.svelte';
	import ListToolbar from '$lib/components/list/ListToolbar.svelte';
	import SortableTh from '$lib/components/list/SortableTh.svelte';
	import { createListControls } from '$lib/utils/list.svelte';
	import { glo } from '$nostr/store.svelte';
	import { dataSync } from '$nostr/sync.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatMoney, relativeTime } from '$lib/utils/format';
	import { newRecordId } from '$lib/utils/record-id';
	import {
		TYPE,
		statusColor,
		type Membership,
		type MembershipSubscription,
		type MembershipCheckIn,
		type MembershipSubscriptionStatus
	} from '$lib/domain';

	type Tab = 'plans' | 'subscriptions' | 'checkins';
	let tab = $state<Tab>('plans');
	onMount(() => {
		dataSync.pageSync([TYPE.membership, TYPE.membershipSubscription, TYPE.membershipCheckIn], {
			scope: 'memberships'
		});
	});

	const currency = $derived(tenant.state.currency);
	const plans = $derived(glo.all<Membership, typeof TYPE.membership>(TYPE.membership));
	const subs = $derived(
		glo.all<MembershipSubscription, typeof TYPE.membershipSubscription>(TYPE.membershipSubscription)
	);
	const checkins = $derived(
		glo.all<MembershipCheckIn, typeof TYPE.membershipCheckIn>(TYPE.membershipCheckIn)
	);

	const planCtrl = createListControls<{ id: string; data: Membership }>({
		items: () => plans,
		search: (m, q) => (m.data.name ?? '').toLowerCase().includes(q),
		sortOptions: () => [
			{ key: 'name', label: t('common.name'), value: (m) => m.data.name },
			{ key: 'price', label: t('common.price'), value: (m) => m.data.price }
		],
		defaultSortKey: 'name',
		defaultViewMode: 'grid',
		storageKey: 'memberships-plans'
	});
	const subCtrl = createListControls<{ id: string; data: MembershipSubscription }>({
		items: () => subs,
		search: (s, q) => (s.data.customerName ?? '').toLowerCase().includes(q),
		sortOptions: () => [
			{ key: 'customer', label: t('common.customer'), value: (s) => s.data.customerName ?? '~' },
			{ key: 'status', label: t('common.status'), value: (s) => s.data.status }
		],
		defaultSortKey: 'customer',
		defaultViewMode: 'table',
		storageKey: 'memberships-subs'
	});
	const ciCtrl = createListControls<{ id: string; data: MembershipCheckIn }>({
		items: () => checkins,
		search: (c, q) => (c.data.customerName ?? '').toLowerCase().includes(q),
		sortOptions: () => [{ key: 'date', label: t('common.date'), value: (c) => c.data.occurredAt }],
		defaultSortKey: 'date',
		defaultSortDir: 'desc',
		defaultViewMode: 'table',
		storageKey: 'memberships-checkins'
	});

	// ── Dialog state ──
	let open = $state(false);
	let rawOpen = $state(false);
	let rawItem = $state<any>(null);
	let dlgTab = $state<Tab>('plans');
	let editingId = $state<string | null>(null);

	// Plan form fields
	let mName = $state('');
	let mMode = $state<Membership['mode']>('normal');
	let mPrice = $state<number | ''>('');
	let mPeriod = $state<Membership['period']>('monthly');
	let mDays = $state(30);
	let mBenefits = $state<string[]>([]);
	let mTrialDays = $state(0);
	let mDescription = $state('');
	let mColor = $state('#6366F1');
	let mActive = $state(true);

	// Subscription form fields
	let subCust = $state('');
	let subPlan = $state('');
	let subStatus = $state<MembershipSubscriptionStatus>('active');
	let subExtendDays = $state(0);

	// Check-in form fields
	let ciCust = $state('');
	let ciResult = $state<'allowed' | 'denied' | 'override'>('allowed');

	const isEditing = $derived(editingId !== null);

	function resetPlanForm() {
		mName = '';
		mMode = 'normal';
		mPrice = '';
		mPeriod = 'monthly';
		mDays = 30;
		mBenefits = [];
		mTrialDays = 0;
		mDescription = '';
		mColor = '#6366F1';
		mActive = true;
	}

	function openCreate(t: Tab) {
		dlgTab = t;
		editingId = null;
		resetPlanForm();
		subCust = '';
		subPlan = '';
		subStatus = 'active';
		subExtendDays = 0;
		ciCust = '';
		ciResult = 'allowed';
		open = true;
	}

	function openEditPlan(p: { id: string; data: Membership }) {
		dlgTab = 'plans';
		editingId = p.id;
		mName = p.data.name ?? '';
		mMode = p.data.mode ?? 'normal';
		mPrice = p.data.price ?? '';
		mPeriod = p.data.period ?? 'monthly';
		mDays = p.data.durationDays ?? 30;
		mBenefits = p.data.benefits ?? [];
		mTrialDays = (p.data as any).trialDays ?? 0;
		mDescription = p.data.description ?? '';
		mColor = p.data.color ?? '#6366F1';
		mActive = p.data.active ?? p.data.status === 'active';
		open = true;
	}

	function openEditSub(s: { id: string; data: MembershipSubscription }) {
		dlgTab = 'subscriptions';
		editingId = s.id;
		subCust = s.data.customerName ?? '';
		subPlan = s.data.membershipName ?? '';
		subStatus = s.data.status;
		subExtendDays = 0;
		open = true;
	}

	function addBenefit() {
		mBenefits = [...mBenefits, ''];
	}
	function removeBenefit(idx: number) {
		mBenefits = mBenefits.filter((_, i) => i !== idx);
	}
	function updateBenefit(idx: number, val: string) {
		mBenefits = mBenefits.map((b, i) => (i === idx ? val : b));
	}

	async function save() {
		if (dlgTab === 'plans') {
			if (!mName.trim()) return toast.warning('Name required');
			const payload = {
				name: mName.trim(),
				mode: mMode,
				price: typeof mPrice === 'number' ? mPrice : Number(mPrice) || 0,
				currency,
				period: mPeriod,
				durationDays: mDays,
				status: mActive ? ('active' as const) : ('inactive' as const),
				active: mActive,
				benefits: mBenefits.filter((b) => b.trim()),
				description: mDescription.trim() || undefined,
				color: mColor,
				...(mTrialDays > 0 ? { trialDays: mTrialDays } : {})
			} as Membership;
			await glo.upsert<Membership>(TYPE.membership, payload, {
				id: editingId ?? newRecordId('membership')
			});
			toast.success(isEditing ? 'Plan updated' : 'Plan created');
		} else if (dlgTab === 'subscriptions') {
			if (!subCust.trim()) return toast.warning('Customer required');
			if (isEditing) {
				const existing = subs.find((s) => s.id === editingId);
				if (!existing) return toast.error('Subscription not found');
				const d = existing.data;
				let endsAt = d.endsAt ?? undefined;
				if (subExtendDays > 0) {
					const base = endsAt ? new Date(endsAt) : new Date();
					endsAt = new Date(base.getTime() + subExtendDays * 86_400_000).toISOString();
				}
				const update: Record<string, unknown> = {
					status: subStatus,
					startsAt: d.startsAt,
					customerId: d.customerId,
					customerName: subCust.trim(),
					membershipId: d.membershipId,
					membershipName: subPlan || d.membershipName || undefined,
					subscriptionId: d.subscriptionId,
					startedAt: d.startedAt,
					expiresAt: d.expiresAt ?? undefined,
					renewsAt: d.renewsAt ?? undefined,
					renewalPolicy: d.renewalPolicy,
					visitsUsed: d.visitsUsed,
					classesUsed: d.classesUsed,
					lastCheckInAt: d.lastCheckInAt ?? undefined,
					branchId: d.branchId
				};
				if (endsAt) update.endsAt = endsAt;
				await glo.upsert<MembershipSubscription>(
					TYPE.membershipSubscription,
					update as unknown as MembershipSubscription,
					{ id: editingId! }
				);
				toast.success('Subscription updated');
			} else {
				const plan = plans.find((p) => p.data.name === subPlan);
				const now = new Date();
				const end = new Date(now.getTime() + (plan?.data.durationDays ?? 30) * 86_400_000);
				await glo.upsert<MembershipSubscription>(
					TYPE.membershipSubscription,
					{
						customerName: subCust.trim(),
						membershipName: subPlan || plan?.data.name,
						status: 'active',
						startsAt: now.toISOString(),
						endsAt: end.toISOString()
					},
					{ id: newRecordId('membership-subscription') }
				);
				toast.success('Subscription created');
			}
		} else {
			if (!ciCust.trim()) return toast.warning('Customer required');
			await glo.upsert<MembershipCheckIn>(
				TYPE.membershipCheckIn,
				{
					customerName: ciCust.trim(),
					result: ciResult,
					occurredAt: new Date().toISOString()
				},
				{ id: newRecordId('membership-check-in') }
			);
			toast.success('Check-in recorded');
		}
		open = false;
		editingId = null;
	}

	const tabs = [
		{ id: 'plans' as Tab, label: t('memberships.plans'), icon: 'lucide:layers' },
		{ id: 'subscriptions' as Tab, label: t('memberships.subscriptions'), icon: 'lucide:badge-check' },
		{ id: 'checkins' as Tab, label: t('memberships.checkins'), icon: 'lucide:door-open' }
	];

	const modeBadgeColor = (mode?: string) =>
		mode === 'gym' ? 'info' : mode === 'hybrid' ? 'warning' : 'primary';
</script>

<svelte:head><title>{t('common.appName')} · {t('nav.memberships')}</title></svelte:head>

<div class="space-y-4">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h1 class="font-display text-xl font-bold tracking-tight">{t('nav.memberships')}</h1>
			<p class="text-[12.5px] text-[var(--ui-text-muted)]">
				Tiers, subscriptions & check-ins · kinds 30311–30315
			</p>
		</div>
		<Button color="primary" icon="lucide:plus" onclick={() => openCreate(tab)}
			>New {tab === 'plans'
				? 'plan'
				: tab === 'subscriptions'
					? 'subscription'
					: 'check-in'}</Button
		>
	</div>

	<!-- Stats row -->
	<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
		<div class="surface-card p-4">
			<p class="text-[10px] font-semibold tracking-wider text-[var(--ui-text-dimmed)] uppercase">
				Total Plans
			</p>
			<p class="font-display text-2xl font-bold tabular-nums">{plans.length}</p>
		</div>
		<div class="surface-card p-4">
			<p class="text-[10px] font-semibold tracking-wider text-[var(--ui-text-dimmed)] uppercase">
				Active
			</p>
			<p class="font-display text-2xl font-bold text-emerald-500 tabular-nums">
				{plans.filter((p) => p.data.active ?? p.data.status === 'active').length}
			</p>
		</div>
		<div class="surface-card p-4">
			<p class="text-[10px] font-semibold tracking-wider text-[var(--ui-text-dimmed)] uppercase">
				Subscriptions
			</p>
			<p class="font-display text-2xl font-bold text-blue-500 tabular-nums">
				{subs.filter((s) => s.data.status === 'active').length}
			</p>
		</div>
		<div class="surface-card p-4">
			<p class="text-[10px] font-semibold tracking-wider text-[var(--ui-text-dimmed)] uppercase">
				Check-ins Today
			</p>
			<p class="font-display text-2xl font-bold tabular-nums">
				{checkins.filter((c) => {
					const d = new Date(c.data.occurredAt);
					const t = new Date();
					return (
						d.getDate() === t.getDate() &&
						d.getMonth() === t.getMonth() &&
						d.getFullYear() === t.getFullYear()
					);
				}).length}
			</p>
		</div>
	</div>

	<div class="segmented inline-flex w-fit gap-1 p-1">
		{#each tabs as t (t.id)}<button
				type="button"
				onclick={() => (tab = t.id)}
				class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-semibold transition-colors {tab ===
				t.id
					? 'bg-[var(--ui-bg-elevated)] text-[var(--ui-text)] shadow-sm'
					: 'text-[var(--ui-text-muted)]'}"
				><Icon name={t.icon} class="size-3.5" />{t.label}<span
					class="rounded bg-[var(--ui-bg-accented)] px-1.5 text-[10px] tabular-nums"
					>{t.id === 'plans'
						? plans.length
						: t.id === 'subscriptions'
							? subs.length
							: checkins.length}</span
				></button
			>{/each}
	</div>

	{#if tab === 'plans'}
		{#if plans.length || planCtrl.search}
			<ListToolbar
				bind:search={planCtrl.search}
				bind:sortKey={planCtrl.sortKey}
				bind:sortDir={planCtrl.sortDir}
				bind:viewMode={planCtrl.viewMode}
				sortItems={planCtrl.sortItems}
				searchPlaceholder="Search plan name…"
				applySort={planCtrl.applySort}
				setViewMode={planCtrl.setViewMode}
			/>
		{/if}
		{#if planCtrl.list.length === 0}
			<EmptyState
				icon="lucide:layers"
				title={planCtrl.search ? 'No matching plans' : 'No membership plans'}
				description={planCtrl.search
					? 'Try a different search.'
					: 'Create tiers for gyms, clubs or VIP customers.'}
			>
				{#snippet actions()}
					{#if !planCtrl.search}
						<Button color="primary" size="sm" icon="lucide:plus" onclick={() => openCreate('plans')}
							>New plan</Button
						>
					{/if}
				{/snippet}
			</EmptyState>
		{:else if planCtrl.viewMode === 'table'}
			<div class="data-panel">
				<div class="overflow-x-auto">
					<table class="table-surface w-full text-left">
						<thead>
							<tr>
								<SortableTh
									column="name"
									active={planCtrl.sortKey === 'name'}
									direction={planCtrl.sortDir}
									applySort={planCtrl.applySort}>{t('common.plan')}</SortableTh
								>
								<SortableTh
									column="price"
									active={planCtrl.sortKey === 'price'}
									direction={planCtrl.sortDir}
									align="right"
									applySort={planCtrl.applySort}>{t('common.price')}</SortableTh
								>
								<th
									class="px-5 py-2.5 text-[11px] font-semibold tracking-wider text-[var(--ui-text-dimmed)] uppercase"
									>{t('common.period')}</th
								>
								<th
									class="px-5 py-2.5 text-[11px] font-semibold tracking-wider text-[var(--ui-text-dimmed)] uppercase"
									>{t('common.duration')}</th
								>
								<th
									class="px-5 py-2.5 text-[11px] font-semibold tracking-wider text-[var(--ui-text-dimmed)] uppercase"
									>{t('common.mode')}</th
								>
								<th
									class="px-5 py-2.5 text-[11px] font-semibold tracking-wider text-[var(--ui-text-dimmed)] uppercase"
									>{t('common.status')}</th
								>
								<th class="w-10 px-5 py-2.5"></th>
							</tr>
						</thead>
						<tbody class="divide-y divide-[var(--ui-border-muted)] text-[13px]">
							{#each planCtrl.pagedList as p (p.id)}
								{@const pActive = p.data.active ?? p.data.status === 'active'}
								<tr class="hover:bg-[var(--ui-bg-accented)]/40">
									<td class="px-5 py-3">
										<div class="flex items-center gap-3">
											<div
												class="grid size-8 shrink-0 place-items-center rounded-lg"
												style="background-color:{(p.data.color ?? '#6366F1') + '1a'}; color:{p.data
													.color ?? '#6366F1'}"
											>
												<Icon
													name={p.data.mode === 'gym' ? 'lucide:dumbbell' : 'lucide:crown'}
													class="size-4"
												/>
											</div>
											<div class="min-w-0">
												<div class="font-semibold">{p.data.name}</div>
												{#if p.data.description}
													<div class="line-clamp-1 text-[11px] text-[var(--ui-text-dimmed)]">
														{p.data.description}
													</div>
												{/if}
											</div>
										</div>
									</td>
									<td class="px-5 py-3 text-right font-semibold tabular-nums">
										{formatMoney(p.data.price, p.data.currency || currency)}
									</td>
									<td class="px-5 py-3 text-[var(--ui-text-muted)] capitalize">{p.data.period}</td>
									<td class="px-5 py-3 text-[var(--ui-text-muted)] tabular-nums">
										{p.data.durationDays ?? '∞'}d
									</td>
									<td class="px-5 py-3"
										><Badge color={modeBadgeColor(p.data.mode)}>{p.data.mode ?? 'normal'}</Badge
										></td
									>
									<td class="px-5 py-3"
										><Badge color={pActive ? 'success' : 'neutral'}
											>{pActive ? 'active' : 'inactive'}</Badge
										></td
									>
									<td class="px-5 py-3">
										<div class="flex items-center justify-end gap-1">
											<Button
												color="neutral"
												variant="ghost"
												size="icon-sm"
												icon="lucide:code"
												onclick={() => {
													rawItem = glo.get(TYPE.membership, p.id);
													rawOpen = true;
												}}
											/>
											<Button
												color="neutral"
												variant="ghost"
												size="icon-sm"
												icon="lucide:pencil"
												onclick={() => openEditPlan(p)}
											/>
											<Button
												color="neutral"
												variant="ghost"
												size="icon-sm"
												icon="lucide:trash-2"
												onclick={() => {
													glo.remove(TYPE.membership, p.id);
													toast.info('Removed');
												}}
											/>
										</div>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				<Pagination controls={planCtrl} />
			</div>
		{:else}
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{#each planCtrl.pagedList as p (p.id)}
					<div
						class="accent-bar surface-card p-5"
						style="--accent:{p.data.color ?? 'var(--ui-color-primary-500)'};"
					>
						<div class="flex items-start justify-between">
							<div
								class="grid size-10 place-items-center rounded-xl bg-primary-500/10 text-primary-600 dark:text-primary-400"
								style="background-color:{(p.data.color ?? '#6366F1') === '#6366F1'
									? ''
									: (p.data.color ?? '#6366F1') + '1a'}; color:{p.data.color ?? '#6366F1'};"
							>
								<Icon
									name={p.data.mode === 'gym' ? 'lucide:dumbbell' : 'lucide:crown'}
									class="size-5"
								/>
							</div>
							<div class="flex items-center gap-1">
								<Badge color={(p.data.active ?? p.data.status === 'active') ? 'success' : 'neutral'}
									>{(p.data.active ?? p.data.status === 'active') ? 'active' : 'inactive'}</Badge
								>
								<Badge color={modeBadgeColor(p.data.mode)}>{p.data.mode ?? 'normal'}</Badge>
							</div>
						</div>
						<div class="mt-3 font-display text-lg font-bold">{p.data.name}</div>
						<div class="font-display text-3xl font-bold tabular-nums">
							{formatMoney(p.data.price, p.data.currency || currency)}<span
								class="text-[12px] font-medium text-[var(--ui-text-dimmed)]">/{p.data.period}</span
							>
						</div>
						<div class="mt-1 text-[11.5px] text-[var(--ui-text-muted)]">
							{p.data.durationDays ?? '∞'} days duration{#if (p.data as any).trialDays}
								· {(p.data as any).trialDays}d trial{/if}
						</div>

						{#if p.data.description}
							<p class="mt-2 line-clamp-2 text-[12px] text-[var(--ui-text-muted)]">
								{p.data.description}
							</p>
						{/if}

						{#if p.data.benefits && p.data.benefits.length > 0}
							<div class="mt-2 flex flex-wrap gap-1">
								{#each p.data.benefits.slice(0, 4) as benefit (benefit)}
									<span
										class="rounded-full bg-[var(--ui-bg-accented)] px-2 py-0.5 text-[10px] font-medium text-[var(--ui-text-muted)]"
										>{benefit}</span
									>
								{/each}
								{#if p.data.benefits.length > 4}
									<span
										class="rounded-full bg-[var(--ui-bg-accented)] px-2 py-0.5 text-[10px] font-medium text-[var(--ui-text-dimmed)]"
										>+{p.data.benefits.length - 4}</span
									>
								{/if}
							</div>
						{/if}

						<div
							class="mt-3 flex items-center justify-between border-t border-[var(--ui-border-muted)] pt-3"
						>
							<label class="flex items-center gap-1.5 text-[11px] text-[var(--ui-text-muted)]">
								<Switch
									checked={p.data.active ?? p.data.status === 'active'}
									onCheckedChange={async (v) => {
										await glo.upsert<Membership>(
											TYPE.membership,
											{ ...p.data, active: v, status: v ? 'active' : 'inactive' },
											{ id: p.id }
										);
										toast.info(v ? 'Activated' : 'Deactivated');
									}}
								/>
								Active
							</label>
							<div class="flex items-center gap-1">
								<Button
									color="neutral"
									variant="ghost"
									size="icon-sm"
									icon="lucide:code"
									onclick={() => {
										rawItem = glo.get(TYPE.membership, p.id);
										rawOpen = true;
									}}
								/>
								<Button
									color="neutral"
									variant="ghost"
									size="icon-sm"
									icon="lucide:pencil"
									onclick={() => openEditPlan(p)}
								/>
								<Button
									color="neutral"
									variant="ghost"
									size="icon-sm"
									icon="lucide:trash-2"
									onclick={() => {
										glo.remove(TYPE.membership, p.id);
										toast.info('Removed');
									}}
								/>
							</div>
						</div>
					</div>
				{/each}
			</div>
			<Pagination controls={planCtrl} class="mt-3 rounded-xl border border-[var(--ui-border)]" />
		{/if}
	{:else if tab === 'subscriptions'}
		{#if subs.length || subCtrl.search}
			<ListToolbar
				bind:search={subCtrl.search}
				bind:sortKey={subCtrl.sortKey}
				bind:sortDir={subCtrl.sortDir}
				bind:viewMode={subCtrl.viewMode}
				sortItems={subCtrl.sortItems}
				searchPlaceholder="Search customer…"
				applySort={subCtrl.applySort}
				setViewMode={subCtrl.setViewMode}
			/>
		{/if}
		{#if subCtrl.list.length === 0}
			<EmptyState
				icon="lucide:badge-check"
				title={subCtrl.search ? 'No matching subscriptions' : 'No subscriptions'}
				description={subCtrl.search
					? 'Try a different search.'
					: 'Enroll customers into a membership plan.'}
			>
				{#snippet actions()}
					{#if !subCtrl.search}
						<Button
							color="primary"
							size="sm"
							icon="lucide:plus"
							onclick={() => openCreate('subscriptions')}>New subscription</Button
						>
					{/if}
				{/snippet}
			</EmptyState>
		{:else if subCtrl.viewMode === 'grid'}
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
				{#each subCtrl.pagedList as s (s.id)}
					<div class="metric-card p-4">
						<div class="flex items-start justify-between gap-2">
							<div class="min-w-0">
								<div class="truncate font-semibold">{s.data.customerName ?? '—'}</div>
								<div class="truncate text-[12px] text-[var(--ui-text-muted)]">
									{s.data.membershipName ?? '—'}
								</div>
							</div>
							<Badge color={statusColor(s.data.status)}>{s.data.status}</Badge>
						</div>
						<div class="mt-2 flex items-center gap-1 text-[11px] text-[var(--ui-text-dimmed)]">
							<Icon name="lucide:calendar-clock" class="size-3.5" />
							{s.data.endsAt ? relativeTime(s.data.endsAt) : 'No end date'}
						</div>
						<div
							class="mt-3 flex items-center justify-end gap-1 border-t border-[var(--ui-border-muted)] pt-2.5"
						>
							<Button
								color="neutral"
								variant="ghost"
								size="icon-sm"
								icon="lucide:code"
								onclick={() => {
									rawItem = glo.get(TYPE.membershipSubscription, s.id);
									rawOpen = true;
								}}
							/>
							<Button
								color="neutral"
								variant="ghost"
								size="icon-sm"
								icon="lucide:pencil"
								onclick={() => openEditSub(s)}
							/>
							<Button
								color="neutral"
								variant="ghost"
								size="icon-sm"
								icon="lucide:trash-2"
								onclick={() => {
									glo.remove(TYPE.membershipSubscription, s.id);
									toast.info('Removed');
								}}
							/>
						</div>
					</div>
				{/each}
			</div>
			<Pagination controls={subCtrl} class="mt-3 rounded-xl border border-[var(--ui-border)]" />
		{:else}
			<div class="data-panel">
				<div class="overflow-x-auto">
					<table class="table-surface w-full text-left">
						<thead>
							<tr>
								<SortableTh
									column="customer"
									active={subCtrl.sortKey === 'customer'}
									direction={subCtrl.sortDir}
									applySort={subCtrl.applySort}>{t('common.customer')}</SortableTh
								>
								<th
									class="px-5 py-2.5 text-[11px] font-semibold tracking-wider text-[var(--ui-text-dimmed)] uppercase"
									>{t('common.plan')}</th
								>
								<SortableTh
									column="status"
									active={subCtrl.sortKey === 'status'}
									direction={subCtrl.sortDir}
									applySort={subCtrl.applySort}>{t('common.status')}</SortableTh
								>
								<th
									class="px-5 py-2.5 text-right text-[11px] font-semibold tracking-wider text-[var(--ui-text-dimmed)] uppercase"
									>{t('common.ends')}</th
								>
								<th
									class="px-5 py-2.5 text-right text-[11px] font-semibold tracking-wider text-[var(--ui-text-dimmed)] uppercase"
									>{t('common.actions')}</th
								>
							</tr>
						</thead>
						<tbody class="divide-y divide-[var(--ui-border-muted)] text-[13px]">
							{#each subCtrl.pagedList as s (s.id)}
								<tr class="hover:bg-[var(--ui-bg-accented)]/40">
									<td class="px-5 py-3 font-semibold">{s.data.customerName ?? '—'}</td>
									<td class="px-5 py-3 text-[var(--ui-text-muted)]"
										>{s.data.membershipName ?? '—'}</td
									>
									<td class="px-5 py-3"
										><Badge color={statusColor(s.data.status)}>{s.data.status}</Badge></td
									>
									<td class="px-5 py-3 text-right text-[12px] text-[var(--ui-text-dimmed)]"
										>{s.data.endsAt ? relativeTime(s.data.endsAt) : '—'}</td
									>
									<td class="px-5 py-3">
										<div class="flex items-center justify-end gap-1">
											<Button
												color="neutral"
												variant="ghost"
												size="icon-sm"
												icon="lucide:code"
												onclick={() => {
													rawItem = glo.get(TYPE.membershipSubscription, s.id);
													rawOpen = true;
												}}
											/>
											<Button
												color="neutral"
												variant="ghost"
												size="icon-sm"
												icon="lucide:pencil"
												onclick={() => openEditSub(s)}
											/>
											<Button
												color="neutral"
												variant="ghost"
												size="icon-sm"
												icon="lucide:trash-2"
												onclick={() => {
													glo.remove(TYPE.membershipSubscription, s.id);
													toast.info('Removed');
												}}
											/>
										</div>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				<Pagination controls={subCtrl} />
			</div>
		{/if}
	{:else}
		{#if checkins.length || ciCtrl.search}
			<ListToolbar
				bind:search={ciCtrl.search}
				bind:sortKey={ciCtrl.sortKey}
				bind:sortDir={ciCtrl.sortDir}
				bind:viewMode={ciCtrl.viewMode}
				sortItems={ciCtrl.sortItems}
				searchPlaceholder="Search customer…"
				applySort={ciCtrl.applySort}
				setViewMode={ciCtrl.setViewMode}
			/>
		{/if}
		{#if ciCtrl.list.length === 0}
			<EmptyState
				icon="lucide:door-open"
				title={ciCtrl.search ? 'No matching check-ins' : 'No check-ins'}
				description={ciCtrl.search ? 'Try a different search.' : 'Record gym/club attendance.'}
			>
				{#snippet actions()}
					{#if !ciCtrl.search}
						<Button
							color="primary"
							size="sm"
							icon="lucide:plus"
							onclick={() => openCreate('checkins')}>New check-in</Button
						>
					{/if}
				{/snippet}
			</EmptyState>
		{:else if ciCtrl.viewMode === 'grid'}
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
				{#each ciCtrl.pagedList as c (c.id)}
					<div class="metric-card flex items-center gap-3 p-4">
						<div
							class="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)]"
						>
							<Icon
								name={c.data.result === 'denied'
									? 'lucide:x'
									: c.data.result === 'override'
										? 'lucide:shield-check'
										: 'lucide:check'}
								class="size-5"
							/>
						</div>
						<div class="min-w-0 flex-1">
							<div class="truncate font-semibold">{c.data.customerName ?? '—'}</div>
							<div class="text-[11px] text-[var(--ui-text-dimmed)]">
								{relativeTime(c.data.occurredAt)}
							</div>
						</div>
						<Badge color={statusColor(c.data.result)}>{c.data.result}</Badge>
					</div>
				{/each}
			</div>
			<Pagination controls={ciCtrl} class="mt-3 rounded-xl border border-[var(--ui-border)]" />
		{:else}
			<div class="data-panel">
				<div class="overflow-x-auto">
					<table class="table-surface w-full text-left">
						<thead>
							<tr>
								<th
									class="px-5 py-2.5 text-[11px] font-semibold tracking-wider text-[var(--ui-text-dimmed)] uppercase"
									>{t('common.customer')}</th
								>
								<th
									class="px-5 py-2.5 text-[11px] font-semibold tracking-wider text-[var(--ui-text-dimmed)] uppercase"
									>{t('common.result')}</th
								>
								<SortableTh
									column="date"
									active={ciCtrl.sortKey === 'date'}
									direction={ciCtrl.sortDir}
									align="right"
									applySort={ciCtrl.applySort}>{t('common.when')}</SortableTh
								>
								<th class="w-10 px-5 py-2.5"></th>
							</tr>
						</thead>
						<tbody class="divide-y divide-[var(--ui-border-muted)] text-[13px]">
							{#each ciCtrl.pagedList as c (c.id)}
								<tr>
									<td class="px-5 py-3 font-semibold">{c.data.customerName ?? '—'}</td>
									<td class="px-5 py-3"
										><Badge color={statusColor(c.data.result)}>{c.data.result}</Badge></td
									>
									<td class="px-5 py-3 text-right text-[12px] text-[var(--ui-text-dimmed)]"
										>{relativeTime(c.data.occurredAt)}</td
									>
									<td class="px-5 py-3 text-right">
										<Button
											color="neutral"
											variant="ghost"
											size="icon-sm"
											icon="lucide:trash-2"
											onclick={() => {
												glo.remove(TYPE.membershipCheckIn, c.id);
												toast.info('Removed');
											}}
										/>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				<Pagination controls={ciCtrl} />
			</div>
		{/if}
	{/if}
</div>

<Dialog
	bind:open
	size="lg"
	title={dlgTab === 'plans'
		? isEditing
			? 'Edit plan'
			: 'New plan'
		: dlgTab === 'subscriptions'
			? isEditing
				? 'Edit subscription'
				: 'New subscription'
			: 'New check-in'}
>
	{#if dlgTab === 'plans'}
		<div class="space-y-4">
			<!-- Name + Color -->
			<div class="flex items-end gap-3">
				<div
					class="grid size-12 shrink-0 place-items-center rounded-xl border-2 border-dashed"
					style="background-color:{mColor}1a; border-color:{mColor}; color:{mColor}"
				>
					<Icon name={mMode === 'gym' ? 'lucide:dumbbell' : 'lucide:crown'} class="size-5" />
				</div>
				<label class="flex-1">
					<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>Plan name</span
					>
					<Input bind:value={mName} class="w-full" placeholder="Gold Member" />
				</label>
				<label>
					<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>Color</span
					>
					<input
						type="color"
						bind:value={mColor}
						class="h-9.5 w-14 cursor-pointer rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] p-1"
					/>
				</label>
			</div>

			{#if mDescription !== undefined}
				<label class="block">
					<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>{t('common.description')}</span
					>
					<Input
						textarea
						bind:value={mDescription}
						rows={2}
						class="w-full"
						placeholder="Brief description of this plan..."
					/>
				</label>
			{/if}

			<!-- Mode selector -->
			<div>
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">{t('common.mode')}</span>
				<div class="grid grid-cols-3 gap-2">
					{#each [{ v: 'normal', l: 'Normal', i: 'lucide:star' }, { v: 'gym', l: 'Gym', i: 'lucide:dumbbell' }, { v: 'hybrid', l: 'Hybrid', i: 'lucide:layers' }] as m (m.v)}
						<button
							type="button"
							onclick={() => (mMode = m.v as Membership['mode'])}
							class="flex flex-col items-center gap-1 rounded-lg border-2 px-2 py-2.5 text-[11px] font-medium transition-colors {mMode ===
							m.v
								? 'border-primary-500 bg-primary-500/10 text-primary-600 dark:text-primary-400'
								: 'border-[var(--ui-border)] hover:border-[var(--ui-border-accented)]'}"
						>
							<Icon name={m.i} class="size-4" />
							{m.l}
						</button>
					{/each}
				</div>
			</div>

			<div class="grid grid-cols-2 gap-3">
				<label class="block"
					><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>Price ({currency})</span
					><Input bind:value={mPrice} type="number" min="0" class="w-full" /></label
				>
				<label class="block"
					><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>{t('common.period')}</span
					><Select
						bind:value={mPeriod}
						options={[
							{ value: 'daily', label: 'Daily' },
							{ value: 'weekly', label: 'Weekly' },
							{ value: 'monthly', label: 'Monthly' },
							{ value: 'quarterly', label: 'Quarterly' },
							{ value: 'yearly', label: 'Yearly' },
							{ value: 'one_time', label: 'One Time' }
						]}
						class="w-full"
					/></label
				>
			</div>
			<div class="grid grid-cols-2 gap-3">
				<label class="block"
					><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>Duration (days)</span
					><Input bind:value={mDays} type="number" min="1" class="w-full" /></label
				>
				<label class="block"
					><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>Trial period (days)</span
					><Input
						bind:value={mTrialDays}
						type="number"
						min="0"
						class="w-full"
						placeholder="0"
					/></label
				>
			</div>

			<!-- Benefits -->
			<div>
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
					>Benefits</span
				>
				<div class="space-y-2">
					{#each mBenefits as benefit, i (i)}
						<div class="flex gap-2">
							<Input
								value={benefit}
								oninput={(e) => updateBenefit(i, e.currentTarget.value)}
								class="flex-1"
								placeholder="e.g. Free coffee"
							/>
							<Button
								color="neutral"
								variant="ghost"
								size="icon-sm"
								icon="lucide:x"
								onclick={() => removeBenefit(i)}
							/>
						</div>
					{/each}
					<button
						type="button"
						onclick={addBenefit}
						class="inline-flex items-center gap-1 text-[12px] font-medium text-primary-600 hover:text-primary-500 dark:text-primary-400"
					>
						<Icon name="lucide:plus" class="size-3.5" /> Add benefit
					</button>
				</div>
			</div>

			<!-- Active toggle -->
			<div class="flex items-center justify-between rounded-xl bg-[var(--ui-bg-accented)] p-3">
				<span class="text-[12px] font-semibold">Active</span>
				<Switch bind:checked={mActive} />
			</div>
		</div>
	{:else if dlgTab === 'subscriptions'}
		<div class="space-y-3">
			<label class="block"
				><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
					>{t('common.customer')}</span
				><Input bind:value={subCust} class="w-full" /></label
			>
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">{t('common.plan')}</span>
				<Input bind:value={subPlan} list="planslist" class="w-full" />
				<datalist id="planslist"
					>{#each plans as p (p.id)}<option value={p.data.name}></option>{/each}</datalist
				>
			</label>
			{#if isEditing}
				<label class="block"
					><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>{t('common.status')}</span
					><Select
						bind:value={subStatus}
						options={[
							{ value: 'active', label: 'Active' },
							{ value: 'suspended', label: 'Suspended' },
							{ value: 'frozen', label: 'Frozen' },
							{ value: 'cancelled', label: t('status.cancelled') },
							{ value: 'expired', label: 'Expired' }
						]}
						class="w-full"
					/></label
				>
				<label class="block"
					><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>Extend duration (days)</span
					><Input
						bind:value={subExtendDays}
						type="number"
						min="0"
						class="w-full"
						placeholder="0 = no change"
					/></label
				>
			{/if}
		</div>
	{:else}
		<div class="space-y-3">
			<label class="block"
				><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
					>{t('common.customer')}</span
				><Input bind:value={ciCust} class="w-full" /></label
			>
			<label class="block"
				><span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
					>{t('common.result')}</span
				><Select
					bind:value={ciResult}
					options={[
						{ value: 'allowed', label: 'Allowed' },
						{ value: 'denied', label: 'Denied' },
						{ value: 'override', label: 'Override' }
					]}
					class="w-full"
				/></label
			>
		</div>
	{/if}
	{#snippet footer()}<Button
			color="neutral"
			variant="ghost"
			onclick={() => {
				open = false;
				editingId = null;
			}}>{t('common.cancel')}</Button
		><Button color="primary" icon="lucide:check" onclick={save}
			>{isEditing ? 'Update' : 'Save'}</Button
		>{/snippet}
</Dialog>

<RawDataDialog bind:open={rawOpen} data={rawItem} title={t('common.membershipRawData')} />
