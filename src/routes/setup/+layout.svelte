<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { setupSteps, stepIndex } from './steps';
	import { relays } from '$nostr/relay.svelte';
	import { session } from '$nostr/session.svelte';
	import { tenant } from '$nostr/tenant.svelte';

	let { children } = $props();

	onMount(() => {
		session.load();
		tenant.load();
	});

	// Guard: setup requires a session.
	$effect(() => {
		if (session.hydrated && !session.isAuthenticated) {
			void goto(resolve('/login'), { replaceState: true });
		}
	});

	const currentSlug = $derived(
		(page.url.pathname.split('/setup/')[1] ?? 'identity') as (typeof setupSteps)[number]['slug']
	);
	const idx = $derived(stepIndex(currentSlug));
	const progress = $derived(((idx + 1) / setupSteps.length) * 100);
	const currentStep = $derived(setupSteps[idx]);
	const isDone = $derived(currentSlug === 'done');
	const isOptionalStep = $derived(currentSlug === 'catalog');
	const blockedReason = $derived.by(() => {
		if (currentSlug === 'identity' && !session.isAuthenticated) return 'Sign in before continuing.';
		if (currentSlug === 'company' && !tenant.state.organizationName.trim())
			return 'Add your company name first.';
		if (currentSlug === 'branch' && !tenant.state.locationName.trim())
			return 'Name your primary branch first.';
		if (currentSlug === 'relays' && relays.activeRelays.length === 0)
			return 'Keep at least one relay switched on.';
		return '';
	});
	const canProceed = $derived(!blockedReason && idx >= 0 && idx < setupSteps.length - 1);
	const nextLabel = $derived(currentSlug === 'catalog' ? 'Review setup' : 'Next');

	async function go(delta: number) {
		if (delta > 0 && blockedReason) {
			toast.warning('Setup step incomplete', blockedReason);
			return;
		}
		const next = setupSteps[idx + delta];
		if (next) await goto(resolve(`/setup/${next.slug}`));
	}
</script>

<div class="mx-auto flex h-dvh w-full max-w-5xl flex-col overflow-hidden px-4 py-5 sm:px-6 lg:py-8">
	<!-- Header -->
	<header class="mb-6 flex items-center justify-between">
		<a href={resolve('/')} class="flex items-center gap-2.5">
			<div
				class="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-primary-400 to-primary-600"
			>
				<Icon name="lucide:zap" class="size-5 text-white" />
			</div>
			<span class="font-display text-lg font-bold tracking-tight">BNOS</span>
		</a>
		<span class="text-[11px] font-semibold tracking-wider text-[var(--ui-text-dimmed)] uppercase">
			Setup · step {idx + 1} of {setupSteps.length}
		</span>
	</header>

	<!-- Progress bar -->
	<div class="mb-8 space-y-2">
		<div class="flex items-end justify-between gap-4">
			<div>
				<div
					class="text-[11px] font-semibold tracking-wider text-[var(--ui-text-dimmed)] uppercase"
				>
					{currentStep?.label}
				</div>
				<div class="text-[13px] text-[var(--ui-text-muted)]">{currentStep?.description}</div>
			</div>
			<div class="text-[12px] font-semibold text-[var(--ui-text-muted)]">
				{Math.round(progress)}%
			</div>
		</div>
		<div class="h-1.5 w-full overflow-hidden rounded-full bg-[var(--ui-bg-accented)]">
			<div
				class="h-full rounded-full bg-primary-500 transition-all duration-500"
				style="width: {progress}%"
			></div>
		</div>
	</div>

	<div class="flex min-h-0 flex-1 gap-8">
		<!-- Stepper rail -->
		<aside class="hidden w-56 shrink-0 overflow-y-auto pb-4 md:block">
			<ol class="sticky top-0 flex flex-col gap-1">
				{#each setupSteps as step, i (step.slug)}
					{@const done = i < idx}
					{@const active = i === idx}
					<li>
						<div
							class="flex items-center gap-3 rounded-lg px-3 py-2 {active
								? 'is-active-surface'
								: done
									? 'text-[var(--ui-text-muted)]'
									: 'text-[var(--ui-text-dimmed)]'}"
						>
							<span
								class="grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-bold {active
									? 'bg-primary-500 text-white'
									: done
										? 'bg-primary-500/15 text-primary-600 dark:text-primary-400'
										: 'bg-[var(--ui-bg-accented)]'}"
							>
								{#if done}<Icon name="lucide:check" class="size-3.5" />{:else}{i + 1}{/if}
							</span>
							<span class="text-[13px] font-semibold">{step.label}</span>
						</div>
					</li>
				{/each}
			</ol>
		</aside>

		<!-- Step content -->
		<div class="flex min-w-0 flex-1 flex-col overflow-hidden">
			<div class="min-h-0 flex-1 overflow-y-auto pb-4 md:pr-1">
				<div class="surface-card animate-rise p-6 sm:p-8">
					{@render children()}
				</div>
			</div>

			{#if !isDone}
				<!-- Nav buttons -->
				<div
					class="sticky bottom-0 z-10 flex shrink-0 flex-col gap-3 border-t border-[var(--ui-border-muted)] bg-[var(--ui-bg)] pt-4 pb-1 sm:flex-row sm:items-center sm:justify-between"
				>
					<button
						type="button"
						class="inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-semibold text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)] disabled:opacity-40"
						onclick={() => go(-1)}
						disabled={idx <= 0}
					>
						<Icon name="lucide:arrow-left" class="size-4" /> Back
					</button>
					<div class="flex flex-col items-stretch gap-2 sm:items-end">
						{#if blockedReason}
							<div class="flex items-center gap-1.5 text-[12px] text-[var(--tone-error-text)]">
								<Icon name="lucide:circle-alert" class="size-3.5" />
								{blockedReason}
							</div>
						{:else if isOptionalStep}
							<div class="text-[12px] text-[var(--ui-text-dimmed)]">Samples are optional.</div>
						{/if}
						<button
							type="button"
							class="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary-500 px-4 py-2 text-[13px] font-semibold text-white hover:bg-primary-400 disabled:opacity-40"
							onclick={() => go(1)}
							disabled={!canProceed}
						>
							{nextLabel}
							<Icon name="lucide:arrow-right" class="size-4" />
						</button>
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>
