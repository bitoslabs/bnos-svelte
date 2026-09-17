<script lang="ts">
	/**
	 * Marketplace sub-navigation — a sticky horizontal tab bar with live
	 * counts (orders to act on, reviews unanswered…). Responsive: scrolls on
	 * narrow viewports. Mirrors the visual language of the promotions
	 * `segmented` control but spans the module.
	 */
	import { resolve } from '$app/paths';
	import { t } from '$lib/i18n/i18n.svelte';
	import { page } from '$app/state';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { cn } from '$lib/utils/cn';

	let { counts = {} }: { counts?: Record<string, number> } = $props();

	const items: { to: string; icon: string; label: string; exact?: boolean; countKey?: string }[] = [
		{ to: '/marketplace', icon: 'lucide:gauge', label: 'Overview', exact: true },
		{ to: '/marketplace/listings', icon: 'lucide:tags', label: 'Listings' },
		{ to: '/marketplace/channels', icon: 'lucide:radio', label: 'Channels' },
		{ to: '/marketplace/orders', icon: 'lucide:shopping-bag', label: 'Orders', countKey: 'orders' },
		{ to: '/marketplace/shipping', icon: 'lucide:truck', label: 'Shipping', countKey: 'shipping' },
		{ to: '/marketplace/promotions', icon: 'lucide:megaphone', label: t('nav.promotions') },
		{ to: '/marketplace/reviews', icon: 'lucide:star', label: t('nav.reviews'), countKey: 'reviews' },
		{ to: '/marketplace/analytics', icon: 'lucide:chart-column', label: 'Analytics' },
		{ to: '/marketplace/settings', icon: 'lucide:settings', label: 'Settings' }
	];

	function active(to: string, exact?: boolean) {
		const p = page.url.pathname;
		return exact ? p === to : p === to || p.startsWith(to + '/');
	}
</script>

<nav class="no-scrollbar -mx-5 mb-5 overflow-x-auto px-5 sm:mx-0 sm:px-0" aria-label={t('nav.sectionMarketplace')}>
	<div class="flex w-max min-w-full gap-1 border-b border-[var(--ui-border-muted)] pb-px">
		{#each items as it (it.to)}
			{@const isActive = active(it.to, it.exact)}
			{@const count = it.countKey ? counts[it.countKey] : undefined}
			<a
				href={resolve(it.to as '/')}
				aria-current={isActive ? 'page' : undefined}
				class={cn(
					'group relative flex items-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-[13px] font-semibold transition-colors',
					isActive
						? 'text-primary-600 dark:text-primary-400'
						: 'text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'
				)}
			>
				<Icon
					name={it.icon}
					class={cn(
						'size-4 shrink-0 transition-colors',
						isActive ? 'text-primary-500' : 'text-[var(--ui-text-dimmed)] group-hover:text-[var(--ui-text-muted)]'
					)}
				/>
				{it.label}
				{#if count && count > 0}
					<span
						class="ml-0.5 inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-primary-500/15 px-1 text-[10px] font-bold tabular-nums text-primary-600 dark:text-primary-300"
					>
						{count > 99 ? '99+' : count}
					</span>
				{/if}
				{#if isActive}
					<span
						class="absolute right-2 bottom-0 left-2 h-0.5 rounded-full bg-primary-500"
						aria-hidden="true"
					></span>
					{/if}
			</a>
		{/each}
	</div>
</nav>
