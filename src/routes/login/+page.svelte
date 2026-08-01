<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { fly } from 'svelte/transition';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import { session, hasNip07Extension } from '$nostr/session.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { toast } from '$lib/stores/toast.svelte';

	let nsec = $state('');
	let showKey = $state(false);
	let loading = $state(false);
	let loadingExt = $state(false);
	let hasExtension = $state(false);

	// Create-account flow (bdgo-os: generate → backup → continue)
	let view = $state<'login' | 'create'>('login');
	let generated = $state<{ nsec: string; npub: string } | null>(null);
	let backedUp = $state(false);
	let copied = $state(false);

	onMount(() => {
		session.load();
		tenant.load();
		hasExtension = hasNip07Extension();
		// Already signed in? Route onward.
		if (session.isAuthenticated) routeAfterLogin();
	});

	function routeAfterLogin() {
		void goto(tenant.state.setupComplete ? '/' : '/setup', { replaceState: true });
	}

	async function handleExtension() {
		loadingExt = true;
		try {
			await session.loginWithExtension();
			toast.success('Signed in', 'Connected via Nostr extension.');
			routeAfterLogin();
		} catch (e) {
			toast.error('Extension sign-in failed', e instanceof Error ? e.message : undefined);
		} finally {
			loadingExt = false;
		}
	}

	function handleNsec() {
		loading = true;
		try {
			session.loginWithNsec(nsec.trim());
			toast.success('Signed in', 'Nostr identity loaded.');
			nsec = '';
			routeAfterLogin();
		} catch (e) {
			toast.error('Invalid private key', 'Enter a valid nsec… or hex private key.');
		} finally {
			loading = false;
		}
	}

	function handleCreate() {
		try {
			generated = session.generateAccount();
			backedUp = false;
			view = 'create';
			toast.success('New identity generated', 'Back up your key below.');
		} catch (e) {
			toast.error('Could not generate account', e instanceof Error ? e.message : undefined);
		}
	}

	async function copyNsec() {
		if (!generated) return;
		try {
			await navigator.clipboard.writeText(generated.nsec);
			copied = true;
			toast.success('Copied to clipboard');
			setTimeout(() => (copied = false), 2000);
		} catch {
			toast.warning('Copy failed', 'Select and copy the key manually.');
		}
	}

	function confirmCreate() {
		if (!generated) return;
		session.loginWithNsec(generated.nsec);
		toast.success('Welcome to bdGo OS', 'Your new Nostr identity is ready.');
		generated = null;
		view = 'login';
		routeAfterLogin();
	}
</script>

<div
	class="relative flex min-h-screen items-center justify-center overflow-hidden p-4"
>
	<!-- ambient backdrop -->
	<div class="pointer-events-none absolute inset-0 overflow-hidden">
		<div class="absolute -top-40 -right-40 size-80 rounded-full bg-primary-500/5 blur-3xl"></div>
		<div class="absolute -bottom-40 -left-40 size-80 rounded-full bg-cyan-accent/5 blur-3xl"></div>
	</div>

	<div class="relative z-10 w-full max-w-sm">
		<!-- Brand -->
		<div class="mb-8 text-center" in:fly={{ y: 8, duration: 300 }}>
			<div
				class="mx-auto mb-5 grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-primary-400 to-primary-600 shadow-lg shadow-primary-500/25 ring-4 ring-[var(--ui-bg-elevated)]"
			>
				<Icon name="lucide:zap" class="size-7 text-white" />
			</div>
			<h1 class="font-display text-2xl font-bold tracking-tight">Welcome back</h1>
			<p class="mt-1.5 text-sm text-[var(--ui-text-muted)]">Sign in to bdGo OS with your Nostr identity</p>
		</div>

		<!-- Card -->
		<div
			in:fly={{ y: 12, duration: 300, delay: 80 }}
			class="surface-card overflow-hidden"
		>
			{#if view === 'login'}
			<div class="space-y-5 p-6 sm:p-7">
				<!-- NIP-07 extension -->
				<div class="space-y-3">
					<Button color="primary" block size="lg" disabled={loadingExt || !hasExtension} onclick={handleExtension}>
						{#if loadingExt}
							<Icon name="lucide:loader-circle" class="size-4 animate-spin" />
							Connecting…
						{:else}
							<Icon name="lucide:puzzle" class="size-4" />
							Continue with extension
						{/if}
					</Button>
					{#if !hasExtension}
						<p class="flex items-center justify-center gap-1.5 text-center text-xs text-[var(--tone-warning-text)]">
							<Icon name="lucide:info" class="size-3.5 shrink-0" />
							No extension detected —
							<a href="https://getalby.com" target="_blank" rel="noopener" class="font-semibold underline">
								install Alby</a
							>
						</p>
					{/if}
				</div>

				<div class="flex items-center gap-3">
					<div class="h-px flex-1 bg-[var(--ui-border)]"></div>
					<span class="text-[10px] font-semibold uppercase tracking-wider text-[var(--ui-text-dimmed)]">
						or
					</span>
					<div class="h-px flex-1 bg-[var(--ui-border)]"></div>
				</div>

				<!-- nsec -->
				<form class="space-y-3" onsubmit={(e) => (e.preventDefault(), handleNsec())}>
					<label class="block">
						<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
							>Private key (nsec)</span
						>
						<Input
							bind:value={nsec}
							icon="lucide:key-round"
							type={showKey ? 'text' : 'password'}
							placeholder="nsec1…"
							autocomplete="off"
							class="w-full"
						>
							{#snippet trailing()}
								<button
									type="button"
									class="grid size-5 place-items-center rounded text-[var(--ui-text-dimmed)] hover:text-[var(--ui-text)]"
									onclick={() => (showKey = !showKey)}
									aria-label="Toggle key visibility"
								>
									<Icon name={showKey ? 'lucide:eye-off' : 'lucide:eye'} class="size-3.5" />
								</button>
							{/snippet}
						</Input>
					</label>
					<Button type="submit" color="neutral" variant="subtle" block disabled={loading || !nsec.trim()}>
						{#if loading}
							<Icon name="lucide:loader-circle" class="size-4 animate-spin" />
						{:else}
							<Icon name="lucide:log-in" class="size-4" />
						{/if}
						Sign in with private key
					</Button>
				</form>
			</div>

			<!-- New to Nostr → Create account -->
			<div
				class="flex items-center justify-between gap-3 border-t border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-6 py-4 sm:px-7"
			>
				<div class="min-w-0">
					<p class="text-[12.5px] font-semibold text-[var(--ui-text)]">New to Nostr?</p>
					<p class="mt-0.5 text-[11.5px] text-[var(--ui-text-muted)]">
						Generate a fresh identity in one tap.
					</p>
				</div>
				<Button color="primary" variant="soft" size="sm" icon="lucide:user-plus" onclick={handleCreate}>
					Create account
				</Button>
			</div>
			{:else}
			<!-- Create / backup view -->
			<div class="space-y-5 p-6 sm:p-7">
				<div class="flex items-center gap-3">
					<div
						class="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--tone-warning-bg)] text-[var(--tone-warning-text)]"
					>
						<Icon name="lucide:triangle-alert" class="size-5" />
					</div>
					<div>
						<h2 class="font-display text-[15px] font-semibold tracking-tight">Back up your secret key</h2>
						<p class="mt-0.5 text-[12px] text-[var(--ui-text-muted)]">
							This is the <strong>only</strong> time we can show your <code>nsec</code>. Store it somewhere safe — it
							controls your account and cannot be recovered.
						</p>
					</div>
				</div>

				<label class="block">
					<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Public key (npub)</span>
					<Input value={generated?.npub ?? ''} icon="lucide:user" readonly class="w-full font-mono text-[11.5px]" />
				</label>

				<label class="block">
					<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Secret key (nsec)</span>
					<Input
						value={generated?.nsec ?? ''}
						icon="lucide:key-round"
						readonly
						class="w-full font-mono text-[11.5px]"
					>
						{#snippet trailing()}
							<button
								type="button"
								onclick={copyNsec}
								class="inline-flex items-center gap-1 rounded-md bg-primary-500/10 px-2 py-1 text-[11px] font-semibold text-primary-600 hover:bg-primary-500/15 dark:text-primary-400"
							>
								<Icon name={copied ? 'lucide:check' : 'lucide:clipboard-copy'} class="size-3.5" />
								{copied ? 'Copied' : 'Copy'}
							</button>
						{/snippet}
					</Input>
				</label>

				<label class="flex cursor-pointer items-start gap-2.5">
					<input
						type="checkbox"
						bind:checked={backedUp}
						class="mt-0.5 size-4 rounded border-[var(--ui-border-accented)] accent-[var(--ui-color-primary-500)]"
					/>
					<span class="text-[12px] text-[var(--ui-text-muted)]">
						I’ve saved my key somewhere safe. I understand it can’t be reset.
					</span>
				</label>

				<Button color="primary" block size="lg" disabled={!backedUp} onclick={confirmCreate}>
					<Icon name="lucide:rocket" class="size-4" />
					Continue to setup
				</Button>
				<button
					type="button"
					onclick={() => (view = 'login')}
					class="w-full text-center text-[12px] font-semibold text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]"
				>
					← Back to sign in
				</button>
			</div>
			{/if}
		</div>

		<p class="mt-6 text-center text-[11.5px] text-[var(--ui-text-dimmed)]">
			Your key never leaves this device. Records are signed locally and published to Nostr relays.
		</p>
	</div>
</div>
