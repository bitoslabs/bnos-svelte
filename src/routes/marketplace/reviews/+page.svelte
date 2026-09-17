<script lang="ts">
	/**
	 * Reviews — aggregate rating, distribution, and a reply / moderate flow.
	 * Reads marketplace.review (kind 30955). Replies are written back to the
	 * same object so the conversation stays with the review.
	 */
	import Icon from '$lib/components/ui/Icon.svelte';
	import { t } from '$lib/i18n/i18n.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { glo } from '$nostr/store.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { relativeTime } from '$lib/utils/format';
	import {
		TYPE,
		statusColor,
		REVIEW_STATUSES,
		ratingStars,
		ratingDistribution,
		channelMeta,
		type MarketplaceReview
	} from '$lib/domain';

	const reviews = $derived(
		glo.all<MarketplaceReview, typeof TYPE.marketplaceReview>(TYPE.marketplaceReview)
	);

	let statusFilter = $state<string>('__all__');
	let ratingFilter = $state<string>('__all__');

	const filtered = $derived(
		reviews.filter((r) => {
			if (statusFilter !== '__all__' && r.data.status !== statusFilter) return false;
			if (ratingFilter !== '__all__' && r.data.rating !== Number(ratingFilter)) return false;
			return true;
		})
	);

	// ── Aggregate ───────────────────────────────────────────
	const ratings = $derived(reviews.map((r) => r.data.rating).filter((r) => r > 0));
	const avgRating = $derived(ratings.length ? ratings.reduce((s, r) => s + r, 0) / ratings.length : 0);
	const dist = $derived(ratingDistribution(ratings));
	const totalRatings = $derived(ratings.length);

	const pendingCount = $derived(reviews.filter((r) => r.data.status === 'pending' || r.data.status === 'flagged').length);

	// ── Reply modal ─────────────────────────────────────────
	let replyOpen = $state(false);
	let replyId = $state<string | null>(null);
	let replyText = $state('');
	let saving = $state(false);

	function openReply(id: string, data: MarketplaceReview) {
		replyId = id;
		replyText = data.reply ?? '';
		replyOpen = true;
	}

	async function saveReply() {
		if (!replyId || !replyText.trim()) return;
		saving = true;
		const obj = reviews.find((r) => r.id === replyId);
		if (!obj) return;
		try {
			await glo.upsert<MarketplaceReview>(
				TYPE.marketplaceReview,
				{ ...obj.data, reply: replyText.trim(), status: 'replied' },
				{ id: replyId }
			);
			toast.success('Reply posted');
			replyOpen = false;
		} catch {
			toast.error('Failed to post reply');
		} finally {
			saving = false;
		}
	}

	async function setStatus(id: string, data: MarketplaceReview, status: MarketplaceReview['status']) {
		await glo.upsert<MarketplaceReview>(TYPE.marketplaceReview, { ...data, status }, { id });
		toast.success(`Review ${status}`);
	}
</script>

<svelte:head><title>{t('nav.marketplace')} · {t('nav.reviews')}</title></svelte:head>

<div class="space-y-5">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h2 class="font-display text-lg font-bold tracking-tight">{t('nav.reviews')}</h2>
			<p class="text-[12px] text-[var(--ui-text-muted)]">{reviews.length} reviews · {pendingCount} need attention</p>
		</div>
	</div>

	{#if reviews.length === 0}
		<EmptyState
			icon="lucide:star"
			title={t('marketplace.noReviews')}
			description="Customer reviews synced from your channels and captured after purchase will appear here."
		/>
	{:else}
		<!-- Summary panel -->
		<div class="surface-card flex flex-col gap-5 p-5 sm:flex-row sm:items-center">
			<div class="flex items-center gap-4 sm:w-48 sm:border-r sm:border-[var(--ui-border-muted)] sm:pr-5">
				<div class="text-center">
					<div class="font-display text-4xl font-black tabular-nums">{avgRating.toFixed(2)}</div>
					<div class="mt-1 text-lg tracking-tight text-amber-500">{ratingStars(avgRating)}</div>
					<div class="mt-0.5 text-[11px] text-[var(--ui-text-dimmed)]">{totalRatings} ratings</div>
				</div>
			</div>
			<div class="flex-1 space-y-1.5">
				{#each [5, 4, 3, 2, 1] as star (star)}
					{@const n = dist[star] ?? 0}
					{@const pct = totalRatings > 0 ? (n / totalRatings) * 100 : 0}
					<div class="flex items-center gap-2">
						<span class="w-3 text-[11px] font-semibold tabular-nums text-[var(--ui-text-muted)]">{star}</span>
						<Icon name="lucide:star" class="size-3 fill-amber-400 text-amber-400" />
						<div class="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--ui-bg-accented)]">
							<div class="h-full rounded-full bg-amber-400 transition-all" style="width:{pct}%"></div>
						</div>
						<span class="w-8 text-right text-[11px] tabular-nums text-[var(--ui-text-dimmed)]">{n}</span>
					</div>
				{/each}
			</div>
		</div>

		<!-- Filters -->
		<div class="flex flex-wrap items-center gap-2">
			<div class="flex items-center gap-1 rounded-lg bg-[var(--ui-bg-accented)] p-1">
				<button type="button" onclick={() => (statusFilter = '__all__')} class="rounded-md px-2.5 py-1 text-[11px] font-semibold transition-all {statusFilter === '__all__' ? 'bg-[var(--ui-bg-elevated)] text-[var(--ui-text)] shadow-sm' : 'text-[var(--ui-text-muted)]'}">{t('common.all')}</button>
				{#each REVIEW_STATUSES as s (s.value)}
					<button type="button" onclick={() => (statusFilter = statusFilter === s.value ? '__all__' : s.value)} class="rounded-md px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap transition-all {statusFilter === s.value ? 'bg-[var(--ui-bg-elevated)] text-[var(--ui-text)] shadow-sm' : 'text-[var(--ui-text-muted)]'}">{s.label}</button>
				{/each}
			</div>
			<div class="flex items-center gap-1 rounded-lg bg-[var(--ui-bg-accented)] p-1">
				<button type="button" onclick={() => (ratingFilter = '__all__')} class="rounded-md px-2 py-1 text-[11px] font-semibold transition-all {ratingFilter === '__all__' ? 'bg-[var(--ui-bg-elevated)] text-[var(--ui-text)] shadow-sm' : 'text-[var(--ui-text-muted)]'}">All ★</button>
				{#each [5, 4, 3, 2, 1] as star (star)}
					<button type="button" onclick={() => (ratingFilter = ratingFilter === String(star) ? '__all__' : String(star))} class="rounded-md px-2 py-1 text-[11px] font-semibold transition-all {ratingFilter === String(star) ? 'bg-[var(--ui-bg-elevated)] text-[var(--ui-text)] shadow-sm' : 'text-[var(--ui-text-muted)]'}">{star}★</button>
				{/each}
			</div>
		</div>

		<!-- Review list -->
		<div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
			{#each filtered as r (r.id)}
				<div class="surface-card flex flex-col p-4">
					<div class="flex items-start justify-between gap-3">
						<div class="flex items-center gap-2.5">
							<div class="grid size-9 shrink-0 place-items-center rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
								<Icon name="lucide:user" class="size-4.5" />
							</div>
							<div>
								<div class="flex items-center gap-1.5">
									<p class="text-[13px] font-bold">{r.data.customerName}</p>
									{#if r.data.verified}
										<Icon name="lucide:badge-check" class="size-3.5 text-primary-500" />
									{/if}
								</div>
								<div class="flex items-center gap-1.5 text-[10.5px] text-[var(--ui-text-dimmed)]">
									{#if r.data.channelName}
										{@const m = channelMeta(r.data.channelName)}
										<span class="inline-flex items-center gap-0.5"><Icon name={m.icon} class="size-2.5" />{r.data.channelName}</span>
									{/if}
									{#if r.data.productName}<span>· {r.data.productName}</span>{/if}
								</div>
							</div>
						</div>
						<div class="flex flex-col items-end gap-1">
							<span class="text-sm tracking-tight text-amber-500">{ratingStars(r.data.rating)}</span>
							<Badge color={statusColor(r.data.status)}>{r.data.status}</Badge>
						</div>
					</div>

					{#if r.data.title}
						<p class="mt-2.5 text-[13px] font-semibold">{r.data.title}</p>
					{/if}
					{#if r.data.body}
						<p class="mt-1 text-[12px] leading-relaxed text-[var(--ui-text-muted)]">"{r.data.body}"</p>
					{/if}

					{#if r.data.reply}
						<div class="mt-3 rounded-lg bg-[var(--ui-bg-accented)] p-2.5">
							<div class="flex items-center gap-1 text-[10px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase">
								<Icon name="lucide:message-square-reply" class="size-3" /> Owner reply
							</div>
							<p class="mt-1 text-[11.5px] text-[var(--ui-text-muted)]">{r.data.reply}</p>
						</div>
					{/if}

					<div class="mt-auto flex items-center justify-between pt-3">
						<span class="text-[10.5px] text-[var(--ui-text-dimmed)]">{relativeTime((glo.get(TYPE.marketplaceReview, r.id)?.data as { createdAt?: string })?.createdAt ?? Date.now())}</span>
						<div class="flex items-center gap-1">
							<Button size="sm" color="neutral" variant="ghost" onclick={() => setStatus(r.id, r.data, r.data.status === 'hidden' ? 'published' : 'hidden')} title={r.data.status === 'hidden' ? 'Show' : 'Hide'}>
								<Icon name={r.data.status === 'hidden' ? 'lucide:eye' : 'lucide:eye-off'} class="size-3.5" />
							</Button>
							{#if r.data.status !== 'flagged'}
								<Button size="sm" color="neutral" variant="ghost" icon="lucide:flag" title={t('marketplace.flag')} onclick={() => setStatus(r.id, r.data, 'flagged')} />
							{/if}
							<Button size="sm" color="primary" variant="subtle" icon="lucide:reply" onclick={() => openReply(r.id, r.data)}>
								{r.data.reply ? 'Edit reply' : 'Reply'}
							</Button>
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<!-- Reply modal -->
<Dialog bind:open={replyOpen} title={t('common.replyToReview')} size="md">
	{#if replyId}
		{@const review = reviews.find((r) => r.id === replyId)?.data}
		<div class="space-y-3">
			{#if review}
				<div class="rounded-lg bg-[var(--ui-bg-accented)] p-3">
					<div class="flex items-center justify-between">
						<span class="text-[12px] font-semibold">{review.customerName}</span>
						<span class="text-amber-500">{ratingStars(review.rating)}</span>
					</div>
					{#if review.body}<p class="mt-1 text-[11.5px] text-[var(--ui-text-muted)]">"{review.body}"</p>{/if}
				</div>
			{/if}
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Your reply</span>
				<Input bind:value={replyText} textarea rows={3} placeholder="Thank your customer publicly…" class="w-full" />
			</label>
		</div>
	{/if}
	{#snippet footer()}
		<Button color="neutral" variant="ghost" onclick={() => (replyOpen = false)}>{t('common.cancel')}</Button>
		<Button color="primary" icon="lucide:send" disabled={!replyText.trim() || saving} onclick={saveReply}>{saving ? 'Posting…' : 'Post reply'}</Button>
	{/snippet}
</Dialog>
