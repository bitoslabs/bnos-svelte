<script lang="ts">
	import { t } from '$lib/i18n/i18n.svelte';
	import Icon from './ui/Icon.svelte';
	import type { MediaSpan } from '$lib/utils/note-markdown';

	let {
		open = $bindable(false),
		items,
		index = $bindable(0)
	}: {
		open?: boolean;
		items: MediaSpan[];
		index?: number;
	} = $props();

	const current = $derived(items[index] ?? null);
	const hasMany = $derived(items.length > 1);

	function step(delta: number) {
		const next = index + delta;
		if (next >= 0 && next < items.length) index = next;
	}

	function onKey(e: KeyboardEvent) {
		if (!open) return;
		if (e.key === 'Escape') open = false;
		else if (e.key === 'ArrowRight') step(1);
		else if (e.key === 'ArrowLeft') step(-1);
	}
</script>

<svelte:window onkeydown={onKey} />

{#if open && current}
	<div
		class="fixed inset-0 z-[100] flex items-center justify-center p-4"
		role="dialog"
		aria-modal="true"
	>
		<button
			type="button"
			tabindex="-1"
			aria-label={t('common.close')}
			class="absolute inset-0 cursor-zoom-out bg-black/85 backdrop-blur-[2px]"
			onclick={() => (open = false)}
		></button>

		<button
			type="button"
			onclick={() => (open = false)}
			class="absolute top-3 right-3 z-20 grid size-10 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
			aria-label={t('common.close')}
			title={t('common.close')}
		>
			<Icon name="lucide:x" class="size-5" />
		</button>

		{#if hasMany}
			<button
				type="button"
				onclick={() => step(-1)}
				disabled={index === 0}
				class="absolute left-3 z-20 grid size-10 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 disabled:opacity-30"
				aria-label={t('common.previous')}
			>
				<Icon name="lucide:chevron-left" class="size-5" />
			</button>
			<button
				type="button"
				onclick={() => step(1)}
				disabled={index === items.length - 1}
				class="absolute right-3 z-20 grid size-10 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 disabled:opacity-30"
				aria-label={t('common.next')}
			>
				<Icon name="lucide:chevron-right" class="size-5" />
			</button>
		{/if}

		<div class="relative z-10 max-h-[88vh] max-w-[92vw]">
			{#if current.kind === 'video'}
				<!-- svelte-ignore a11y_media_has_caption -->
				<video
					src={current.url}
					controls
					autoplay
					class="max-h-[88vh] max-w-[92vw] rounded-xl bg-black"
				></video>
			{:else}
				<img
					src={current.url}
					alt={current.alt}
					class="max-h-[88vh] max-w-[92vw] rounded-xl object-contain"
				/>
			{/if}
		</div>

		{#if hasMany}
			<span
				class="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-[12px] font-medium text-white"
			>
				{index + 1} / {items.length}
			</span>
		{/if}
	</div>
{/if}
