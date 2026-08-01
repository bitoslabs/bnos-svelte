<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Menu from '$lib/components/ui/Menu.svelte';
	import MenuItem from '$lib/components/ui/MenuItem.svelte';
	import MenuDivider from '$lib/components/ui/MenuDivider.svelte';
	import { session, hasNip07Extension } from '$nostr/session.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { truncateNpub, initialsFrom } from '$lib/utils/format';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	onMount(() => session.load());

	const snap = $derived(session.snapshot);
	const hasExt = $derived(hasNip07Extension());

	// ── reveal / copy secrets ──
	let showNsec = $state(false);
	async function copy(text: string, label: string) {
		try {
			await navigator.clipboard.writeText(text);
			toast.success(`${label} copied`);
		} catch {
			toast.error('Copy failed');
		}
	}
	function downloadKey() {
		if (!snap?.nsec) return;
		const blob = new Blob(
			[
				`BNOS Nostr private key\nnpub: ${snap.npub}\nnsec: ${snap.nsec}\n\nKeep this secret. Anyone with it controls your identity.`
			],
			{ type: 'text/plain' }
		);
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `bnos-key-${snap.npub.slice(0, 12)}.txt`;
		a.click();
		URL.revokeObjectURL(url);
		toast.success('Key file downloaded');
	}

	// ── import existing key ──
	let importOpen = $state(false);
	let importKey = $state('');
	function doImport() {
		const k = importKey.trim();
		if (!k) return toast.warning('Paste an nsec or hex key');
		try {
			const s = session.loginWithNsec(k);
			toast.success('Signed in', truncateNpub(s.npub, 10, 6));
			importOpen = false;
			importKey = '';
		} catch (e) {
			toast.error('Invalid key', e instanceof Error ? e.message : undefined);
		}
	}

	// ── create new identity (generate → backup → confirm) ──
	let createOpen = $state(false);
	let pending = $state<{ pubkey: string; npub: string; nsec: string } | null>(null);
	let backedUp = $state(false);
	function startCreate() {
		pending = session.generateAccount();
		backedUp = false;
		createOpen = true;
	}
	function confirmCreate() {
		if (!pending) return;
		if (!backedUp) return toast.warning('Confirm you saved your key');
		session.loginWithNsec(pending.nsec);
		toast.success('New identity created', truncateNpub(pending.npub, 10, 6));
		createOpen = false;
		pending = null;
	}

	// ── connect NIP-07 extension ──
	let connecting = $state(false);
	async function connectExtension() {
		connecting = true;
		try {
			const s = await session.loginWithExtension();
			toast.success('Extension connected', truncateNpub(s.npub, 10, 6));
		} catch (e) {
			toast.error('Extension sign-in failed', e instanceof Error ? e.message : undefined);
		} finally {
			connecting = false;
		}
	}

	async function signOut() {
		session.logout();
		toast.info('Signed out');
		await goto(resolve('/login'));
	}
</script>

<svelte:head><title>Account · Settings</title></svelte:head>

<div class="space-y-5">
	<!-- Identity hero -->
	<section class="surface-card p-5">
		<div class="flex items-center gap-4">
			<div
				class="grid size-14 shrink-0 place-items-center rounded-2xl bg-primary-500/10 font-display text-lg font-bold text-primary-600 dark:text-primary-400"
			>
				{initialsFrom(snap ? truncateNpub(snap.npub, 4, 0) : null, null) || '?'}
			</div>
			<div class="min-w-0 flex-1">
				<h2 class="font-display text-[15px] font-semibold tracking-tight">Nostr identity</h2>
				<div class="truncate font-mono text-[13px] text-[var(--ui-text-muted)]">
					{snap ? truncateNpub(snap.npub, 20, 12) : '—'}
				</div>
				<div class="mt-1 flex items-center gap-2">
					{#if snap?.loginMethod === 'extension'}
						<Badge color="info"
							><Icon name="lucide:puzzle" class="mr-1 size-3" />NIP-07 extension</Badge
						>
					{:else}
						<Badge color="success"><span class="live-dot mr-1.5"></span>Private key</Badge>
					{/if}
				</div>
			</div>
			<Menu
				id="account-hero"
				label="Identity actions"
				triggerClass="grid size-9 place-items-center rounded-lg text-[var(--ui-text-dimmed)] transition-colors hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]"
				triggerActiveClass="bg-[var(--ui-bg-accented)] text-[var(--ui-text)]"
			>
				{#snippet trigger()}<Icon name="lucide:ellipsis-vertical" class="size-4" />{/snippet}
				<MenuItem icon="lucide:copy" onclick={() => snap && copy(snap.npub, 'npub')}
					>Copy npub</MenuItem
				>
				<MenuItem icon="lucide:fingerprint" onclick={() => snap && copy(snap.pubkey, 'pubkey')}
					>Copy hex pubkey</MenuItem
				>
				{#if snap?.nsec}
					<MenuDivider />
					<MenuItem icon="lucide:key-round" onclick={() => copy(snap.nsec!, 'nsec')}
						>Copy nsec</MenuItem
					>
				{/if}
			</Menu>
		</div>
		<div
			class="mt-4 rounded-lg border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-4 py-2.5 text-[11.5px] leading-relaxed text-[var(--ui-text-muted)]"
		>
			<Icon name="lucide:info" class="mr-1 inline size-3.5 align-text-bottom" />
			This key signs every GLO record (orders, products, …) and is your portable identity across bdGo
			OS, bnos-space and any Nostr client.
		</div>
	</section>

	<!-- Secret key (only for nsec login) -->
	{#if snap?.nsec}
		<section class="surface-card p-5">
			<div class="mb-4 flex items-center gap-3">
				<Icon name="lucide:key-round" class="size-5 text-primary-500" />
				<div>
					<h2 class="font-display text-[15px] font-semibold tracking-tight">Secret key</h2>
					<p class="text-[12px] text-[var(--ui-text-muted)]">
						Back it up — losing it locks you out permanently
					</p>
				</div>
			</div>
			<div
				class="flex items-center gap-2 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-3 py-2.5"
			>
				<span class="min-w-0 flex-1 truncate font-mono text-[12.5px]">
					{showNsec ? snap.nsec : '•'.repeat(32) + snap.nsec!.slice(-6)}
				</span>
				<button
					type="button"
					onclick={() => (showNsec = !showNsec)}
					class="grid size-7 place-items-center rounded-md text-[var(--ui-text-dimmed)] hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]"
					aria-label={showNsec ? 'Hide' : 'Reveal'}
				>
					<Icon name={showNsec ? 'lucide:eye-off' : 'lucide:eye'} class="size-4" />
				</button>
			</div>
			<div class="mt-3 flex flex-wrap gap-2">
				<Button
					size="sm"
					color="neutral"
					variant="subtle"
					icon="lucide:copy"
					onclick={() => copy(snap.nsec!, 'nsec')}>Copy</Button
				>
				<Button
					size="sm"
					color="neutral"
					variant="subtle"
					icon="lucide:download"
					onclick={downloadKey}>Download</Button
				>
			</div>
			<div
				class="mt-3 flex items-start gap-2 rounded-lg border border-[var(--tone-warning-bg)] bg-[var(--tone-warning-bg)] px-3 py-2 text-[11.5px] text-[var(--tone-warning-text)]"
			>
				<Icon name="lucide:triangle-alert" class="mt-0.5 size-3.5 shrink-0" />
				<span
					>Never share your nsec. Treat it like a bank password — anyone with it can impersonate
					your business identity.</span
				>
			</div>
		</section>
	{/if}

	<!-- Switch identity -->
	<section class="surface-card p-5">
		<div class="mb-4 flex items-center gap-3">
			<Icon name="lucide:repeat-2" class="size-5 text-primary-500" />
			<div>
				<h2 class="font-display text-[15px] font-semibold tracking-tight">Switch identity</h2>
				<p class="text-[12px] text-[var(--ui-text-muted)]">
					Import a key, create a new one, or use a browser extension
				</p>
			</div>
		</div>
		<div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
			<button
				type="button"
				onclick={() => (importOpen = true)}
				class="flex flex-col items-start gap-1 rounded-xl border border-[var(--ui-border)] p-3 text-left transition-colors hover:bg-[var(--ui-bg-accented)]"
			>
				<Icon name="lucide:log-in" class="size-4 text-primary-500" />
				<span class="text-[13px] font-semibold">Import key</span>
				<span class="text-[11.5px] text-[var(--ui-text-dimmed)]">Sign in with an existing nsec</span
				>
			</button>
			<button
				type="button"
				onclick={startCreate}
				class="flex flex-col items-start gap-1 rounded-xl border border-[var(--ui-border)] p-3 text-left transition-colors hover:bg-[var(--ui-bg-accented)]"
			>
				<Icon name="lucide:user-plus" class="size-4 text-primary-500" />
				<span class="text-[13px] font-semibold">Create new</span>
				<span class="text-[11.5px] text-[var(--ui-text-dimmed)]">Generate a fresh keypair</span>
			</button>
			<button
				type="button"
				disabled={!hasExt || connecting}
				onclick={connectExtension}
				class="flex flex-col items-start gap-1 rounded-xl border border-[var(--ui-border)] p-3 text-left transition-colors enabled:hover:bg-[var(--ui-bg-accented)] disabled:opacity-50"
			>
				<Icon name="lucide:puzzle" class="size-4 text-primary-500" />
				<span class="text-[13px] font-semibold"
					>{connecting ? 'Connecting…' : 'Connect extension'}</span
				>
				<span class="text-[11.5px] text-[var(--ui-text-dimmed)]"
					>{hasExt ? 'Use your NIP-07 signer' : 'No NIP-07 extension found'}</span
				>
			</button>
		</div>
	</section>

	<!-- Danger zone -->
	<section class="surface-card p-5">
		<div class="mb-4 flex items-center gap-3">
			<Icon name="lucide:log-out" class="size-5 text-[var(--tone-error-text)]" />
			<div>
				<h2 class="font-display text-[15px] font-semibold tracking-tight">Sign out</h2>
				<p class="text-[12px] text-[var(--ui-text-muted)]">Clear this identity from the device</p>
			</div>
		</div>
		<Button color="neutral" variant="subtle" icon="lucide:log-out" onclick={signOut}
			>Sign out</Button
		>
	</section>
</div>

<!-- Import key dialog -->
<Dialog bind:open={importOpen} title="Import Nostr key" size="sm">
	<div class="space-y-3">
		<Input
			bind:value={importKey}
			icon="lucide:key-round"
			placeholder="nsec1… or hex private key"
			class="w-full font-mono"
		/>
		<p class="text-[11.5px] text-[var(--ui-text-muted)]">
			This replaces the current identity on this device. Make sure you have a backup of the active
			key first.
		</p>
	</div>
	{#snippet footer()}
		<Button color="neutral" variant="ghost" onclick={() => (importOpen = false)}>Cancel</Button>
		<Button color="primary" icon="lucide:log-in" onclick={doImport}>Sign in</Button>
	{/snippet}
</Dialog>

<!-- Create account → backup dialog -->
<Dialog bind:open={createOpen} title="Back up your new key" size="md">
	{#if pending}
		{@const p = pending}
		<div class="space-y-4">
			<div
				class="flex items-start gap-2 rounded-lg border border-[var(--tone-warning-bg)] bg-[var(--tone-warning-bg)] px-3 py-2.5 text-[12px] text-[var(--tone-warning-text)]"
			>
				<Icon name="lucide:triangle-alert" class="mt-0.5 size-4 shrink-0" />
				<span
					>Write this down or download it now. It is shown only once and cannot be recovered.</span
				>
			</div>
			<div>
				<div
					class="mb-1.5 text-[11px] font-semibold tracking-wide text-[var(--ui-text-dimmed)] uppercase"
				>
					Your npub (shareable)
				</div>
				<div
					class="rounded-lg border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-3 py-2 font-mono text-[12px] break-all"
				>
					{pending.npub}
				</div>
			</div>
			<div>
				<div
					class="mb-1.5 text-[11px] font-semibold tracking-wide text-[var(--ui-text-dimmed)] uppercase"
				>
					Your nsec (secret)
				</div>
				<div
					class="rounded-lg border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-3 py-2 font-mono text-[12px] break-all"
				>
					{pending.nsec}
				</div>
			</div>
			<div class="flex flex-wrap gap-2">
				<Button
					size="sm"
					color="neutral"
					variant="subtle"
					icon="lucide:copy"
					onclick={() => copy(p.nsec, 'nsec')}>Copy nsec</Button
				>
				<Button
					size="sm"
					color="neutral"
					variant="subtle"
					icon="lucide:download"
					onclick={() => {
						const blob = new Blob([`BNOS Nostr key\nnpub: ${p.npub}\nnsec: ${p.nsec}`], {
							type: 'text/plain'
						});
						const url = URL.createObjectURL(blob);
						const a = document.createElement('a');
						a.href = url;
						a.download = `bnos-key-${p.npub.slice(0, 12)}.txt`;
						a.click();
						URL.revokeObjectURL(url);
					}}>Download</Button
				>
			</div>
			<label class="flex cursor-pointer items-center gap-2 text-[12.5px] font-semibold">
				<input
					type="checkbox"
					bind:checked={backedUp}
					class="size-4 rounded border-[var(--ui-border)]"
				/>
				I’ve saved my key in a safe place
			</label>
		</div>
	{/if}
	{#snippet footer()}
		<Button color="neutral" variant="ghost" onclick={() => (createOpen = false)}>Cancel</Button>
		<Button color="primary" icon="lucide:check" disabled={!backedUp} onclick={confirmCreate}
			>Create identity</Button
		>
	{/snippet}
</Dialog>
