<script lang="ts">
	import { onMount } from 'svelte';
	import { t } from '$lib/i18n/i18n.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Icon from '$lib/components/ui/Icon.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Checkbox from '$lib/components/ui/Checkbox.svelte';
	import MediaImageInput from '$lib/components/media/MediaImageInput.svelte';
	import { session, hasNip07Extension } from '$nostr/session.svelte';
	import { profile } from '$nostr/profile.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { glo } from '$nostr/store.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { truncateNpub, initialsFrom, titleCase } from '$lib/utils/format';

	onMount(() => {
		session.load();
		tenant.load();
		profile.load();
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
		// Seed the form from the reactive kind-0 cache (localStorage-hydrated).
		displayName = profile.meta.display_name ?? '';
		username = profile.meta.name ?? '';
		about = profile.meta.about ?? '';
		picture = profile.meta.picture ?? '';
		website = profile.meta.website ?? '';
		lud16 = profile.meta.lud16 ?? '';
	}

	async function saveProfile() {
		if (!snap?.pubkey) return;
		isSaving = true;
		try {
			// 1. Update the local cache (reactive chrome updates immediately).
			profile.save({
				display_name: displayName,
				name: username,
				about,
				picture,
				website,
				lud16
			});

			// 2. Publish to Nostr as a kind-0 replaceable event (best-effort).
			const published = await profile.publish();

			profileSaved = true;
			toast.success(
				t('settings.toastProfileSaved'),
				published ? t('settings.toastPublished') : t('settings.toastSavedLocal')
			);
			setTimeout(() => (profileSaved = false), 2500);
		} catch (e) {
			toast.error(t('settings.toastProfileSaveFailed'), e instanceof Error ? e.message : undefined);
		} finally {
			isSaving = false;
		}
	}

	async function copy(text: string, field: string) {
		try {
			if (navigator.clipboard?.writeText) {
				await navigator.clipboard.writeText(text);
			} else {
				const input = document.createElement('textarea');
				input.value = text;
				input.setAttribute('readonly', '');
				input.style.position = 'fixed';
				input.style.opacity = '0';
				document.body.appendChild(input);
				input.select();
				document.execCommand('copy');
				document.body.removeChild(input);
			}
			copiedField = field;
			toast.success(t('settings.toastCopied'));
			setTimeout(() => (copiedField = ''), 2000);
		} catch (e) {
			toast.error(t('settings.toastCopyFailed'), e instanceof Error ? e.message : undefined);
		}
	}

	// Avatar uploads are handled by <MediaImageInput> below (no more data URIs).

	// ── identity actions ──
	let importOpen = $state(false);
	let importKey = $state('');

	function doImport() {
		const k = importKey.trim();
		if (!k) return toast.warning(t('settings.toastPasteKey'));
		try {
			const s = session.loginWithNsec(k);
			toast.success(t('settings.toastPublished'), truncateNpub(s.npub, 10, 6));
			importOpen = false;
			importKey = '';
		} catch (e) {
			toast.error(t('settings.toastInvalidKey'), e instanceof Error ? e.message : undefined);
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
		if (!backedUp) return toast.warning(t('settings.toastConfirmBackup'));
		session.loginWithNsec(pending.nsec);
		toast.success(t('settings.toastIdentityCreated'), truncateNpub(pending.npub, 10, 6));
		createOpen = false;
		pending = null;
	}

	let connecting = $state(false);
	async function connectExtension() {
		connecting = true;
		try {
			const s = await session.loginWithExtension();
			toast.success(t('settings.connected'), truncateNpub(s.npub, 10, 6));
		} catch (e) {
			toast.error('Extension sign-in failed', e instanceof Error ? e.message : undefined);
		} finally {
			connecting = false;
		}
	}

	async function signOut() {
		await session.logout();
		tenant.reset();
		glo.clearAll();
		toast.info(t('toast.signedOut'));
		await goto(resolve('/login'), { replaceState: true });
	}
</script>

<svelte:head><title>{t('settings.profile')} · {t('common.settings')}</title></svelte:head>

<div class="space-y-5">
	<!-- Header -->
	<PageHeader
		icon="lucide:user"
		title={t('settings.profile')}
		description={t('profile.nostrIdentityDesc')}
	/>

	<!-- Identity & Avatar -->
	<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
		<div class="flex items-center gap-2 px-5 py-3">
			<Icon name="lucide:user-circle" class="size-4 text-primary-500" />
			<h2 class="font-display text-[14px] font-semibold">{t('profile.nostrIdentity')}</h2>
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
							<img
								src={picture}
								alt={displayName || username}
								class="size-16 rounded-2xl object-cover"
							/>
						{:else}
							{initialsFrom(displayName || username, null) || '?'}
						{/if}
					</div>
				</div>

				<div class="min-w-0 flex-1">
					<p class="truncate text-[14px] font-bold">
						{snap ? displayName || username || t('profile.unnamedUser') : t('profile.notSignedIn')}
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
							{t('profile.signInToManage')}
						</p>
					{/if}
				</div>
			</div>
		</div>

		<!-- npub display + copy -->
		{#if snap}
			<div class="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
				<label class="w-36 shrink-0 text-[13px] font-semibold">{t('profile.publicKey')}</label>
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
							title={t('settings.copyNpub')}
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
				<label class="w-36 shrink-0 text-[13px] font-semibold text-[var(--tone-warning-text)]"
					>{t('profile.secretKey')}</label
				>
				<div class="flex-1">
					<div
						class="flex items-center gap-2 rounded-lg border border-[var(--tone-warning-bg)] bg-[var(--tone-warning-bg)]/50 px-3 py-2"
					>
						<code
							class="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--tone-warning-text)]"
						>
							{showNsec ? snap.nsec : '•'.repeat(32) + snap.nsec.slice(-6)}
						</code>
						<button
							type="button"
							onclick={() => (showNsec = !showNsec)}
							class="grid size-7 shrink-0 place-items-center rounded-md text-[var(--tone-warning-text)] transition-colors hover:bg-[var(--tone-warning-bg)]"
							title={showNsec ? t('profile.hide') : t('profile.reveal')}
						>
							<Icon name={showNsec ? 'lucide:eye-off' : 'lucide:eye'} class="size-3.5" />
						</button>
						<button
							type="button"
							onclick={() => {
								if (snap?.nsec) {
									void copy(snap.nsec, 'nsec');
								} else {
									toast.warning(
										t('settings.toastConfirmBackupTitle'),
										t('profile.noSecretKeyDesc')
									);
								}
							}}
							class="grid size-7 shrink-0 place-items-center rounded-md text-[var(--tone-warning-text)] transition-colors hover:bg-[var(--tone-warning-bg)]"
							title={t('settings.copyNsec')}
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
			<h2 class="font-display text-[14px] font-semibold">{t('profile.metadata')}</h2>
		</div>

		<!-- Display name -->
		<div class="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
			<div class="w-36 shrink-0">
				<label class="text-[13px] font-semibold">{t('common.displayName')}</label>
			</div>
			<div class="flex-1">
				<Input bind:value={displayName} placeholder="My Store" class="w-full" />
			</div>
		</div>

		<!-- Username -->
		<div class="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
			<div class="w-36 shrink-0">
				<label class="text-[13px] font-semibold">{t('profile.username')}</label>
			</div>
			<div class="flex-1">
				<Input bind:value={username} placeholder="mystore" class="w-full" />
			</div>
		</div>

		<!-- About -->
		<div class="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start">
			<div class="w-36 shrink-0">
				<label class="text-[13px] font-semibold">{t('common.bio')}</label>
			</div>
			<div class="flex-1">
				<Input
					textarea
					bind:value={about}
					placeholder={t('settings.briefDesc')}
					rows={3}
					class="w-full"
				/>
			</div>
		</div>

		<!-- Avatar -->
		<div class="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start">
			<div class="w-36 shrink-0">
				<label class="text-[13px] font-semibold">{t('profile.avatar')}</label>
			</div>
			<div class="flex-1">
				<MediaImageInput
					bind:value={picture}
					purpose="avatar"
					preview="round"
					size={64}
					placeholder="https://example.com/avatar.jpg"
				/>
			</div>
		</div>

		<!-- Website -->
		<div class="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
			<div class="w-36 shrink-0">
				<label class="text-[13px] font-semibold">{t('common.website')}</label>
			</div>
			<div class="flex-1">
				<Input bind:value={website} placeholder="https://my-store.com" class="w-full" />
			</div>
		</div>

		<!-- Lightning address -->
		<div class="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
			<div class="w-36 shrink-0">
				<label class="text-[13px] font-semibold">{t('profile.lightningAddress')}</label>
			</div>
			<div class="flex-1">
				<Input bind:value={lud16} placeholder="user@getalby.com" class="w-full" />
			</div>
		</div>

		<!-- Save button -->
		<div class="flex items-center justify-between gap-4 px-5 py-4">
			{#if profileSaved}
				<p
					class="flex items-center gap-1 text-[12px] font-semibold text-[var(--tone-success-text)]"
				>
					<Icon name="lucide:check-check" class="size-3.5" />{t('profile.saved')}
				</p>
			{/if}
			<div class="flex-1"></div>
			<Button
				color="primary"
				icon={isSaving
					? 'lucide:loader-circle'
					: profileSaved
						? 'lucide:check-check'
						: 'lucide:cloud-save'}
				disabled={!snap || isSaving}
				onclick={saveProfile}
			>
				{isSaving
					? t('profile.saving')
					: profileSaved
						? t('profile.saved')
						: t('profile.saveProfile')}
			</Button>
		</div>
	</section>

	<!-- Role & tenant info -->
	<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
		<div class="flex items-center gap-2 px-5 py-3">
			<Icon name="lucide:shield-user" class="size-4 text-primary-500" />
			<h2 class="font-display text-[14px] font-semibold">{t('profile.rolePermissions')}</h2>
		</div>
		<div class="divide-y divide-[var(--ui-border-muted)] text-[13px]">
			<div class="flex items-center gap-3 px-5 py-3">
				<Icon name="lucide:building-2" class="size-4 text-[var(--ui-text-dimmed)]" />
				<span class="text-[var(--ui-text-muted)]">{t('settings.organizationHeading')}</span>
				<span class="ml-auto font-semibold">{tenant.state.organizationName || '—'}</span>
			</div>
			<div class="flex items-center gap-3 px-5 py-3">
				<Icon name="lucide:map-pin" class="size-4 text-[var(--ui-text-dimmed)]" />
				<span class="text-[var(--ui-text-muted)]">{t('settings.branchLabel')}</span>
				<span class="ml-auto font-semibold">{tenant.state.locationName || 'Main'}</span>
			</div>
			<div class="flex items-center gap-3 px-5 py-3">
				<Icon name="lucide:store" class="size-4 text-[var(--ui-text-dimmed)]" />
				<span class="text-[var(--ui-text-muted)]">{t('settings.businessType')}</span>
				<span class="ml-auto font-semibold capitalize">{titleCase(tenant.state.businessType)}</span>
			</div>
			<div class="flex items-center gap-3 px-5 py-3">
				<Icon name="lucide:user-check" class="size-4 text-[var(--ui-text-dimmed)]" />
				<span class="text-[var(--ui-text-muted)]">{t('common.role')}</span>
				<span class="ml-auto">
					<Badge color="primary">{t('staff.roleOwner')}</Badge>
				</span>
			</div>
		</div>
	</section>

	<!-- Switch identity -->
	<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
		<div class="flex items-center gap-2 px-5 py-3">
			<Icon name="lucide:repeat-2" class="size-4 text-primary-500" />
			<h2 class="font-display text-[14px] font-semibold">{t('profile.switchIdentity')}</h2>
		</div>
		<div class="grid grid-cols-1 gap-2 p-5 sm:grid-cols-3">
			<button
				type="button"
				onclick={() => (importOpen = true)}
				class="flex flex-col items-start gap-1 rounded-xl border border-[var(--ui-border)] p-3 text-left transition-colors hover:bg-[var(--ui-bg-accented)]"
			>
				<Icon name="lucide:log-in" class="size-4 text-primary-500" />
				<span class="text-[13px] font-semibold">{t('profile.importKeyCard')}</span>
				<span class="text-[11.5px] text-[var(--ui-text-dimmed)]">{t('profile.importKeyDesc')}</span>
			</button>
			<button
				type="button"
				onclick={startCreate}
				class="flex flex-col items-start gap-1 rounded-xl border border-[var(--ui-border)] p-3 text-left transition-colors hover:bg-[var(--ui-bg-accented)]"
			>
				<Icon name="lucide:user-plus" class="size-4 text-primary-500" />
				<span class="text-[13px] font-semibold">{t('profile.createNew')}</span>
				<span class="text-[11.5px] text-[var(--ui-text-dimmed)]">{t('profile.createNewDesc')}</span>
			</button>
			<button
				type="button"
				disabled={!hasExt || connecting}
				onclick={connectExtension}
				class="flex flex-col items-start gap-1 rounded-xl border border-[var(--ui-border)] p-3 text-left transition-colors enabled:hover:bg-[var(--ui-bg-accented)] disabled:opacity-50"
			>
				<Icon name="lucide:puzzle" class="size-4 text-primary-500" />
				<span class="text-[13px] font-semibold"
					>{connecting ? t('profile.connecting') : t('profile.connectExtension')}</span
				>
				<span class="text-[11.5px] text-[var(--ui-text-dimmed)]"
					>{hasExt ? t('profile.useNip07') : t('profile.noExtension')}</span
				>
			</button>
		</div>
	</section>

	<!-- Sign out -->
	<section class="surface-card">
		<div class="flex items-center justify-between gap-4 p-5">
			<div class="flex items-center gap-3">
				<Icon name="lucide:log-out" class="size-5 text-[var(--tone-error-text)]" />
				<div>
					<h2 class="font-display text-[14px] font-semibold">{t('common.signOut')}</h2>
					<p class="text-[12px] text-[var(--ui-text-muted)]">{t('profile.clearFromDevice')}</p>
				</div>
			</div>
			<Button color="error" variant="subtle" icon="lucide:log-out" onclick={signOut}
				>{t('common.signOut')}</Button
			>
		</div>
	</section>
</div>

<!-- Import key dialog -->
<Dialog bind:open={importOpen} title={t('settings.importKey')} size="sm">
	<div class="space-y-3">
		<Input
			bind:value={importKey}
			icon="lucide:key-round"
			placeholder={t('settings.nsecHint')}
			class="w-full font-mono"
		/>
		<p class="text-[11.5px] text-[var(--ui-text-muted)]">
			{t('profile.importReplaceWarn')}
		</p>
	</div>
	{#snippet footer()}
		<Button color="neutral" variant="ghost" onclick={() => (importOpen = false)}
			>{t('common.cancel')}</Button
		>
		<Button color="primary" icon="lucide:log-in" onclick={doImport}>{t('common.signIn')}</Button>
	{/snippet}
</Dialog>

<!-- Create account → backup dialog -->
<Dialog bind:open={createOpen} title={t('settings.backUpNewKey')} size="md">
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
					{t('profile.npubShareable')}
				</div>
				<div
					class="rounded-lg border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-3 py-2 font-mono text-[12px] break-all"
				>
					{p.npub}
				</div>
			</div>
			<div>
				<div
					class="mb-1.5 text-[11px] font-semibold tracking-wide text-[var(--ui-text-dimmed)] uppercase"
				>
					{t('profile.nsecSecret')}
				</div>
				<div
					class="rounded-lg border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-3 py-2 font-mono text-[12px] break-all"
				>
					{p.nsec}
				</div>
			</div>
			<div class="flex flex-wrap gap-2">
				<Button
					size="sm"
					color="neutral"
					variant="subtle"
					icon="lucide:copy"
					onclick={() => copy(p.nsec, 'nsec')}>{t('profile.copyNsec')}</Button
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
					}}>{t('common.download')}</Button
				>
			</div>
			<Checkbox
				bind:checked={backedUp}
				size="sm"
				label={t('settings.savedKeySafe')}
				class="font-semibold"
			/>
		</div>
	{/if}
	{#snippet footer()}
		<Button color="neutral" variant="ghost" onclick={() => (createOpen = false)}
			>{t('common.cancel')}</Button
		>
		<Button color="primary" icon="lucide:check" disabled={!backedUp} onclick={confirmCreate}
			>{t('profile.createIdentity')}</Button
		>
	{/snippet}
</Dialog>
