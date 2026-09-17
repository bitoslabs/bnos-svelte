<script lang="ts">
	/**
	 * Global host for the imperative `confirm()` store. Mounted once in
	 * `+layout.svelte`; renders nothing unless a confirm is pending. Centred
	 * icon-badge layout, tone-driven colours, Enter = confirm, Esc = cancel.
	 */
	import { scale } from 'svelte/transition';
	import Icon from './Icon.svelte';
	import Button from './Button.svelte';
	import { confirmStore, type ConfirmTone } from '$lib/stores/confirm.svelte';
	import { t } from '$lib/i18n/i18n.svelte';

	const toneStyles: Record<
		ConfirmTone,
		{ badge: string; ring: string; icon: string; btn: 'primary' | 'error' | 'neutral' }
	> = {
		danger: {
			badge: 'bg-[var(--tone-error-bg)] text-[var(--tone-error-text)]',
			ring: 'ring-[var(--tone-error-text)]/15',
			icon: 'lucide:trash-2',
			btn: 'error'
		},
		warning: {
			badge: 'bg-[var(--tone-warning-bg)] text-[var(--tone-warning-text)]',
			ring: 'ring-[var(--tone-warning-text)]/15',
			icon: 'lucide:triangle-alert',
			btn: 'primary'
		},
		primary: {
			badge: 'bg-primary-500/10 text-primary-600 dark:text-primary-400',
			ring: 'ring-primary-500/20',
			icon: 'lucide:check-circle-2',
			btn: 'primary'
		},
		neutral: {
			badge: 'bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)]',
			ring: 'ring-[var(--ui-border-muted)]',
			icon: 'lucide:circle-help',
			btn: 'neutral'
		}
	};

	const state = $derived(confirmStore.state);
	const tone = $derived(state.options.tone ?? 'neutral');
	const style = $derived(toneStyles[tone]);
	const icon = $derived(state.options.icon ?? style.icon);
	const isDismiss = $derived(state.options.dismissOnly === true);
	const confirmText = $derived(state.options.confirmText ?? (isDismiss ? t('common.ok') : t('common.confirm')));
	const cancelText = $derived(state.options.cancelText ?? t('common.cancel'));

	function onKey(e: KeyboardEvent) {
		if (!state.open) return;
		if (e.key === 'Escape') confirmStore.resolve(false);
		else if (e.key === 'Enter' && !isDismiss) {
			e.preventDefault();
			confirmStore.resolve(true);
		}
	}
</script>

<svelte:window onkeydown={onKey} />

{#if state.open}
	<div class="fixed inset-0 z-[100] flex items-center justify-center p-4">
		<button
			type="button"
			aria-label={cancelText}
			tabindex="-1"
			class="animate-fade fixed inset-0 bg-black/50 backdrop-blur-[2px]"
			onclick={() => confirmStore.resolve(false)}
		></button>
		<div
			in:scale={{ duration: 180, start: 0.94 }}
			out:scale={{ duration: 120, start: 0.97 }}
			class="relative w-full max-w-sm overflow-hidden rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-bg-elevated)] shadow-2xl shadow-black/25"
			role="alertdialog"
			aria-modal="true"
			aria-labelledby="confirm-title"
		>
			<!-- Soft tone wash at the top -->
			<div class="pointer-events-none absolute inset-x-0 top-0 h-24 {style.badge} opacity-40"></div>

			<div class="relative px-6 pt-6 pb-2 text-center">
				<div
					class="mx-auto mb-3 grid size-14 place-items-center rounded-full ring-1 ring-inset {style.badge} {style.ring}"
				>
					<Icon name={icon} class="size-7" />
				</div>
				<h2 id="confirm-title" class="font-display text-[17px] font-bold tracking-tight">
					{state.options.title}
				</h2>
				{#if state.options.message}
					<p class="mt-1.5 text-[13px] leading-relaxed text-[var(--ui-text-muted)]">
						{state.options.message}
					</p>
				{/if}
				{#if state.options.detail}
					<div
						class="mt-3 rounded-lg border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-3 py-2 text-left text-[12.5px] font-medium break-words text-[var(--ui-text)]"
					>
						{state.options.detail}
					</div>
				{/if}
			</div>

			<div class="flex gap-2 px-6 pt-4 pb-6">
				{#if !isDismiss}
					<Button
						color="neutral"
						variant="subtle"
						class="flex-1"
						onclick={() => confirmStore.resolve(false)}>{cancelText}</Button
					>
				{/if}
				<Button
					color={style.btn}
					class="flex-1"
					onclick={() => confirmStore.resolve(isDismiss ? false : true)}>{confirmText}</Button
				>
			</div>
		</div>
	</div>
{/if}
