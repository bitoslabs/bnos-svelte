<script lang="ts">
	import { page } from '$app/state';
	import Icon from '$lib/components/ui/Icon.svelte';

	let { children } = $props();

	const groups: { label: string; items: { to: string; icon: string; label: string }[] }[] = [
		{
			label: 'Store',
			items: [
				{ to: '/settings', icon: 'lucide:building-2', label: 'Organization' },
				{ to: '/settings/branches', icon: 'lucide:map-pin', label: 'Branches' },
				{ to: '/settings/payment-methods', icon: 'lucide:credit-card', label: 'Payment methods' },
				{ to: '/settings/receipt', icon: 'lucide:receipt-text', label: 'Receipt' }
			]
		},
		{
			label: 'System',
			items: [
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
</script>

<div class="grid grid-cols-1 gap-6 lg:grid-cols-[15rem_1fr]">
	<!-- sub-nav -->
	<aside class="lg:sticky lg:top-20 lg:h-fit">
		<h1 class="mb-3 font-display text-xl font-bold tracking-tight">Settings</h1>
		<nav class="space-y-4">
			{#each groups as g (g.label)}
				<div>
					<div class="px-3 pb-1.5 text-[10px] font-semibold tracking-[0.16em] text-[var(--ui-text-dimmed)] uppercase">{g.label}</div>
					{#each g.items as it (it.to)}
						<a href={it.to} class="mb-0.5 flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors {active(it.to) ? 'is-active-surface' : 'text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]'}">
							<Icon name={it.icon} class="size-4 {active(it.to) ? 'text-primary-500' : 'text-[var(--ui-text-dimmed)]'}" />{it.label}
						</a>
					{/each}
				</div>
			{/each}
		</nav>
	</aside>

	<!-- content -->
	<div class="min-w-0">
		{@render children?.()}
	</div>
</div>
