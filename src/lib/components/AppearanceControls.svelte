<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import { cn } from '$lib/utils/cn';
	import { preferences, accentOptions, densityOptions } from '$lib/theme/preferences.svelte';
	import { setMode, userPrefersMode } from 'mode-watcher';
	import { t } from '$lib/i18n/i18n.svelte';

	/**
	 * Compact appearance controls — theme cards + accent swatches + density.
	 * Shared by the app top-bar quick-settings popover and the setup layout
	 * popover so the markup (and behaviour) lives in one place.
	 */
	let { class: cls }: { class?: string } = $props();

	const modes = [
		{ key: 'light', label: t('settings.light'), icon: 'lucide:sun' },
		{ key: 'dark', label: t('settings.dark'), icon: 'lucide:moon' },
		{ key: 'system', label: t('settings.system'), icon: 'lucide:monitor' }
	] as const;
</script>

<div class={cn('space-y-4', cls)}>
	<!-- Theme cards -->
	<div>
		<p class="mb-2 px-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--ui-text-dimmed)]">
			{t('settings.colorMode')}
		</p>
		<div class="grid grid-cols-3 gap-1.5">
			{#each modes as m (m.key)}
				{@const active = userPrefersMode.current === m.key}
				<button
					type="button"
					onclick={() => setMode(m.key)}
					class={cn(
						'group flex flex-col items-center gap-1.5 rounded-lg border-2 px-2 py-2.5 transition-all',
						active
							? 'border-primary-500 bg-primary-500/10'
							: 'border-[var(--ui-border-muted)] hover:border-[var(--ui-border-accented)] hover:bg-[var(--ui-bg-accented)]'
					)}
					aria-pressed={active}
				>
					<span
						class={cn(
							'grid size-7 place-items-center rounded-md transition-colors',
							m.key === 'light' ? 'bg-[var(--ui-bg-muted)]' : m.key === 'dark' ? 'bg-[var(--ui-bg-inverse)]' : 'bg-[var(--ui-bg-accented)]'
						)}
					>
						<Icon
							name={m.icon}
							class={cn(
								'size-4',
								m.key === 'dark' ? 'text-white' : active ? 'text-primary-600 dark:text-primary-400' : 'text-[var(--ui-text-muted)]'
							)}
						/>
					</span>
					<span
						class={cn(
							'text-[11px] font-semibold',
							active ? 'text-primary-700 dark:text-primary-300' : 'text-[var(--ui-text-muted)]'
						)}
					>{m.label}</span>
				</button>
			{/each}
		</div>
	</div>

	<!-- Accent -->
	<div>
		<p class="mb-2 px-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--ui-text-dimmed)]">
			{t('settings.accentColor')}
		</p>
		<div class="flex flex-wrap gap-2 px-0.5">
			{#each accentOptions as opt (opt.key)}
				{@const active = preferences.state.accent === opt.key}
				<button
					type="button"
					onclick={() => preferences.setAccent(opt.key)}
					class="grid size-7 cursor-pointer place-items-center rounded-full ring-2 ring-offset-2 ring-offset-[var(--surface-bg)] transition-transform hover:scale-110 {active
						? 'ring-[var(--ui-text)]'
						: 'ring-transparent'}"
					style="background: {opt.hex}"
					title={opt.label}
					aria-label={opt.label}
					aria-pressed={active}
				>
					{#if active}
						<Icon name="lucide:check" class="size-3.5 text-white drop-shadow" />
					{/if}
				</button>
			{/each}
		</div>
	</div>

	<!-- Density -->
	<div>
		<p class="mb-2 px-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--ui-text-dimmed)]">
			{t('settings.density')}
		</p>
		<div class="segmented flex gap-1">
			{#each densityOptions as opt (opt.key)}
				{@const active = preferences.state.density === opt.key}
				<button
					type="button"
					onclick={() => preferences.setDensity(opt.key)}
					class="flex-1 rounded-md px-3 py-1.5 text-[12px] font-semibold capitalize transition-colors {active
						? 'bg-[var(--ui-bg-elevated)] text-[var(--ui-text)] shadow-sm'
						: 'text-[var(--ui-text-muted)]'}"
				>{opt.label}</button>
			{/each}
		</div>
	</div>
</div>
