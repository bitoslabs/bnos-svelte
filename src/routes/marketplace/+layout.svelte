<script lang="ts">
	/**
	 * Marketplace module shell. Gates on the `marketplace` feature flag and
	 * provides a sticky sub-nav with live counts across the module's pages.
	 */
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import MarketplaceNav from '$lib/components/marketplace/MarketplaceNav.svelte';
	import { features } from '$lib/features.svelte';
	import { glo } from '$nostr/store.svelte';
	import { dataSync } from '$nostr/sync.svelte';
	import { syncWorkspaceSettingsToOrganization } from '$nostr/workspace-settings';
	import { TYPE, isRemoteSource } from '$lib/domain';
	import type {
		MarketplaceConnection,
		MarketplaceReview,
		MarketplaceProduct
	} from '$lib/domain';
	import type { DashboardOrder } from '$lib/dashboard/metrics';

	let { children } = $props();

	onMount(() => {
		features.load();
		dataSync.pageSync(
			[
				TYPE.marketplaceConnection,
				TYPE.marketplaceProduct,
				TYPE.marketplaceReview,
				TYPE.order,
				TYPE.promotion,
				TYPE.coupon
			],
			{ scope: 'marketplace' }
		);
	});

	const connections = $derived(
		glo.all<MarketplaceConnection, typeof TYPE.marketplaceConnection>(TYPE.marketplaceConnection)
	);
	const reviews = $derived(
		glo.all<MarketplaceReview, typeof TYPE.marketplaceReview>(TYPE.marketplaceReview)
	);
	const orders = $derived(glo.all<DashboardOrder, 'commerce.order'>('commerce.order'));
	const listings = $derived(
		glo.all<MarketplaceProduct, typeof TYPE.marketplaceProduct>(TYPE.marketplaceProduct)
	);

	// Counts for nav badges
	const pendingOrders = $derived(
		orders.filter(
			(o) =>
				isRemoteSource(o.data.source) &&
				['pending', 'confirmed', 'preparing', 'ready'].includes(o.data.status ?? '')
		).length
	);
	const toShip = $derived(
		orders.filter((o) => {
			const s = (o.data as { shipping?: { shippingStatus?: string } }).shipping?.shippingStatus;
			return isRemoteSource(o.data.source) && ['pending', 'packed'].includes(s ?? '');
		}).length
	);
	const unansweredReviews = $derived(
		reviews.filter((r) => r.data.status === 'pending' || r.data.status === 'flagged').length
	);

	const counts = $derived({
		orders: pendingOrders,
		shipping: toShip,
		reviews: unansweredReviews
	});

	const enabled = $derived(features.isEnabled('marketplace'));
</script>

{#if !enabled}
	<!-- Feature gate: graceful CTA -->
	<div class="mx-auto max-w-xl py-16 text-center sm:py-24">
		<div
			class="mx-auto grid size-16 place-items-center rounded-2xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 text-violet-500"
		>
			<Icon name="lucide:globe" class="size-8" />
		</div>
		<h1 class="mt-5 font-display text-2xl font-bold tracking-tight">Marketplace</h1>
		<p class="mx-auto mt-2 max-w-md text-[13.5px] leading-relaxed text-[var(--ui-text-muted)]">
			Sell across TikTok, Facebook, Shopee, your own website and more — unified listings,
			synchronized inventory, and one fulfillment board for every channel.
		</p>
		<div class="mt-6 flex items-center justify-center gap-2">
			<Button
				color="primary"
				icon="lucide:rocket"
				onclick={async () => {
					features.set('marketplace', true);
					await syncWorkspaceSettingsToOrganization();
				}}
			>
				Enable Marketplace
			</Button>
			<Button color="neutral" variant="subtle" icon="lucide:settings" href={resolve('/settings/features')}>
				Module settings
			</Button>
		</div>
	</div>
{:else}
	<div class="space-y-5">
		<!-- Module header -->
		<div class="flex flex-wrap items-center justify-between gap-3">
			<div class="flex items-center gap-3">
				<div
					class="grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 text-violet-600 dark:text-violet-400"
				>
					<Icon name="lucide:globe" class="size-5" />
				</div>
				<div>
					<h1 class="font-display text-xl font-bold tracking-tight">Marketplace</h1>
					<p class="text-[12px] text-[var(--ui-text-muted)]">
						{connections.length} channels · {listings.length} listings
					</p>
				</div>
			</div>
		</div>

		<MarketplaceNav {counts} />

		<div>
			{@render children?.()}
		</div>
	</div>
{/if}
