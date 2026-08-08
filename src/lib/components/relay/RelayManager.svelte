<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import { t } from '$lib/i18n/i18n.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import { cn } from '$lib/utils/cn';
	import { relays, DEFAULT_RELAYS } from '$nostr/relay.svelte';
	import { testRelay, relayTestLabel, type RelayTestResult } from '$nostr/relay-test';

	/**
	 * Reusable Nostr relay manager. Renders the add-relay form, the live relay
	 * list (status dot, primary star, R/W toggles, latency, test, remove) and an
	 * action footer (reset + test all + summary). Used by the settings page, the
	 * setup wizard and the login relay panel so the markup lives in one place.
	 */
	let {
		variant = 'full',
		showAdd = true,
		showActions = true,
		class: cls
	}: {
		/** `full` = settings page density, `compact` = popover / drawer density. */
		variant?: 'full' | 'compact';
		showAdd?: boolean;
		showActions?: boolean;
		class?: string;
	} = $props();

	const compact = $derived(variant === 'compact');

	let newRelay = $state('');
	let relayTests = $state<Record<string, RelayTestResult>>({});

	function add() {
		const v = newRelay.trim();
		if (!v) return;
		relays.add(v);
		newRelay = '';
	}

	async function runTest(url: string) {
		relayTests = { ...relayTests, [url]: { status: 'testing' } };
		const result = await testRelay(url);
		relayTests = { ...relayTests, [url]: result };
	}

	function testAll() {
		for (const url of relays.relays) void runTest(url);
	}

	function toggleRead(url: string) {
		relays.setPermission(url, 'read', !relays.canRead(url));
	}
	function toggleWrite(url: string) {
		relays.setPermission(url, 'write', !relays.canWrite(url));
	}
</script>

<div class={cn('space-y-3', cls)}>
	{#if showAdd}
		<form class="flex gap-2" onsubmit={(e) => (e.preventDefault(), add())}>
			<Input
				bind:value={newRelay}
				icon="lucide:plus"
				placeholder="wss://relay.example.com"
				class="flex-1"
			/>
			<Button type="submit" color="primary" variant="solid" icon="lucide:plus">{t('common.add')}</Button>
		</form>
	{/if}

	<!-- Relay list -->
	{#if relays.relays.length === 0}
		<div class="rounded-xl border border-dashed border-[var(--ui-border)] px-4 py-8 text-center">
			<Icon name="lucide:radio-off" class="mx-auto mb-2 size-6 text-[var(--ui-text-dimmed)]" />
			<p class="text-[12.5px] font-semibold text-[var(--ui-text-muted)]">No relays configured</p>
			<p class="mt-0.5 text-[11.5px] text-[var(--ui-text-dimmed)]">
				Add a relay above to sync data across devices.
			</p>
		</div>
	{:else}
		<ul
			class="divide-y divide-[var(--ui-border-muted)] overflow-hidden rounded-xl border border-[var(--ui-border)] bg-[var(--surface-bg)]"
		>
			{#each relays.relays as url (url)}
				{@const state = relayTests[url]}
				{@const isPrimary = relays.primaryRelay === url}
				<li class={cn('flex items-center gap-3', compact ? 'px-3 py-2' : 'px-4 py-3')}>
					<!-- Status dot -->
					<span
						class="size-2 shrink-0 rounded-full transition-colors"
						class:bg-primary-500={relays.isActive(url)}
						class:bg-[var(--ui-text-dimmed)]={!relays.isActive(url)}
					></span>

					<!-- URL + meta -->
					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-1.5">
							<span class={cn('truncate font-mono text-[var(--ui-text)]', compact ? 'text-[11.5px]' : 'text-[12.5px]')}>
								{url}
							</span>
							{#if isPrimary}
								<span
									class="shrink-0 rounded bg-primary-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-primary-600 dark:text-primary-400"
								>
									Primary
								</span>
							{/if}
						</div>
						<div class="mt-0.5 flex flex-wrap items-center gap-1.5">
							<span
								class="text-[10.5px] font-semibold"
								class:text-emerald-600={state?.status === 'ok'}
								class:dark:text-emerald-400={state?.status === 'ok'}
								class:text-amber-600={state?.status === 'testing'}
								class:dark:text-amber-400={state?.status === 'testing'}
								class:text-[var(--tone-error-text)]={state?.status === 'failed'}
								class:text-[var(--ui-text-dimmed)]={!state || state.status === 'idle'}
							>
								{relayTestLabel(state)}
							</span>
						</div>
					</div>

					<!-- Controls -->
					<div class="flex shrink-0 items-center gap-1.5">
						<button
							type="button"
							class="grid size-7 place-items-center rounded-md transition-colors"
							class:bg-primary-500={isPrimary}
							class:text-white={isPrimary}
							class:bg-[var(--ui-bg-accented)]={!isPrimary}
							class:text-[var(--ui-text-muted)]={!isPrimary}
							class:hover:bg-[var(--interactive-hover-bg)]={!isPrimary}
							class:hover:text-[var(--ui-text)]={!isPrimary}
							onclick={() => relays.setPrimary(url)}
							aria-label={t('common.setPrimary')}
							aria-pressed={isPrimary}
							title={t('common.setPrimary')}
						>
							<Icon name="lucide:star" class="size-3.5" />
						</button>
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
							title={t('common.readAccess')}
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
							title={t('common.writeAccess')}
						>
							W
						</button>
						<button
							type="button"
							class="grid size-7 place-items-center rounded-md bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)] disabled:cursor-wait disabled:opacity-60"
							onclick={() => runTest(url)}
							disabled={state?.status === 'testing'}
							aria-label="Test connection for {url}"
							title={t('common.testConnection')}
						>
							<Icon
								name={state?.status === 'testing'
									? 'lucide:loader-circle'
									: state?.status === 'ok'
										? 'lucide:wifi'
										: state?.status === 'failed'
											? 'lucide:wifi-off'
											: 'lucide:activity'}
								class="size-3.5 {state?.status === 'testing' ? 'animate-spin' : ''}"
							/>
						</button>
					</div>

					<!-- Remove -->
					<button
						type="button"
						class="grid size-7 shrink-0 place-items-center rounded-lg text-[var(--ui-text-dimmed)] transition-colors hover:bg-[var(--tone-error-bg)] hover:text-[var(--tone-error-text)]"
						onclick={() => {
							relays.remove(url);
							const { [url]: _removed, ...rest } = relayTests;
							relayTests = rest;
						}}
						aria-label="Remove {url}"
						title={t('common.removeRelay')}
					>
						<Icon name="lucide:x" class="size-4" />
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	{#if showActions}
		<div class="flex flex-wrap items-center justify-between gap-2">
			<Button
				color="neutral"
				variant="ghost"
				size="sm"
				icon="lucide:rotate-ccw"
				onclick={relays.reset}
			>
				Reset
			</Button>
			<Button
				color="neutral"
				variant="subtle"
				size="sm"
				icon="lucide:zap"
				onclick={testAll}
				disabled={relays.relays.length === 0}
			>
				Test all
			</Button>
		</div>
		<p class="text-[11px] text-[var(--ui-text-dimmed)]">
			{relays.readableRelays.length} read · {relays.writableRelays.length} write ·
			{DEFAULT_RELAYS.length} defaults available · star one primary relay for fastest sync
		</p>
	{/if}
</div>
