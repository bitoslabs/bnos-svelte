<script lang="ts">
	/**
	 * Compact language switcher. Used in the quick-settings popover and the
	 * Settings → General page. Switching updates the global i18n store, which
	 * reactively re-renders the whole app.
	 */
	import Icon from '$lib/components/ui/Icon.svelte';
	import { i18n, locales } from '$lib/i18n/i18n.svelte';
	import { nativeNames, localeFlag, type Locale } from '$lib/i18n/messages';

	let { size = 'md' }: { size?: 'sm' | 'md' } = $props();

	const current = $derived(i18n.locale);

	function pick(locale: Locale) {
		i18n.set(locale);
	}
</script>

<div class="flex flex-wrap gap-1.5" role="group" aria-label="Language">
	{#each locales as locale (locale)}
		<button
			type="button"
			onclick={() => pick(locale)}
			aria-pressed={current === locale}
			class="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold transition-all {current ===
			locale
				? 'border-primary-500 bg-primary-500/10 text-primary-600 dark:text-primary-400'
				: 'border-[var(--ui-border)] text-[var(--ui-text-muted)] hover:border-[var(--ui-text-dimmed)] hover:text-[var(--ui-text)]'} {size ===
			'sm'
				? 'px-2 py-1 text-[11px]'
				: ''}"
		>
			<span class="text-[13px] leading-none">{localeFlag[locale]}</span>
			<span>{nativeNames[locale]}</span>
			{#if current === locale}
				<Icon name="lucide:check" class="size-3" />
			{/if}
		</button>
	{/each}
</div>
