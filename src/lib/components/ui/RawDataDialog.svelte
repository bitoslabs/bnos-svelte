<script lang="ts">
	import Dialog from './Dialog.svelte';
	import Icon from './Icon.svelte';
	import Badge from './Badge.svelte';
	import { createGloIdentifier } from '@bitos/bnos-core/glo';
	import { kindForType } from '$lib/domain/kind';
	import { glo } from '$nostr/store.svelte';
	import { verifyEvent } from 'nostr-tools/pure';

	let {
		open = $bindable(),
		data,
		title = 'Raw Data'
	}: { open?: boolean; data: unknown; title?: string } = $props();

	type Tab = 'overview' | 'data' | 'event' | 'meta';
	let tab = $state<Tab>('overview');
	let copied = $state<'' | 'tab' | 'id' | 'pubkey' | 'sig'>('');
	let liveOverride = $state<any>(null);
	let fetching = $state(false);

	function flash(which: '' | 'tab' | 'id' | 'pubkey' | 'sig') {
		copied = which;
		setTimeout(() => (copied = ''), 1400);
	}

	// ── Normalize the incoming payload ───────────────────────
	const obj = $derived(data as any);
	const isGlo = $derived(
		!!obj && typeof obj === 'object' && 'type' in obj && 'data' in obj && 'id' in obj
	);
	const liveEvent = $derived(liveOverride ?? (isGlo ? (obj as any).__event : undefined));

	/** Cryptographic id + signature check on the live event (null = no live event / preview). */
	const sigValid = $derived.by<'yes' | 'no' | null>(() => {
		if (!liveEvent) return null;
		try {
			return verifyEvent(liveEvent as any) ? 'yes' : 'no';
		} catch {
			return 'no';
		}
	});

	function trunc(s: string | undefined, n = 12): string {
		if (!s) return '—';
		return s.length <= n ? s : `${s.slice(0, n)}…${s.slice(-4)}`;
	}
	function timeOf(ts?: number): string {
		if (!ts || !Number.isFinite(ts)) return '—';
		return new Date(ts * 1000).toLocaleString();
	}

	/** Reconstruct a representative Nostr event when the live one isn't cached. */
	const eventView = $derived.by(() => {
		if (liveEvent) return { event: liveEvent, live: true };
		if (!isGlo) return { event: null, live: false };
		const type = obj.type as string;
		const id = obj.id as string;
		const created =
			(obj.__eventCreatedAt as number | undefined) ??
			Math.floor(Date.parse(obj.data?.updatedAt ?? obj.data?.createdAt ?? '') / 1000) ??
			Math.floor(Date.now() / 1000);
		return {
			event: {
				pubkey: obj.scope?.ownerPubkey ?? '(set at sign)',
				created_at: created,
				kind: kindForType(type),
				tags: [['d', createGloIdentifier(type, id)]],
				content: obj.encryption
					? '(encrypted GLO payload — AES-256-GCM)'
					: JSON.stringify({ spec: obj.spec, version: obj.version, type, id, data: obj.data }),
				id: '(not cached — re-sync to view)',
				sig: '(not cached — re-sync to view)'
			},
			live: false
		};
	});

	// Top-level data keys for the overview preview
	const dataKeys = $derived(
		isGlo && obj.data && typeof obj.data === 'object' ? Object.keys(obj.data).slice(0, 8) : []
	);

	function pretty(v: unknown): string {
		return JSON.stringify(v, null, 2);
	}
	function currentJson(): string {
		if (tab === 'overview' || tab === 'meta') return pretty(isGlo ? metaView() : obj);
		if (tab === 'event') return eventView.event ? pretty(eventView.event) : '';
		return pretty(isGlo ? obj.data : obj);
	}
	function metaView() {
		if (!isGlo) return {};
		const { data: _d, __event: _e, __eventCreatedAt: _c, ...rest } = obj as any;
		return rest;
	}

	function copy(which: '' | 'tab' | 'id' | 'pubkey' | 'sig') {
		let text = '';
		if (which === 'tab') text = currentJson();
		else if (which === 'id') text = liveEvent?.id ?? (isGlo ? obj.__eventId : '') ?? '';
		else if (which === 'pubkey') text = liveEvent?.pubkey ?? '';
		else if (which === 'sig') text = liveEvent?.sig ?? '';
		if (text) {
			navigator.clipboard?.writeText(text);
			flash(which);
		}
	}

	function download() {
		const payload = isGlo
			? { object: metaView(), data: obj.data, ...(eventView.event ? { event: eventView.event } : {}) }
			: obj;
		const blob = new Blob([pretty(payload)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${isGlo ? `${obj.type}-${String(obj.id).slice(0, 8)}` : 'record'}.json`;
		a.click();
		URL.revokeObjectURL(url);
	}

	// Reset to overview whenever a new record is opened.
	$effect(() => {
		if (open) {
			tab = 'overview';
			liveOverride = null;
			fetching = false;
		}
	});

	// Lazy-fetch the live signed event when the Nostr Event tab is opened.
	// Single-record relay query; cached in-memory by glo.fetchEvent so repeats are instant.
	$effect(() => {
		if (!open || tab !== 'event' || !isGlo) return;
		if (liveEvent || fetching) return;
		fetching = true;
		void glo.fetchEvent(obj.type, obj.id).then((ev) => {
			if (ev) liveOverride = ev;
			fetching = false;
		});
	});
</script>

<Dialog bind:open {title} size="xl">
	<div class="flex items-center justify-between gap-2 border-b border-[var(--ui-border-muted)] px-4 py-2.5">
		<div class="flex items-center gap-2">
			{#if isGlo}<Badge color="primary">{obj.type}</Badge>{/if}
			{#if liveEvent}
				<Badge color="success"><span class="size-1.5 rounded-full bg-emerald-500" /> Live event</Badge>
				{#if sigValid === 'yes'}
					<Badge color="success"><Icon name="lucide:shield-check" class="mr-1 size-3" /> Verified</Badge>
				{:else if sigValid === 'no'}
					<Badge color="error"><Icon name="lucide:shield-x" class="mr-1 size-3" /> Invalid sig</Badge>
				{/if}
			{:else if fetching}
				<Badge color="info"><Icon name="lucide:loader-circle" class="mr-1 size-3 animate-spin" /> Fetching</Badge>
			{:else if isGlo}
				<Badge color="neutral">Preview</Badge>
			{/if}
		</div>
		<div class="flex items-center gap-1">
			<button
				type="button"
				onclick={() => copy('tab')}
				class="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11.5px] font-semibold text-primary-600 hover:bg-primary-500/10 dark:text-primary-400"
			>
				<Icon name={copied === 'tab' ? 'lucide:check' : 'lucide:copy'} class="size-3.5" />
				{copied === 'tab' ? 'Copied' : 'Copy'}
			</button>
			<button
				type="button"
				onclick={download}
				title="Download JSON"
				class="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11.5px] font-semibold text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)]"
			>
				<Icon name="lucide:download" class="size-3.5" />
			</button>
		</div>
	</div>

	<!-- Tabs -->
	<div class="flex gap-1 border-b border-[var(--ui-border-muted)] px-3 pt-2">
		{#each [['overview', 'Overview', 'lucide:layout-dashboard'], ['data', 'Data', 'lucide:braces'], ['event', 'Nostr Event', 'lucide:radio'], ['meta', 'Meta', 'lucide:settings-2']] as [t, label, icon] (t)}
			<button
				type="button"
				onclick={() => (tab = t as Tab)}
				class="inline-flex items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-2 text-[12px] font-semibold transition-colors {tab ===
				t
					? 'border-primary-500 text-primary-600 dark:text-primary-400'
					: 'border-transparent text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'}"
			>
				<Icon name={icon} class="size-3.5" />
				{label}
			</button>
		{/each}
	</div>

	<div class="max-h-[58vh] overflow-auto">
		<!-- ── Overview ── -->
		{#if tab === 'overview'}
			<div class="space-y-3 p-4">
				{#if isGlo}
					<dl class="grid grid-cols-1 gap-2 sm:grid-cols-2">
						<div class="rounded-lg border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-3 py-2">
							<dt class="text-[10px] font-semibold tracking-wider text-[var(--ui-text-dimmed)] uppercase">ID</dt>
							<dd class="truncate font-mono text-[11.5px]">{obj.id}</dd>
						</div>
						{#if liveEvent?.id ?? obj.__eventId}
							<div class="rounded-lg border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-3 py-2 sm:col-span-2">
								<div class="flex items-center justify-between">
									<dt class="text-[10px] font-semibold tracking-wider text-[var(--ui-text-dimmed)] uppercase">Nostr event id</dt>
									<button
										type="button"
										onclick={() => copy('id')}
										class="text-[var(--ui-text-dimmed)] hover:text-primary-500"
										title="Copy event id"
									>
										<Icon name={copied === 'id' ? 'lucide:check' : 'lucide:copy'} class="size-3" />
									</button>
								</div>
								<dd class="truncate font-mono text-[11.5px]">{liveEvent?.id ?? obj.__eventId}</dd>
							</div>
						{/if}
						<div class="rounded-lg border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-3 py-2">
							<dt class="text-[10px] font-semibold tracking-wider text-[var(--ui-text-dimmed)] uppercase">Kind</dt>
							<dd class="font-mono text-[11.5px]">{liveEvent?.kind ?? (isGlo ? kindForType(obj.type) : '—')}</dd>
						</div>
						<div class="rounded-lg border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-3 py-2">
							<dt class="text-[10px] font-semibold tracking-wider text-[var(--ui-text-dimmed)] uppercase">Created</dt>
							<dd class="text-[11.5px]">{timeOf(liveEvent?.created_at ?? obj.__eventCreatedAt)}</dd>
						</div>
						<div class="rounded-lg border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-3 py-2">
							<dt class="text-[10px] font-semibold tracking-wider text-[var(--ui-text-dimmed)] uppercase">Author</dt>
							<dd class="truncate font-mono text-[11.5px]">{trunc(liveEvent?.pubkey ?? obj.scope?.ownerPubkey, 16)}</dd>
						</div>
						<div class="rounded-lg border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-3 py-2">
							<dt class="text-[10px] font-semibold tracking-wider text-[var(--ui-text-dimmed)] uppercase">Visibility</dt>
							<dd class="text-[11.5px] capitalize">{obj.visibility ?? '—'}</dd>
						</div>
						<div class="rounded-lg border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-3 py-2">
							<dt class="text-[10px] font-semibold tracking-wider text-[var(--ui-text-dimmed)] uppercase">Encrypted</dt>
							<dd class="text-[11.5px]">{obj.encryption ? 'Yes' : 'No'}</dd>
						</div>
					</dl>
					{#if dataKeys.length}
						<div>
							<p class="mb-1.5 text-[10px] font-semibold tracking-wider text-[var(--ui-text-dimmed)] uppercase">
								Data preview
							</p>
							<div class="flex flex-wrap gap-1.5">
								{#each dataKeys as k (k)}
									<span
										class="inline-flex items-center gap-1 rounded-md bg-[var(--ui-bg-muted)] px-2 py-0.5 font-mono text-[11px] text-[var(--ui-text-muted)]"
									>
										{k}
									</span>
								{/each}
							</div>
						</div>
					{/if}
				{:else}
					<p class="text-[12.5px] text-[var(--ui-text-muted)]">No structured object — see the Data tab.</p>
				{/if}
			</div>
		{/if}

		<!-- ── Data ── -->
		{#if tab === 'data'}
			<pre class="bg-[var(--ui-bg-muted)] p-4 text-[11.5px] leading-relaxed"><code>{pretty(
					isGlo ? obj.data : obj
				)}</code></pre>
		{/if}

		<!-- ── Nostr Event ── -->
		{#if tab === 'event'}
			<div class="space-y-3 p-4">
				{#if fetching && !eventView.live}
					<div class="flex items-center gap-2 rounded-lg border border-sky-500/30 bg-sky-500/5 px-3 py-2 text-[11.5px] text-sky-700 dark:text-sky-300">
						<Icon name="lucide:loader-circle" class="size-3.5 animate-spin" />
						Fetching live event from relays…
					</div>
				{/if}
				{#if !eventView.live}
					{#if !fetching}
						<div
							class="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11.5px] text-amber-700 dark:text-amber-300"
						>
							<Icon name="lucide:info" class="mt-0.5 size-3.5 shrink-0" />
							<span>
								Reconstructed preview — the live <code class="font-mono">id</code> / <code class="font-mono">sig</code>
								weren't cached locally and none arrived from relays (offline or not yet published).
							</span>
						</div>
					{/if}
				{:else}
					{#if sigValid === 'yes'}
						<div class="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-[11.5px] text-emerald-700 dark:text-emerald-300">
							<Icon name="lucide:shield-check" class="size-3.5" />
							Signature &amp; event id verified — content is authentic and untampered.
						</div>
					{:else if sigValid === 'no'}
						<div class="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-[11.5px] text-red-600 dark:text-red-400">
							<Icon name="lucide:shield-x" class="size-3.5" />
							Signature invalid — the id or signature does not match. This event may be corrupt or tampered.
						</div>
					{/if}
					<div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
						{#each [['id', eventView.event?.id, 'id'], ['pubkey', eventView.event?.pubkey, 'pubkey'], ['sig', eventView.event?.sig, 'sig']] as [label, value, which] (label)}
							<div class="rounded-lg border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-3 py-2">
								<div class="mb-0.5 flex items-center justify-between">
									<span class="text-[10px] font-semibold tracking-wider text-[var(--ui-text-dimmed)] uppercase">{label}</span>
									<button
										type="button"
										onclick={() => copy(which as 'id' | 'pubkey' | 'sig')}
										class="text-[var(--ui-text-dimmed)] hover:text-primary-500"
										title={`Copy ${label}`}
									>
										<Icon name={copied === which ? 'lucide:check' : 'lucide:copy'} class="size-3" />
									</button>
								</div>
								<div class="truncate font-mono text-[10.5px]">{trunc(value, 18)}</div>
							</div>
						{/each}
					</div>
				{/if}
				<pre class="bg-[var(--ui-bg-muted)] p-4 text-[11.5px] leading-relaxed"><code>{eventView.event
						? pretty(eventView.event)
						: 'No event available.'}</code></pre>
			</div>
		{/if}

		<!-- ── Meta ── -->
		{#if tab === 'meta'}
			<pre class="bg-[var(--ui-bg-muted)] p-4 text-[11.5px] leading-relaxed"><code>{pretty(
					metaView()
				)}</code></pre>
		{/if}
	</div>
</Dialog>
