<script lang="ts">
	/** Renders the toast stack. Mounted once in +layout.svelte. */
	import { fly } from 'svelte/transition';
	import { toast } from '$lib/stores/toast.svelte';
	import Icon from './Icon.svelte';

	const iconFor = $derived.by(() => ({
		success: 'lucide:circle-check',
		info: 'lucide:info',
		warning: 'lucide:triangle-alert',
		error: 'lucide:circle-x',
		neutral: 'lucide:circle-check'
	}));
</script>

<div
	class="pointer-events-none fixed inset-x-4 bottom-24 z-[100] flex flex-col gap-2 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-80"
>
	{#each toast.items as t (t.id)}
		<div
			in:fly={{ x: 40, duration: 200 }}
			out:fly={{ x: 40, duration: 150 }}
			class="surface-card pointer-events-auto flex items-start gap-3 p-3.5 shadow-lg shadow-black/10"
		>
			<Icon
				name={t.icon ?? iconFor[t.color ?? 'neutral']}
				class="mt-0.5 size-4.5 shrink-0 {t.color === 'error' || t.color === 'warning'
					? 'text-[var(--tone-error-text)]'
					: t.color === 'success'
						? 'text-[var(--tone-success-text)]'
						: 'text-[var(--ui-color-primary-500)]'}"
			/>
			<div class="min-w-0 flex-1">
				<div
					class="flex items-center gap-2 text-[13px] font-semibold text-[var(--ui-text-highlighted)]"
				>
					<span class="truncate">{t.title}</span>
					{#if (t.count ?? 1) > 1}
						<span
							class="rounded-full bg-[var(--ui-bg-accented)] px-1.5 py-0.5 text-[10px] text-[var(--ui-text-muted)]"
						>
							x{t.count}
						</span>
					{/if}
				</div>
				{#if t.description}
					<div class="mt-0.5 text-[12px] text-[var(--ui-text-muted)]">{t.description}</div>
				{/if}
			</div>
			<button
				type="button"
				class="grid size-5 shrink-0 place-items-center rounded text-[var(--ui-text-dimmed)] hover:text-[var(--ui-text)]"
				onclick={() => toast.dismiss(t.id)}
				aria-label="Dismiss"
			>
				<Icon name="lucide:x" class="size-3.5" />
			</button>
		</div>
	{/each}
</div>
