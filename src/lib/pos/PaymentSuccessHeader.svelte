<script lang="ts">
	/**
	 * Celebration header for the "Sale complete" receipt dialog.
	 *
	 * Replaces the old separate full-screen overlay: the animation now lives at
	 * the TOP of the receipt dialog (one smooth surface), then the line items +
	 * totals flow underneath. Mounts fresh every time the dialog opens (Dialog
	 * uses `{#if open}`), so the count-up + check draw replay each sale.
	 *
	 * Motion: pop-in badge → 3 staggered ring bursts → SVG check stroke-draw →
	 * rAF amount count-up. All gated by prefers-reduced-motion.
	 */
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import type { CompletedSale } from '$lib/pos/cart.svelte';
	import { formatMoney, formatInt } from '$lib/utils/format';
	import { methodMetaFor } from '$lib/pos/payment-methods';
	import { t } from '$lib/i18n/i18n.svelte';

	type Props = {
		sale: CompletedSale;
		currency: string;
		tip?: number;
		tendered?: number;
		onClose?: () => void;
	};

	let { sale, currency, tip = 0, tendered = 0, onClose }: Props = $props();

	const reducedMotion =
		typeof window !== 'undefined' &&
		window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

	const meta = $derived(methodMetaFor(sale.method));
	const finalTotal = $derived(sale.totals.total);
	let displayTotal = $state(0);

	onMount(() => {
		if (reducedMotion) {
			displayTotal = finalTotal;
			return;
		}
		// Gentle haptic tap where supported.
		try {
			navigator.vibrate?.([0, 25, 35, 55]);
		} catch {
			/* not supported */
		}
		if (finalTotal > 0) {
			const target = finalTotal;
			const start = performance.now();
			const span = 700;
			const raf = (t: number) => {
				const p = Math.min(1, (t - start) / span);
				displayTotal = target * (1 - Math.pow(1 - p, 3)); // easeOutCubic
				if (p < 1) requestAnimationFrame(raf);
				else displayTotal = target;
			};
			requestAnimationFrame(raf);
		}
	});

	const hasChange = $derived(sale.method === 'cash' && sale.change > 0.001);
	const hasTip = $derived(tip > 0);
	const hasTendered = $derived(typeof tendered === 'number' && tendered > 0);
	const count = $derived(sale.items.reduce((n, i) => n + i.quantity, 0));
	const orderTypeLabel = $derived(sale.orderType.replace(/_/g, ' '));
</script>

<div class="relative text-center">
	{#if onClose}
		<button
			type="button"
			onclick={onClose}
			aria-label={t('common.close')}
			class="absolute -top-1.5 right-0 grid size-8 place-items-center rounded-lg text-[var(--ui-text-dimmed)] transition-colors hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]"
		>
			<Icon name="lucide:x" class="size-4" />
		</button>
	{/if}

	<!-- Animated check badge + ring burst -->
	<div class="relative mx-auto grid size-16 place-items-center">
		{#if !reducedMotion}
			<span class="ps-ring absolute inset-0 rounded-full" style="border:2px solid {meta.accent};"
			></span>
			<span
				class="ps-ring ps-ring-2 absolute inset-0 rounded-full"
				style="border:2px solid {meta.accent};"
			></span>
			<span
				class="ps-ring ps-ring-3 absolute inset-0 rounded-full"
				style="border:2px solid {meta.accent};"
			></span>
		{/if}
		<div
			class="ps-pop grid size-16 place-items-center rounded-full text-white shadow-lg"
			style="background:{meta.accent}; box-shadow:0 12px 30px -8px {meta.glow};"
		>
			<svg viewBox="0 0 52 52" class="size-8" fill="none" aria-hidden="true">
				<path
					d="M14 27.5l8 8 16-18"
					stroke="white"
					stroke-width="5"
					stroke-linecap="round"
					stroke-linejoin="round"
					class={reducedMotion ? '' : 'ps-check-draw'}
				></path>
			</svg>
		</div>
	</div>

	<h2 class="ps-fade-up mt-3 font-display text-xl font-black tracking-tight text-[var(--ui-text)]">
		{t('pos.paymentReceived')}
	</h2>
	<p class="ps-fade-up mt-0.5 font-mono text-[12px] font-semibold text-[var(--ui-text-dimmed)]">
		{sale.number}
	</p>
	<div class="ps-fade-up mx-auto mt-3 w-full max-w-[260px] text-left">
		<div class="mb-1.5 flex items-center justify-between text-[9px] font-bold tracking-[0.12em] text-[var(--tone-success-text)] uppercase">
			<span>Payment confirmed</span>
			<span>100%</span>
		</div>
		<div class="h-1.5 overflow-hidden rounded-full bg-[var(--tone-success-bg)]">
			<div class="h-full w-full rounded-full bg-[var(--tone-success-text)]"></div>
		</div>
	</div>

	<!-- Amount (count-up) -->
	<div class="ps-fade-up ps-fade-up-2 mt-1.5">
		<span
			class="font-display text-[2.2rem] leading-none font-black text-[var(--ui-text)] tabular-nums"
		>
			{formatMoney(displayTotal, currency)}
		</span>
	</div>

	<!-- Method · order type · items -->
	<div
		class="ps-fade-up ps-fade-up-2 mt-2.5 flex flex-wrap items-center justify-center gap-1.5 text-[11px] font-semibold"
	>
		<span
			class="inline-flex items-center gap-1 rounded-full px-2.5 py-1"
			style="background:{meta.glow}; color:{meta.accent};"
		>
			<Icon name={meta.icon} class="size-3.5" />
			{meta.label}
		</span>
		<span
			class="inline-flex items-center gap-1 rounded-full bg-[var(--ui-bg-muted)] px-2.5 py-1 text-[var(--ui-text-muted)] capitalize"
		>
			<Icon name="lucide:bag" class="size-3.5" />
			{orderTypeLabel}
		</span>
		<span
			class="inline-flex items-center gap-1 rounded-full bg-[var(--ui-bg-muted)] px-2.5 py-1 text-[var(--ui-text-muted)]"
		>
			<Icon name="lucide:hash" class="size-3.5" />
			{t('pos.itemsCount', { count })}
		</span>
	</div>

	{#if hasTip}
		<div
			class="ps-fade-up ps-fade-up-3 mt-1.5 text-[11.5px] font-medium text-[var(--ui-text-muted)]"
		>
			{t('pos.includesTip', { amount: formatMoney(tip, currency) })}
		</div>
	{/if}

	<!-- Change due (cash) — the cashier's single most important number -->
	{#if hasChange}
		<div
			class="ps-fade-up ps-fade-up-3 mt-3 flex items-center justify-between rounded-xl border border-dashed border-[var(--tone-success-text)]/40 bg-[var(--tone-success-bg)] px-3.5 py-2"
		>
			<span
				class="text-[10.5px] font-bold tracking-[0.12em] text-[var(--tone-success-text)] uppercase"
			>
				{t('pos.changeDue')}
			</span>
			<span class="font-display text-xl font-black text-[var(--tone-success-text)] tabular-nums">
				{formatMoney(sale.change, currency)}
			</span>
		</div>
		{#if hasTendered}
			<div class="mt-1 flex items-center justify-between text-[11px] text-[var(--ui-text-muted)]">
				<span>{t('pos.tendered')} <span class="tabular-nums">{formatMoney(tendered, currency)}</span></span>
				<span>{t('common.total')} <span class="tabular-nums">{formatMoney(finalTotal, currency)}</span></span>
			</div>
		{/if}
	{/if}
</div>
