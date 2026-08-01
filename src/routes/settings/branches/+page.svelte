<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { glo } from '$nostr/store.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { TYPE, type GloLocation } from '$lib/domain';

	onMount(() => {
		glo.hydrate(TYPE.branch);
		void glo.sync(TYPE.branch);
	});
	const branches = $derived(glo.all<GloLocation, typeof TYPE.branch>(TYPE.branch));
	let name = $state('');
	let code = $state('');
	async function add() {
		if (!name.trim()) return toast.warning('Name required');
		await glo.upsert<GloLocation>(TYPE.branch, {
			name: name.trim(),
			code: code.trim() || undefined,
			status: 'active'
		});
		toast.success('Branch added');
		name = code = '';
	}
</script>

<svelte:head><title>Branches · Settings</title></svelte:head>

<div class="space-y-4">
	<div class="flex items-center gap-3">
		<Icon name="lucide:map-pin" class="size-5 text-primary-500" />
		<div>
			<h2 class="font-display text-[15px] font-semibold tracking-tight">Branches</h2>
			<p class="text-[12px] text-[var(--ui-text-muted)]">
				Locations · GLO <code>location</code> (kind 30600) · current:
				<strong>{tenant.state.locationName || 'Main'}</strong>
			</p>
		</div>
	</div>
	<div class="surface-card flex flex-wrap gap-2 p-3">
		<Input
			bind:value={name}
			icon="lucide:map-pin"
			placeholder="Branch name"
			class="min-w-[12rem] flex-1"
		/>
		<Input bind:value={code} icon="lucide:hash" placeholder="Code" class="w-32" />
		<Button color="primary" icon="lucide:plus" onclick={add}>Add</Button>
	</div>
	{#if branches.length === 0}
		<EmptyState
			icon="lucide:map-pin"
			title="No branches"
			description="Add more locations for multi-branch operations."
		/>
	{:else}
		<div class="surface-card divide-y divide-[var(--ui-border-muted)]">
			{#each branches as b (b.id)}
				<div class="flex items-center gap-3 px-4 py-3">
					<Icon name="lucide:map-pin" class="size-4 text-[var(--ui-text-dimmed)]" />
					<div class="flex-1">
						<div class="font-semibold">{b.data.name}</div>
						{#if b.data.code}<div class="font-mono text-[11px] text-[var(--ui-text-dimmed)]">
								{b.data.code}
							</div>{/if}
					</div>
					<Badge color={b.data.status === 'active' ? 'success' : 'neutral'}
						>{b.data.status ?? 'active'}</Badge
					><Button
						color="neutral"
						variant="ghost"
						size="icon-sm"
						icon="lucide:trash-2"
						onclick={() => {
							glo.remove(TYPE.branch, b.id);
							toast.info('Removed');
						}}
					/>
				</div>
			{/each}
		</div>
	{/if}
</div>
