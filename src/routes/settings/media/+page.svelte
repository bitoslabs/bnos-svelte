<script lang="ts">
	import { onMount } from 'svelte';
	import { t } from '$lib/i18n/i18n.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import SettingsSection from '$lib/components/ui/SettingsSection.svelte';
	import SettingRow from '$lib/components/ui/SettingRow.svelte';
	import { media, MEDIA_PROVIDERS, providerLabel } from '$lib/media/media.svelte';
	import type { MediaProviderId } from '$lib/media/uploaders';
	import { toast } from '$lib/stores/toast.svelte';

	let revealCldSecret = $state(false);
	let revealS3Secret = $state(false);
	let testingProvider = $state<MediaProviderId | null>(null);
	let serverEnabled = $state<boolean | null>(null);

	onMount(() => {
		media.load();
		// Detect whether the server fallback is available (GET /api/media/upload).
		fetch('/api/media/upload')
			.then((r) => r.json())
			.then((d: { enabled?: boolean }) => (serverEnabled = !!d.enabled))
			.catch(() => (serverEnabled = false));
	});

	async function testUpload(id: MediaProviderId) {
		if (testingProvider) return;
		if (!media.isConfigured(id)) {
			toast.warning('Fill in the required fields first');
			return;
		}
		testingProvider = id;
		try {
			const blob = new Blob(['BNOS upload test\n'], { type: 'text/plain' });
			const file = new File([blob], 'bnos-test.txt', { type: 'text/plain' });
			await media.upload(file, id, { purpose: 'test' });
			toast.success(`Test upload OK via ${providerLabel(id)}`);
		} catch (e) {
			toast.error('Test failed', e instanceof Error ? e.message : undefined);
		} finally {
			testingProvider = null;
		}
	}
</script>

<svelte:head><title>{t('settings.media')} · {t('common.settings')}</title></svelte:head>

<div class="space-y-5">
	<PageHeader
		icon="lucide:image-up"
		title={t('settings.media')}
		description={t('settings.mediaDesc')}
	/>

	<!-- Default provider -->
	<SettingsSection
		title={t('settings.defaultProvider')}
		icon="lucide:cloud-upload"
		description={t('settings.mediaDefaultDesc')}
	>
		<div class="grid grid-cols-1 gap-2 p-5 sm:grid-cols-3">
			<button
				type="button"
				onclick={() => media.setDefaultProvider('none')}
				class="rounded-xl border p-3 text-left transition-colors {media.state.defaultProvider ===
				'none'
					? 'border-primary-500 bg-primary-500/10'
					: 'border-[var(--ui-border)] hover:bg-[var(--ui-bg-accented)]'}"
			>
				<div class="flex items-center gap-2">
					<Icon name="lucide:server" class="size-4 text-[var(--ui-text-muted)]" />
					<span class="text-[13px] font-bold">{t('settings.serverFallbackProvider')}</span>
				</div>
				<p class="mt-1 text-[11px] text-[var(--ui-text-muted)]">
					{t('settings.serverFallbackProviderDesc')}
				</p>
			</button>
			{#each MEDIA_PROVIDERS as p (p.id)}
				<button
					type="button"
					onclick={() => media.setDefaultProvider(p.id)}
					class="rounded-xl border p-3 text-left transition-colors {media.state.defaultProvider ===
					p.id
						? 'border-primary-500 bg-primary-500/10'
						: 'border-[var(--ui-border)] hover:bg-[var(--ui-bg-accented)]'}"
				>
					<div class="flex items-center gap-2">
						<Icon name={p.icon} class="size-4" />
						<span class="text-[13px] font-bold">{p.label}</span>
						{#if media.isConfigured(p.id)}
							<Badge color="success" class="ml-auto">{t('settings.ready')}</Badge>
						{:else}
							<Badge color="warning" class="ml-auto">{t('settings.setup')}</Badge>
						{/if}
					</div>
					<p class="mt-1 text-[11px] text-[var(--ui-text-muted)]">{p.description}</p>
				</button>
			{/each}
		</div>

		<SettingRow title={t('common.serverFallback')} description={t('settings.mediaFallbackDesc')}>
			{#if serverEnabled === null}
				<Badge color="neutral"
					><Icon name="lucide:loader-circle" class="mr-1 size-3 animate-spin" />{t(
						'settings.checking'
					)}</Badge
				>
			{:else if serverEnabled}
				<Badge color="success"
					><Icon name="lucide:check" class="mr-1 size-3" />{t('settings.available')}</Badge
				>
			{:else}
				<Badge color="warning"
					><Icon name="lucide:triangle-alert" class="mr-1 size-3" />{t(
						'settings.notConfiguredShort'
					)}</Badge
				>
			{/if}
		</SettingRow>
	</SettingsSection>

	<!-- Cloudinary -->
	<SettingsSection title={t('settings.cloudinary')} icon="lucide:cloud-sun">
		{#snippet actions()}
			{#if media.isConfigured('cloudinary')}
				{#if media.state.cloudinary.apiKey?.trim() && media.state.cloudinary.apiSecret?.trim()}
					<Badge color="primary">{t('settings.signed')}</Badge>
				{:else}<Badge color="success">{t('settings.connected')}</Badge>{/if}
			{/if}
		{/snippet}

		<div class="space-y-4 p-5">
			<p class="text-[12px] text-[var(--ui-text-muted)]">
				Two options: (1) an <strong>unsigned upload preset</strong> (safest — no secret in the
				browser), or (2) your <strong>API key + API secret</strong> for signed uploads with full control.
				The secret is stored only on this device.
			</p>
			<div class="grid gap-4 sm:grid-cols-2">
				<label class="block">
					<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>{t('settings.cloudName')}</span
					>
					<Input
						value={media.state.cloudinary.cloudName}
						oninput={(e) => media.updateCloudinary({ cloudName: e.currentTarget.value })}
						icon="lucide:cloud"
						placeholder="my-cloud"
						class="w-full"
					/>
				</label>
				<label class="block">
					<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>{t('settings.uploadPreset')}</span
					>
					<Input
						value={media.state.cloudinary.uploadPreset ?? ''}
						oninput={(e) => media.updateCloudinary({ uploadPreset: e.currentTarget.value })}
						icon="lucide:shield"
						placeholder="unsigned_preset"
						class="w-full"
					/>
				</label>
				<label class="block">
					<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>{t('settings.apiKey')}</span
					>
					<Input
						value={media.state.cloudinary.apiKey ?? ''}
						oninput={(e) => media.updateCloudinary({ apiKey: e.currentTarget.value })}
						icon="lucide:key-round"
						placeholder="123456789012345"
						autocomplete="off"
						class="w-full font-mono text-[11.5px]"
					/>
				</label>
				<label class="block">
					<span
						class="mb-1.5 flex items-center justify-between text-[12px] font-semibold text-[var(--ui-text-muted)]"
					>
						<span>{t('settings.apiSecret')}</span>
						<button
							type="button"
							onclick={() => (revealCldSecret = !revealCldSecret)}
							class="flex items-center gap-1 text-[11px] font-medium text-primary-500"
						>
							<Icon name={revealCldSecret ? 'lucide:eye-off' : 'lucide:eye'} class="size-3.5" />
							{revealCldSecret ? 'Hide' : 'Reveal'}
						</button>
					</span>
					<Input
						value={media.state.cloudinary.apiSecret ?? ''}
						oninput={(e) => media.updateCloudinary({ apiSecret: e.currentTarget.value })}
						icon="lucide:lock"
						type={revealCldSecret ? 'text' : 'password'}
						placeholder="••••••••"
						autocomplete="off"
						class="w-full font-mono text-[11.5px]"
					/>
				</label>
				<label class="block sm:col-span-2">
					<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>{t('settings.folder')}</span
					>
					<Input
						value={media.state.cloudinary.folder ?? ''}
						oninput={(e) => media.updateCloudinary({ folder: e.currentTarget.value })}
						icon="lucide:folder"
						placeholder="bnos"
						class="w-full"
					/>
				</label>
			</div>
			<div class="flex gap-2 border-t border-[var(--ui-border-muted)] pt-4">
				<Button
					color="primary"
					variant="subtle"
					icon={testingProvider === 'cloudinary' ? 'lucide:loader-circle' : 'lucide:upload-cloud'}
					onclick={() => testUpload('cloudinary')}
					disabled={!!testingProvider}>{t('settings.testUpload')}</Button
				>
				<Button
					color="neutral"
					variant="ghost"
					onclick={() =>
						media.updateCloudinary({
							cloudName: '',
							uploadPreset: '',
							apiKey: '',
							apiSecret: '',
							folder: ''
						})}>{t('settings.clear')}</Button
				>
			</div>
		</div>
	</SettingsSection>

	<!-- S3 / R2 -->
	<SettingsSection title={t('settings.s3r2b2')} icon="lucide:database">
		{#snippet actions()}
			{#if media.isConfigured('s3')}<Badge color="success">{t('settings.connected')}</Badge>{/if}
		{/snippet}

		<div class="space-y-4 p-5">
			<p class="text-[12px] text-[var(--ui-text-muted)]">
				Works with AWS S3 and S3-compatible storage. Enable CORS on the bucket to allow PUT requests
				from this site. The secret key is stored locally on this device.
			</p>
			<div class="grid gap-4 sm:grid-cols-2">
				<label class="block">
					<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>{t('settings.bucket')}</span
					>
					<Input
						value={media.state.s3.bucket}
						oninput={(e) => media.updateS3({ bucket: e.currentTarget.value })}
						icon="lucide:hard-drive"
						placeholder="my-bucket"
						class="w-full"
					/>
				</label>
				<label class="block">
					<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>{t('settings.region')}</span
					>
					<Input
						value={media.state.s3.region}
						oninput={(e) => media.updateS3({ region: e.currentTarget.value })}
						icon="lucide:globe"
						placeholder="us-east-1 / auto"
						class="w-full"
					/>
				</label>
				<label class="block sm:col-span-2">
					<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>{t('settings.endpoint')}</span
					>
					<Input
						value={media.state.s3.endpoint ?? ''}
						oninput={(e) => media.updateS3({ endpoint: e.currentTarget.value })}
						icon="lucide:link"
						placeholder="https://<acct>.r2.cloudflarestorage.com"
						type="url"
						class="w-full"
					/>
				</label>
				<label class="block">
					<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>{t('settings.accessKey')}</span
					>
					<Input
						value={media.state.s3.accessKey}
						oninput={(e) => media.updateS3({ accessKey: e.currentTarget.value })}
						icon="lucide:key-round"
						placeholder="AKIA…"
						autocomplete="off"
						class="w-full font-mono text-[11.5px]"
					/>
				</label>
				<label class="block">
					<span
						class="mb-1.5 flex items-center justify-between text-[12px] font-semibold text-[var(--ui-text-muted)]"
					>
						<span>{t('settings.secretKey')}</span>
						<button
							type="button"
							onclick={() => (revealS3Secret = !revealS3Secret)}
							class="flex items-center gap-1 text-[11px] font-medium text-primary-500"
						>
							<Icon name={revealS3Secret ? 'lucide:eye-off' : 'lucide:eye'} class="size-3.5" />
							{revealS3Secret ? 'Hide' : 'Reveal'}
						</button>
					</span>
					<Input
						value={media.state.s3.secretKey}
						oninput={(e) => media.updateS3({ secretKey: e.currentTarget.value })}
						icon="lucide:lock"
						type={revealS3Secret ? 'text' : 'password'}
						placeholder="••••••••"
						autocomplete="off"
						class="w-full font-mono text-[11.5px]"
					/>
				</label>
				<label class="block sm:col-span-2">
					<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>{t('settings.publicUrlBase')}</span
					>
					<Input
						value={media.state.s3.publicUrlBase ?? ''}
						oninput={(e) => media.updateS3({ publicUrlBase: e.currentTarget.value })}
						icon="lucide:globe"
						placeholder="https://cdn.example.com"
						type="url"
						class="w-full"
					/>
				</label>
				<label class="block sm:col-span-2">
					<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
						>{t('settings.folderPrefix')}</span
					>
					<Input
						value={media.state.s3.folder ?? ''}
						oninput={(e) => media.updateS3({ folder: e.currentTarget.value })}
						icon="lucide:folder"
						placeholder="bnos"
						class="w-full"
					/>
				</label>
			</div>
			<div class="flex gap-2 border-t border-[var(--ui-border-muted)] pt-4">
				<Button
					color="primary"
					variant="subtle"
					icon={testingProvider === 's3' ? 'lucide:loader-circle' : 'lucide:upload-cloud'}
					onclick={() => testUpload('s3')}
					disabled={!!testingProvider}>{t('settings.testUpload')}</Button
				>
				<Button
					color="neutral"
					variant="ghost"
					onclick={() =>
						media.updateS3({
							bucket: '',
							region: 'us-east-1',
							endpoint: '',
							accessKey: '',
							secretKey: '',
							publicUrlBase: '',
							folder: ''
						})}>{t('settings.clear')}</Button
				>
			</div>
		</div>
	</SettingsSection>

	<!-- Danger zone -->
	<SettingsSection danger title={t('common.eraseCredentials')} icon="lucide:shield-alert">
		<div class="flex items-center justify-between gap-4 p-5">
			<p class="text-[12px] text-[var(--ui-text-muted)]">
				{t('settings.eraseCredentialsDesc')}
			</p>
			<Button
				color="error"
				variant="subtle"
				icon="lucide:trash-2"
				onclick={() => {
					media.reset();
					toast.success(t('settings.toastMediaCleared'));
				}}>{t('settings.eraseAll')}</Button
			>
		</div>
	</SettingsSection>
</div>
