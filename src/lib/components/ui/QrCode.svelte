<script lang="ts">
	/**
	 * Offline-capable QR code renderer (SVG). Uses the vendored Nayuki encoder
	 * so it works with zero network/runtime deps — every payment surface
	 * (Lightning, PromptPay/EMVCo, bank transfer, npub) renders through this.
	 *
	 * Renders crisp vector SVG (scales to any display size / printer) with a
	 * quiet-zone margin and an optional accent center badge (e.g. ⚡ Lightning).
	 */
	import { encodeText, type EccLevel } from '$lib/utils/qr';
	import Icon from './Icon.svelte';

	interface Props {
		value: string;
		size?: number;
		level?: EccLevel;
		/** Light/dark module colors. Defaults to black-on-white. */
		dark?: string;
		light?: string;
		/** Quiet-zone size in modules (recommend ≥ 2 for reliable scan). */
		margin?: number;
		/** Optional accent center badge. */
		badge?: 'lightning' | 'bitcoin' | 'bank' | 'qr' | 'store' | 'none';
		/** Badge tint (overrides default per-badge colour). */
		badgeColor?: string;
		class?: string;
	}

	let {
		value,
		size = 200,
		level = 'medium',
		dark = '#0a0a0a',
		light = '#ffffff',
		margin = 2,
		badge = 'none',
		badgeColor,
		class: klass = ''
	}: Props = $props();

	const matrix = $derived(value ? encodeText(value, level) : []);
	const modules = $derived(matrix.length);
	const total = $derived(modules + margin * 2);

	const path = $derived.by(() => {
		if (!modules) return '';
		let d = '';
		for (let y = 0; y < modules; y++) {
			const row = matrix[y];
			for (let x = 0; x < modules; x++) {
				if (row[x]) d += `M${x + margin} ${y + margin}h1v1h-1z`;
			}
		}
		return d;
	});

	const badgeIcon: Record<string, string> = {
		lightning: 'lucide:zap',
		bitcoin: 'lucide:bitcoin',
		bank: 'lucide:landmark',
		qr: 'lucide:qr-code',
		store: 'lucide:store'
	};
	const badgeTint: Record<string, string> = {
		lightning: '#f59e0b',
		bitcoin: '#f7931a',
		bank: '#0ea5e9',
		qr: '#8b5cf6',
		store: 'var(--primary-500)'
	};
</script>

<div class="relative inline-block {klass}" style="width: {size}px; height: {size}px;">
	<svg
		viewBox="0 0 {total} {total}"
		width={size}
		height={size}
		role="img"
		aria-label="QR code"
		style="shape-rendering: crispEdges; max-width: 100%; height: auto; display: block;"
	>
		{#if light !== 'transparent'}<rect x="0" y="0" width={total} height={total} fill={light} rx="2" />{/if}
		{#if path}<path d={path} fill={dark} />{/if}
	</svg>
	{#if badge !== 'none' && modules > 0}
		<div
			class="absolute inset-0 grid place-items-center"
			style="pointer-events: none;"
		>
			<span
				class="grid place-items-center rounded-full shadow-md ring-4 ring-white"
				style="width: {size * 0.2}px; height: {size * 0.2}px; background: {badgeColor ??
					badgeTint[badge]}; color: white;"
			>
				<Icon name={badgeIcon[badge]} size={String(size * 0.1)} class="text-white" />
			</span>
		</div>
	{/if}
</div>
