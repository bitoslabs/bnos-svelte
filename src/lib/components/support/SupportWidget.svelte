<script lang="ts">
	import { onMount } from 'svelte';
	import { decode } from 'nostr-tools/nip19';
	import Icon from '$lib/components/ui/Icon.svelte';
	import QrCode from '$lib/components/ui/QrCode.svelte';
	import { fetchEvents } from '$nostr/client';
	import { NOSTR_KINDS, type NostrEvent } from '@bitos/bnos-core';

	type Props = { compact?: boolean };
	let { compact = false }: Props = $props();

	/** BNOS project account. Donations go directly to its published Lightning address. */
	const SUPPORT_NPUB = 'npub1e65vutc5cfgutyvjetu5wp3ael48asklchtrut8m2svtt4lxdp4sruf0pk';
	const SUPPORT_PROFILE_URL = `https://social.bitos.space/profile/${SUPPORT_NPUB}`;
	const tiers = [
		{ label: 'Coffee', sats: 1000 },
		{ label: 'Builder', sats: 5000, recommended: true },
		{ label: 'Release', sats: 21000 },
		{ label: 'Patron', sats: 100000 }
	];

	let lightningAddress = $state('');
	let displayName = $state('BNOS contributors');
	let selectedSats = $state(5000);
	let customSats = $state('');
	let invoice = $state('');
	let error = $state('');
	let loading = $state(true);
	let requesting = $state(false);
	let copied = $state(false);
	const amount = $derived(Math.max(1, Math.round(Number(customSats) || selectedSats)));

	onMount(() => {
		void loadSupportProfile();
	});

	async function loadSupportProfile() {
		try {
			const decoded = decode(SUPPORT_NPUB);
			if (decoded.type !== 'npub') throw new Error('Invalid support npub');
			const events = await fetchEvents({ kinds: [NOSTR_KINDS.PROFILE], authors: [decoded.data as string] });
			const event = events.sort((a, b) => b.created_at - a.created_at)[0] as NostrEvent | undefined;
			if (event) {
				const meta = JSON.parse(event.content) as { display_name?: string; name?: string; lud16?: string; lud06?: string };
				displayName = meta.display_name || meta.name || displayName;
				lightningAddress = meta.lud16 || meta.lud06 || '';
			}
		} catch {
			error = 'The BNOS support profile could not be loaded.';
		} finally {
			loading = false;
		}
	}

	function selectTier(sats: number) {
		selectedSats = sats;
		customSats = '';
		invoice = '';
		error = '';
	}

	function setCustom(value: string) {
		customSats = value.replace(/[^\d]/g, '').slice(0, 8);
		invoice = '';
		error = '';
	}

	async function requestInvoice() {
		if (!lightningAddress) {
			error = loading ? 'Loading the BNOS support profile…' : 'This profile has not published a Lightning address yet.';
			return;
		}
		const [user, domain] = lightningAddress.split('@');
		if (!user || !domain || lightningAddress.includes('://')) {
			error = 'The published Lightning address is invalid.';
			return;
		}
		requesting = true;
		error = '';
		invoice = '';
		try {
			const metadataResponse = await fetch(`https://${domain}/.well-known/lnurlp/${encodeURIComponent(user)}`);
			if (!metadataResponse.ok) throw new Error('Could not reach the Lightning address provider.');
			const metadata = (await metadataResponse.json()) as { callback?: string; minSendable?: number; maxSendable?: number; status?: string; reason?: string };
			if (metadata.status === 'ERROR' || !metadata.callback) throw new Error(metadata.reason || 'The provider rejected the request.');
			const millisats = amount * 1000;
			if (metadata.minSendable && millisats < metadata.minSendable) throw new Error(`Minimum amount is ${Math.ceil(metadata.minSendable / 1000)} sats.`);
			if (metadata.maxSendable && millisats > metadata.maxSendable) throw new Error(`Maximum amount is ${Math.floor(metadata.maxSendable / 1000)} sats.`);
			const callback = new URL(metadata.callback);
			callback.searchParams.set('amount', String(millisats));
			const response = await fetch(callback);
			const payment = (await response.json()) as { pr?: string; status?: string; reason?: string };
			if (!response.ok || payment.status === 'ERROR' || !payment.pr) throw new Error(payment.reason || 'Could not create a Lightning invoice.');
			invoice = payment.pr;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not prepare the donation.';
		} finally {
			requesting = false;
		}
	}

	async function copyInvoice() {
		if (!invoice) return;
		await navigator.clipboard.writeText(invoice);
		copied = true;
		setTimeout(() => (copied = false), 1800);
	}
</script>

<section class="surface-card overflow-hidden rounded-2xl border border-[var(--ui-border-muted)] {compact ? 'p-4' : 'p-5 sm:p-6'}">
	<div class="flex items-start gap-3">
		<div class="grid size-11 shrink-0 place-items-center rounded-2xl bg-warm-500/12 text-warm-600"><Icon name="lucide:heart" class="size-5" /></div>
			<div><h2 class="font-display text-[18px] font-extrabold tracking-tight">Support BNOS</h2><p class="mt-1 text-[12.5px] leading-relaxed text-[var(--ui-text-muted)]">Send sats directly to <a href={SUPPORT_PROFILE_URL} target="_blank" rel="noopener noreferrer" class="font-semibold text-primary-600 hover:underline dark:text-primary-400">{displayName}</a>. No account, ads, or middleman.</p></div>
	</div>
	<div class="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
		{#each tiers as tier (tier.label)}
			<button type="button" onclick={() => selectTier(tier.sats)} class="rounded-xl border p-3 text-left transition {selectedSats === tier.sats && !customSats ? 'border-primary-500 bg-primary-500/8' : 'border-[var(--ui-border-muted)] hover:border-primary-500/40'}">
				<span class="block text-[12px] font-bold">{tier.label}</span><span class="mt-1 block font-mono text-[13px] font-bold text-primary-500">{tier.sats.toLocaleString()} sats</span>
				{#if tier.recommended}<span class="mt-1 block text-[10px] font-semibold text-primary-500">Recommended</span>{/if}
			</button>
		{/each}
	</div>
	<div class="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
		<input aria-label="Custom sats amount" type="text" inputmode="numeric" value={customSats} oninput={(e) => setCustom(e.currentTarget.value)} placeholder="Custom amount in sats" class="min-w-0 flex-1 rounded-xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-3 py-2.5 text-[13px] font-semibold outline-none" />
		<button type="button" onclick={requestInvoice} disabled={requesting || loading} class="inline-flex items-center justify-center gap-2 rounded-xl bg-warm-500 px-4 py-2.5 text-[12.5px] font-bold dark:text-white text-primary-500 transition hover:bg-warm-600 disabled:opacity-60 "><Icon name={requesting ? 'lucide:loader-circle' : 'lucide:zap'} class={requesting ? 'size-4 animate-spin' : 'size-4'} />{requesting ? 'Preparing…' : `Support with ${amount.toLocaleString()} sats`}</button>
	</div>
	{#if error}<p role="alert" class="mt-3 rounded-xl bg-[var(--tone-warning-bg)] px-3 py-2 text-[11.5px] font-semibold text-[var(--tone-warning-text)]">{error}</p>{/if}
	{#if invoice}<div class="mt-4 grid gap-4 rounded-2xl bg-[var(--ui-bg-muted)] p-4 sm:grid-cols-[auto_1fr] sm:items-center"><QrCode value={invoice.toUpperCase()} size={180} badge="lightning" /><div><p class="text-[13px] font-bold">Invoice ready · {amount.toLocaleString()} sats</p><p class="mt-1 text-[11.5px] text-[var(--ui-text-muted)]">Scan with any Lightning wallet, or open it directly on this device.</p><div class="mt-3 flex flex-wrap gap-2"><a href={`lightning:${invoice}`} class="rounded-lg bg-primary-500 px-3 py-2 text-[11.5px] font-bold text-white"><Icon name="lucide:wallet-cards" class="mr-1 inline size-3.5" />Open wallet</a><button type="button" onclick={copyInvoice} class="rounded-lg border border-[var(--ui-border-muted)] px-3 py-2 text-[11.5px] font-bold"><Icon name={copied ? 'lucide:check' : 'lucide:copy'} class="mr-1 inline size-3.5" />{copied ? 'Copied' : 'Copy invoice'}</button></div></div></div>{/if}
	<p class="mt-4 text-[10.5px] text-[var(--ui-text-dimmed)]">Powered by Nostr profile metadata · Lightning payments are final.</p>
</section>
