<script lang="ts">
	import { page } from '$app/state';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { bottomBarItems } from '$lib/nav';

	function normalizePath(path: string) {
		return path.length > 1 ? path.replace(/\/+$/, '') : path;
	}
	function isActive(to: string, exact?: boolean) {
		const current = normalizePath(page.url.pathname);
		const target = normalizePath(to);
		return exact ? current === target : current === target || current.startsWith(target + '/');
	}
</script>

<nav
	class="glass fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around border-t border-[var(--glass-border)] pb-[env(safe-area-inset-bottom)] lg:hidden"
>
	{#each bottomBarItems as item (item.to)}
		{@const active = isActive(item.to, item.exact)}
		<a
			href={item.to}
			class="relative flex flex-1 flex-col items-center gap-0.5 py-2 transition-colors {active
				? 'text-primary-500'
				: 'text-[var(--ui-text-dimmed)]'}"
		>
			{#if active}
				<span class="absolute top-0 h-0.5 w-8 rounded-full bg-primary-500"></span>
			{/if}
			<Icon name={item.icon} class="size-5" />
			<span class="text-[10px] font-semibold">{item.label}</span>
		</a>
	{/each}
</nav>
