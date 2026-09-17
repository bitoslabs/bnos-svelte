<script lang="ts">
	import { fly } from 'svelte/transition';
	import Button from './Button.svelte';
	import { t } from '$lib/i18n/i18n.svelte';

	/**
	 * Floating "unsaved changes" action bar. Slides up from the bottom whenever
	 * `visible` is true (i.e. the form is dirty). Sticky so it stays pinned near
	 * the viewport bottom while the page scrolls. Pass `onsave` (required) and
	 * optionally `ondiscard` to reset to the last saved snapshot.
	 */
	let {
		visible,
		saving = false,
		label = '',
		onsave,
		ondiscard
	}: {
		visible: boolean;
		saving?: boolean;
		label?: string;
		onsave: () => void;
		ondiscard?: () => void;
	} = $props();
</script>

{#if visible}
	<div class="sticky bottom-4 z-30" transition:fly={{ y: 20, duration: 200 }}>
		<div
			class="flex items-center gap-3 rounded-xl border border-[var(--ui-border-accented)] bg-[var(--ui-bg-elevated)] px-4 py-2.5 shadow-lg shadow-black/5"
		>
			<span class="relative flex size-2 shrink-0">
				<span
					class="absolute inline-flex size-full animate-ping rounded-full bg-amber-400 opacity-75"
				></span>
				<span class="relative inline-flex size-2 rounded-full bg-amber-500"></span>
			</span>
			<span class="text-[13px] font-semibold text-[var(--ui-text)]"
				>{label || t('common.unsavedChanges')}</span
			>
			<div class="ml-auto flex items-center gap-1.5">
				{#if ondiscard}
					<Button variant="ghost" color="neutral" size="sm" onclick={ondiscard}
						>{t('common.discard')}</Button
					>
				{/if}
				<Button color="primary" size="sm" icon="lucide:check" onclick={onsave} disabled={saving}>
					{saving ? t('common.saving') : t('common.saveChanges')}
				</Button>
			</div>
		</div>
	</div>
{/if}
