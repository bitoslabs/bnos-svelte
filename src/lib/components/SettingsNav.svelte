<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { permissionForPath } from '$lib/nav';
	import { permissions } from '$lib/permissions.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { cn } from '$lib/utils/cn';

	/**
	 * Settings navigation, responsive:
	 *  - mobile  → iOS/macOS-style grouped list (inset rounded cards, large tap
	 *              targets, trailing chevrons). Shown in-page on the index.
	 *  - desktop → compact sticky sidebar list.
	 * Self-contained: computes groups, filters by permissions, tracks active.
	 */
	let { class: cls }: { class?: string } = $props();

	const groups: { label: string; items: { to: string; icon: string; label: string }[] }[] = [
		{
			label: 'Account',
			items: [{ to: '/settings/profile', icon: 'lucide:user', label: 'Profile' }]
		},
		{
			label: 'Store',
			items: [
				{ to: '/settings/organization', icon: 'lucide:building-2', label: 'Workspace' },
				{ to: '/settings/store', icon: 'lucide:store', label: 'Store profile' },
				{ to: '/settings/general', icon: 'lucide:sliders-horizontal', label: 'General' },
				{ to: '/settings/features', icon: 'lucide:layout-grid', label: 'Features' },
				{ to: '/settings/payment-methods', icon: 'lucide:credit-card', label: 'Payment methods' },
				{ to: '/settings/receipt', icon: 'lucide:receipt-text', label: 'Receipt' },
				{ to: '/settings/bitcoin', icon: 'lucide:bitcoin', label: 'Bitcoin' }
			]
		},
		{
			label: 'Hardware',
			items: [
				{ to: '/settings/hardware', icon: 'lucide:cpu', label: 'Hardware' },
				{ to: '/settings/printers', icon: 'lucide:printer', label: 'Printers' }
			]
		},
		{
			label: 'Billing',
			items: [{ to: '/settings/billing', icon: 'lucide:credit-card', label: 'Plan & billing' }]
		},
		{
			label: 'System',
			items: [
				{ to: '/settings/notifications', icon: 'lucide:bell', label: 'Notifications' },
				{ to: '/settings/relays', icon: 'lucide:radio', label: 'Relays' },
				{ to: '/settings/appearance', icon: 'lucide:palette', label: 'Appearance' },
				{ to: '/settings/data', icon: 'lucide:database', label: 'Data' },
				{ to: '/settings/about', icon: 'lucide:info', label: 'About' }
			]
		}
	];

	function active(to: string) {
		const p = page.url.pathname;
		return to === '/settings' ? p === '/settings' : p.startsWith(to);
	}

	function canSee(to: string) {
		if (tenant.state.activeRole === null) return true;
		const gate = permissionForPath(to);
		if (!gate) return true;
		return permissions.can(gate.resource, gate.action);
	}

	const visibleGroups = $derived(
		groups
			.map((group) => ({ ...group, items: group.items.filter((item) => canSee(item.to)) }))
			.filter((group) => group.items.length > 0)
	);
</script>

<nav class={cn('space-y-5 lg:space-y-4', cls)} aria-label="Settings">
	{#each visibleGroups as g (g.label)}
		<section>
			<div
				class="px-1 pb-1.5 text-[11px] font-semibold tracking-wider text-[var(--ui-text-dimmed)] uppercase lg:px-3 lg:text-[10px] lg:tracking-[0.16em]"
			>
				{g.label}
			</div>
			<ul
				class="divide-y divide-[var(--ui-border-muted)] overflow-hidden rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] lg:divide-y-0 lg:rounded-none lg:border-0 lg:bg-transparent"
			>
				{#each g.items as it (it.to)}
					{@const isActive = active(it.to)}
					<li>
						<a
							href={resolve(it.to)}
							aria-current={isActive ? 'page' : undefined}
							class="group flex items-center gap-3 px-3.5 py-3 text-[14px] font-medium transition-colors lg:gap-2.5 lg:px-3 lg:py-2 lg:text-[13px] {isActive
								? 'is-active-surface'
								: 'text-[var(--ui-text)] hover:bg-[var(--ui-bg-accented)] lg:text-[var(--ui-text-muted)] lg:hover:text-[var(--ui-text)]'}"
						>
							<Icon
								name={it.icon}
								class={cn(
									'size-5 shrink-0 transition-colors lg:size-4',
									isActive
										? 'text-primary-500'
										: 'text-[var(--ui-text-dimmed)] group-hover:text-[var(--ui-text-muted)]'
								)}
							/>
							<span class="flex-1 truncate">{it.label}</span>
							<Icon
								name="lucide:chevron-right"
								class="size-4 shrink-0 text-[var(--ui-text-dimmed)] lg:hidden"
							/>
						</a>
					</li>
				{/each}
			</ul>
		</section>
	{/each}
</nav>
