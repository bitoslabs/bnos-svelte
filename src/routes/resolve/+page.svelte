<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { session } from '$nostr/session.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { relays } from '$nostr/relay.svelte';
	import { warmRelays } from '$nostr/client';

	type StepStatus = 'pending' | 'active' | 'done';
	interface Step { key: string; label: string; icon: string; status: StepStatus; }

	let percentage = $state(0);
	let steps = $state<Step[]>([
		{ key: 'connecting', label: 'Connecting to relays', icon: 'lucide:wifi', status: 'pending' },
		{ key: 'syncing', label: 'Syncing workspace data', icon: 'lucide:refresh-cw', status: 'pending' },
		{ key: 'workspace', label: 'Resolving workspace', icon: 'lucide:building-2', status: 'pending' },
		{ key: 'redirecting', label: 'Opening dashboard', icon: 'lucide:arrow-right-circle', status: 'pending' }
	]);
	let hasError = $state(false);
	let errorMessage = $state('');
	let timer: ReturnType<typeof setTimeout> | undefined;

	function updateStep(key: string, pct: number) {
		percentage = Math.min(pct, 100);
		const idx = steps.findIndex((s) => s.key === key);
		steps = steps.map((s, i) => ({ ...s, status: i < idx ? 'done' : i === idx ? 'active' : 'pending' }));
	}

	function markAllDone() {
		percentage = 100;
		steps = steps.map((s) => ({ ...s, status: 'done' }));
	}

	onMount(async () => {
		if (!session.isAuthenticated) {
			await goto('/login', { replaceState: true });
			return;
		}

		updateStep('connecting', 25);
		try {
			await warmRelays();
			relays.load();
		} catch (e) {
			hasError = true;
			errorMessage = 'Could not connect to relays. You can continue in offline mode.';
		}

		updateStep('syncing', 50);
		try {
			// Give stores time to hydrate
			await new Promise((r) => setTimeout(r, 600));
			tenant.load();
		} catch { /* */ }

		updateStep('workspace', 75);
		await new Promise((r) => setTimeout(r, 400));

		updateStep('redirecting', 95);
		await new Promise((r) => setTimeout(r, 300));

		markAllDone();
		timer = setTimeout(() => {
			goto(tenant.state.setupComplete ? '/' : '/setup', { replaceState: true });
		}, 500);
	});

	onDestroy(() => { if (timer) clearTimeout(timer); });

	function retry() {
		hasError = false;
		errorMessage = '';
		percentage = 0;
		steps = steps.map((s) => ({ ...s, status: 'pending' }));
		// Re-trigger by reloading
		window.location.reload();
	}
	function continueOffline() { goto('/', { replaceState: true }); }
</script>

<svelte:head><title>Resolving · BNOS</title></svelte:head>

<div class="flex min-h-screen items-center justify-center px-4">
	<div class="w-full max-w-md space-y-6">
		<div class="text-center">
			<div class="mx-auto mb-4 grid size-16 place-items-center rounded-2xl bg-primary-500/10">
				{#if hasError}
					<Icon name="lucide:cloud-off" class="size-8 text-[var(--tone-warning-text)]" />
				{:else if percentage >= 100}
					<Icon name="lucide:circle-check" class="size-8 text-primary-500" />
				{:else}
					<Icon name="lucide:loader" class="size-8 animate-spin text-primary-500" />
				{/if}
			</div>
			<h1 class="font-display text-xl font-bold tracking-tight">
				{#if hasError}Connection issue{:else if percentage >= 100}All set!{:else}Setting up your workspace{/if}
			</h1>
			<p class="mt-1 text-[12.5px] text-[var(--ui-text-muted)]">
				{#if hasError}{errorMessage}{:else if percentage >= 100}Redirecting…{:else}Resolving your identity and workspace data{/if}
			</p>
		</div>

		<!-- Progress steps -->
		<div class="surface-card divide-y divide-[var(--ui-border-muted)]">
			{#each steps as s (s.key)}
				<div class="flex items-center gap-3 px-5 py-3.5">
					<div class="grid size-8 shrink-0 place-items-center rounded-full transition-colors {s.status === 'done' ? 'bg-primary-500 text-white' : s.status === 'active' ? 'bg-primary-500/15 text-primary-500' : 'bg-[var(--ui-bg-muted)] text-[var(--ui-text-dimmed)]'}">
						{#if s.status === 'active'}<Icon name="lucide:loader" class="size-4 animate-spin" />{:else if s.status === 'done'}<Icon name="lucide:check" class="size-4" />{:else}<Icon name={s.icon} class="size-4" />{/if}
					</div>
					<span class="text-[13px] font-semibold {s.status === 'pending' ? 'text-[var(--ui-text-dimmed)]' : 'text-[var(--ui-text)]'}">{s.label}</span>
				</div>
			{/each}
		</div>

		<!-- Progress bar -->
		<div class="h-2 overflow-hidden rounded-full bg-[var(--ui-bg-muted)]">
			<div class="h-full rounded-full bg-primary-500 transition-all duration-500" style="width: {percentage}%"></div>
		</div>

		{#if hasError}
			<div class="flex gap-2">
				<button type="button" onclick={retry} class="flex-1 rounded-lg bg-primary-500 px-4 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-primary-400">Retry</button>
				<button type="button" onclick={continueOffline} class="flex-1 rounded-lg border border-[var(--ui-border)] px-4 py-2.5 text-[13px] font-semibold text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--ui-bg-muted)]">Continue offline</button>
			</div>
		{/if}
	</div>
</div>
