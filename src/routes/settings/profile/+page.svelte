<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import { session, hasNip07Extension } from '$nostr/session.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { truncateNpub, initialsFrom, titleCase } from '$lib/utils/format';

	const PROFILE_KEY = 'nostr_profile_kind0';

	onMount(() => {
		session.load();
		tenant.load();
		loadProfile();
	});

	// ── profile form state ──
	let displayName = $state('');
	let username = $state('');
	let about = $state('');
	let picture = $state('');
	let website = $state('');
	let lud16 = $state('');
	let isSaving = $state(false);
	let profileSaved = $state(false);

	// ── reveal / copy helpers ──
	let showNsec = $state(false);
	let copiedField = $state('');

	const snap = $derived(session.snapshot);
	const hasExt = $derived(hasNip07Extension());

	function loadProfile() {
		if (!browser) return;
		try {
			const raw = localStorage.getItem(PROFILE_KEY);
			if (!raw) return;
			const d = JSON.parse(raw);
			displayName = d.display_name ?? '';
			username = d.name ?? '';
			about = d.about ?? '';
			picture = d.picture ?? '';
			website = d.website ?? '';
			lud16 = d.lud16 ?? '';
		} catch { /* ignore */ }
	}

	function saveProfile() {
		if (!snap?.pubkey) return;
		isSaving = true;
		try {
			const data: Record<string, string> = {};
			if (displayName) data.display_name = displayName;
			if (username) data.name = username;
			if (about) data.about = about;
			if (picture) data.picture = picture;
			if (website) data.website = website;
			if (lud16) data.lud16 = lud16;

			if (browser) localStorage.setItem(PROFILE_KEY, JSON.stringify(data));

			profileSaved = true;
			toast.success('Profile saved');
			setTimeout(() => (profileSaved = false), 2500);
		} catch (e) {
			toast.error('Failed to save profile', e instanceof Error ? e.message : undefined);
		} finally {
			isSaving = false;
		}
	}

	async function copy(text: string, field: string) {
		try {
			await navigator.clipboard.writeText(text);
			copiedField = field;
			setTimeout(() => (copiedField = ''), 2000);
		} catch {
			toast.error('Copy failed');
		}
	}

	// ── avatar upload (data URI) ──
	let fileInput: HTMLInputElement;

	function handleAvatarUpload(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		if (file.size > 512 * 1024) {
			toast.warning('Image too large (max 512 KB)');
			return;
		}
		const reader = new FileReader();
		reader.onload = () => {
			picture = reader.result as string;
		};
		reader.readAsDataURL(file);
	}

	// ── identity actions ──
	let importOpen = $state(false);
	let importKey = $state('');

	function downloadKey() {
		if (!snap?.nsec) return;
		const blob = new Blob(
			[`BNOS Nostr private key\nnpub: ${snap.npub}\nnsec: ${snap.nsec}\n\nKeep this secret. Anyone with it controls your identity.`],
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
		tenant.reset();
		toast.info('Signed out');
		await goto('/login', { replaceState: true });
	}
</script>

<svelte:head><title>Profile · Settings</title></svelte:head>

<div class="mx-auto max-w-2xl space-y-5">
	<!-- Header -->
	<div>
		<h1 class="font-display text-xl font-bold tracking-tight">Profile</h1>
		<p class="text-[12.5px] text-[var(--ui-text-muted)]">
			Your Nostr identity, display name, and avatar
		</p>
	</div>

	<!-- Identity & Avatar -->
	<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
		<div class="flex items-center gap-2 px-5 py-3">
			<Icon name="lucide:user-circle" class="size-4 text-primary-500" />
			<h2 class="font-display text-[14px] font-semibold">Nostr identity</h2>
		</div>

		<!-- Avatar + name preview -->
		<div class="p-5">
			<div class="flex items-center gap-4">
				<!-- Avatar -->
				<div class="relative shrink-0">
					<div
						class="grid size-16 place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-primary-400 to-primary-600 text-lg font-bold text-white shadow-lg shadow-primary-500/25"
					>
						{#if picture}
							<img src={picture} alt={displayName || username} class="size-16 rounded-2xl object-cover" />
						{:else}
							{initialsFrom(displayName || username, null) || '?'}
						{/if}
					</div>
					<!-- Upload button overlay -->
					<button
						type="button"
						onclick={() => fileInput.click()}
						class="absolute -bottom-1 -right-1 grid size-6 place-items-center rounded-full border-2 border-[var(--ui-bg)] bg-[var(--ui-bg-elevated)] text-[var(--ui-text-dimmed)] shadow-sm transition-colors hover:text-primary-500"
						title="Upload avatar"
					>
						<Icon name="lucide:camera" class="size-3.5" />
					</button>
					<input
						bind:this={fileInput}
						type="file"
						accept="image/png,image/jpeg,image/webp,image/gif"
						class="hidden"
						onchange={handleAvatarUpload}
					/>
				</div>

				<div class="min-w-0 flex-1">
					<p class="truncate text-[14px] font-bold">
						{snap
							? displayName || username || 'Unnamed user'
							: 'Not signed in'}
					</p>
					{#if snap}
						<p class="mt-0.5 truncate font-mono text-[11px] text-[var(--ui-text-muted)]">
							{truncateNpub(snap.npub, 20, 12)}
						</p>
						<div class="mt-1.5 flex items-center gap-2">
							{#if snap.loginMethod === 'extension'}
								<Badge color="info">
									<Icon name="lucide:puzzle" class="mr-1 size-3" />NIP-07 extension
								</Badge>
							{:else}
								<Badge color="success">
									<span class="live-dot mr-1.5"></span>Private key
								</Badge>
							{/if}
						</div>
					{:else}
						<p class="mt-0.5 text-[11px] text-[var(--ui-text-dimmed)]">
							Sign in to manage your identity
						</p>
					{/if}
				</div>
			</div>
		</div>

		<!-- npub display + copy -->
		{#if snap}
			<div class="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
				<label class="w-36 shrink-0 text-[13px] font-semibold">Public key</label>
				<div class="flex-1">
					<div
						class="flex items-center gap-2 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-3 py-2"
					>
						<code class="min-w-0 flex-1 truncate font-mono text-[11px]">
							{truncateNpub(snap.npub, 20, 12)}
						</code>
						<button
							type="button"
							onclick={() => copy(snap.npub, 'npub')}
							class="grid size-7 shrink-0 place-items-center rounded-md text-[var(--ui-text-dimmed)] transition-colors hover:bg-primary-500/10 hover:text-primary-500"
							title="Copy npub"
						>
							<Icon
								name={copiedField === 'npub' ? 'lucide:check-check' : 'lucide:copy'}
								class="size-3.5"
							/>
						</button>
					</div>
				</div>
			</div>
		{/if}

		<!-- nsec (only if available) -->
		{#if snap?.nsec}
			<div class="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
				<label class="w-36 shrink-0 text-[13px] font-semibold text-[var(--tone-warning-text)]">Secret key</label>
				<div class="flex-1">
					<div
						class="flex items-center gap-2 rounded-lg border border-[var(--tone-warning-bg)] bg-[var(--tone-warning-bg)]/50 px-3 py-2"
					>
						<code class="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--tone-warning-text)]">
							{showNsec ? snap.nsec : '•'.repeat(32) + snap.nsec.slice(-6)}
						</code>
						<button
							type="button"
							onclick={() => (showNsec = !showNsec)}
							class="grid size-7 shrink-0 place-items-center rounded-md text-[var(--tone-warning-text)] transition-colors hover:bg-[var(--tone-warning-bg)]"
							title={showNsec ? 'Hide' : 'Reveal'}
						>
							<Icon name={showNsec ? 'lucide:eye-off' : 'lucide:eye'} class="size-3.5" />
						</button>
						<button
							type="button"
							onclick={() => {
								if (snap?.nsec) {
									void copy(snap.nsec, 'nsec');
								} else {
									toast.warning('No secret key available', "Extension login doesn't expose the private key.");
								}
							}}
							class="grid size-7 shrink-0 place-items-center rounded-md text-[var(--tone-warning-text)] transition-colors hover:bg-[var(--tone-warning-bg)]"
							title="Copy nsec"
						>
							<Icon
								name={copiedField === 'nsec' ? 'lucide:check-check' : 'lucide:copy'}
								class="size-3.5"
							/>
						</button>
					</div>
				</div>
			</div>
		{/if}
	</section>

	<!-- Profile metadata -->
	<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
		<div class="flex items-center gap-2 px-5 py-3">
			<Icon name="lucide:id-card" class="size-4 text-primary-500" />
			<h2 class="font-display text-[14px] font-semibold">Profile metadata</h2>
		</div>

		<!-- Display name -->
		<div class="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
			<div class="w-36 shrink-0">
				<label class="text-[13px] font-semibold">Display name</label>
			</div>
			<div class="flex-1">
				<Input
					bind:value={displayName}
					placeholder="My Store"
					class="w-full"
				/>
			</div>
		</div>

		<!-- Username -->
		<div class="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
			<div class="w-36 shrink-0">
				<label class="text-[13px] font-semibold">Username</label>
			</div>
			<div class="flex-1">
				<Input
					bind:value={username}
					placeholder="mystore"
					class="w-full"
				/>
			</div>
		</div>

		<!-- About -->
		<div class="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start">
			<div class="w-36 shrink-0">
				<label class="text-[13px] font-semibold">About</label>
			</div>
			<div class="flex-1">
				<Input
					textarea
					bind:value={about}
					placeholder="Brief description…"
					rows={3}
					class="w-full"
				/>
			</div>
		</div>

		<!-- Avatar URL -->
		<div class="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start">
			<div class="w-36 shrink-0">
				<label class="text-[13px] font-semibold">Avatar URL</label>
			</div>
			<div class="flex-1 space-y-2">
				<Input
					bind:value={picture}
					placeholder="https://example.com/avatar.jpg"
					class="w-full"
				/>
				{#if picture}
					<div class="flex items-center gap-2 rounded-lg bg-[var(--ui-bg-muted)] p-2">
						<img
							src={picture}
							alt={displayName}
							class="size-9 rounded-lg object-cover border border-[var(--ui-border)]"
							onerror={(e: Event) => ((e.target as HTMLImageElement).style.display = 'none')}
						/>
						<p class="min-w-0 flex-1 truncate text-[11px] text-[var(--ui-text-dimmed)]">{picture}</p>
					</div>
				{/if}
			</div>
		</div>

		<!-- Website -->
		<div class="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
			<div class="w-36 shrink-0">
				<label class="text-[13px] font-semibold">Website</label>
			</div>
			<div class="flex-1">
				<Input
					bind:value={website}
					placeholder="https://my-store.com"
					class="w-full"
				/>
			</div>
		</div>

		<!-- Lightning address -->
		<div class="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
			<div class="w-36 shrink-0">
				<label class="text-[13px] font-semibold">Lightning address</label>
			</div>
			<div class="flex-1">
				<Input
					bind:value={lud16}
					placeholder="user@getalby.com"
					class="w-full"
				/>
			</div>
		</div>

		<!-- Save button -->
		<div class="flex items-center justify-between gap-4 px-5 py-4">
			{#if profileSaved}
				<p class="flex items-center gap-1 text-[12px] font-semibold text-[var(--tone-success-text)]">
					<Icon name="lucide:check-check" class="size-3.5" />Saved
				</p>
			{/if}
			<div class="flex-1"></div>
			<Button
				color="primary"
				icon={isSaving ? 'lucide:loader-circle' : profileSaved ? 'lucide:check-check' : 'lucide:cloud-save'}
				disabled={!snap || isSaving}
				onclick={saveProfile}
			>
				{isSaving ? 'Saving…' : profileSaved ? 'Saved' : 'Save profile'}
			</Button>
		</div>
	</section>

	<!-- Role & tenant info -->
	<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
		<div class="flex items-center gap-2 px-5 py-3">
			<Icon name="lucide:shield-user" class="size-4 text-primary-500" />
			<h2 class="font-display text-[14px] font-semibold">Role & permissions</h2>
		</div>
		<div class="divide-y divide-[var(--ui-border-muted)] text-[13px]">
			<div class="flex items-center gap-3 px-5 py-3">
				<Icon name="lucide:building-2" class="size-4 text-[var(--ui-text-dimmed)]" />
				<span class="text-[var(--ui-text-muted)]">Organization</span>
				<span class="ml-auto font-semibold">{tenant.state.organizationName || '—'}</span>
			</div>
			<div class="flex items-center gap-3 px-5 py-3">
				<Icon name="lucide:map-pin" class="size-4 text-[var(--ui-text-dimmed)]" />
				<span class="text-[var(--ui-text-muted)]">Branch</span>
				<span class="ml-auto font-semibold">{tenant.state.locationName || 'Main'}</span>
			</div>
			<div class="flex items-center gap-3 px-5 py-3">
				<Icon name="lucide:store" class="size-4 text-[var(--ui-text-dimmed)]" />
				<span class="text-[var(--ui-text-muted)]">Business type</span>
				<span class="ml-auto font-semibold capitalize">{titleCase(tenant.state.businessType)}</span>
			</div>
			<div class="flex items-center gap-3 px-5 py-3">
				<Icon name="lucide:user-check" class="size-4 text-[var(--ui-text-dimmed)]" />
				<span class="text-[var(--ui-text-muted)]">Role</span>
				<span class="ml-auto">
					<Badge color="primary">Owner</Badge>
				</span>
			</div>
		</div>
	</section>

	<!-- Switch identity -->
	<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
		<div class="flex items-center gap-2 px-5 py-3">
			<Icon name="lucide:repeat-2" class="size-4 text-primary-500" />
			<h2 class="font-display text-[14px] font-semibold">Switch identity</h2>
		</div>
		<div class="grid grid-cols-1 gap-2 p-5 sm:grid-cols-3">
			<button
				type="button"
				onclick={() => (importOpen = true)}
				class="flex flex-col items-start gap-1 rounded-xl border border-[var(--ui-border)] p-3 text-left transition-colors hover:bg-[var(--ui-bg-accented)]"
			>
				<Icon name="lucide:log-in" class="size-4 text-primary-500" />
				<span class="text-[13px] font-semibold">Import key</span>
				<span class="text-[11.5px] text-[var(--ui-text-dimmed)]">Sign in with an existing nsec</span>
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
				<span class="text-[13px] font-semibold">{connecting ? 'Connecting…' : 'Connect extension'}</span>
				<span class="text-[11.5px] text-[var(--ui-text-dimmed)]">{hasExt ? 'Use your NIP-07 signer' : 'No NIP-07 extension found'}</span>
			</button>
		</div>
	</section>

	<!-- Sign out -->
	<section class="surface-card">
		<div class="flex items-center justify-between gap-4 p-5">
			<div class="flex items-center gap-3">
				<Icon name="lucide:log-out" class="size-5 text-[var(--tone-error-text)]" />
				<div>
					<h2 class="font-display text-[14px] font-semibold">Sign out</h2>
					<p class="text-[12px] text-[var(--ui-text-muted)]">Clear this identity from the device</p>
				</div>
			</div>
			<Button color="error" variant="subtle" icon="lucide:log-out" onclick={signOut}>Sign out</Button>
		</div>
	</section>
</div>

<!-- Import key dialog -->
<Dialog
	bind:open={importOpen}
	title="Import Nostr key"
	size="sm"
>
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
<Dialog
	bind:open={createOpen}
	title="Back up your new key"
	size="md"
>
	{#if pending}
		{@const p = pending}
		<div class="space-y-4">
			<div
				class="flex items-start gap-2 rounded-lg border border-[var(--tone-warning-bg)] bg-[var(--tone-warning-bg)] px-3 py-2.5 text-[12px] text-[var(--tone-warning-text)]"
			>
				<Icon name="lucide:triangle-alert" class="mt-0.5 size-4 shrink-0" />
				<span>Write this down or download it now. It is shown only once and cannot be recovered.</span>
			</div>
			<div>
				<div class="mb-1.5 text-[11px] font-semibold tracking-wide text-[var(--ui-text-dimmed)] uppercase">
					Your npub (shareable)
				</div>
				<div class="rounded-lg border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-3 py-2 font-mono text-[12px] break-all">
					{p.npub}
				</div>
			</div>
			<div>
				<div class="mb-1.5 text-[11px] font-semibold tracking-wide text-[var(--ui-text-dimmed)] uppercase">
					Your nsec (secret)
				</div>
				<div class="rounded-lg border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-3 py-2 font-mono text-[12px] break-all">
					{p.nsec}
				</div>
			</div>
			<div class="flex flex-wrap gap-2">
				<Button size="sm" color="neutral" variant="subtle" icon="lucide:copy" onclick={() => copy(p.nsec, 'nsec')}>Copy nsec</Button>
				<Button
					size="sm"
					color="neutral"
					variant="subtle"
					icon="lucide:download"
					onclick={() => {
						const blob = new Blob([`BNOS Nostr key\nnpub: ${p.npub}\nnsec: ${p.nsec}`], { type: 'text/plain' });
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
				<input type="checkbox" bind:checked={backedUp} class="size-4 rounded border-[var(--ui-border)]" />
				I've saved my key in a safe place
			</label>
		</div>
	{/if}
	{#snippet footer()}
		<Button color="neutral" variant="ghost" onclick={() => (createOpen = false)}>Cancel</Button>
		<Button color="primary" icon="lucide:check" disabled={!backedUp} onclick={confirmCreate}>Create identity</Button>
	{/snippet}
</Dialog>
