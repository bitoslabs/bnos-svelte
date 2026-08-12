<script lang="ts">
	import { resolve } from '$app/paths';
	import Icon from '$lib/components/ui/Icon.svelte';
	import BnosMark from '$lib/components/BnosMark.svelte';
	import SupportWidget from '$lib/components/support/SupportWidget.svelte';
	import ContributorsWidget from '$lib/components/support/ContributorsWidget.svelte';
	import { site, aboutLinks } from '$lib/site';

	const legalLinks = [
		{ href: '/legal/privacy', icon: 'lucide:shield-check', label: 'Privacy Policy', description: 'How local data, keys, and relay data are handled' },
		{ href: '/legal/terms', icon: 'lucide:file-text', label: 'Terms of Service', description: 'Terms for using BNOS and its public services' },
		{ href: '/legal/license', icon: 'lucide:scale', label: 'Open-source License', description: `${site.license} permissions and third-party notices` }
	] as const;
</script>

<svelte:head><title>About · {site.name}</title></svelte:head>

<main class="mx-auto min-h-screen w-full max-w-3xl px-5 py-10 sm:py-16">
	<section class="text-center">
		<div class="mx-auto mb-4 grid size-16 place-items-center rounded-2xl bg-gradient-to-br from-primary-400 to-primary-600 shadow-lg shadow-primary-500/25"><BnosMark class="size-12 text-white" /></div>
		<h1 class="font-display text-3xl font-extrabold tracking-tight">{site.name}</h1>
		<p class="mx-auto mt-3 max-w-xl text-[14px] leading-relaxed text-[var(--ui-text-muted)]">{site.fullName} — {site.tagline}</p>
		<div class="mt-5 flex flex-wrap justify-center gap-2"><a href={resolve('/login')} class="inline-flex items-center gap-2 rounded-xl bg-primary-500 px-4 py-2.5 text-[13px] font-bold text-white"><Icon name="lucide:arrow-right" class="size-4" />Open BNOS</a><a href={site.website.url} target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-2 rounded-xl border border-[var(--ui-border)] px-4 py-2.5 text-[13px] font-bold text-[var(--ui-text)]"><Icon name="lucide:globe" class="size-4" />{site.website.label}</a></div>
	</section>

	<section class="mt-10">
		<div class="mb-3 flex items-end justify-between gap-3"><div><h2 class="font-display text-xl font-bold tracking-tight">Project links</h2><p class="mt-1 text-[12.5px] text-[var(--ui-text-muted)]">Explore BNOS, contribute code, or report a problem.</p></div><Icon name="lucide:external-link" class="size-4 text-[var(--ui-text-dimmed)]" /></div>
		<div class="grid gap-2 sm:grid-cols-2">
			{#each aboutLinks as link (link.label)}
				<a href={link.href} target="_blank" rel="noopener noreferrer" class="group flex items-center gap-3 rounded-xl border border-[var(--ui-border)] bg-[var(--surface-bg)] p-3.5 transition hover:border-primary-500/40 hover:bg-[var(--ui-bg-accented)]"><span class="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-500/10 text-primary-600 dark:text-primary-400"><Icon name={link.icon} class="size-4" /></span><span class="min-w-0 flex-1"><span class="block text-[13px] font-semibold text-[var(--ui-text)]">{link.label}</span><span class="mt-0.5 block truncate text-[11px] text-[var(--ui-text-dimmed)]">{link.description}</span></span><Icon name="lucide:arrow-up-right" class="size-3.5 shrink-0 text-[var(--ui-text-dimmed)] transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5" /></a>
			{/each}
		</div>
	</section>

	<section class="mt-10"><SupportWidget /></section>
	<section class="mt-5"><ContributorsWidget /></section>

	<section class="mt-10">
		<div class="mb-3"><h2 class="font-display text-xl font-bold tracking-tight">Legal & transparency</h2><p class="mt-1 text-[12.5px] text-[var(--ui-text-muted)]">Read the public documents before using BNOS.</p></div>
		<div class="grid gap-2 sm:grid-cols-3">
			{#each legalLinks as link (link.href)}
				<a href={resolve(link.href)} class="rounded-xl border border-[var(--ui-border)] bg-[var(--surface-bg)] p-4 transition hover:border-primary-500/40 hover:bg-[var(--ui-bg-accented)]"><Icon name={link.icon} class="size-5 text-primary-500" /><span class="mt-2 block text-[13px] font-semibold">{link.label}</span><span class="mt-1 block text-[11px] leading-relaxed text-[var(--ui-text-dimmed)]">{link.description}</span><span class="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-primary-600 dark:text-primary-400">Read page <Icon name="lucide:arrow-right" class="size-3" /></span></a>
			{/each}
		</div>
	</section>

	<footer class="mt-10 border-t border-[var(--ui-border-muted)] pt-5 text-center text-[11px] leading-relaxed text-[var(--ui-text-dimmed)]">© {new Date().getFullYear()} {site.name} contributors · {site.license} licensed · Built on Nostr/GLO<br /><a href={site.sponsor.url} target="_blank" rel="noopener noreferrer" class="font-semibold hover:text-primary-500">Supported by {site.sponsor.name}</a></footer>
</main>
