<script lang="ts">
	import { onMount } from 'svelte';
	import { decode } from 'nostr-tools/nip19';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { fetchEvents } from '$nostr/client';
	import { NOSTR_KINDS } from '@bitos/bnos-core';
	import { truncateNpub } from '$lib/utils/format';

	type Props = { compact?: boolean };
	let { compact = false }: Props = $props();
	const contributors = ['npub1ujh9lp7vw38yatm0vsxy7xuwxl3j98qvnyatyyg9xszufpyxn2fskqagph'];
	type Contributor = { npub: string; pubkey: string; name: string; picture?: string };
	let people = $state<Contributor[]>([]);
	let copied = $state('');

	onMount(() => { void loadContributors(); });

	async function loadContributors() {
		people = await Promise.all(contributors.map(async (npub) => {
			try {
				const decoded = decode(npub);
				if (decoded.type !== 'npub') throw new Error('invalid npub');
				const pubkey = decoded.data as string;
				const events = await fetchEvents({ kinds: [NOSTR_KINDS.PROFILE], authors: [pubkey] });
				const event = events.sort((a, b) => b.created_at - a.created_at)[0];
				const meta = event ? JSON.parse(event.content) as { display_name?: string; name?: string; picture?: string } : {};
				return { npub, pubkey, name: meta.display_name || meta.name || truncateNpub(npub, 10, 8), picture: meta.picture };
			} catch { return { npub, pubkey: '', name: truncateNpub(npub, 10, 8) }; }
		}));
	}

	async function copyNpub(npub: string) { await navigator.clipboard.writeText(npub); copied = npub; setTimeout(() => (copied = ''), 1800); }
	function profileUrl(npub: string) { return `https://social.bitos.space/profile/${npub}`; }
</script>

<section class="surface-card rounded-2xl border border-[var(--ui-border-muted)] {compact ? 'p-4' : 'p-5 sm:p-6'}">
	<div class="flex items-start gap-3"><div class="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary-500/10 text-primary-500"><Icon name="lucide:heart-handshake" class="size-5" /></div><div><h2 class="font-display text-[18px] font-extrabold tracking-tight">Contributors</h2><p class="mt-1 text-[12.5px] leading-relaxed text-[var(--ui-text-muted)]">People helping BNOS grow as an open, independent commerce system.</p></div></div>
		<div class="mt-4 space-y-2">{#each people as person (person.npub)}<div class="flex items-center gap-3 rounded-xl border border-[var(--ui-border-muted)] p-3">{#if person.picture}<img src={person.picture} alt="" class="size-10 rounded-full object-cover" />{:else}<div class="grid size-10 place-items-center rounded-full bg-primary-500/10 font-bold text-primary-600">{person.name.slice(0, 1).toUpperCase()}</div>{/if}<div class="min-w-0 flex-1"><a href={profileUrl(person.npub)} target="_blank" rel="noopener noreferrer" class="block truncate text-[13.5px] font-bold hover:text-primary-500">{person.name}</a><p class="truncate font-mono text-[10.5px] text-[var(--ui-text-dimmed)]">{truncateNpub(person.npub, 14, 10)}</p></div><button type="button" title="Copy npub" onclick={() => copyNpub(person.npub)} class="grid size-8 place-items-center rounded-lg text-[var(--ui-text-dimmed)] transition hover:bg-[var(--ui-bg-accented)] hover:text-primary-500"><Icon name={copied === person.npub ? 'lucide:check' : 'lucide:copy'} class="size-4" /></button></div>{/each}</div>
</section>
