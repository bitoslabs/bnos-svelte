<script lang="ts">
	import { resolve } from '$app/paths';
	import { t } from '$lib/i18n/i18n.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { session } from '$nostr/session.svelte';
	import BnosMark from '$lib/components/BnosMark.svelte';
	import { truncateNpub } from '$lib/utils/format';
	import { site, aboutLinks } from '$lib/site';

	const buildRows = [
		{ label: 'Version', value: `v${site.version}`, icon: 'lucide:tag' },
		{ label: 'License', value: site.license, icon: 'lucide:scale' },
		{
			label: 'Data layer',
			value: `${site.core.label}`,
			sub: site.core.standard,
			icon: 'lucide:layers'
		},
		{
			label: 'Framework',
			value: 'SvelteKit · Svelte 5',
			sub: 'Tailwind v4',
			icon: 'lucide:component'
		},
		{ label: 'Identity', value: 'Nostr · NIP-07 / nsec', icon: 'lucide:fingerprint' },
		{
			label: 'Storage',
			value: 'Local-first',
			sub: 'localStorage + Nostr relays',
			icon: 'lucide:database'
		}
	];

	const legalLinks = [
		{
			to: '/legal/privacy',
			icon: 'lucide:shield-check',
			label: 'Privacy Policy',
			desc: 'What we store and how'
		},
		{
			to: '/legal/terms',
			icon: 'lucide:file-text',
			label: 'Terms of Service',
			desc: 'Using this software'
		},
		{
			to: '/legal/license',
			icon: 'lucide:scale',
			label: 'Open-source License',
			desc: 'MIT · your permissions'
		}
	] as const;

	// "local-first" highlight chips
	const highlights = [
		{ icon: 'lucide:wifi-off', label: 'Works offline' },
		{ icon: 'lucide:shield', label: 'Your keys, your data' },
		{ icon: 'lucide:git-fork', label: 'Self-hostable' },
		{ icon: 'lucide:lock', label: 'Optional encryption' }
	];
</script>

<svelte:head><title>{t('settings.about')} · {t('common.settings')}</title></svelte:head>

<div class="space-y-5">
	<PageHeader
		icon="lucide:info"
		title={t('settings.about')}
		description={t('settings.aboutDesc')}
	/>

	<!-- Hero -->
	<section class="surface-card overflow-hidden">
		<div class="relative px-6 pt-8 pb-6 text-center sm:px-8">
			<!-- ambient glow -->
			<div class="pointer-events-none absolute inset-0 overflow-hidden">
				<div
					class="absolute -top-24 left-1/2 size-56 -translate-x-1/2 rounded-full bg-primary-500/10 blur-3xl"
				></div>
			</div>

			<div class="relative">
				<div
					class="mx-auto mb-4 grid size-16 place-items-center rounded-2xl bg-gradient-to-br from-primary-400 to-primary-600 shadow-lg shadow-primary-500/25"
				>
					<BnosMark class="size-12 text-white" />
				</div>
				<h2 class="font-display text-xl font-bold tracking-tight">{site.name}</h2>
				<p class="mx-auto mt-1 max-w-md text-[12.5px] text-[var(--ui-text-muted)]">
					{site.fullName} — {site.tagline}
				</p>

				<div class="mt-4 flex flex-wrap items-center justify-center gap-1.5">
					{#each highlights as h (h.label)}
						<span
							class="inline-flex items-center gap-1 rounded-full bg-[var(--ui-bg-accented)] px-2.5 py-1 text-[11px] font-semibold text-[var(--ui-text-muted)]"
						>
							<Icon name={h.icon} class="size-3 text-primary-500" />
							{h.label}
						</span>
					{/each}
				</div>

				{#if session.npub}
					<div
						class="mx-auto mt-4 inline-flex items-center gap-1.5 rounded-full border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-3 py-1 text-[11.5px] text-[var(--ui-text-dimmed)]"
					>
						<span class="live-dot"></span>
						Signed in as
						<span class="font-mono font-semibold">{truncateNpub(session.npub, 10, 6)}</span>
					</div>
				{/if}
			</div>
		</div>
	</section>

	<!-- Version & build -->
	<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
		<div class="flex items-center gap-2 px-5 py-3">
			<Icon name="lucide:package" class="size-4 text-primary-500" />
			<h2 class="font-display text-[14px] font-semibold">{t('settings.versionBuild')}</h2>
		</div>
		<div>
			{#each buildRows as row, i (row.label)}
				<div
					class="flex items-center gap-3 px-5 py-3 text-[13px] {i === buildRows.length - 1
						? ''
						: 'border-b border-[var(--ui-border-muted)]'}"
				>
					<Icon name={row.icon} class="size-4 shrink-0 text-[var(--ui-text-dimmed)]" />
					<span class="w-28 shrink-0 text-[var(--ui-text-muted)]">{row.label}</span>
					<div class="ml-auto min-w-0 text-right">
						<p class="truncate font-semibold text-[var(--ui-text)]">{row.value}</p>
						{#if row.sub}
							<p class="truncate text-[11px] text-[var(--ui-text-dimmed)]">{row.sub}</p>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	</section>

	<!-- Links & open source -->
	<section class="surface-card">
		<div class="flex items-center gap-2 px-5 py-3">
			<Icon name="lucide:link" class="size-4 text-primary-500" />
			<h2 class="font-display text-[14px] font-semibold">{t('settings.linksOpenSource')}</h2>
			<Badge color="success" class="ml-auto"
				><Icon name="lucide:heart" class="mr-1 size-3" />Open source</Badge
			>
		</div>
		<div class="grid grid-cols-1 gap-px bg-[var(--ui-border-muted)] sm:grid-cols-2">
			{#each aboutLinks as link (link.label)}
				<a
					href={link.href}
					target="_blank"
					rel="noopener"
					class="group flex items-start gap-3 bg-[var(--surface-bg)] px-5 py-4 transition-colors hover:bg-[var(--ui-bg-accented)]"
				>
					<span
						class="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-500/10 text-primary-600 transition-colors group-hover:bg-primary-500/15 dark:text-primary-400"
					>
						<Icon name={link.icon} class="size-4" />
					</span>
					<span class="min-w-0 flex-1">
						<span class="flex items-center gap-1 text-[13px] font-semibold text-[var(--ui-text)]">
							{link.label}
							<Icon
								name="lucide:arrow-up-right"
								class="size-3.5 text-[var(--ui-text-dimmed)] transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
							/>
						</span>
						<span class="mt-0.5 block text-[11.5px] text-[var(--ui-text-dimmed)]"
							>{link.description}</span
						>
					</span>
				</a>
			{/each}
		</div>
		<div
			class="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--ui-border-muted)] px-5 py-3"
		>
			<a
				href={site.website.url}
				target="_blank"
				rel="noopener"
				class="inline-flex items-center gap-1.5 text-[12px] font-semibold text-primary-600 hover:underline dark:text-primary-400"
			>
				<Icon name="lucide:globe" class="size-3.5" />
				{site.website.label}
			</a>
			<a
				href={site.source.url}
				target="_blank"
				rel="noopener"
				class="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]"
			>
				<Icon name="lucide:github" class="size-3.5" />
				{site.source.label}
			</a>
		</div>
	</section>

	<!-- Legal -->
	<section class="surface-card">
		<div class="flex items-center gap-2 px-5 py-3">
			<Icon name="lucide:scroll-text" class="size-4 text-primary-500" />
			<h2 class="font-display text-[14px] font-semibold">{t('legal.title')}</h2>
		</div>
		<div class="divide-y divide-[var(--ui-border-muted)]">
			{#each legalLinks as l (l.to)}
				<a
					href={resolve(l.to)}
					class="group flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-[var(--ui-bg-accented)]"
				>
					<Icon
						name={l.icon}
						class="size-4 shrink-0 text-[var(--ui-text-dimmed)] group-hover:text-primary-500"
					/>
					<span class="min-w-0 flex-1">
						<span class="block text-[13px] font-semibold text-[var(--ui-text)]">{l.label}</span>
						<span class="block text-[11.5px] text-[var(--ui-text-dimmed)]">{l.desc}</span>
					</span>
					<Icon name="lucide:chevron-right" class="size-4 shrink-0 text-[var(--ui-text-dimmed)]" />
				</a>
			{/each}
		</div>
	</section>

	<!-- Account quick links -->
	<section class="surface-card flex flex-wrap items-center justify-between gap-3 p-5">
		<div class="min-w-0">
			<h2 class="font-display text-[14px] font-semibold">{t('settings.manageAccount')}</h2>
			<p class="mt-0.5 text-[12px] text-[var(--ui-text-muted)]">
				{t('settings.manageAccountDesc')}
			</p>
		</div>
		<div class="flex flex-wrap gap-2">
			<Button
				href={resolve('/login')}
				color="neutral"
				variant="subtle"
				size="sm"
				icon="lucide:log-in">{t('common.signIn')}</Button
			>
			<Button
				href={resolve('/login')}
				color="primary"
				variant="soft"
				size="sm"
				icon="lucide:user-plus">{t('auth.createAccount')}</Button
			>
		</div>
	</section>

	<!-- Footer credit -->
	<p class="px-2 pb-1 text-center text-[11px] leading-relaxed text-[var(--ui-text-dimmed)]">
		© {new Date().getFullYear()}
		{site.name} contributors · {site.license} licensed
		<br />
		Built on the {site.fullName}, with thanks to
		<a
			href={site.sponsor.url}
			target="_blank"
			rel="noopener"
			class="font-semibold text-[var(--ui-text-muted)] hover:text-primary-500"
			>{site.sponsor.name}</a
		>.
	</p>
</div>
