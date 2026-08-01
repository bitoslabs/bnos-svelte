<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Switch from '$lib/components/ui/Switch.svelte';
	import { preferences, accentOptions, densityOptions, surfaceOptions } from '$lib/theme/preferences.svelte';
	import { setMode, userPrefersMode } from 'mode-watcher';

	onMount(() => preferences.load());
	const compact = $derived(preferences.state.density === 'compact');
</script>

<svelte:head><title>Appearance · Settings</title></svelte:head>

<div class="space-y-5">
	<section class="surface-card p-5">
		<div class="mb-4 flex items-center gap-3"><Icon name="lucide:sun-moon" class="size-5 text-primary-500" /><div><h2 class="font-display text-[15px] font-semibold tracking-tight">Color mode</h2></div></div>
		<div class="segmented inline-flex gap-1 p-1">
			{#each ['light', 'dark', 'system'] as m (m)}<button type="button" onclick={() => setMode(m as 'light' | 'dark' | 'system')} class="rounded-md px-4 py-1.5 text-[13px] font-semibold capitalize transition-colors {userPrefersMode.current === m ? 'bg-[var(--ui-bg-elevated)] text-[var(--ui-text)] shadow-sm' : 'text-[var(--ui-text-muted)]'}">{m}</button>{/each}
		</div>
	</section>
	<section class="surface-card p-5">
		<div class="mb-4 flex items-center gap-3"><Icon name="lucide:palette" class="size-5 text-primary-500" /><div><h2 class="font-display text-[15px] font-semibold tracking-tight">Accent</h2></div></div>
		<div class="flex flex-wrap gap-2">
			{#each accentOptions as opt (opt.key)}<button type="button" onclick={() => preferences.setAccent(opt.key)} class="size-8 rounded-full ring-2 ring-offset-2 ring-offset-[var(--surface-bg)] transition-transform hover:scale-110 {preferences.state.accent === opt.key ? 'ring-[var(--ui-text)]' : 'ring-transparent'}" style="background:{opt.hex}" title={opt.label} aria-label={opt.label}></button>{/each}
		</div>
	</section>
	<section class="surface-card p-5">
		<div class="mb-4 flex items-center gap-3"><Icon name="lucide:layers" class="size-5 text-primary-500" /><div><h2 class="font-display text-[15px] font-semibold tracking-tight">Surface & density</h2></div></div>
		<div class="mb-4">
			<div class="mb-2 text-[12px] font-semibold text-[var(--ui-text-muted)]">Surface</div>
			<div class="flex flex-wrap gap-2">{#each surfaceOptions as s (s.key)}<button type="button" onclick={() => preferences.setSurface(s.key)} class="rounded-lg border-2 px-3 py-1.5 text-[12.5px] font-semibold transition-colors {preferences.state.surface === s.key ? 'border-primary-500 bg-primary-500/10 text-primary-700 dark:text-primary-300' : 'border-[var(--ui-border)] text-[var(--ui-text-muted)]'}">{s.label}</button>{/each}</div>
		</div>
		<div class="flex items-center justify-between"><span class="text-[13px] font-semibold">Compact density</span><Switch checked={compact} onCheckedChange={(v) => preferences.setDensity(v ? 'compact' : 'normal')} /></div>
	</section>
</div>
