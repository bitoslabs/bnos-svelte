<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Switch from '$lib/components/ui/Switch.svelte';
	import { relays, DEFAULT_RELAYS } from '$nostr/relay.svelte';

	let newRelay = $state('');
	onMount(() => relays.load());
	function add() { if (newRelay.trim()) { relays.add(newRelay.trim()); newRelay = ''; } }
</script>

<svelte:head><title>Relays · Settings</title></svelte:head>

<div class="space-y-4">
	<div class="flex items-center gap-3">
		<Icon name="lucide:radio" class="size-5 text-primary-500" />
		<div>
			<h2 class="font-display text-[15px] font-semibold tracking-tight">Relays</h2>
			<p class="text-[12px] text-[var(--ui-text-muted)]">
				{relays.relays.length} configured · {relays.readableRelays.length} read · {relays.writableRelays.length} write · {relays.online ? 'online' : 'offline'}
			</p>
		</div>
	</div>
	<ul class="surface-card divide-y divide-[var(--ui-border-muted)]">
		{#each relays.relays as url (url)}
			<li class="flex items-center gap-3 px-4 py-3">
				<span class:opacity-40={!relays.isActive(url)} class="live-dot"></span>
				<span
					class={`flex-1 truncate font-mono text-[12.5px] ${
						relays.isActive(url) ? '' : 'text-[var(--ui-text-dimmed)]'
					}`}
				>
					{url}
				</span>
				<div class="flex items-center gap-3">
					<div class="flex items-center gap-1.5">
						<Badge color={relays.canRead(url) ? 'success' : 'neutral'}>R</Badge>
						<Switch checked={relays.canRead(url)} onCheckedChange={(enabled) => relays.setPermission(url, 'read', enabled)} />
					</div>
					<div class="flex items-center gap-1.5">
						<Badge color={relays.canWrite(url) ? 'primary' : 'neutral'}>W</Badge>
						<Switch checked={relays.canWrite(url)} onCheckedChange={(enabled) => relays.setPermission(url, 'write', enabled)} />
					</div>
				</div>
				<Button color="neutral" variant="ghost" size="icon-sm" icon="lucide:x" onclick={() => relays.remove(url)} />
			</li>
		{/each}
	</ul>
	<form class="flex gap-2" onsubmit={(e) => (e.preventDefault(), add())}>
		<Input bind:value={newRelay} icon="lucide:plus" placeholder="wss://…" class="flex-1" />
		<Button type="submit" color="neutral" variant="subtle">Add</Button>
	</form>
	<Button color="neutral" variant="ghost" size="sm" icon="lucide:rotate-ccw" onclick={relays.reset}>
		Reset to defaults ({DEFAULT_RELAYS.length})
	</Button>
</div>
