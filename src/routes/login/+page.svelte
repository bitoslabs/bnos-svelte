<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { fly } from 'svelte/transition';
	import Icon from '$lib/components/ui/Icon.svelte';
	import BnosMark from '$lib/components/BnosMark.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Checkbox from '$lib/components/ui/Checkbox.svelte';
	import RelayStatusPopover from '$lib/components/RelayStatusPopover.svelte';
	import { session, hasNip07Extension } from '$nostr/session.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { relays } from '$nostr/relay.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { setMode, mode } from 'mode-watcher';
	import { site } from '$lib/site';
	import { t, i18n } from '$lib/i18n/i18n.svelte';

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
		relays.load();
		hasExtension = hasNip07Extension();
		i18n.init();
		if (session.isAuthenticated) {
			routeAfterLogin();
		}
	});

	function routeAfterLogin(destination = '/') {
		void goto(destination, { replaceState: true });
	}

	async function handleExtension() {
		loadingExt = true;
		try {
			await session.loginWithExtension();
			toast.success(t('common.signIn'), t('auth.connectingExt'));
			routeAfterLogin();
		} catch (e) {
			toast.error(t('auth.extensionNotFound'), e instanceof Error ? e.message : undefined);
		} finally {
			loadingExt = false;
		}
	}

	function handleNsec() {
		loading = true;
		try {
			session.loginWithNsec(nsec.trim());
			toast.success(t('common.signIn'), t('auth.signInNostr'));
			nsec = '';
			routeAfterLogin();
		} catch (e) {
			toast.error(t('auth.invalidKey'), t('auth.invalidKeyMsg'));
		} finally {
			loading = false;
		}
	}

	function handleCreate() {
		try {
			generated = session.generateAccount();
			backedUp = false;
			view = 'create';
			toast.success(t('auth.createAccount'), t('auth.newIdentityGen'));
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
		toast.success(t('auth.welcome'), t('auth.newIdentityReady'));
		generated = null;
		view = 'login';
		routeAfterLogin('/setup/identity');
	}
</script>

<div class="relative flex min-h-dvh items-center justify-center overflow-hidden p-4">
	<!-- ambient backdrop -->
	<div class="pointer-events-none absolute inset-0 overflow-hidden">
		<div class="absolute -top-40 -right-40 size-96 rounded-full bg-primary-500/10 blur-3xl"></div>
		<div class="absolute top-1/3 -left-40 size-80 rounded-full bg-cyan-accent/10 blur-3xl"></div>
		<div class="absolute -bottom-40 right-1/4 size-96 rounded-full bg-primary-500/5 blur-3xl"></div>
	</div>

	<!-- Top-right: theme + relay status -->
	<div class="absolute right-4 top-4 z-20 flex items-center gap-1.5">
		<button
			type="button"
			onclick={() => setMode(mode.current === 'dark' ? 'light' : 'dark')}
			class="grid size-9 place-items-center rounded-lg text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]"
			aria-label={t('common.toggleTheme')}
			title={t('common.toggleTheme')}
		>
			<Icon name={mode.current === 'dark' ? 'lucide:sun' : 'lucide:moon'} class="size-[18px]" />
		</button>

		<RelayStatusPopover />
	</div>

	<div class="relative z-10 w-full max-w-sm">
		<!-- Brand -->
		<div class="mb-8 text-center" in:fly={{ y: 8, duration: 300 }}>
			<div
				class="mx-auto mb-5 grid size-14 place-items-center "
			>
				<BnosMark class="size-12 text-primary-500" />
			</div>
			<h1 class="font-display text-2xl font-bold tracking-tight">{t('auth.welcomeBack')}</h1>
			<p class="mt-1.5 text-sm text-[var(--ui-text-muted)]">{t('auth.signInDesc')}</p>
		</div>

		<!-- Card -->
		<div in:fly={{ y: 12, duration: 300, delay: 80 }} class="surface-card overflow-hidden">
			{#if view === 'login'}
				<div class="space-y-5 p-6 sm:p-7">
					<!-- NIP-07 extension -->
					<div class="space-y-3">
						<Button color="primary" block size="lg" disabled={loadingExt || !hasExtension} onclick={handleExtension}>
							{#if loadingExt}
								<Icon name="lucide:loader-circle" class="size-4 animate-spin" />
								{t('auth.connecting')}
							{:else}
								<Icon name="lucide:puzzle" class="size-4" />
								{t('auth.continueWithExtension')}
							{/if}
						</Button>
						{#if !hasExtension}
							<p class="flex items-center justify-center gap-1.5 text-center text-xs text-[var(--tone-warning-text)]">
								<Icon name="lucide:info" class="size-3.5 shrink-0" />
								{t('auth.noExtension')}
								<a href="https://getalby.com" target="_blank" rel="noopener" class="font-semibold underline">
									{t('auth.installAlby')}</a
								>
							</p>
						{/if}
					</div>

					<div class="flex items-center gap-3">
						<div class="h-px flex-1 bg-[var(--ui-border)]"></div>
						<span class="text-[10px] font-semibold uppercase tracking-wider text-[var(--ui-text-dimmed)]">
							{t('auth.or')}
						</span>
						<div class="h-px flex-1 bg-[var(--ui-border)]"></div>
					</div>

					<!-- nsec -->
					<form class="space-y-3" onsubmit={(e) => (e.preventDefault(), handleNsec())}>
						<label class="block">
							<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
								>{t('auth.privateKey')}</span
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
							{t('auth.signInWithKey')}
						</Button>
					</form>
				</div>

				<!-- New to Nostr → {t('auth.createAccount')} -->
				<div
					class="flex items-center justify-between gap-3 border-t border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-6 py-4 sm:px-7"
				>
					<div class="min-w-0">
						<p class="text-[12.5px] font-semibold text-[var(--ui-text)]">{t('auth.newToNostr')}</p>
						<p class="mt-0.5 text-[11.5px] text-[var(--ui-text-muted)]">
							{t('auth.generateFresh')}
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
							<h2 class="font-display text-[15px] font-semibold tracking-tight">{t('auth.backUpSecretKey')}</h2>
							<p class="mt-0.5 text-[12px] text-[var(--ui-text-muted)]">
								This is the <strong>only</strong> time we can show your <code>nsec</code>. Store it somewhere safe — it
								controls your account and cannot be recovered.
							</p>
						</div>
					</div>

					<label class="block">
						<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">{t('auth.publicKey')}</span>
						<Input value={generated?.npub ?? ''} icon="lucide:user" readonly class="w-full font-mono text-[11.5px]" />
					</label>

					<label class="block">
						<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">{t('auth.secretKey')}</span>
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
									{copied ? t('common.copied') : t('common.copy')}
								</button>
							{/snippet}
						</Input>
					</label>

					<Checkbox
						bind:checked={backedUp}
						label={t('auth.savedKey')}
					/>

					<Button color="primary" block size="lg" disabled={!backedUp} onclick={confirmCreate}>
						<Icon name="lucide:rocket" class="size-4" />
						{t('auth.continueSetup')}
					</Button>
					<button
						type="button"
						onclick={() => (view = 'login')}
						class="w-full text-center text-[12px] font-semibold text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]"
					>
						← {t('auth.backToSignIn')}
					</button>
				</div>
			{/if}
		</div>

		<p class="mt-6 text-center text-[11.5px] text-[var(--ui-text-dimmed)]">
			{t('auth.keyNeverLeaves')}
		</p>

		<!-- Footer links: legal + open source -->
		<div class="mt-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-[11px]">
			<a href={resolve('/legal/privacy')} class="font-medium text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]">{t('legal.privacy')}</a>
			<span class="text-[var(--ui-text-dimmed)]">·</span>
			<a href={resolve('/legal/terms')} class="font-medium text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]">{t('legal.terms')}</a>
			<span class="text-[var(--ui-text-dimmed)]">·</span>
			<a href={resolve('/legal/license')} class="font-medium text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]">{t('legal.license')}</a>
			<span class="text-[var(--ui-text-dimmed)]">·</span>
			<a href={site.source.url} target="_blank" rel="noopener" class="inline-flex items-center gap-1 font-medium text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]">
				<Icon name="lucide:github" class="size-3" />{t('common.source')}
			</a>
			<span class="text-[var(--ui-text-dimmed)]">·</span>
			<a href={site.website.url} target="_blank" rel="noopener" class="inline-flex items-center gap-1 font-medium text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]">
				<Icon name="lucide:globe" class="size-3" />{site.website.label}
			</a>
		</div>
		<p class="mt-2 text-center text-[10.5px] text-[var(--ui-text-dimmed)]">
			© {new Date().getFullYear()} {site.name} contributors · {site.license}
		</p>
	</div>
</div>
