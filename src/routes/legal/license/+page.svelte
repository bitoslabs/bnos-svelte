<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import { site } from '$lib/site';

	const stack = [
		{ name: 'SvelteKit', url: 'https://kit.svelte.dev', note: 'Application framework' },
		{ name: 'Svelte 5', url: 'https://svelte.dev', note: 'Reactive UI (runes)' },
		{ name: 'Tailwind CSS v4', url: 'https://tailwindcss.com', note: 'Styling' },
		{
			name: '@bitos/bnos-core',
			url: site.core.url,
			note: `${site.core.standard} data standard`
		},
		{ name: 'nostr-tools', url: 'https://github.com/nbd-wtf/nostr-tools', note: 'Nostr protocol' },
		{ name: 'idb-keyval', url: 'https://github.com/jakearchibald/idb-keyval', note: 'IndexedDB store' },
		{ name: 'mode-watcher', url: 'https://github.com/svecosystem/mode-watcher', note: 'Dark / light mode' },
		{ name: 'Iconify (Lucide)', url: 'https://iconify.design', note: 'Icon set' }
	];
</script>

<svelte:head><title>Open-source License · {site.name}</title></svelte:head>

<div class="prose prose-sm max-w-none dark:prose-invert
	prose-headings:font-display prose-headings:tracking-tight
	prose-headings:text-[var(--ui-text)] prose-p:text-[var(--ui-text-muted)]
	prose-li:text-[var(--ui-text-muted)] prose-strong:text-[var(--ui-text)]
	prose-a:text-primary-600 prose-a:no-underline hover:prose-a:underline dark:prose-a:text-primary-400
	prose-h3:text-[1.05rem] prose-code:rounded prose-code:bg-[var(--ui-bg-accented)]
	prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[0.85em] prose-code:before:content-[''] prose-code:after:content-['']">

	<h2>Open-source License</h2>

	<p class="text-[var(--ui-text)]">
		{site.fullName} is free and open-source software released under the <strong>{site.license}
		License</strong>. You are free to run, study, modify, and redistribute it — including for
		commercial use.
	</p>

	<div class="not-prose my-6 flex flex-wrap items-center gap-2">
		<Badge color="success"><Icon name="lucide:check" class="mr-1 size-3" />MIT Licensed</Badge>
		<Badge color="neutral"><Icon name="lucide:github" class="mr-1 size-3" />Public source</Badge>
		<Badge color="info"><Icon name="lucide:git-fork" class="mr-1 size-3" />Self-host friendly</Badge>
	</div>

	<h3>Your permissions</h3>
	<p>Under the MIT license you may, without asking permission:</p>
	<ul>
		<li><strong>Use</strong> {site.name} commercially and non-commercially.</li>
		<li><strong>Study</strong> and audit the complete source code.</li>
		<li><strong>Modify</strong> it to fit your business and self-host your build.</li>
		<li><strong>Redistribute</strong> and even relicense derivatives (under the license's terms).</li>
	</ul>

	<div class="not-prose my-6">
		<div class="flex flex-wrap gap-2">
			<Button color="primary" variant="soft" size="sm" icon="lucide:github" href={site.source.url} target="_blank" rel="noopener">
				View on GitHub
			</Button>
			<Button color="neutral" variant="subtle" size="sm" icon="lucide:scale" href={`${site.source.url}/blob/main/LICENSE`} target="_blank" rel="noopener">
				Read full LICENSE
			</Button>
			<Button color="neutral" variant="subtle" size="sm" icon="lucide:git-fork" href={`${site.source.url}/fork`} target="_blank" rel="noopener">
				Fork &amp; self-host
			</Button>
		</div>
	</div>

	<h3>The MIT License</h3>
	<pre class="not-prose overflow-x-auto rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] p-4 text-[11.5px] leading-relaxed text-[var(--ui-text-muted)]"><code>MIT License

Copyright (c) {new Date().getFullYear()} {site.name} contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.</code></pre>

	<h3>Built on</h3>
	<p>{site.name} stands on the shoulders of excellent open-source projects:</p>
	<div class="not-prose grid grid-cols-1 gap-2.5 sm:grid-cols-2">
		{#each stack as s (s.name)}
			<a
				href={s.url}
				target="_blank"
				rel="noopener"
				class="group flex items-center gap-3 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-3.5 py-2.5 transition-colors hover:border-primary-500/40 hover:bg-[var(--ui-bg-accented)]"
			>
				<Icon name="lucide:box" class="size-4 shrink-0 text-[var(--ui-text-dimmed)] group-hover:text-primary-500" />
				<div class="min-w-0">
					<p class="truncate text-[13px] font-bold text-[var(--ui-text)]">{s.name}</p>
					<p class="truncate text-[11px] text-[var(--ui-text-dimmed)]">{s.note}</p>
				</div>
				<Icon name="lucide:arrow-up-right" class="ml-auto size-3.5 shrink-0 text-[var(--ui-text-dimmed)]" />
			</a>
		{/each}
	</div>

	<h3>Acknowledgments</h3>
	<p>
		Built on the foundational architecture of the <strong>{site.fullName}</strong>, with thanks to
		<a href={site.sponsor.url} target="_blank" rel="noopener">{site.sponsor.name}</a> for sponsoring
		and supporting the open BNOS ecosystem, and to the wider
		<a href={site.nostr.nips} target="_blank" rel="noopener">Nostr</a> community for the protocol and
		tools this project depends on.
	</p>
</div>
