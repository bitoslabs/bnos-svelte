<script lang="ts">
	/**
	 * DateRangePicker — From/To date fields plus one-tap presets, bound as
	 * `yyyy-mm-dd` strings. Consumers normalise inverted ranges with
	 * `dateRangeBounds`, so presets never leave a broken range behind.
	 */
	import { t } from '$lib/i18n/i18n.svelte';
	import { cn } from '$lib/utils/cn';
	import { dateInputKey, todayDateInput } from '$lib/utils/date-input';
	import DateTimePicker from './DateTimePicker.svelte';

	let {
		from = $bindable(''),
		to = $bindable(''),
		class: cls
	}: {
		from?: string;
		to?: string;
		class?: string;
	} = $props();

	const presets = $derived.by(() => {
		const today = new Date();
		const todayKey = todayDateInput();
		const weekStart = new Date(
			today.getFullYear(),
			today.getMonth(),
			today.getDate() - today.getDay()
		);
		const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
		return [
			{ id: 'today', label: t('common.today'), from: todayKey, to: todayKey },
			{ id: 'week', label: t('common.thisWeek'), from: dateInputKey(weekStart), to: todayKey },
			{ id: 'month', label: t('common.thisMonth'), from: dateInputKey(monthStart), to: todayKey }
		];
	});
</script>

<div class={cn('flex flex-wrap items-center gap-1.5', cls)}>
	<DateTimePicker
		bind:value={from}
		placeholder={t('common.from')}
		ariaLabel={t('common.from')}
		class="min-w-36"
	/>
	<span class="text-[12px] text-(--ui-text-dimmed)" aria-hidden="true">→</span>
	<DateTimePicker
		bind:value={to}
		placeholder={t('common.to')}
		ariaLabel={t('common.to')}
		class="min-w-36"
	/>

	<div class="flex items-center gap-1" role="group" aria-label={t('common.period')}>
		{#each presets as preset (preset.id)}
			{@const active = from === preset.from && to === preset.to}
			<button
				type="button"
				aria-pressed={active}
				onclick={() => {
					from = preset.from;
					to = preset.to;
				}}
				class={cn(
					'focus-ring h-9.5 rounded-lg border px-2.5 text-[12px] font-semibold whitespace-nowrap transition-colors',
					active
						? 'border-primary-500/30 bg-primary-500/10 text-primary-700 dark:text-primary-300'
						: 'border-(--ui-border) text-(--ui-text-muted) hover:bg-(--interactive-hover-bg) hover:text-(--ui-text)'
				)}
			>
				{preset.label}
			</button>
		{/each}
	</div>
</div>
