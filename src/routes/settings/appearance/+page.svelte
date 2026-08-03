<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import {
		preferences,
		accentOptions,
		surfaceOptions,
		surfaceTintOptions,
		neutralOptions,
		fontSizeOptions,
		radiusOptions
	} from '$lib/theme/preferences.svelte';
	import { setMode, userPrefersMode } from 'mode-watcher';

	onMount(() => preferences.load());

	const modes = [
		{ key: 'light', label: 'Light', icon: 'lucide:sun' },
		{ key: 'dark', label: 'Dark', icon: 'lucide:moon' },
		{ key: 'system', label: 'System', icon: 'lucide:monitor' }
	] as const;

	const densities = [
		{ key: 'normal', label: 'Normal', description: 'Comfortable spacing' },
		{ key: 'compact', label: 'Compact', description: 'More content on screen' }
	] as const;
</script>

<svelte:head><title>Appearance · Settings</title></svelte:head>

<div class="space-y-5">
	<!-- Page header -->
	<div class="flex items-center gap-3">
		<div class="grid size-11 place-items-center rounded-xl bg-primary-500/10 text-primary-600 dark:text-primary-400">
			<Icon name="lucide:palette" class="size-5" />
		</div>
		<div>
			<h2 class="font-display text-[16px] font-semibold tracking-tight">Appearance</h2>
			<p class="text-[12px] text-[var(--ui-text-muted)]">Customize how BNOS looks across your devices</p>
		</div>
	</div>

	<!-- Color mode — visual cards -->
	<section class="surface-card p-5">
		<div class="mb-4">
			<h3 class="font-display text-[14px] font-bold">Color mode</h3>
			<p class="mt-0.5 text-[12px] text-[var(--ui-text-muted)]">Choose light, dark or follow your system</p>
		</div>
		<div class="grid grid-cols-3 gap-3">
			{#each modes as m (m.key)}
				{@const active = userPrefersMode.current === m.key}
				<button
					type="button"
					onclick={() => setMode(m.key)}
					class="group rounded-xl border-2 p-3 transition-all {active
						? 'border-primary-500 bg-primary-500/5'
						: 'border-[var(--ui-border-muted)] hover:border-[var(--ui-border-accented)]'}"
					aria-pressed={active}
				>
					<div
						class="mb-2.5 grid h-14 place-items-center rounded-lg transition-colors {m.key === 'light'
							? 'bg-[var(--ui-bg-muted)]'
							: m.key === 'dark'
								? 'bg-[var(--ui-bg-inverse)]'
								: 'bg-[var(--ui-bg-accented)]'}"
					>
						<Icon
							name={m.icon}
							class={m.key === 'dark'
								? 'size-5 text-white'
								: m.key === 'light'
									? 'size-5 text-amber-500'
									: 'size-5 text-[var(--ui-text-muted)]'}
						/>
					</div>
					<p
						class="text-center text-[12px] font-bold {active
							? 'text-primary-700 dark:text-primary-300'
							: 'text-[var(--ui-text)]'}"
					>
						{m.label}
					</p>
				</button>
			{/each}
		</div>
	</section>

	<!-- Accent — round swatches with check -->
	<section class="surface-card p-5">
		<div class="mb-4">
			<h3 class="font-display text-[14px] font-bold">Accent color</h3>
			<p class="mt-0.5 text-[12px] text-[var(--ui-text-muted)]">The primary brand color used throughout the app</p>
		</div>
		<div class="flex flex-wrap gap-3">
			{#each accentOptions as opt (opt.key)}
				{@const active = preferences.state.accent === opt.key}
				<button
					type="button"
					onclick={() => preferences.setAccent(opt.key)}
					class="grid size-10 cursor-pointer place-items-center rounded-full ring-2 ring-offset-2 ring-offset-[var(--surface-bg)] transition-transform hover:scale-110 {active
						? 'ring-[var(--ui-text)]'
						: 'ring-transparent'}"
					style="background: {opt.hex}"
					title={opt.label}
					aria-label={opt.label}
					aria-pressed={active}
				>
					{#if active}
						<Icon name="lucide:check" class="size-4 text-white drop-shadow" />
					{/if}
				</button>
			{/each}
		</div>
	</section>

	<!-- Neutral palette — swatches -->
	<section class="surface-card p-5">
		<div class="mb-4">
			<h3 class="font-display text-[14px] font-bold">Neutral palette</h3>
			<p class="mt-0.5 text-[12px] text-[var(--ui-text-muted)]">Base gray used for text &amp; borders</p>
		</div>
		<div class="flex flex-wrap gap-3">
			{#each neutralOptions as n (n.key)}
				{@const active = preferences.state.neutral === n.key}
				<button
					type="button"
					onclick={() => preferences.setNeutral(n.key)}
					class="flex items-center gap-2 rounded-lg border-2 px-3 py-1.5 text-[12.5px] font-semibold transition-colors {active
						? 'border-primary-500 bg-primary-500/10'
						: 'border-[var(--ui-border)] text-[var(--ui-text-muted)] hover:bg-[var(--interactive-hover-bg)]'}"
				>
					<span class="size-4 rounded-full" style="background:{n.hex}"></span>{n.label}
				</button>
			{/each}
		</div>
	</section>

	<!-- Density — visual cards -->
	<section class="surface-card p-5">
		<div class="mb-4">
			<h3 class="font-display text-[14px] font-bold">Density</h3>
			<p class="mt-0.5 text-[12px] text-[var(--ui-text-muted)]">How tightly content is packed on screen</p>
		</div>
		<div class="grid grid-cols-2 gap-3">
			{#each densities as d (d.key)}
				{@const active = preferences.state.density === d.key}
				<button
					type="button"
					onclick={() => preferences.setDensity(d.key)}
					class="rounded-xl border-2 p-4 text-left transition-all {active
						? 'border-primary-500 bg-primary-500/10'
						: 'border-[var(--ui-border)] hover:bg-[var(--interactive-hover-bg)]'}"
					aria-pressed={active}
				>
					<div class="mb-3 space-y-1.5">
						<div class="h-2 rounded-full bg-current/25"></div>
						<div class="h-2 rounded-full bg-current/20 {d.key === 'compact' ? 'w-3/4' : 'w-5/6'}"></div>
						<div class="h-2 rounded-full bg-current/15 {d.key === 'compact' ? 'w-1/2' : 'w-2/3'}"></div>
					</div>
					<p class="text-[13px] font-bold {active ? 'text-primary-700 dark:text-primary-300' : 'text-[var(--ui-text)]'}">
						{d.label}
					</p>
					<p class="mt-0.5 text-[11px] text-[var(--ui-text-muted)]">{d.description}</p>
				</button>
			{/each}
		</div>
	</section>

	<!-- Surface & tint -->
	<section class="surface-card p-5">
		<div class="mb-4">
			<h3 class="font-display text-[14px] font-bold">Surface</h3>
			<p class="mt-0.5 text-[12px] text-[var(--ui-text-muted)]">Card &amp; window treatment</p>
		</div>
		<div class="mb-4">
			<div class="mb-2 text-[12px] font-semibold text-[var(--ui-text-muted)]">Style</div>
			<div class="flex flex-wrap gap-2">
				{#each surfaceOptions as s (s.key)}
					{@const active = preferences.state.surface === s.key}
					<button
						type="button"
						onclick={() => preferences.setSurface(s.key)}
						class="rounded-lg border-2 px-3 py-1.5 text-[12.5px] font-semibold transition-colors {active
							? 'border-primary-500 bg-primary-500/10 text-primary-700 dark:text-primary-300'
							: 'border-[var(--ui-border)] text-[var(--ui-text-muted)] hover:bg-[var(--interactive-hover-bg)]'}"
					>{s.label}</button>
				{/each}
			</div>
		</div>
		<div>
			<div class="mb-2 text-[12px] font-semibold text-[var(--ui-text-muted)]">Tint</div>
			<div class="flex flex-wrap gap-2">
				{#each surfaceTintOptions as st (st.key)}
					{@const active = preferences.state.surfaceTint === st.key}
					<button
						type="button"
						onclick={() => preferences.setSurfaceTint(st.key)}
						class="rounded-lg border-2 px-3 py-1.5 text-[12.5px] font-semibold transition-colors {active
							? 'border-primary-500 bg-primary-500/10 text-primary-700 dark:text-primary-300'
							: 'border-[var(--ui-border)] text-[var(--ui-text-muted)] hover:bg-[var(--interactive-hover-bg)]'}"
					>{st.label}</button>
				{/each}
			</div>
		</div>
	</section>

	<!-- Typography & shape -->
	<section class="surface-card p-5">
		<div class="mb-4">
			<h3 class="font-display text-[14px] font-bold">Typography &amp; shape</h3>
		</div>
		<div class="mb-4">
			<div class="mb-2 text-[12px] font-semibold text-[var(--ui-text-muted)]">Font size</div>
			<div class="flex flex-wrap gap-2">
				{#each fontSizeOptions as f (f.key)}
					{@const active = preferences.state.fontSize === f.key}
					<button
						type="button"
						onclick={() => preferences.setFontSize(f.key)}
						class="rounded-lg border-2 px-3 py-1.5 text-[12.5px] font-semibold transition-colors {active
							? 'border-primary-500 bg-primary-500/10 text-primary-700 dark:text-primary-300'
							: 'border-[var(--ui-border)] text-[var(--ui-text-muted)] hover:bg-[var(--interactive-hover-bg)]'}"
					>{f.label}</button>
				{/each}
			</div>
		</div>
		<div>
			<div class="mb-2 text-[12px] font-semibold text-[var(--ui-text-muted)]">Corner radius</div>
			<div class="flex flex-wrap gap-2">
				{#each radiusOptions as r (r.key)}
					{@const active = preferences.state.radius === r.key}
					<button
						type="button"
						onclick={() => preferences.setRadius(r.key)}
						class="flex items-center gap-2 rounded-lg border-2 px-3 py-1.5 text-[12.5px] font-semibold transition-colors {active
							? 'border-primary-500 bg-primary-500/10 text-primary-700 dark:text-primary-300'
							: 'border-[var(--ui-border)] text-[var(--ui-text-muted)] hover:bg-[var(--interactive-hover-bg)]'}"
					>
						<span class="size-3.5 border-2 border-current/40" style="border-radius:{r.value}"></span>
						{r.label}
					</button>
				{/each}
			</div>
		</div>
	</section>
</div>
