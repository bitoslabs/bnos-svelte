<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { session } from '$nostr/session.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { relays } from '$nostr/relay.svelte';
	import { warmRelays } from '$nostr/client';
	import { resolveWorkspace } from '$nostr/workspace.svelte';
	import { memberships } from '$nostr/memberships.svelte';

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

	function sleep(ms: number) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	function updateStep(key: string, pct: number) {
		percentage = Math.min(pct, 100);
		const idx = steps.findIndex((s) => s.key === key);
		steps = steps.map((s, i) => ({ ...s, status: i < idx ? 'done' : i === idx ? 'active' : 'pending' }));
	}

	function markAllDone() {
		percentage = 100;
		steps = steps.map((s) => ({ ...s, status: 'done' }));
	}

	async function restoreWorkspace() {
		let workspace = await resolveWorkspace({ allowRelaySync: true });
		if (workspace.found) return true;

		await sleep(250);
		if (await memberships.resolveStaffWorkspace()) return true;

		await sleep(600);
		workspace = await resolveWorkspace({ allowRelaySync: true });
		return workspace.found || (await memberships.resolveStaffWorkspace());
	}

	async function resolveRole() {
		await memberships.resolve();
		if (memberships.autoResolve()) return;
		await memberships.bootstrapOwnerIfMissing();
		memberships.autoResolve();
	}

	function finish() {
		const dest = memberships.resolveLoginDestination();
		if (dest === '/blocked') {
			void goto(resolve('/blocked'), { replaceState: true });
			return;
		}
		if (dest === '/staff') {
			void goto(resolve('/staff'), { replaceState: true });
			return;
		}
		void goto(resolve('/'), { replaceState: true });
	}

	onMount(async () => {
		session.load();
		tenant.load();
		relays.load();

		if (!session.isAuthenticated) {
			await goto(resolve('/login'), { replaceState: true });
			return;
		}

		updateStep('connecting', 25);
		try {
			await warmRelays();
		} catch {
			/* best-effort: workspace resolution below handles offline/relay gaps */
		}

		updateStep('syncing', 50);
		try {
			await restoreWorkspace();
		} catch {
			/* local-first fallback: show the unresolved state below */
		}

		updateStep('workspace', 75);
		await resolveRole();

		if (!tenant.state.setupComplete || !tenant.state.organizationId) {
			if (memberships.myStaffRecords.length) {
				hasError = true;
				errorMessage =
					'We found your staff login, but the workspace has not synced from the owner device yet. Bring the owner device online and retry.';
				return;
			}
			updateStep('redirecting', 95);
			await goto(resolve('/setup'), { replaceState: true });
			return;
		}

		updateStep('redirecting', 95);
		await sleep(300);
		markAllDone();
		timer = setTimeout(finish, 500);
	});

	onDestroy(() => { if (timer) clearTimeout(timer); });

	function retry() {
		hasError = false;
		errorMessage = '';
		percentage = 0;
		steps = steps.map((s) => ({ ...s, status: 'pending' }));
		window.location.reload();
	}

	function continueOffline() {
		const target = memberships.myStaffRecords.length > 0 ? '/login' : '/setup';
		void goto(resolve(target), { replaceState: true });
	}
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
				{#if hasError}{errorMessage}{:else if percentage >= 100}Redirecting...{:else}Resolving your identity and workspace data{/if}
			</p>
		</div>

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
