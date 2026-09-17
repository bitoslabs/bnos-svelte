<script lang="ts">
	import { cn } from '$lib/utils/cn';

	/**
	 * Branded boot/splash screen — logo lockup: hexagon gradient badge with the
	 * BNOS lightning mark (BnosMark bolt language) above the BNOS display-type
	 * wordmark, with sweeping PoW segments in the primary orange to match the
	 * app accent. Used for the brief `session.hydrated` window while local
	 * state hydrates; the static twin in `app.html` covers the pre-JS gap
	 * before this mounts.
	 */
	let {
		status = 'Booting BNOS…',
		class: cls
	}: {
		status?: string;
		class?: string;
	} = $props();
</script>

<div
	class={cn('grid h-screen w-full place-items-center bg-[var(--ui-bg)]', cls)}
	role="status"
	aria-label="Loading BNOS"
>
	<div class="flex flex-col items-center gap-4">
		<!-- Hex badge (regular flat-top hexagon, warm/orange gradient). -->
		<div
			class="hex-clip bs-pulse-soft grid size-[60px] place-items-center bg-[linear-gradient(135deg,#FBBF24,#F97316)] shadow-[0_4px_18px_rgb(249_115_22_/_0.5)]"
			aria-hidden="true"
		>
			<!-- A single perimeter trace gives the mark a compact "system online" moment. -->
			<svg class="bs-boot-orbit" viewBox="0 0 100 100" aria-hidden="true">
				<polygon points="25,6.7 75,6.7 100,50 75,93.3 25,93.3 0,50" />
			</svg>
			<!-- BNOS lightning bolt: fill participates in the draw, flashes in when
			     the trace completes — the reveal moment. -->
			<svg viewBox="0 0 24 24" class="bs-symbol size-[34px]" aria-hidden="true">
				<path class="bs-bolt" d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" fill="#fff" />
				<path class="bs-bolt-trace" pathLength="1" d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
				<!-- Spark comet riding the stroke tip while the bolt draws. -->
				<circle class="bs-spark" r="0.7" fill="#fff" />
			</svg>
		</div>
		<!-- Wordmark: BNOS display type, follows the color mode via --ui-text. -->
		<p class="font-display text-[26px] leading-none font-bold tracking-tight text-[var(--ui-text)]">
			BNOS
		</p>
		<div class="mt-1 flex flex-col items-center gap-2.5">
			<!-- Proof-of-Work segments sweeping while the app initializes. -->
			<div class="pow-bar" aria-hidden="true">
				{#each Array(9) as _, i (i)}
					<span class="pow-boot-seg" style="animation-delay:{i * 0.12}s"></span>
				{/each}
			</div>
			<p class="font-mono text-[11px] text-[var(--ui-text-dimmed)]">{status}</p>
		</div>
	</div>
</div>
