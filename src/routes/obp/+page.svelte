<script lang="ts">
	/**
	 * OBP pilot console (feature-gated). Read-mostly shadow view over the
	 * local business node: document inbox, append-only logs, settlement
	 * status, audit trail, plus RFQ composition from existing
	 * purchase-order drafts through the read-only adapter mapping.
	 */
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { features } from '$lib/features.svelte';
	import { session } from '$nostr/session.svelte';
	import { relays } from '$nostr/relay.svelte';
	import { glo } from '$nostr/store.svelte';
	import { TYPE, type PurchaseOrder, type Supplier } from '$lib/domain';
	import { CURRENCY_MINOR_UNITS, type ObpDocumentProjection } from '$lib/obp';
	import { obpNode, orgIdForPubkey } from '$lib/obp-adapter/node.svelte';
	import { rfqInputFromPurchaseOrder } from '$lib/obp-adapter/mapping';

	let enabled = $derived(features.isEnabled('obp'));
	let ourOrgId = $derived(session.pubkey ? orgIdForPubkey(session.pubkey) : null);

	// ── Node data (polled while running — relay inbox is push, stores are pull)
	let documents = $state<ObpDocumentProjection[]>([]);
	let selected = $state<{ doc: ObpDocumentProjection; log: { at: string; action: string; decision: string; from: string }[] } | null>(null);
	let audit = $state<{ at: string; kind: string; detail: string }[]>([]);
	let outboxPending = $state(0);
	let busy = $derived(obpNode.status === 'starting');
	let message = $state<string | null>(null);

	async function refresh() {
		const node = obpNode.node;
		if (!node) {
			documents = [];
			selected = null;
			audit = [];
			return;
		}
		documents = await node.listDocuments();
		audit = (await node.listAudit(12)).slice().reverse();
		outboxPending = (await node.pendingOutbox()).length;
		if (selected) {
			const doc = documents.find((d) => d.documentId === selected!.doc.documentId);
			if (!doc) selected = null;
			else {
				const log = await node.getDocumentLog(doc.documentId);
				selected = {
					doc,
					log: log.map((m) => ({
						at: m.receivedAt,
						action: m.envelope.action,
						decision: m.decision,
						from: m.envelope.issuer === ourOrgId ? 'us' : m.envelope.issuer
					}))
				};
			}
		}
	}

	let timer: ReturnType<typeof setInterval> | undefined;
	onMount(() => {
		features.load();
		void maybeAutostart();
		timer = setInterval(() => {
			if (obpNode.status === 'running') void refresh();
		}, 5000);
		return () => clearInterval(timer);
	});

	async function maybeAutostart() {
		if (obpNode.status === 'off' && obpNode.canStart) await obpNode.start();
		void refresh();
	}

	async function startNode() {
		await obpNode.start();
		await refresh();
	}

	async function selectDoc(doc: ObpDocumentProjection) {
		const node = obpNode.node;
		if (!node) return;
		const log = await node.getDocumentLog(doc.documentId);
		selected = {
			doc,
			log: log.map((m) => ({
				at: m.receivedAt,
				action: m.envelope.action,
				decision: m.decision,
				from: m.envelope.issuer === ourOrgId ? 'us' : m.envelope.issuer
			}))
		};
	}

	async function respond(doc: ObpDocumentProjection, action: 'accept' | 'reject') {
		if (!obpNode.node || !obpNode.ownSignerKeyId) return;
		try {
			message = null;
			await obpNode.node.respond({
				documentId: doc.documentId,
				action,
				signerKeyId: obpNode.ownSignerKeyId
			});
			message = `${action} sent for ${doc.documentType} ${doc.documentId.slice(0, 8)}…`;
		} catch (e) {
			message = e instanceof Error ? e.message : String(e);
		}
		await refresh();
	}

	// ── RFQ composition from local purchase-order drafts
	let suppliers = $derived(
		glo.all<Supplier, typeof TYPE.supplier>(TYPE.supplier).filter((s) => !!s.data?.pubkey)
	);
	let drafts = $derived(
		glo.all<PurchaseOrder, typeof TYPE.purchaseOrder>(TYPE.purchaseOrder).filter(
			(p) => p.data.status === 'draft' && (p.data.lines?.length ?? 0) > 0
		)
	);
	let chosenSupplier = $state('');
	let chosenDraft = $state('');

	async function sendRfq() {
		const node = obpNode.node;
		if (!node || !obpNode.ownSignerKeyId) return;
		const supplier = suppliers.find((s) => s.id === chosenSupplier);
		const draft = drafts.find((p) => p.id === chosenDraft);
		if (!supplier?.data?.pubkey || !draft) return;
		try {
			message = null;
			const input = rfqInputFromPurchaseOrder(draft.data, {
				orgId: ourOrgId ?? '',
				signerKeyId: obpNode.ownSignerKeyId,
				recipient: orgIdForPubkey(supplier.data.pubkey)
			});
			const result = await node.issue(input);
			message = result.delivered
				? `RFQ ${result.envelope.documentId.slice(0, 8)}… sent to ${supplier.data.name}`
				: `RFQ queued in outbox (transport: ${result.transportError})`;
			chosenSupplier = '';
			chosenDraft = '';
		} catch (e) {
			message = e instanceof Error ? e.message : String(e);
		}
		await refresh();
	}

	// ── Display helpers
	const TYPE_LABEL: Record<string, string> = {
		rfq: 'RFQ',
		quote: 'Quote',
		purchase_order: 'Order',
		invoice: 'Invoice',
		payment_evidence: 'Payment',
		receipt: 'Receipt'
	};
	function amount(doc: ObpDocumentProjection): string {
		const digits = CURRENCY_MINOR_UNITS[doc.currency] ?? 0;
		return `${(doc.totalsMinor / 10 ** digits).toLocaleString()} ${doc.currency}`;
	}
	function canRespond(doc: ObpDocumentProjection): boolean {
		return doc.state === 'issued' && doc.recipient === ourOrgId;
	}
</script>

<svelte:head><title>BNOS · OBP Purchasing</title></svelte:head>

{#if !enabled}
	<!-- Feature gate: graceful CTA (marketplace pattern) -->
	<div class="mx-auto max-w-xl py-16 text-center sm:py-24">
		<div
			class="mx-auto grid size-16 place-items-center rounded-2xl bg-gradient-to-br from-orange-500/20 to-amber-500/20 text-orange-500"
		>
			<Icon name="lucide:file-signature" class="size-8" />
		</div>
		<h1 class="mt-5 font-display text-2xl font-bold tracking-tight">OBP Purchasing</h1>
		<p class="mx-auto mt-2 max-w-md text-[13.5px] leading-relaxed text-[var(--ui-text-muted)]">
			Open Business Protocol pilot: exchange signed RFQs, quotes, orders, invoices and payment
			receipts directly with your suppliers' nodes — no shared database.
		</p>
		<div class="mt-6 flex items-center justify-center gap-2">
			<Button color="primary" icon="lucide:rocket" onclick={() => features.set('obp', true)}>
				Enable pilot
			</Button>
			<Button color="neutral" variant="subtle" icon="lucide:settings" href={resolve('/settings/features')}>
				Module settings
			</Button>
		</div>
	</div>
{:else}
	<div class="space-y-5">
		<!-- Header + node control -->
		<div class="flex flex-wrap items-center justify-between gap-3">
			<div class="flex items-center gap-3">
				<div
					class="grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-orange-500/20 to-amber-500/20 text-orange-600 dark:text-orange-400"
				>
					<Icon name="lucide:file-signature" class="size-5" />
				</div>
				<div>
					<h1 class="font-display text-xl font-bold tracking-tight">OBP Purchasing</h1>
					<p class="text-[12px] text-[var(--ui-text-muted)]">
						{obpNode.counterparties.length} counterparties · {relays.writableNormalized.length} relays
						{#if outboxPending}
							· {outboxPending} queued
						{/if}
					</p>
				</div>
			</div>
			<div class="flex items-center gap-2">
				{#if obpNode.status === 'running'}
					<span class="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11.5px] font-semibold text-emerald-600 dark:text-emerald-400">
						<span class="size-1.5 rounded-full bg-emerald-500"></span>
						Node running
					</span>
					<Button color="neutral" variant="subtle" icon="lucide:power" onclick={() => { obpNode.stop(); void refresh(); }}>
						Stop
					</Button>
				{:else}
					<Button
						color="primary"
						icon="lucide:power"
						disabled={busy || !obpNode.canStart}
						onclick={startNode}
					>
						{busy ? 'Starting…' : 'Start node'}
					</Button>
				{/if}
			</div>
		</div>

		{#if obpNode.status !== 'running'}
			<div class="rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-bg)] p-4 text-[13px] text-[var(--ui-text-muted)]">
				{#if obpNode.blockers.length}
					<ul class="list-inside list-disc space-y-1">
						{#each obpNode.blockers as blocker (blocker)}
							<li>{blocker}</li>
						{/each}
					</ul>
				{:else}
					Start the node to send and receive signed OBP documents over Nostr.
				{/if}
				{#if obpNode.error}
					<p class="mt-2 text-[var(--tone-error-text)]">{obpNode.error}</p>
				{/if}
			</div>
		{/if}

		{#if message}
			<div class="rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg)] px-4 py-2.5 text-[12.5px]">
				{message}
			</div>
		{/if}

		<!-- RFQ composer -->
		{#if obpNode.status === 'running' && suppliers.length && drafts.length}
			<div class="rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-bg)] p-4">
				<h2 class="mb-3 text-[13px] font-semibold">Request a quote</h2>
				<div class="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
					<select class="obp-select" bind:value={chosenSupplier}>
						<option value="">Supplier…</option>
						{#each suppliers as s (s.id)}
							<option value={s.id}>{s.data.name}</option>
						{/each}
					</select>
					<select class="obp-select" bind:value={chosenDraft}>
						<option value="">Purchase-order draft…</option>
						{#each drafts as d (d.id)}
							<option value={d.id}>{d.data.number} · {d.data.lines.length} lines · {d.data.total} {d.data.currency}</option>
						{/each}
					</select>
					<Button color="primary" icon="lucide:send" disabled={!chosenSupplier || !chosenDraft} onclick={sendRfq}>
						Send RFQ
					</Button>
				</div>
				<p class="mt-2 text-[11.5px] text-[var(--ui-text-muted)]">
					The local draft keeps its id and kind; the RFQ is linked via the OBP link store.
				</p>
			</div>
		{/if}

		<!-- Documents -->
		<div class="overflow-hidden rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-bg)]">
			<table class="w-full text-left text-[13px]">
				<thead class="border-b border-[var(--ui-border)] text-[11.5px] uppercase tracking-wide text-[var(--ui-text-muted)]">
					<tr>
						<th class="px-4 py-2.5 font-semibold">Document</th>
						<th class="px-4 py-2.5 font-semibold">Counterparty</th>
						<th class="px-4 py-2.5 text-right font-semibold">Amount</th>
						<th class="px-4 py-2.5 font-semibold">State</th>
						<th class="px-4 py-2.5 font-semibold">Settlement</th>
					</tr>
				</thead>
				<tbody>
					{#if documents.length === 0}
						<tr><td colspan="5" class="px-4 py-6 text-center text-[var(--ui-text-muted)]">No OBP documents yet.</td></tr>
					{/if}
					{#each documents as doc (doc.documentId)}
						<tr
							class="cursor-pointer border-b border-[var(--ui-border)] last:border-0 hover:bg-[var(--ui-bg-hover)]"
							onclick={() => void selectDoc(doc)}
							class:bg-[var(--ui-bg-active)]={selected?.doc.documentId === doc.documentId}
						>
							<td class="px-4 py-2.5 font-semibold">{TYPE_LABEL[doc.documentType] ?? doc.documentType}</td>
							<td class="px-4 py-2.5 text-[var(--ui-text-muted)]">
								{doc.issuer === ourOrgId ? doc.recipient : doc.issuer}
							</td>
							<td class="px-4 py-2.5 text-right tabular-nums">{amount(doc)}</td>
							<td class="px-4 py-2.5"><span class="obp-state" data-state={doc.state}>{doc.state}</span></td>
							<td class="px-4 py-2.5">
								{#if doc.documentType === 'invoice'}
									<span class="obp-state" data-state={doc.settlement}>{doc.settlement}</span>
								{:else}
									—
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<!-- Selected document detail -->
		{#if selected}
			<div class="rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-bg)] p-4">
				<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
					<h2 class="text-[13px] font-semibold">
						{TYPE_LABEL[selected.doc.documentType] ?? selected.doc.documentType}
						· {selected.doc.documentId.slice(0, 8)}…
					</h2>
					{#if canRespond(selected.doc)}
						<div class="flex gap-2">
							<Button color="primary" icon="lucide:check" onclick={() => respond(selected!.doc, 'accept')}>Accept</Button>
							<Button color="neutral" variant="subtle" icon="lucide:x" onclick={() => respond(selected!.doc, 'reject')}>Reject</Button>
						</div>
					{/if}
				</div>
				<ol class="space-y-1.5 text-[12.5px]">
					{#each selected.log as entry (entry.at + entry.action)}
						<li class="flex items-center gap-2">
							<span class="tabular-nums text-[var(--ui-text-muted)]">{new Date(entry.at).toLocaleString()}</span>
							<span class="font-semibold">{entry.action}</span>
							<span class="text-[var(--ui-text-muted)]">from {entry.from === 'us' ? 'us' : entry.from.slice(0, 18) + '…'}</span>
							<span
								class="rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold {entry.decision === 'accepted'
									? 'bg-emerald-500/10 text-emerald-600'
									: 'bg-red-500/10 text-red-600'}"
							>
								{entry.decision}
							</span>
						</li>
					{/each}
				</ol>
			</div>
		{/if}

		<!-- Audit tail -->
		{#if audit.length}
			<div class="rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-bg)] p-4">
				<h2 class="mb-2 text-[13px] font-semibold">Audit trail</h2>
				<ul class="space-y-1 text-[11.5px] text-[var(--ui-text-muted)]">
					{#each audit as entry (entry.at + entry.detail)}
						<li><span class="tabular-nums">{new Date(entry.at).toLocaleTimeString()}</span> · {entry.detail}</li>
					{/each}
				</ul>
			</div>
		{/if}
	</div>
{/if}

<style>
	.obp-select {
		width: 100%;
		border-radius: 0.75rem;
		border: 1px solid var(--ui-border);
		background: var(--ui-bg);
		padding: 0.5rem 0.75rem;
		font-size: 13px;
		color: inherit;
	}
	.obp-state {
		display: inline-block;
		border-radius: 9999px;
		padding: 0.125rem 0.5rem;
		font-size: 11px;
		font-weight: 600;
		background: var(--ui-bg-hover, rgb(0 0 0 / 0.06));
	}
	.obp-state[data-state='accepted'],
	.obp-state[data-state='verified'],
	.obp-state[data-state='paid'] {
		background: rgb(16 185 129 / 0.12);
		color: rgb(5 150 105);
	}
	.obp-state[data-state='rejected'],
	.obp-state[data-state='failed'] {
		background: rgb(239 68 68 / 0.12);
		color: rgb(220 38 38);
	}
</style>
