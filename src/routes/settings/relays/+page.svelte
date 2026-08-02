<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import { relays, DEFAULT_RELAYS } from '$nostr/relay.svelte';

	let newRelay = $state('');
	type TestState = {
		status: 'idle' | 'testing' | 'ok' | 'failed';
		ms?: number;
		message?: string;
	};
	let relayTests = $state<Record<string, TestState>>({});

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

	function testRelay(url: string) {
		relayTests = { ...relayTests, [url]: { status: 'testing' } };
		const startedAt = performance.now();
		let socket: WebSocket | null = null;
		let settled = false;

		const finish = (state: TestState) => {
			if (settled) return;
			settled = true;
			try {
				socket?.close();
			} catch {
				/* noop */
			}
			relayTests = { ...relayTests, [url]: state };
		};

		const timeout = window.setTimeout(() => {
			finish({ status: 'failed', message: 'Timeout' });
		}, 6000);

		try {
			socket = new WebSocket(url);
			socket.onopen = () => {
				window.clearTimeout(timeout);
				finish({ status: 'ok', ms: Math.round(performance.now() - startedAt) });
			};
			socket.onerror = () => {
				window.clearTimeout(timeout);
				finish({ status: 'failed', message: 'Failed' });
			};
		} catch {
			window.clearTimeout(timeout);
			finish({ status: 'failed', message: 'Invalid' });
		}
	}

	function testLabel(url: string) {
		const state = relayTests[url];
		if (!state || state.status === 'idle') return 'Not tested';
		if (state.status === 'testing') return 'Testing...';
		if (state.status === 'ok') return `${state.ms ?? 0} ms`;
		return state.message ?? 'Failed';
	}
</script>

<svelte:head><title>Relays · Settings</title></svelte:head>

<div class="space-y-4">
	<!-- Header -->
	<div class="flex items-center gap-3">
		<Icon name="lucide:radio" class="size-5 text-primary-500" />
		<div class="flex-1">
			<h2 class="font-display text-[15px] font-semibold tracking-tight">Relays</h2>
			<p class="text-[12px] text-[var(--ui-text-muted)]">
				{relays.relays.length} configured · {relays.readableRelays.length} read · {relays.writableRelays.length} write · {relays.online ? 'online' : 'offline'}
			</p>
		</div>
		<Button
			color="neutral"
			variant="ghost"
			size="sm"
			icon="lucide:rotate-ccw"
			onclick={relays.reset}
		>
			Reset
		</Button>
	</div>

	<!-- Add relay -->
	<form class="flex gap-2" onsubmit={(e) => (e.preventDefault(), add())}>
		<Input bind:value={newRelay} icon="lucide:plus" placeholder="wss://…" class="flex-1" />
		<Button type="submit" color="primary" variant="solid" icon="lucide:plus">Add</Button>
	</form>

	<!-- Relay list -->
	<ul class="surface-card divide-y divide-[var(--ui-border-muted)]">
		{#each relays.relays as url (url)}
			<li class="flex items-center gap-3 px-4 py-3">
				<!-- Status dot -->
				<span
					class="size-2 shrink-0 rounded-full"
					class:bg-primary-500={relays.isActive(url)}
					class:bg-[var(--ui-text-dimmed)]={!relays.isActive(url)}
				></span>

				<!-- URL -->
				<div class="min-w-0 flex-1">
					<div class="truncate font-mono text-[12.5px] text-[var(--ui-text)]">
						{url}
					</div>
					<div
						class="mt-0.5 text-[10.5px] font-semibold"
						class:text-emerald-600={relayTests[url]?.status === 'ok'}
						class:dark:text-emerald-400={relayTests[url]?.status === 'ok'}
						class:text-amber-600={relayTests[url]?.status === 'testing'}
						class:dark:text-amber-400={relayTests[url]?.status === 'testing'}
						class:text-[var(--tone-error-text)]={relayTests[url]?.status === 'failed'}
						class:text-[var(--ui-text-dimmed)]={!relayTests[url] || relayTests[url]?.status === 'idle'}
					>
						{testLabel(url)}
					</div>
				</div>

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
					<button
						type="button"
						class="grid size-7 place-items-center rounded-md bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)] disabled:cursor-wait disabled:opacity-60"
						onclick={() => testRelay(url)}
						disabled={relayTests[url]?.status === 'testing'}
						aria-label="Test connection for {url}"
						title="Test connection"
					>
							<Icon
								name={relayTests[url]?.status === 'testing' ? 'lucide:loader-circle' : 'lucide:wifi'}
								class="size-3.5 {relayTests[url]?.status === 'testing' ? 'animate-spin' : ''}"
							/>
					</button>
				</div>

				<!-- Remove -->
				<button
					type="button"
					class="grid size-7 shrink-0 place-items-center rounded-lg text-[var(--ui-text-dimmed)] transition-colors hover:bg-[var(--tone-error-bg)] hover:text-[var(--tone-error-text)]"
					onclick={() => relays.remove(url)}
					aria-label="Remove {url}"
				>
					<Icon name="lucide:x" class="size-4" />
				</button>
			</li>
		{/each}
	</ul>

	<!-- Footer hint -->
	<p class="text-[11.5px] text-[var(--ui-text-dimmed)]">
		{DEFAULT_RELAYS.length} default relays available · Tap R or W to toggle read/write access
	</p>
</div>
