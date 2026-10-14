<script lang="ts">
	import { resolve } from '$app/paths';
	import { t } from '$lib/i18n/i18n.svelte';
	import { cn } from '$lib/utils/cn';
	import Badge from './ui/Badge.svelte';
	import Icon from './ui/Icon.svelte';
	import MediaLightbox from './MediaLightbox.svelte';
	import {
		parseNote,
		parseInline,
		type Block,
		type MediaSpan,
		type Span
	} from '$lib/utils/note-markdown';

	let { content, class: cls }: { content: string; class?: string } = $props();

	const blocks = $derived(parseNote(content));

	const headingSize = [
		'',
		'text-[16px]',
		'text-[15px]',
		'text-[14px]',
		'text-[13.5px]',
		'text-[13px]'
	];

	// A block with nothing but media (whitespace/breaks aside) joins consecutive
	// media into one gallery so long URL runs render as a compact grid.
	type Layout = { kind: 'block'; block: Block } | { kind: 'gallery'; items: MediaSpan[] };

	function mediaOnly(block: Block): MediaSpan[] | null {
		const text =
			block.type === 'paragraph' || block.type === 'heading' || block.type === 'quote'
				? block.text
				: null;
		if (text === null) return null;
		const spans = parseInline(text);
		const items: MediaSpan[] = [];
		for (const s of spans) {
			if (s.type === 'media') items.push(s);
			else if (s.type === 'text' && s.value.trim() === '') continue;
			else if (s.type === 'break') continue;
			else return null;
		}
		return items.length ? items : null;
	}

	const layout = $derived.by((): Layout[] => {
		const out: Layout[] = [];
		let gallery: MediaSpan[] = [];
		const flush = () => {
			if (gallery.length) out.push({ kind: 'gallery', items: gallery });
			gallery = [];
		};
		for (const block of blocks) {
			const media = mediaOnly(block);
			if (media) gallery.push(...media);
			else {
				flush();
				out.push({ kind: 'block', block });
			}
		}
		flush();
		return out;
	});

	let lightboxOpen = $state(false);
	let lightboxIndex = $state(0);
	let lightboxItems = $state<MediaSpan[]>([]);

	function openLightbox(items: MediaSpan[], i: number) {
		lightboxItems = items;
		lightboxIndex = i;
		lightboxOpen = true;
	}
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -- Notice links come from
     Nostr data, so internal paths are resolved at render time and external URLs
     are left untouched. -->
{#snippet anchor(s: Extract<Span, { type: 'link' }>)}
	<a
		href={s.external ? s.href : resolve(s.href as '/')}
		target={s.external ? '_blank' : undefined}
		rel={s.external ? 'noopener noreferrer nofollow' : undefined}
		class="text-primary-600 underline decoration-primary-500/40 underline-offset-2 hover:decoration-primary-500 dark:text-primary-400"
		>{s.value}</a
	>
{/snippet}
<!-- eslint-enable svelte/no-navigation-without-resolve -->

{#snippet media(m: MediaSpan, controls: boolean)}
	{#if m.kind === 'video'}<!-- svelte-ignore a11y_media_has_caption -->
		<video
			src={m.url}
			{controls}
			preload="metadata"
			class="my-2 max-h-80 w-full rounded-xl border border-(--ui-border) bg-black"
		></video>
	{:else}
		<img
			src={m.url}
			alt={m.alt}
			loading="lazy"
			decoding="async"
			referrerpolicy="no-referrer"
			class="my-2 max-h-80 w-full rounded-xl border border-(--ui-border) object-cover"
		/>
	{/if}
{/snippet}

{#snippet inline(spans: Span[])}
	{#each spans as s, i (i)}
		{#if s.type === 'text'}{s.value}{:else if s.type === 'strong'}<strong
				class="font-semibold text-(--ui-text)">{s.value}</strong
			>{:else if s.type === 'em'}<em>{s.value}</em>{:else if s.type === 'code'}<code
				class="rounded bg-(--ui-bg-accented) px-1.5 py-0.5 font-mono text-[0.85em] text-(--ui-text)"
				>{s.value}</code
			>{:else if s.type === 'link'}{@render anchor(s)}{:else if s.type === 'tag'}<Badge
				variant="outline"
				class="mx-0.5 align-baseline">#{s.value}</Badge
			>{:else if s.type === 'break'}<br />{:else if s.type === 'media'}{@render media(s, true)}{/if}
	{/each}
{/snippet}

<div class={cn('text-[13.5px] leading-relaxed text-(--ui-text-muted)', cls)}>
	{#each layout as item, i (i)}
		{#if item.kind === 'gallery'}
			{@const items = item.items}
			{#if items.length === 1}
				{@render media(items[0], true)}
			{:else}
				<div class="my-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
					{#each items as m, j (m.url + '-' + j)}
						<button
							type="button"
							onclick={() => openLightbox(items, j)}
							class="group relative aspect-square overflow-hidden rounded-xl border border-(--ui-border) bg-(--ui-bg-muted)"
							aria-label={t('notifications.viewMedia', { n: j + 1 })}
						>
							{#if m.kind === 'video'}
								<video src={m.url} preload="metadata" muted class="h-full w-full object-cover"
								></video>
								<span class="absolute inset-0 grid place-items-center bg-black/30">
									<Icon name="lucide:play" class="size-6 text-white" />
								</span>
							{:else}
								<img
									src={m.url}
									alt={m.alt}
									loading="lazy"
									decoding="async"
									referrerpolicy="no-referrer"
									class="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
								/>
							{/if}
							<span
								class="absolute right-1.5 bottom-1.5 grid size-6 place-items-center rounded-md bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100"
							>
								<Icon name="lucide:maximize-2" class="size-3" />
							</span>
						</button>
					{/each}
				</div>
			{/if}
		{:else if item.block.type === 'heading'}<svelte:element
				this={'h' + Math.min(item.block.level + 2, 6)}
				class={cn(
					'font-display font-semibold text-(--ui-text)',
					headingSize[item.block.level] ?? 'text-[13.5px]',
					i > 0 && 'mt-4'
				)}>{@render inline(parseInline(item.block.text))}</svelte:element
			>{:else if item.block.type === 'paragraph'}<p class={i > 0 ? 'mt-3' : ''}>
				{@render inline(parseInline(item.block.text))}
			</p>{:else if item.block.type === 'list'}{#if item.block.ordered}<ol
					class="mt-3 list-decimal space-y-1 pl-5"
				>
					{#each item.block.items as listItem, j (j)}<li>
							{@render inline(parseInline(listItem))}
						</li>{/each}
				</ol>{:else}<ul class="mt-3 list-disc space-y-1 pl-5">
					{#each item.block.items as listItem, j (j)}<li>
							{@render inline(parseInline(listItem))}
						</li>{/each}
				</ul>{/if}{:else if item.block.type === 'quote'}<blockquote
				class="mt-3 border-l-2 border-(--ui-border-accented) pl-3 text-(--ui-text-dimmed) italic"
			>
				{@render inline(parseInline(item.block.text))}
			</blockquote>{:else if item.block.type === 'code'}<pre
				class="mt-3 overflow-x-auto rounded-xl border border-(--ui-border) bg-(--ui-bg-muted) p-3 text-[12px]"><code
					class="font-mono text-(--ui-text)">{item.block.code}</code
				></pre>{:else if item.block.type === 'hr'}<hr
				class="my-4 border-(--ui-border-muted)"
			/>{/if}
	{/each}
</div>

<MediaLightbox bind:open={lightboxOpen} bind:index={lightboxIndex} items={lightboxItems} />
