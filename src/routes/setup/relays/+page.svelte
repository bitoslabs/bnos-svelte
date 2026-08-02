<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { relays, DEFAULT_RELAYS } from '$nostr/relay.svelte';

	let newRelay = $state('');

	onMount(() => relays.load());

	function add() {
		const v = newRelay.trim();
		if (!v) return;
		relays.add(v);
		newRelay = '';
	}

	function toggleRead(url: string) {
		relays.setPermission(url, 'read', !relays.canRead(url));
	}

	function toggleWrite(url: string) {
		relays.setPermission(url, 'write', !relays.canWrite(url));
	}
</script>

<svelte:head><title>Setup · Relays</title></svelte:head>

<div class="space-y-5">
	<!-- Header -->
	<div>
		<h2 class="font-display text-xl font-bold tracking-tight">Nostr relays</h2>
		<p class="mt-1 text-[13.5px] text-[var(--ui-text-muted)]">
			Relays carry your signed records between devices. Set which relays can read sync data and which can receive writes.
		</p>
	</div>

	<!-- Add relay -->
	<form class="flex gap-2" onsubmit={(e) => (e.preventDefault(), add())}>
		<Input bind:value={newRelay} icon="lucide:radio" placeholder="wss://relay.example.com" class="flex-1" />
		<Button type="submit" color="primary" variant="solid" icon="lucide:plus">Add</Button>
	</form>

	<!-- Relay list -->
	<ul class="divide-y divide-[var(--ui-border-muted)] overflow-hidden rounded-xl border border-[var(--ui-border)]">
		{#each relays.relays as url (url)}
			<li class="flex items-center gap-3 px-4 py-3">
				<!-- Status dot -->
				<span
					class="size-2 shrink-0 rounded-full"
					class:bg-primary-500={relays.isActive(url)}
					class:bg-[var(--ui-text-dimmed)]={!relays.isActive(url)}
				></span>

				<!-- URL -->
				<span class="min-w-0 flex-1 truncate font-mono text-[13px] text-[var(--ui-text)]">
					{url}
				</span>

				<!-- R / W toggle buttons -->
				<div class="flex items-center gap-1.5">
					<button
						type="button"
						class="inline-flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-[11px] font-bold transition-colors"
						class:is-active-badge={relays.canRead(url)}
						class:bg-[var(--ui-bg-accented)]={!relays.canRead(url)}
						class:text-[var(--ui-text-dimmed)]={!relays.canRead(url)}
						class:hover:bg-[var(--interactive-hover-bg)]={!relays.canRead(url)}
						onclick={() => toggleRead(url)}
						aria-label="Toggle read for {url}"
						aria-pressed={relays.canRead(url)}
					>
						R
					</button>
					<button
						type="button"
						class="inline-flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-[11px] font-bold transition-colors"
						class:is-active-badge={relays.canWrite(url)}
						class:bg-[var(--ui-bg-accented)]={!relays.canWrite(url)}
						class:text-[var(--ui-text-dimmed)]={!relays.canWrite(url)}
						class:hover:bg-[var(--interactive-hover-bg)]={!relays.canWrite(url)}
						onclick={() => toggleWrite(url)}
						aria-label="Toggle write for {url}"
						aria-pressed={relays.canWrite(url)}
					>
						W
					</button>
				</div>

				<!-- Remove -->
				<button
					type="button"
					class="grid size-7 shrink-0 place-items-center rounded-lg text-[var(--ui-text-dimmed)] transition-colors hover:bg-[var(--tone-error-bg)] hover:text-[var(--tone-error-text)]"
					onclick={() => relays.remove(url)}
					aria-label="Remove relay"
				>
					<Icon name="lucide:x" class="size-4" />
				</button>
			</li>
		{/each}
	</ul>

	<!-- Footer -->
	<div class="flex items-center justify-between">
		<Button color="neutral" variant="ghost" size="sm" icon="lucide:rotate-ccw" onclick={relays.reset}>
			Reset to defaults
		</Button>
		<p class="text-[11.5px] text-[var(--ui-text-dimmed)]">
			{relays.readableRelays.length} read · {relays.writableRelays.length} write
		</p>
	</div>

	<p class="text-[11.5px] text-[var(--ui-text-dimmed)]">
		Default set: {DEFAULT_RELAYS.join(', ')}
	</p>
</div>
