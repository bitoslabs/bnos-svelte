<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Switch from '$lib/components/ui/Switch.svelte';
	import { relays, DEFAULT_RELAYS } from '$nostr/relay.svelte';

	let newRelay = $state('');

	onMount(() => relays.load());

	function add() {
		const v = newRelay.trim();
		if (!v) return;
		relays.add(v);
		newRelay = '';
	}
</script>

<svelte:head><title>Setup · Relays</title></svelte:head>

<div class="space-y-5">
	<div>
		<h2 class="font-display text-xl font-bold tracking-tight">Nostr relays</h2>
		<p class="mt-1 text-[13.5px] text-[var(--ui-text-muted)]">
			Relays carry your signed records between devices. Only switched-on relays are used for sync.
		</p>
	</div>

	<form
		class="flex gap-2"
		onsubmit={(e) => (e.preventDefault(), add())}
	>
		<Input bind:value={newRelay} icon="lucide:radio" placeholder="wss://relay.example.com" class="flex-1" />
		<Button type="submit" color="neutral" variant="subtle" icon="lucide:plus">Add</Button>
	</form>

	<ul class="divide-y divide-[var(--ui-border-muted)] overflow-hidden rounded-xl border border-[var(--ui-border)]">
		{#each relays.relays as url (url)}
			<li class="flex items-center gap-3 px-4 py-3">
				<span class:opacity-40={!relays.isActive(url)} class="live-dot"></span>
				<span
					class={`flex-1 truncate font-mono text-[13px] ${
						relays.isActive(url) ? '' : 'text-[var(--ui-text-dimmed)]'
					}`}
				>
					{url}
				</span>
				<div class="flex items-center gap-2">
					<span class="text-[11px] font-semibold uppercase tracking-wider text-[var(--ui-text-dimmed)]">
						{relays.isActive(url) ? 'On' : 'Off'}
					</span>
					<Switch checked={relays.isActive(url)} onCheckedChange={(active) => relays.setActive(url, active)} />
				</div>
				<button
					type="button"
					class="grid size-7 place-items-center rounded-lg text-[var(--ui-text-dimmed)] hover:bg-[var(--tone-error-bg)] hover:text-[var(--tone-error-text)]"
					onclick={() => relays.remove(url)}
					aria-label="Remove relay"
				>
					<Icon name="lucide:x" class="size-4" />
				</button>
			</li>
		{/each}
	</ul>

	<Button color="neutral" variant="ghost" size="sm" icon="lucide:rotate-ccw" onclick={relays.reset}>
		Reset to defaults
	</Button>

	<p class="text-[11.5px] text-[var(--ui-text-dimmed)]">
		Default set: {DEFAULT_RELAYS.join(', ')} · {relays.activeRelays.length} active
	</p>
</div>
