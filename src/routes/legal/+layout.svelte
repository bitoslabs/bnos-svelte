<script lang="ts">
	import { resolve } from '$app/paths';
	import { t } from '$lib/i18n/i18n.svelte';
	import { page } from '$app/state';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { site } from '$lib/site';

	let { children } = $props();

	// In-app legal section navigation.
	const links = [
		{ to: '/legal/privacy', icon: 'lucide:shield-check', label: 'Privacy Policy' },
		{ to: '/legal/terms', icon: 'lucide:file-text', label: 'Terms of Service' },
		{ to: '/legal/license', icon: 'lucide:scale', label: 'Open-source License' },
		// about
		{ to: '/about', icon: 'lucide:info', label: 'About' }

	];

	function active(to: string) {
		return page.url.pathname.startsWith(to);
	}

	// "Last updated" date — bump when content changes meaningfully.
	const updated = 'August 5, 2025';
</script>

<svelte:head><title>{t('legal.title')} · {site.name}</title></svelte:head>

<div class="mx-auto w-full max-w-5xl space-y-6 px-5 pt-6 pb-24 lg:pb-12 min-h-dvh lg:pt-10">
	<header class="space-y-2">
		<a
			href={resolve('/about')}
			class="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] font-semibold text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]"
		>
			<Icon name="lucide:arrow-left" class="size-4" />
			Back to About
		</a>
		<div class="flex items-center gap-3 pt-1">
			<span
				class="grid size-10 place-items-center rounded-xl bg-primary-500/10 text-primary-600 dark:text-primary-400"
			>
				<Icon name="lucide:scroll-text" class="size-5" />
			</span>
			<div>
				<h1 class="font-display text-xl font-bold tracking-tight">{t('settings.grpLegal')}</h1>
				<p class="text-[12.5px] text-[var(--ui-text-muted)]">
					How {site.name} handles your data and the license it ships under.
				</p>
			</div>
		</div>
	</header>

	<div class="grid grid-cols-1 gap-6 lg:grid-cols-[14rem_1fr]">
		<!-- sticky table of contents (desktop) / horizontal pills (mobile) -->
		<aside class="lg:sticky lg:top-20 lg:h-fit">
			<nav
				aria-label="Legal sections"
				class="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:gap-1 lg:overflow-visible"
			>
				{#each links as l (l.to)}
					{@const isActive = active(l.to)}
					<a
						href={resolve(l.to)}
						aria-current={isActive ? 'page' : undefined}
						class="flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors lg:shrink {isActive
							? 'bg-primary-500/10 text-primary-700 dark:text-primary-300'
							: 'text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]'}"
					>
						<Icon name={l.icon} class="size-4 shrink-0" />
						{l.label}
					</a>
				{/each}
			</nav>
			<p class="mt-4 hidden text-[11px] text-[var(--ui-text-dimmed)] lg:block">
				Last updated · {updated}
			</p>
		</aside>

		<!-- article content -->
		<div class="min-w-0">
			<article class="surface-card p-6 sm:p-8">
				{@render children?.()}
			</article>
			<p class="mt-3 px-1 text-center text-[11px] text-[var(--ui-text-dimmed)] lg:hidden">
				Last updated · {updated}
			</p>
		</div>
	</div>
</div>
