<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { session } from '$nostr/session.svelte';
	import { glo } from '$nostr/store.svelte';
	import { preferences } from '$lib/theme/preferences.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { truncateNpub, titleCase } from '$lib/utils/format';
	import Menu from '$lib/components/ui/Menu.svelte';
	import MenuItem from '$lib/components/ui/MenuItem.svelte';
	import MenuDivider from '$lib/components/ui/MenuDivider.svelte';

	onMount(() => preferences.load());

	// Organization fields (name / code / currency / business model / type) are
	// owned by the Workspace page to avoid duplicate editors fighting over the
	// same `tenant` fields. They are shown read-only here.
	const orgRows = $derived([
		{ label: 'Name', value: tenant.state.organizationName || '—', icon: 'lucide:building-2' },
		{ label: 'Code', value: tenant.state.organizationCode || '—', icon: 'lucide:hash' },
		{ label: 'Branch', value: tenant.state.locationName || '—', icon: 'lucide:map-pin' },
		{ label: 'Currency', value: tenant.state.currency || '—', icon: 'lucide:coins' },
		{ label: 'Business model', value: titleCase(tenant.state.businessModel.replace(/_/g, ' ')) || '—', icon: 'lucide:layers' },
		{ label: 'Business type', value: titleCase(tenant.state.businessType) || '—', icon: 'lucide:tag' }
	]);

	async function copyNpub() {
		try {
			await navigator.clipboard.writeText(session.npub ?? '');
			toast.success('npub copied');
		} catch {
			toast.error('Copy failed');
		}
	}
</script>

<svelte:head><title>BNOS · Settings</title></svelte:head>

<div class="space-y-5">
	<div>
		<h1 class="font-display text-xl font-bold tracking-tight">Settings</h1>
		<p class="text-[12.5px] text-[var(--ui-text-muted)]">Organization overview & Nostr identity</p>
	</div>

	<!-- Organization (read-only — owned by Workspace) -->
	<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
		<div class="flex items-center gap-2 px-5 py-3">
			<Icon name="lucide:building-2" class="size-4 text-primary-500" />
			<h2 class="font-display text-[14px] font-semibold">Organization</h2>
			<span class="ml-auto text-[10px] font-medium text-[var(--ui-text-dimmed)]">GLO · kind 30078</span>
		</div>
		<div class="grid grid-cols-1 gap-3 px-5 py-4 sm:grid-cols-2">
			{#each orgRows as row (row.label)}
				<div class="flex items-center gap-3 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-3.5 py-2.5">
					<Icon name={row.icon} class="size-4 shrink-0 text-[var(--ui-text-dimmed)]" />
					<div class="min-w-0">
						<p class="text-[10px] font-semibold tracking-wider text-[var(--ui-text-dimmed)] uppercase">{row.label}</p>
						<p class="truncate text-[13px] font-bold capitalize">{row.value}</p>
					</div>
				</div>
			{/each}
		</div>
		<div class="flex flex-wrap items-center gap-2 px-5 py-3">
			{#if tenant.restaurantEnabled}
				<Badge color="info"><Icon name="lucide:utensils" class="mr-1 size-3" />Restaurant module on</Badge>
			{/if}
			{#if tenant.isMultiLocation}
				<Badge color="neutral"><Icon name="lucide:git-branch" class="mr-1 size-3" />Multi-location</Badge>
			{/if}
			<div class="ml-auto">
				<Button href={resolve('/settings/organization')} variant="subtle" size="sm" icon="lucide:arrow-up-right">
					Manage in Workspace
				</Button>
			</div>
		</div>
	</section>

	<!-- Identity -->
	<section class="surface-card p-5">
		<div class="mb-4 flex items-center gap-3">
			<Icon name="lucide:fingerprint" class="size-5 text-primary-500" />
			<div class="min-w-0 flex-1">
				<h2 class="font-display text-[15px] font-semibold tracking-tight">Nostr identity</h2>
				<p class="text-[12px] text-[var(--ui-text-muted)]">The key that signs every record</p>
			</div>
			<Menu
				id="settings-identity"
				label="Identity actions"
				triggerClass="grid size-8 place-items-center rounded-lg text-[var(--ui-text-dimmed)] transition-colors hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]"
				triggerActiveClass="bg-[var(--ui-bg-accented)] text-[var(--ui-text)]"
			>
				{#snippet trigger()}<Icon name="lucide:ellipsis-vertical" class="size-4" />{/snippet}
				<MenuItem icon="lucide:copy" onclick={copyNpub}>Copy npub</MenuItem>
				<MenuItem icon="lucide:qr-code" onclick={() => toast.info('QR coming soon')}
					>Show QR</MenuItem
				>
				<MenuDivider />
				<MenuItem tone="danger" icon="lucide:log-out" onclick={async () => { await session.logout(); tenant.reset(); glo.clearAll(); await goto(resolve('/login'), { replaceState: true }); }}
					>Sign out</MenuItem>
			</Menu>
		</div>
		<div
			class="flex items-center justify-between gap-3 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-4 py-3"
		>
			<div class="min-w-0">
				<div class="truncate font-mono text-[13px] font-semibold">
					{truncateNpub(session.npub ?? '', 18, 10)}
				</div>
				<div class="text-[11.5px] text-[var(--ui-text-dimmed)]">
					{session.loginMethod === 'extension' ? 'NIP-07 extension' : 'Private key'}
				</div>
			</div>
			<Badge color="success"><span class="live-dot"></span> active</Badge>
		</div>
	</section>
</div>
