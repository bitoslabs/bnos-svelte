<script lang="ts">
	/**
	 * Marketplace Promotions — channel-focused offers reusing the global
	 * promotion/coupon GLO types. Emphasizes shareable coupon codes and
	 * free-shipping offers for social selling. Deep-links to the full
	 * promotions manager for complex campaigns.
	 */
	import { resolve } from '$app/paths';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { glo } from '$nostr/store.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatMoney } from '$lib/utils/format';
	import { newRecordId } from '$lib/utils/record-id';
	import { TYPE, statusColor, type Coupon, type Promotion, type PromotionType } from '$lib/domain';

	const currency = $derived(tenant.state.currency);
	const coupons = $derived(glo.all<Coupon, typeof TYPE.coupon>(TYPE.coupon));
	const promos = $derived(glo.all<Promotion, typeof TYPE.promotion>(TYPE.promotion));

	// ── Quick create coupon ─────────────────────────────────
	let couponOpen = $state(false);
	let saving = $state(false);
	let cCode = $state('');
	let cType = $state<'percent' | 'fixed' | 'free_shipping'>('percent');
	let cValue = $state<number | ''>(10);
	let cMaxUses = $state<number | ''>('');
	let cMinSpend = $state<number | ''>('');

	const couponStatus = $derived(
		cType === 'free_shipping' ? '★ Free Shipping' : cType === 'percent' ? `${cValue || 0}% Off` : `${formatMoney(Number(cValue) || 0, currency)} Off`
	);

	function genCode() {
		const adj = ['SUMMER', 'FLASH', 'HOT', 'NEW', 'VIP', 'FESTIVE', 'MEGA'];
		const n = Math.floor(100 + Math.random() * 900);
		cCode = `${adj[Math.floor(Math.random() * adj.length)]}${n}`;
	}

	async function saveCoupon() {
		if (!cCode.trim()) return toast.warning('Code required');
		saving = true;
		const num = (v: number | '') => (typeof v === 'number' ? v : Number(v) || 0);
		const type = cType === 'free_shipping' ? 'free_shipping' : (cType as 'percent' | 'fixed');
		const data: Coupon = {
			code: cCode.trim().toUpperCase(),
			type,
			value: type === 'free_shipping' ? 0 : num(cValue),
			currency,
			description: `Marketplace ${couponStatus}`,
			minSpend: cMinSpend ? num(cMinSpend) : undefined,
			maxUses: cMaxUses ? num(cMaxUses) : undefined,
			uses: 0,
			status: 'active'
		};
		try {
			await glo.upsert<Coupon>(TYPE.coupon, data, { id: newRecordId('coupon') });
			toast.success('Coupon created — share it on your channels');
			couponOpen = false;
			cCode = '';
			cValue = 10;
			cMaxUses = '';
			cMinSpend = '';
		} catch {
			toast.error('Failed to create coupon');
		} finally {
			saving = false;
		}
	}

	async function toggleCoupon(id: string, data: Coupon) {
		const active = data.status !== 'active';
		await glo.upsert<Coupon>(TYPE.coupon, { ...data, status: active ? 'active' : 'disabled' }, { id });
		toast.success(active ? 'Coupon activated' : 'Coupon disabled');
	}

	function promoBadge(p: Promotion): string {
		const pct = ['percent', 'discount_percent', 'flash_sale', 'happy_hour'] as PromotionType[];
		if (p.type === 'bogo') return `Buy ${p.buyQuantity ?? 1} Get ${p.getQuantity ?? 1}`;
		if (pct.includes(p.type)) return `${p.value}%`;
		return formatMoney(p.value, currency);
	}

	function couponBadge(c: Coupon): string {
		if (c.type === 'free_shipping') return '★ Free Ship';
		if (c.type === 'percent') return `${c.value}%`;
		return formatMoney(c.value, currency);
	}
</script>

<svelte:head><title>Marketplace · Promotions</title></svelte:head>

<div class="space-y-5">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h2 class="font-display text-lg font-bold tracking-tight">Promotions</h2>
			<p class="text-[12px] text-[var(--ui-text-muted)]">Coupon codes & offers for your channels</p>
		</div>
		<div class="flex items-center gap-2">
			<Button color="neutral" variant="subtle" size="sm" icon="lucide:megaphone" href={resolve('/promotions')}>Campaign manager</Button>
			<Button color="primary" icon="lucide:plus" onclick={() => (couponOpen = true)}>New coupon</Button>
		</div>
	</div>

	{#if coupons.length === 0 && promos.length === 0}
		<EmptyState
			icon="lucide:ticket"
			title="No channel offers yet"
			description="Create shareable coupon codes and free-shipping offers to drive sales across TikTok, Facebook, and your website."
		>
			{#snippet actions()}
				<Button color="primary" size="sm" icon="lucide:plus" onclick={() => (couponOpen = true)}>Create coupon</Button>
			{/snippet}
		</EmptyState>
	{:else}
		<!-- Coupons -->
		{#if coupons.length > 0}
			<div class="mb-2 flex items-center gap-2">
				<Icon name="lucide:ticket" class="size-4 text-primary-500" />
				<h3 class="font-display text-[14px] font-semibold">Coupon codes</h3>
				<span class="text-[11px] text-[var(--ui-text-dimmed)]">{coupons.length}</span>
			</div>
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{#each coupons as c (c.id)}
					<div class="accent-bar surface-card relative overflow-hidden p-5" style="--accent: var(--color-violet-accent);">
						<div class="flex items-start justify-between">
							<div class="grid size-10 place-items-center rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-400">
								<Icon name={c.data.type === 'free_shipping' ? 'lucide:truck' : 'lucide:ticket'} class="size-5" />
							</div>
							<Badge color={statusColor(c.data.status)}>{c.data.status}</Badge>
						</div>
						<div class="mt-3 font-mono text-lg font-bold tracking-wider">{c.data.code}</div>
						<div class="font-display text-xl font-bold text-violet-600 tabular-nums dark:text-violet-400">{couponBadge(c.data)}</div>
						<div class="mt-1 text-[11.5px] text-[var(--ui-text-muted)]">
							{c.data.uses ?? 0}{#if c.data.maxUses}/{c.data.maxUses}{/if} redemptions
						</div>
						{#if c.data.minSpend}
							<div class="mt-0.5 text-[10px] text-[var(--ui-text-dimmed)]">Min spend: {formatMoney(c.data.minSpend, currency)}</div>
						{/if}
						<button
							type="button"
							onclick={() => {
								navigator.clipboard?.writeText(c.data.code);
								toast.success('Code copied');
							}}
							class="absolute top-3 right-3 grid size-7 place-items-center rounded-lg text-[var(--ui-text-dimmed)] transition-colors hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]"
							title="Copy code"
						>
							<Icon name="lucide:copy" class="size-3.5" />
						</button>
						<div class="mt-3 flex items-center justify-end">
							<Button size="sm" color="neutral" variant="ghost" icon={c.data.status === 'active' ? 'lucide:circle-x' : 'lucide:circle-check'} onclick={() => toggleCoupon(c.id, c.data)}>
								{c.data.status === 'active' ? 'Disable' : 'Enable'}
							</Button>
						</div>
					</div>
				{/each}
			</div>
		{/if}

		<!-- Promotions -->
		{#if promos.length > 0}
			<div class="mb-2 flex items-center gap-2">
				<Icon name="lucide:megaphone" class="size-4 text-primary-500" />
				<h3 class="font-display text-[14px] font-semibold">Campaigns</h3>
				<span class="text-[11px] text-[var(--ui-text-dimmed)]">{promos.length}</span>
			</div>
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{#each promos as p (p.id)}
					<div class="surface-card p-4">
						<div class="flex items-start justify-between">
							<p class="truncate text-[13px] font-bold">{p.data.name}</p>
							<Badge color={statusColor(p.data.status)}>{p.data.status}</Badge>
						</div>
						{#if p.data.description}
							<p class="mt-0.5 line-clamp-2 text-[11px] text-[var(--ui-text-dimmed)]">{p.data.description}</p>
						{/if}
						<div class="mt-2 font-display text-lg font-bold text-primary-600 tabular-nums dark:text-primary-400">{promoBadge(p.data)}</div>
						<div class="mt-1 text-[10.5px] text-[var(--ui-text-dimmed)]">
							{p.data.currentUsage ?? 0}{#if p.data.maxUsage}/{p.data.maxUsage}{/if} uses
						</div>
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</div>

<!-- Create coupon modal -->
<Dialog bind:open={couponOpen} title="New coupon" size="md">
	<div class="space-y-3">
		<label class="block">
			<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Code</span>
			<div class="flex gap-2">
				<Input bind:value={cCode} placeholder="SUMMER20" class="flex-1 font-mono uppercase" />
				<Button color="neutral" variant="subtle" size="md" icon="lucide:dice-5" onclick={genCode}>Generate</Button>
			</div>
		</label>
		<div>
			<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Offer type</span>
			<div class="grid grid-cols-3 gap-2">
				{#each [{ v: 'percent', l: '% Off', i: 'lucide:percent' }, { v: 'fixed', l: 'Fixed', i: 'lucide:dollar-sign' }, { v: 'free_shipping', l: 'Free Ship', i: 'lucide:truck' }] as t (t.v)}
					<button type="button" onclick={() => (cType = t.v as typeof cType)} class="rounded-lg border-2 px-2 py-2.5 text-center text-[11px] font-medium transition-all {cType === t.v ? 'border-[var(--ui-color-primary-500)] bg-[var(--ui-color-primary-500)]/10 text-[var(--ui-color-primary-500)]' : 'border-[var(--ui-border)] hover:border-[var(--ui-border-muted)]'}">
						<Icon name={t.i} class="mx-auto mb-1 block size-4" />{t.l}
					</button>
				{/each}
			</div>
		</div>
		{#if cType !== 'free_shipping'}
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Value {cType === 'percent' ? '(%)' : `(${currency})`}</span>
				<Input bind:value={cValue} type="number" min="0" class="w-full" />
			</label>
		{/if}
		<div class="grid grid-cols-2 gap-3">
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Min spend</span>
				<Input bind:value={cMinSpend} type="number" min="0" class="w-full" />
			</label>
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Max uses</span>
				<Input bind:value={cMaxUses} type="number" min="0" placeholder="∞" class="w-full" />
			</label>
		</div>
		<div class="rounded-lg bg-[var(--ui-bg-accented)] p-3 text-center">
			<span class="text-[11px] text-[var(--ui-text-dimmed)]">Preview · </span>
			<span class="font-mono text-[13px] font-bold">{cCode || 'CODE'}</span>
			<span class="ml-2 font-display font-bold text-primary-600 dark:text-primary-400">{couponStatus}</span>
		</div>
	</div>
	{#snippet footer()}
		<Button color="neutral" variant="ghost" onclick={() => (couponOpen = false)}>Cancel</Button>
		<Button color="primary" icon="lucide:check" disabled={!cCode.trim() || saving} onclick={saveCoupon}>{saving ? 'Creating…' : 'Create coupon'}</Button>
	{/snippet}
</Dialog>
