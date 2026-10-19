<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { t } from '$lib/i18n/i18n.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { session } from '$nostr/session.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { relays } from '$nostr/relay.svelte';
	import { bootstrapAuth } from '$nostr/auth-bootstrap';
	import { resolveWorkspace } from '$nostr/workspace.svelte';
	import { memberships } from '$nostr/memberships.svelte';

	type StepStatus = 'pending' | 'active' | 'done';
	interface Step {
		key: string;
		label: string;
		icon: string;
		status: StepStatus;
	}

	/**
	 * resolving → automatic bootstrap in flight
	 * choose    → bootstrap could not confirm a workspace; let the user decide
	 * syncing   → user asked to restore an existing workspace from relays
	 * notfound  → restore ran but nothing was found
	 */
	type Mode = 'resolving' | 'choose' | 'syncing' | 'notfound';

	let mode = $state<Mode>('resolving');
	let waitingWorkspace = $state(false);
	let percentage = $state(0);
	let steps = $state<Step[]>([
		{ key: 'connecting', label: 'Connecting to relays', icon: 'lucide:wifi', status: 'pending' },
		{
			key: 'syncing',
			label: 'Syncing workspace data',
			icon: 'lucide:refresh-cw',
			status: 'pending'
		},
		{
			key: 'workspace',
			label: 'Resolving workspace',
			icon: 'lucide:building-2',
			status: 'pending'
		},
		{
			key: 'redirecting',
			label: 'Opening dashboard',
			icon: 'lucide:arrow-right-circle',
			status: 'pending'
		}
	]);
	let hasError = $state(false);
	let errorMessage = $state('');
	let timer: ReturnType<typeof setTimeout> | undefined;

	function sleep(ms: number) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	function resetSteps() {
		percentage = 0;
		hasError = false;
		errorMessage = '';
		steps = steps.map((s) => ({ ...s, status: 'pending' }));
	}

	function updateStep(key: string, pct: number) {
		percentage = Math.min(pct, 100);
		const idx = steps.findIndex((s) => s.key === key);
		steps = steps.map((s, i) => ({
			...s,
			status: i < idx ? 'done' : i === idx ? 'active' : 'pending'
		}));
	}

	function markAllDone() {
		percentage = 100;
		steps = steps.map((s) => ({ ...s, status: 'done' }));
	}

	function finish(access: 'ready' | 'blocked') {
		if (access === 'blocked') {
			void goto(resolve('/blocked'), { replaceState: true });
			return;
		}
		void goto(resolve('/'), { replaceState: true });
	}

	async function exitToDashboard() {
		updateStep('redirecting', 95);
		await sleep(300);
		markAllDone();
		timer = setTimeout(() => finish('ready'), 500);
	}

	async function runAutoResolve() {
		mode = 'resolving';
		resetSteps();
		updateStep('connecting', 25);

		updateStep('syncing', 50);
		let result: Awaited<ReturnType<typeof bootstrapAuth>>;
		try {
			result = await bootstrapAuth();
		} catch (e) {
			hasError = true;
			errorMessage = e instanceof Error ? e.message : t('resolve.notFoundDesc');
			mode = 'notfound';
			return;
		}

		updateStep('workspace', 75);

		if (result.access === 'ready') {
			await exitToDashboard();
			return;
		}
		if (result.access === 'blocked') {
			finish('blocked');
			return;
		}
		// 'setup' or 'waiting-workspace' → never silently drop the user into a
		// fresh wizard. Offer the explicit restore-vs-new choice instead.
		waitingWorkspace = result.access === 'waiting-workspace';
		mode = 'choose';
	}

	onMount(async () => {
		session.load();
		tenant.load();
		relays.load();

		if (!session.isAuthenticated) {
			await goto(resolve('/login'), { replaceState: true });
			return;
		}

		await runAutoResolve();
	});

	onDestroy(() => {
		if (timer) clearTimeout(timer);
	});

	/** Restore an existing workspace (company + branch + data) from relays. */
	async function syncExisting() {
		mode = 'syncing';
		resetSteps();
		updateStep('connecting', 25);
		updateStep('syncing', 50);

		try {
			const workspace = await resolveWorkspace({ allowRelaySync: true });
			const staffWorkspace = workspace.found ? false : await memberships.resolveStaffWorkspace();
			if (workspace.found) await memberships.resolve();
			memberships.autoResolve();

			updateStep('workspace', 75);

			if (workspace.found || staffWorkspace || tenant.state.setupComplete) {
				await exitToDashboard();
				return;
			}
		} catch (e) {
			hasError = true;
			errorMessage = e instanceof Error ? e.message : t('resolve.notFoundDesc');
		}

		mode = 'notfound';
	}

	function startNewSetup() {
		// The user already picked "new" here — go straight to the wizard's first
		// step instead of the /setup welcome choice.
		void goto(resolve('/setup/identity'), { replaceState: true });
	}

	function retry() {
		window.location.reload();
	}

	function continueOffline() {
		const target = memberships.myStaffRecords.length > 0 ? '/login' : '/setup';
		void goto(resolve(target), { replaceState: true });
	}
</script>

<svelte:head><title>{t('common.appName')} · {t('resolve.title')}</title></svelte:head>

<div class="flex min-h-screen items-center justify-center px-4">
	<div class="w-full max-w-md space-y-6">
		{#if mode === 'choose'}
			<div class="text-center">
				<div class="mx-auto mb-4 grid size-16 place-items-center rounded-2xl bg-primary-500/10">
					<Icon name="lucide:layers" class="size-8 text-primary-500" />
				</div>
				<h1 class="font-display text-xl font-bold tracking-tight">{t('resolve.chooseTitle')}</h1>
				<p class="mt-1 text-[12.5px] text-(--ui-text-muted)">
					{waitingWorkspace ? t('resolve.waitingNote') : t('resolve.chooseDesc')}
				</p>
			</div>

			<div class="surface-card divide-y divide-(--ui-border-muted) overflow-hidden">
				<button
					type="button"
					onclick={syncExisting}
					class="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-(--ui-bg-muted)"
				>
					<span
						class="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-500/10 text-primary-500"
					>
						<Icon name="lucide:refresh-cw" class="size-5" />
					</span>
					<span class="min-w-0 flex-1">
						<span class="block text-[13.5px] font-semibold text-(--ui-text)"
							>{t('resolve.syncTitle')}</span
						>
						<span class="mt-0.5 block text-[11.5px] text-(--ui-text-muted)"
							>{t('resolve.syncDesc')}</span
						>
					</span>
					<Icon name="lucide:chevron-right" class="size-4 shrink-0 text-(--ui-text-dimmed)" />
				</button>

				<button
					type="button"
					onclick={startNewSetup}
					class="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-(--ui-bg-muted)"
				>
					<span
						class="grid size-10 shrink-0 place-items-center rounded-xl bg-(--ui-bg-accented) text-(--ui-text-muted)"
					>
						<Icon name="lucide:sparkles" class="size-5" />
					</span>
					<span class="min-w-0 flex-1">
						<span class="block text-[13.5px] font-semibold text-(--ui-text)"
							>{t('resolve.newTitle')}</span
						>
						<span class="mt-0.5 block text-[11.5px] text-(--ui-text-muted)"
							>{t('resolve.newDesc')}</span
						>
					</span>
					<Icon name="lucide:chevron-right" class="size-4 shrink-0 text-(--ui-text-dimmed)" />
				</button>
			</div>
		{:else if mode === 'notfound'}
			<div class="text-center">
				<div
					class="mx-auto mb-4 grid size-16 place-items-center rounded-2xl bg-(--tone-warning-bg)"
				>
					<Icon name="lucide:cloud-off" class="size-8 text-(--tone-warning-text)" />
				</div>
				<h1 class="font-display text-xl font-bold tracking-tight">{t('resolve.notFoundTitle')}</h1>
				<p class="mt-1 text-[12.5px] text-(--ui-text-muted)">
					{hasError && errorMessage ? errorMessage : t('resolve.notFoundDesc')}
				</p>
			</div>

			<div class="flex flex-col gap-2">
				<button
					type="button"
					onclick={syncExisting}
					class="rounded-lg bg-primary-500 px-4 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-primary-400"
				>
					{t('resolve.tryAgain')}
				</button>
				<button
					type="button"
					onclick={startNewSetup}
					class="rounded-lg border border-(--ui-border) px-4 py-2.5 text-[13px] font-semibold text-(--ui-text) transition-colors hover:bg-(--ui-bg-muted)"
				>
					{t('resolve.newTitle')}
				</button>
				<button
					type="button"
					onclick={continueOffline}
					class="rounded-lg px-4 py-2 text-[12.5px] font-semibold text-(--ui-text-muted) transition-colors hover:bg-(--ui-bg-muted)"
				>
					{t('resolve.continueOffline')}
				</button>
			</div>
		{:else}
			<div class="text-center">
				<div class="mx-auto mb-4 grid size-16 place-items-center rounded-2xl bg-primary-500/10">
					{#if hasError}
						<Icon name="lucide:cloud-off" class="size-8 text-(--tone-warning-text)" />
					{:else if percentage >= 100}
						<Icon name="lucide:circle-check" class="size-8 text-primary-500" />
					{:else}
						<Icon name="lucide:loader" class="size-8 animate-spin text-primary-500" />
					{/if}
				</div>
				<h1 class="font-display text-xl font-bold tracking-tight">
					{#if hasError}Connection issue{:else if percentage >= 100}All set!{:else if mode === 'syncing'}{t(
							'resolve.syncingTitle'
						)}{:else}Setting up your workspace{/if}
				</h1>
				<p class="mt-1 text-[12.5px] text-(--ui-text-muted)">
					{#if hasError}{errorMessage}{:else if percentage >= 100}Redirecting...{:else if mode === 'syncing'}{t(
							'resolve.syncingDesc'
						)}{:else}Resolving your identity and workspace data{/if}
				</p>
			</div>

			<div class="surface-card divide-y divide-(--ui-border-muted)">
				{#each steps as s (s.key)}
					<div class="flex items-center gap-3 px-5 py-3.5">
						<div
							class="grid size-8 shrink-0 place-items-center rounded-full transition-colors {s.status ===
							'done'
								? 'bg-primary-500 text-white'
								: s.status === 'active'
									? 'bg-primary-500/15 text-primary-500'
									: 'bg-(--ui-bg-muted) text-(--ui-text-dimmed)'}"
						>
							{#if s.status === 'active'}<Icon
									name="lucide:loader"
									class="size-4 animate-spin"
								/>{:else if s.status === 'done'}<Icon
									name="lucide:check"
									class="size-4"
								/>{:else}<Icon name={s.icon} class="size-4" />{/if}
						</div>
						<span
							class="text-[13px] font-semibold {s.status === 'pending'
								? 'text-(--ui-text-dimmed)'
								: 'text-(--ui-text)'}">{s.label}</span
						>
					</div>
				{/each}
			</div>

			<div class="h-2 overflow-hidden rounded-full bg-(--ui-bg-muted)">
				<div
					class="h-full rounded-full bg-primary-500 transition-all duration-500"
					style="width: {percentage}%"
				></div>
			</div>

			{#if hasError}
				<div class="flex gap-2">
					<button
						type="button"
						onclick={retry}
						class="flex-1 rounded-lg bg-primary-500 px-4 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-primary-400"
						>{t('common.retry')}</button
					>
					<button
						type="button"
						onclick={continueOffline}
						class="flex-1 rounded-lg border border-(--ui-border) px-4 py-2.5 text-[13px] font-semibold text-(--ui-text-muted) transition-colors hover:bg-(--ui-bg-muted)"
						>{t('resolve.continueOffline')}</button
					>
				</div>
			{/if}
		{/if}
	</div>
</div>
