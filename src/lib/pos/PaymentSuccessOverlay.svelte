<script lang="ts" module>
	// Method accent palette lives in ./payment-methods.ts (shared module).
	// Deterministic confetti particle set (stable across renders, SSR-safe).
	type Particle = {
		id: number;
		left: number;
		w: number;
		h: number;
		color: string;
		radius: string;
		cx: number;
		cr: number;
		delay: number;
		dur: number;
	};

	export function confetti(method: { accent: string }): Particle[] {
		// Brand + method + neutral palette.
		const palette = [
			method.accent,
			'#22c55e',
			'#10b981',
			'#34d399',
			'#f59e0b',
			'#ffffff',
			'#60a5fa',
			'#f472b6'
		];
		const N = 16;
		const out: Particle[] = [];
		// Pseudo-random but seeded by index so it's stable.
		let seed = 7;
		const rand = () => {
			seed = (seed * 9301 + 49297) % 233280;
			return seed / 233280;
		};
		for (let i = 0; i < N; i++) {
			const isStrip = rand() > 0.5;
			out.push({
				id: i,
				left: Math.round(rand() * 100),
				w: isStrip ? 7 : 9,
				h: isStrip ? 13 : 9,
				color: palette[i % palette.length],
				radius: isStrip ? '2px' : '9999px',
				cx: Math.round((rand() - 0.5) * 120),
				cr: Math.round((rand() > 0.5 ? 1 : -1) * (360 + rand() * 720)),
				delay: +(rand() * 0.25).toFixed(2),
				dur: +(1.5 + rand() * 1.1).toFixed(2)
			});
		}
		return out;
	}
</script>

<script lang="ts">
	/**
	 * Premium "charge complete" celebration overlay.
	 *
	 * Renders a choreographed payment-received moment:
	 *  • pop-in card with brand/method tint
	 *  • animated SVG check (circle pop + stroke draw)
	 *  • 3 staggered radiating ring bursts
	 *  • confetti shower in brand + method colours
	 *  • rAF amount count-up (skipped for reduced-motion)
	 *  • prominent CHANGE DUE for cash (the cashier's #1 need)
	 *  • tip / tendered / items / order # / sats context
	 *  • haptic vibration + tap-to-dismiss + auto-dismiss progress bar
	 *
	 * Two variants share the same motion language:
	 *   - 'terminal' : adaptive (light/dark), used on the POS cashier screen
	 *   - 'display'  : always-dark, customer-facing big screen
	 *
	 * All animation respects prefers-reduced-motion (global CSS nuke + JS gates).
	 */
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import Icon from '$lib/components/ui/Icon.svelte';
	import type { CompletedSale } from '$lib/pos/cart.svelte';
	import { formatMoney, formatInt } from '$lib/utils/format';
	import { methodMetaFor, type MethodMeta } from '$lib/pos/payment-methods';

	type Props = {
		sale: CompletedSale;
		currency: string;
		tip?: number;
		tendered?: number;
		/** Auto-dismiss after N ms (terminal variant). Set 0 to disable. */
		duration?: number;
		/** 'terminal' = cashier screen, 'display' = customer big screen. */
		variant?: 'terminal' | 'display';
		/** Override item count (used by the customer display, which only gets a
		 *  total via broadcast, not the full line list). */
		itemCount?: number;
		onDismiss?: () => void;
	};

	let {
		sale,
		currency,
		tip = 0,
		tendered = 0,
		duration = 2200,
		variant = 'terminal',
		itemCount,
		onDismiss
	}: Props = $props();

	// Accent palette per payment method — shared with the POS page.
	const methodMeta: MethodMeta = $derived(methodMetaFor(sale.method));

	const reducedMotion =
		typeof window !== 'undefined' &&
		window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

	// ── Amount count-up (rAF). Instant final value for reduced-motion. ──
	const finalTotal = $derived(sale.totals.total);
	let displayTotal = $state(0);

	// ── Auto-dismiss + progress bar ──
	let dismissTimer: ReturnType<typeof setTimeout> | null = null;
	const autoDismiss = $derived(duration > 0 && variant === 'terminal');

	onMount(() => {
		// Reduced-motion: show the final amount immediately (no count-up).
		if (reducedMotion) {
			displayTotal = finalTotal;
			return;
		}

		// Haptic feedback (where supported). Short tap, or a gentle two-pulse.
		try {
			navigator.vibrate?.([0, 25, 35, 55]);
		} catch {
			/* not supported */
		}

		// Count-up over ~700ms with ease-out.
		if (finalTotal > 0) {
			const target = finalTotal;
			const start = performance.now();
			const span = 700;
			const raf = (t: number) => {
				const p = Math.min(1, (t - start) / span);
				const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
				displayTotal = target * eased;
				if (p < 1) requestAnimationFrame(raf);
				else displayTotal = target;
			};
			requestAnimationFrame(raf);
		}

		if (autoDismiss) {
			dismissTimer = setTimeout(() => onDismiss?.(), duration);
		}

		return () => {
			if (dismissTimer) clearTimeout(dismissTimer);
		};
	});

	function dismiss() {
		if (dismissTimer) clearTimeout(dismissTimer);
		dismissTimer = null;
		onDismiss?.();
	}

	// ── Context flags ──
	const hasChange = $derived(sale.method === 'cash' && sale.change > 0.001);
	const hasTip = $derived(tip > 0);
	const hasTendered = $derived(typeof tendered === 'number' && tendered > 0);
	const count = $derived(itemCount ?? sale.items.reduce((n, i) => n + i.quantity, 0));
	const orderTypeLabel = $derived(sale.orderType.replace(/_/g, ' '));
	const isLight = $derived(variant === 'terminal');
</script>

<!-- Backdrop: tinted radial glow + blur. Tap anywhere to dismiss (terminal). -->
<div
	class="fixed inset-0 z-[100] flex items-center justify-center"
	class:cursor-pointer={isLight}
	onclick={isLight ? dismiss : undefined}
	role="status"
	aria-live="polite"
	aria-label="Payment received"
	in:fade={{ duration: 120 }}
	out:fade={{ duration: 200 }}
>
	<!-- Ambient glow + scrim -->
	<div
		class="pointer-events-none absolute inset-0 {isLight
			? 'bg-black/55 backdrop-blur-[3px]'
			: 'bg-black/40'}"
	></div>
	<div
		class="pointer-events-none absolute top-1/2 left-1/2 size-[42rem] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
		style="background: radial-gradient(circle, {methodMeta.glow} 0%, transparent 62%);"
	></div>

	<!-- Confetti shower (hidden for reduced-motion / display keeps a lighter one) -->
	{#if !reducedMotion}
		<div class="pointer-events-none absolute inset-0 overflow-hidden">
			{#each confetti(methodMeta) as p (p.id)}
				<span
					class="ps-confetti"
					style="left:{p.left}%;width:{p.w}px;height:{p.h}px;background:{p.color};border-radius:{p.radius};--cx:{p.cx}px;--cr:{p.cr}deg;animation-delay:{p.delay}s;animation-duration:{p.dur}s;"
				></span>
			{/each}
		</div>
	{/if}

	<!-- Card -->
	<div
		class="ps-pop relative z-10 mx-4 w-full max-w-sm rounded-3xl text-center shadow-2xl {isLight
			? 'border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] px-6 pt-7 pb-5 text-[var(--ui-text)]'
			: 'border border-white/10 bg-white/[0.04] px-8 pt-10 pb-8 text-white backdrop-blur-xl'}"
		onclick={(e) => e.stopPropagation()}
		role="presentation"
	>
		<!-- Badge with ring bursts + animated check -->
		<div class="relative mx-auto grid size-24 place-items-center">
			{#if !reducedMotion}
				<span
					class="ps-ring absolute inset-0 rounded-full"
					style="border:2px solid {methodMeta.accent};"
				></span>
				<span
					class="ps-ring ps-ring-2 absolute inset-0 rounded-full"
					style="border:2px solid {methodMeta.accent};"
				></span>
				<span
					class="ps-ring ps-ring-3 absolute inset-0 rounded-full"
					style="border:2px solid {methodMeta.accent};"
				></span>
			{/if}

			<div
				class="grid size-24 place-items-center rounded-full text-white shadow-lg"
				style="background:{methodMeta.accent}; box-shadow:0 18px 40px -10px {methodMeta.glow};"
			>
				<svg viewBox="0 0 52 52" class="size-12" fill="none" aria-hidden="true">
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

		<!-- Headline -->
		<h2
			class="ps-fade-up mt-4 font-display text-2xl font-black tracking-tight {isLight
				? 'text-[var(--ui-text)]'
				: 'text-white'}"
		>
			{variant === 'display' ? 'Thank You!' : 'Payment received'}
		</h2>
		<p
			class="ps-fade-up mt-0.5 font-mono text-[12px] font-semibold {isLight
				? 'text-[var(--ui-text-dimmed)]'
				: 'text-white/50'}"
		>
			{sale.number}
		</p>

		<!-- Amount (count-up) -->
		<div class="ps-fade-up ps-fade-up-2 mt-2">
			<span
				class="font-display text-[2.6rem] leading-none font-black tabular-nums {isLight
					? 'text-[var(--ui-text)]'
					: 'text-white'}"
			>
				{formatMoney(displayTotal, currency)}
			</span>
		</div>

		<!-- Method chip + order-type + items -->
		<div
			class="ps-fade-up ps-fade-up-2 mt-3 flex flex-wrap items-center justify-center gap-1.5 text-[11.5px] font-semibold"
		>
			<span
				class="inline-flex items-center gap-1 rounded-full px-2.5 py-1"
				style="background:{methodMeta.glow}; color:{methodMeta.accent};"
			>
				<Icon name={methodMeta.icon} class="size-3.5" />
				{methodMeta.label}
			</span>
			<span
				class="inline-flex items-center gap-1 rounded-full px-2.5 py-1 capitalize {isLight
					? 'bg-[var(--ui-bg-muted)] text-[var(--ui-text-muted)]'
					: 'bg-white/10 text-white/70'}"
			>
				<Icon name="lucide:bag" class="size-3.5" />
				{orderTypeLabel}
			</span>
			<span
				class="inline-flex items-center gap-1 rounded-full px-2.5 py-1 {isLight
					? 'bg-[var(--ui-bg-muted)] text-[var(--ui-text-muted)]'
					: 'bg-white/10 text-white/70'}"
			>
				<Icon name="lucide:hash" class="size-3.5" />
				{formatInt(count)} item{count !== 1 ? 's' : ''}
			</span>
		</div>

		{#if hasTip}
			<div
				class="ps-fade-up ps-fade-up-3 mt-2 text-[12px] font-medium {isLight
					? 'text-[var(--ui-text-muted)]'
					: 'text-white/60'}"
			>
				Includes {formatMoney(tip, currency)} tip
			</div>
		{/if}

		<!-- CHANGE DUE — the cashier's single most important number (cash only) -->
		{#if hasChange}
			<div
				class="ps-fade-up ps-fade-up-3 mt-4 overflow-hidden rounded-2xl border-2 border-dashed {isLight
					? 'border-[var(--tone-success-text)]/40 bg-[var(--tone-success-bg)]'
					: 'border-emerald-400/40 bg-emerald-400/10'}"
			>
				<div
					class="px-4 pt-2.5 pb-2 text-[10.5px] font-bold tracking-[0.12em] uppercase {isLight
						? 'text-[var(--tone-success-text)]'
						: 'text-emerald-300'}"
				>
					Change due to customer
				</div>
				<div
					class="px-4 pb-3 font-display text-[2rem] leading-none font-black tabular-nums {isLight
						? 'text-[var(--tone-success-text)]'
						: 'text-emerald-300'}"
				>
					{formatMoney(sale.change, currency)}
				</div>
				{#if hasTendered}
					<div
						class="flex items-center justify-between border-t px-4 py-1.5 text-[11px] {isLight
							? 'border-[var(--tone-success-text)]/15 text-[var(--ui-text-muted)]'
							: 'border-emerald-400/15 text-white/55'}"
					>
						<span>Tendered</span><span class="tabular-nums">{formatMoney(tendered, currency)}</span>
						<span>Total</span><span class="tabular-nums">{formatMoney(finalTotal, currency)}</span>
					</div>
				{/if}
			</div>
		{/if}

		{#if sale.totalSats}
			<div
				class="ps-fade-up ps-fade-up-3 mt-3 inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-1 text-[12px] font-bold text-amber-600 dark:text-amber-400"
			>
				<Icon name="lucide:zap" class="size-3.5" />
				≈ {formatInt(sale.totalSats)} sats
			</div>
		{/if}

		{#if sale.promotion?.name}
			<div
				class="ps-fade-up ps-fade-up-3 mt-2 inline-flex items-center gap-1.5 text-[11.5px] font-semibold {isLight
					? 'text-[var(--tone-success-text)]'
					: 'text-emerald-300'}"
			>
				<Icon name="lucide:ticket-percent" class="size-3.5" />
				{sale.promotion.name}
			</div>
		{/if}

		<!-- Auto-dismiss progress + hint (terminal only) -->
		{#if autoDismiss && !reducedMotion}
			<div class="mt-5">
				<div
					class="mx-auto h-1 w-28 overflow-hidden rounded-full {isLight
						? 'bg-[var(--ui-border-muted)]'
						: 'bg-white/10'}"
				>
					<div
						class="ps-countbar h-full rounded-full"
						style="background:{methodMeta.accent}; animation-duration:{duration}ms;"
					></div>
				</div>
				<p
					class="mt-2 text-[10.5px] font-medium {isLight
						? 'text-[var(--ui-text-dimmed)]'
						: 'text-white/40'}"
				>
					Tap anywhere to continue
				</p>
			</div>
		{:else if isLight}
			<p class="mt-5 text-[10.5px] font-medium text-[var(--ui-text-dimmed)]">
				Tap anywhere to continue
			</p>
		{/if}
	</div>
</div>
