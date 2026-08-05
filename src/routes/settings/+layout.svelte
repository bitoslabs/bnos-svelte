<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Icon from '$lib/components/ui/Icon.svelte';
	import SettingsNav from '$lib/components/SettingsNav.svelte';

	let { children } = $props();

	// Mobile master/detail: a back button takes over on sub-pages. The nav list
	// itself lives on the index page (mobile) and the sidebar (desktop).
	const isIndex = $derived(page.url.pathname === '/settings');
</script>

<div class="grid grid-cols-1 gap-6 lg:grid-cols-[15rem_1fr]">
	<!-- sub-nav (desktop only; mobile shows it on the index page) -->
	<aside
		class="settings-layout-sidebar hidden lg:sticky lg:top-20 lg:block lg:h-fit lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pr-1 lg:pb-4"
	>
		<h1 class="mb-3 font-display text-xl font-bold tracking-tight">Settings</h1>
		<SettingsNav />
	</aside>

	<!-- content -->
	<div class="min-w-0">
		<div class="mx-auto w-full max-w-5xl">
			{#if !isIndex}
				<a
					href={resolve('/settings')}
					class="settings-layout-back mb-4 inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] font-semibold text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)] lg:hidden"
				>
					<Icon name="lucide:arrow-left" class="size-4" />
					All settings
				</a>
			{/if}
			{@render children?.()}
		</div>
	</div>
</div>
