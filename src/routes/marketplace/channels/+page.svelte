<script lang="ts">
	/**
	 * Sales Channels — connect and manage external sales channels.
	 * Gallery of connectable platforms + connected channels with sync control.
	 */
	import Icon from '$lib/components/ui/Icon.svelte';
	import { t } from '$lib/i18n/i18n.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Switch from '$lib/components/ui/Switch.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { glo } from '$nostr/store.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { relativeTime, titleCase } from '$lib/utils/format';
	import { newRecordId } from '$lib/utils/record-id';
	import {
		TYPE,
		CHANNEL_TYPES,
		channelMeta,
		statusLabel,
		type MarketplaceChannelType,
		type MarketplaceConnection
	} from '$lib/domain';

	const currency = $derived(tenant.state.currency);
	const connections = $derived(
		glo.all<MarketplaceConnection, typeof TYPE.marketplaceConnection>(TYPE.marketplaceConnection)
	);

	// Connectable = channel types not yet connected
	const connectable = $derived.by(() => {
		const used = new Set(connections.map((c) => c.data.type));
		return CHANNEL_TYPES.filter((m) => !used.has(m.value));
	});

	// ── Connect modal ───────────────────────────────────────
	let connectType = $state<MarketplaceChannelType | null>(null);
	let cName = $state('');
	let cStoreUrl = $state('');
	let cApiKey = $state('');
	let cRegion = $state('');
	let connecting = $state(false);

	function openConnect(t: MarketplaceChannelType) {
		connectType = t;
		cName = channelMeta(t).label;
		cStoreUrl = '';
		cApiKey = '';
		cRegion = '';
		connecting = false;
	}

	const connectMeta = $derived(connectType ? channelMeta(connectType) : null);

	async function saveConnection() {
		if (!connectType || !cName.trim()) return;
		connecting = true;
		const data: MarketplaceConnection = {
			name: cName.trim(),
			type: connectType,
			status: 'connected',
			storeUrl: cStoreUrl.trim() || undefined,
			syncEnabled: true,
			autoFulfill: false,
			lastSyncAt: new Date().toISOString(),
			config: {
				...(cApiKey.trim() ? { apiKey: cApiKey.trim() } : {}),
				...(cRegion.trim() ? { region: cRegion.trim() } : {})
			}
		};
		try {
			await glo.upsert<MarketplaceConnection>(TYPE.marketplaceConnection, data, {
				id: newRecordId('mp-channel')
			});
			toast.success(`${data.name} connected`);
			connectType = null;
		} catch {
			toast.error('Failed to connect channel');
		} finally {
			connecting = false;
		}
	}

	async function toggleSync(id: string, data: MarketplaceConnection) {
		await glo.upsert<MarketplaceConnection>(
			TYPE.marketplaceConnection,
			{ ...data, syncEnabled: !data.syncEnabled, lastSyncAt: new Date().toISOString() },
			{ id }
		);
		toast.success(`Sync ${data.syncEnabled ? 'paused' : 'resumed'}`);
	}

	async function syncNow(id: string, data: MarketplaceConnection) {
		await glo.upsert<MarketplaceConnection>(
			TYPE.marketplaceConnection,
			{ ...data, lastSyncAt: new Date().toISOString() },
			{ id }
		);
		toast.success('Synced');
	}

	async function disconnect(id: string, data: MarketplaceConnection) {
		await glo.upsert<MarketplaceConnection>(
			TYPE.marketplaceConnection,
			{ ...data, status: 'disconnected', syncEnabled: false },
			{ id }
		);
		toast.info(`${data.name} disconnected`);
	}

	async function removeChannel(id: string) {
		glo.remove(TYPE.marketplaceConnection, id);
		toast.info('Channel removed');
	}

	let confirmRemoveId = $state<string | null>(null);
</script>

<svelte:head><title>{t('nav.marketplace')} · {t('nav.salesChannels')}</title></svelte:head>

<div class="space-y-6">
<!-- Connected channels -->
{#if connections.length > 0}
	<section class="space-y-3">
		<header class="flex items-center gap-2">
			<Icon name="lucide:link" class="size-4 text-primary-500" />
			<h2 class="font-display text-[14px] font-semibold">Connected</h2>
			<span class="text-[11px] text-[var(--ui-text-dimmed)]">{connections.length}</span>
		</header>
		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
		{#each connections as c (c.id)}
			{@const m = channelMeta(c.data.type)}
			<div class="surface-card flex flex-col p-5">
				<div class="flex items-start justify-between">
					<div class="flex items-center gap-3">
						<div class="grid size-11 shrink-0 place-items-center rounded-xl {m.color}">
							<Icon name={m.icon} class="size-5.5" />
						</div>
						<div class="min-w-0">
							<div class="flex items-center gap-1.5">
								<p class="truncate text-[13.5px] font-bold">{c.data.name}</p>
								{#if c.data.status === 'connected' && c.data.syncEnabled}
									<span class="live-dot" aria-label="live"></span>
								{/if}
							</div>
							<p class="text-[11px] text-[var(--ui-text-dimmed)]">
								{#if c.data.lastSyncAt}Synced {relativeTime(c.data.lastSyncAt)}{:else}Not synced yet{/if}
							</p>
						</div>
					</div>
					<Badge color={c.data.status === 'connected' ? 'success' : c.data.status === 'error' ? 'info' : 'neutral'}>
						{statusLabel(c.data.status)}
					</Badge>
				</div>

				{#if c.data.storeUrl}
					<a
						href={c.data.storeUrl}
						target="_blank"
						rel="noopener"
						class="mt-3 inline-flex items-center gap-1 truncate text-[11px] font-medium text-primary-600 dark:text-primary-400 hover:underline"
					>
						<Icon name="lucide:external-link" class="size-3 shrink-0" />
						<span class="truncate">{c.data.storeUrl}</span>
					</a>
				{/if}

				<div class="mt-auto flex items-center justify-between pt-4">
					<div class="flex items-center gap-2">
						<Switch checked={c.data.syncEnabled} onCheckedChange={() => toggleSync(c.id, c.data)} />
						<span class="text-[11px] font-medium text-[var(--ui-text-muted)]">Auto-sync</span>
					</div>
					<div class="flex items-center gap-1">
						<Button
							size="icon-sm"
							color="neutral"
							variant="ghost"
							icon="lucide:refresh-cw"
							title={t('common.syncNow')}
							onclick={() => syncNow(c.id, c.data)}
						/>
						<Button
							size="icon-sm"
							color="neutral"
							variant="ghost"
							icon="lucide:power"
							title={t('common.disconnect')}
							onclick={() => disconnect(c.id, c.data)}
						/>
						<Button
							size="icon-sm"
							color="neutral"
							variant="ghost"
							icon="lucide:trash-2"
							title={t('common.remove')}
							onclick={() => (confirmRemoveId = c.id)}
						/>
					</div>
				</div>
			</div>
		{/each}
		</div>
	</section>
{/if}

<!-- Connectable channels -->
<section class="space-y-3">
	<header class="flex items-center gap-2">
		<Icon name="lucide:plug" class="size-4 text-primary-500" />
		<h2 class="font-display text-[14px] font-semibold">Available channels</h2>
	</header>

	{#if connectable.length === 0}
	<EmptyState
		icon="lucide:circle-check-big"
		title={t('marketplace.allChannelsConnected')}
		description="You've connected every available channel. Sync your catalog to start selling."
	/>
{:else}
	<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
		{#each connectable as m (m.value)}
			<button
				type="button"
				onclick={() => openConnect(m.value)}
				class="group surface-card flex flex-col p-5 text-left transition-all hover:border-[var(--ui-border-accented)] hover:shadow-sm"
			>
				<div class="flex items-start justify-between">
					<div class="grid size-11 shrink-0 place-items-center rounded-xl {m.color}">
						<Icon name={m.icon} class="size-5.5" />
					</div>
					<span
						class="grid size-7 place-items-center rounded-lg bg-[var(--ui-bg-accented)] text-[var(--ui-text-dimmed)] transition-colors group-hover:bg-primary-500/10 group-hover:text-primary-500"
					>
						<Icon name="lucide:plus" class="size-4" />
					</span>
				</div>
				<p class="mt-3 text-[13.5px] font-bold">{m.label}</p>
				<p class="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-[var(--ui-text-dimmed)]">
					{m.blurb}
				</p>
			</button>
		{/each}
		</div>
	{/if}
	</section>
</div>

<!-- Connect modal -->
<Dialog bind:open={() => connectType !== null, (v) => !v && (connectType = null)} title={t('marketplace.connectChannel')} size="md">
	{#if connectMeta}
		<div class="space-y-4">
			<div class="flex items-center gap-3 rounded-xl bg-[var(--ui-bg-accented)] p-3">
				<div class="grid size-10 shrink-0 place-items-center rounded-lg {connectMeta.color}">
					<Icon name={connectMeta.icon} class="size-5" />
				</div>
				<div>
					<p class="text-[13px] font-bold">{connectMeta.label}</p>
					<p class="text-[11px] text-[var(--ui-text-dimmed)]">{connectMeta.blurb}</p>
				</div>
			</div>
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Channel name</span>
				<Input bind:value={cName} class="w-full" />
			</label>
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Store URL</span>
				<Input bind:value={cStoreUrl} placeholder="https://shop.example.com" class="w-full" />
			</label>
			<div class="grid grid-cols-2 gap-3">
				<label class="block">
					<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">API key (optional)</span>
					<Input bind:value={cApiKey} type="password" placeholder="••••••••" class="w-full" />
				</label>
				<label class="block">
					<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Region</span>
					<Input bind:value={cRegion} placeholder="us / id / th" class="w-full" />
				</label>
			</div>
		</div>
	{/if}
	{#snippet footer()}
		<Button color="neutral" variant="ghost" onclick={() => (connectType = null)}>{t('common.cancel')}</Button>
		<Button color="primary" icon="lucide:plug-zap" disabled={!cName.trim() || connecting} onclick={saveConnection}>
			{connecting ? 'Connecting…' : 'Connect'}
		</Button>
	{/snippet}
</Dialog>

<!-- Remove confirm -->
{#if confirmRemoveId}
	<div class="fixed inset-0 z-[95] flex items-center justify-center p-4">
		<button
			type="button"
			tabindex="-1"
			class="fixed inset-0 bg-black/45 backdrop-blur-[2px]"
			onclick={() => (confirmRemoveId = null)}
			aria-label={t('common.cancel')}
		></button>
		<div class="animate-rise relative w-full max-w-sm rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-bg-elevated)] p-5 shadow-2xl">
			<div class="flex items-center gap-3">
				<div class="grid size-10 place-items-center rounded-xl bg-red-500/10 text-red-500">
					<Icon name="lucide:trash-2" class="size-5" />
				</div>
				<div>
					<p class="font-display text-[14px] font-bold">Remove channel?</p>
					<p class="text-[11.5px] text-[var(--ui-text-dimmed)]">Listings on it will be unlinked. This cannot be undone.</p>
				</div>
			</div>
			<div class="mt-4 flex justify-end gap-2">
				<Button color="neutral" variant="ghost" size="sm" onclick={() => (confirmRemoveId = null)}>{t('common.cancel')}</Button>
				<Button color="error" size="sm" icon="lucide:trash-2" onclick={() => { if (confirmRemoveId) removeChannel(confirmRemoveId); confirmRemoveId = null; }}>{t('common.remove')}</Button>
			</div>
		</div>
	</div>
{/if}
