<script lang="ts">
	import { t } from '$lib/i18n/i18n.svelte';
	import { scale } from 'svelte/transition';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import QrCode from '$lib/components/ui/QrCode.svelte';
	import { formatInt, formatMoney } from '$lib/utils/format';
	import { toast } from '$lib/stores/toast.svelte';
	import { fmtCountdown, type PaymentQrFlowStore } from '$lib/pos/payment-qr-flow.svelte';

	/**
	 * Payment QR checkout dialog — pure presentation over `PaymentQrFlowStore`.
	 *
	 * UX principles (production POS: the cashier glances, doesn't read):
	 *  • Amount hero at the top — the number the customer owes, biggest thing.
	 *  • Honest 3-step timeline (Invoice → Payment → Confirmed). No fake
	 *    percentages: a payment isn't "66% complete", it's *awaiting*.
	 *  • Real countdown: a depleting bar under the QR, red under 60s; expiry
	 *    greys the QR and promotes "New invoice".
	 *  • Paid moment: animated check + non-dismissable while the sale records.
	 *  • "Check payment" gives inline feedback (stays in context, no toasts).
	 */
	let {
		flow,
		currency,
		showSats = false,
		satsFromAmount,
		onclose,
		onconfirm
	}: {
		flow: PaymentQrFlowStore;
		currency: string;
		showSats?: boolean;
		satsFromAmount: (amountLocal: number) => number;
		onclose: () => void;
		onconfirm: () => void;
	} = $props();

	const QR_WINDOW_SEC = 15 * 60;

	// Reconcile the Dialog's bind:open with the store's open flag. The flag
	// guards the race where ESC flips the local flag false a tick before the
	// store processes onclose() — without it the "store→show" effect would
	// instantly re-open the dialog.
	let dlgOpen = $state(false);
	let userDismissed = false;
	// store open → show
	$effect(() => {
		if (flow.open && !userDismissed) dlgOpen = true;
	});
	// store closed → hide (and re-arm for the next open)
	$effect(() => {
		if (!flow.open && dlgOpen) {
			dlgOpen = false;
			userDismissed = false;
		}
	});
	// user dismissed (ESC/backdrop) → hand off to the store once
	$effect(() => {
		if (!dlgOpen && flow.open && !userDismissed) {
			userDismissed = true;
			onclose();
		}
	});

	const isLightning = $derived(flow.method === 'lightning');
	/** Timeline steps: state + label (honest — no fake percentages). */
	const steps = $derived([
		{ state: 'done' as const, label: isLightning ? 'Invoice' : 'QR ready' },
		{
			state: (flow.paid ? 'done' : flow.phase === 'awaiting' || flow.phase === 'expired' ? 'active' : 'pending') as
				| 'done'
				| 'active'
				| 'pending',
			label: isLightning ? 'Payment' : 'Scan & pay'
		},
		{ state: (flow.paid ? 'done' : 'pending') as 'done' | 'pending', label: 'Confirmed' }
	]);
	const satsHint = $derived(
		flow.invoice?.amountSats ?? satsFromAmount(flow.amount)
	);
	const countdownPct = $derived(Math.max(0, Math.min(100, (flow.secondsLeft / QR_WINDOW_SEC) * 100)));
	const urgent = $derived(flow.secondsLeft < 60);
	const qrDimmed = $derived(flow.expired && !flow.paid);

	/** Honest memo delivery: where the customer/merchant actually sees it. */
	const memoDeliveryInfo = $derived.by(() => {
		switch (flow.memoDelivery) {
			case 'invoice':
				return {
					icon: 'lucide:eye',
					text: 'Shown in the customer\u2019s wallet — embedded in the invoice description.',
					cls: 'text-emerald-600 dark:text-emerald-400'
				};
			case 'comment':
				return {
					icon: 'lucide:mail',
					text: 'Delivered as a payment note to your receiving wallet (Lightning Address providers set the customer-visible text themselves).',
					cls: 'text-[var(--ui-text-muted)]'
				};
			case 'zap':
				return {
					icon: 'lucide:zap',
					text: 'Attached to the zap receipt in your Nostr notifications.',
					cls: 'text-[var(--ui-text-muted)]'
				};
			default:
				// Static fallback QR (no live invoice) vs a live invoice whose
				// provider rejects memos — different causes, same "no memo" truth.
				return {
					icon: 'lucide:info',
					text: !flow.isInvoice
						? 'Static address QR — the customer\u2019s wallet creates the payment itself, so no memo can travel.'
						: 'This provider accepts no memo — the customer sees the provider\u2019s own description.',
					cls: 'text-[var(--ui-text-muted)]'
				};
		}
	});
</script>

<Dialog bind:open={dlgOpen} title={t('common.scanToPay')} size="md" dismissible={!flow.paid && !flow.loading}>
	{#if flow.result}
		<div class="flex flex-col items-center gap-4 py-2">
			<!-- Header: method + kind badge -->
			<div class="flex w-full items-center justify-between">
				<div class="flex items-center gap-2">
					<div
						class="grid size-8 place-items-center rounded-xl {isLightning
							? 'bg-amber-500/10 text-amber-500'
							: 'bg-primary-500/10 text-primary-500'}"
					>
						<Icon name={isLightning ? 'lucide:zap' : 'lucide:qr-code'} class="size-4" />
					</div>
					<div>
						<p class="text-[12px] font-bold text-[var(--ui-text)]">
							{isLightning ? 'Lightning checkout' : 'QR checkout'}
						</p>
						<p class="text-[10px] font-medium text-[var(--ui-text-dimmed)]">
							{isLightning ? 'Secure wallet payment' : 'Secure scan to pay'}
						</p>
					</div>
				</div>
				<span
					class="rounded-full bg-[var(--ui-bg-muted)] px-2.5 py-1 text-[10px] font-bold text-[var(--ui-text-muted)] capitalize"
				>
					{flow.result.kind}
				</span>
			</div>

			<!-- Amount hero: the number the customer owes. -->
			<div class="text-center">
				<p class="text-[10.5px] font-semibold tracking-wider text-[var(--ui-text-dimmed)] uppercase">
					{t('pos.amountDue')}
				</p>
				<p class="font-display text-[32px] leading-tight font-black tabular-nums">
					{formatMoney(flow.amount, currency)}
				</p>
				{#if showSats || isLightning}
					<p
						class="flex items-center justify-center gap-1 text-[11px] font-semibold text-[var(--tone-warning-text)]"
					>
						<Icon name="lucide:zap" class="size-3" />≈ {formatInt(satsHint)} sats
					</p>
				{/if}
			</div>

			<!-- Honest 3-step timeline (no fake percentages). -->
			<div class="grid w-full grid-cols-3 gap-1.5" aria-hidden="true">
				{#each steps as s, i (i)}
					<div class="flex items-center gap-1.5 text-[10px] font-semibold {s.state === 'done'
						? 'text-emerald-600 dark:text-emerald-400'
						: s.state === 'active'
							? 'text-amber-700 dark:text-amber-300'
							: 'text-[var(--ui-text-dimmed)]'}"
					>
						{#if s.state === 'done'}
							<Icon name="lucide:check-circle-2" class="size-3.5 shrink-0" />
						{:else if s.state === 'active'}
							<span class="relative flex size-3.5 shrink-0">
								<span
									class="absolute inline-flex size-full animate-ping rounded-full bg-amber-400 opacity-75"></span>
								<span class="relative inline-flex size-3.5 rounded-full bg-amber-500"></span>
							</span>
						{:else}
							<span class="size-3.5 shrink-0 rounded-full border-2 border-[var(--ui-border)]"></span>
						{/if}
						<span class="truncate">{s.label}</span>
					</div>
				{/each}
			</div>

			<!-- QR stage: skeleton while fetching, dim on expiry, check on paid. -->
			<div class="relative">
				<div
					class="rounded-2xl border border-[var(--ui-border)] bg-white p-3 shadow-sm transition-all duration-500 {qrDimmed
						? 'scale-[0.97] opacity-40 grayscale'
						: ''}"
				>
					{#if flow.fetching}
						<div
							class="flex size-[224px] flex-col items-center justify-center gap-3 text-[var(--ui-text-dimmed)]"
						>
							<Icon name="lucide:loader-circle" class="size-8 animate-spin text-amber-500" />
							<span class="text-[11.5px] font-semibold">Generating Lightning invoice…</span>
							<span class="text-[10px] text-[var(--ui-text-dimmed)]">Contacting wallet provider</span>
						</div>
					{:else if flow.result.payload}
						<QrCode value={flow.result.payload} size={224} badge={flow.result.badge} />
					{:else}
						<div class="flex size-[224px] items-center justify-center text-[var(--ui-text-dimmed)]">
							<Icon name="lucide:qr-code" class="size-8" />
						</div>
					{/if}
				</div>

				{#if flow.paid}
					<!-- Paid moment -->
					<div
						class="absolute inset-0 grid place-items-center rounded-2xl bg-emerald-500/95"
						transition:scale={{ start: 0.8, duration: 250 }}
					>
						<div class="flex flex-col items-center gap-1.5 text-white">
							<Icon name="lucide:check-circle-2" class="size-12" />
							<p class="text-[14px] font-bold">Payment received</p>
							<p class="text-[11px] font-medium opacity-90">Completing sale…</p>
						</div>
					</div>
				{/if}
			</div>

			<!-- Real countdown: depleting bar + clock; red & pulsing under 60s. -->
			{#if !flow.paid}
				<div class="w-full max-w-[260px]">
					<div
						class="h-1.5 overflow-hidden rounded-full {urgent
							? 'bg-[var(--tone-error-bg)]'
							: 'bg-amber-500/15'}"
					>
						<div
							class="h-full rounded-full transition-[width] duration-1000 ease-linear {urgent
								? 'animate-pulse bg-red-500'
								: 'bg-gradient-to-r from-amber-400 to-orange-500'}"
							style="width:{countdownPct}%"
						></div>
					</div>
					<p
						class="mt-1 flex items-center justify-center gap-1 text-[11px] font-semibold {urgent
							? 'text-[var(--tone-error-text)]'
							: 'text-[var(--ui-text-muted)]'}"
					>
						<Icon name="lucide:clock" class="size-3.5" />
						{#if flow.expired}
							Invoice expired — generate a new one below
						{:else}
							Expires in {fmtCountdown(flow.secondsLeft)}
						{/if}
					</p>
				</div>
			{/if}

			<!-- Detection banner: watching (auto) vs manual confirm. -->
			{#if flow.isInvoice && !flow.paid && !flow.expired}
				<div
					class="flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2 text-[11px] font-semibold {flow.watching
						? 'border-amber-500/15 bg-amber-500/5 text-amber-700 dark:text-amber-300'
						: 'border-[var(--ui-border)] bg-[var(--ui-bg-muted)] text-[var(--ui-text-muted)]'}"
				>
					{#if flow.watching}
						<span class="relative flex size-2">
							<span
								class="absolute inline-flex size-full animate-ping rounded-full bg-amber-400 opacity-75"
							></span>
							<span class="relative inline-flex size-2 rounded-full bg-amber-500"></span>
						</span>
						{flow.detectMode === 'instant'
							? 'Watching for payment — detected automatically'
							: 'Checking payment every few seconds'}
					{:else}
						<Icon name="lucide:bell-ring" class="size-3.5 shrink-0" />
						Auto-detect unavailable — use “Check payment” or Mark paid
					{/if}
				</div>
			{/if}

			<!-- Manual check with inline feedback (stays in context). -->
			{#if flow.isInvoice && !flow.paid}
				<div class="w-full space-y-1.5">
					{#if flow.expired}
						<button
							type="button"
							class="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-3 py-2.5 text-[12px] font-bold text-white transition-colors hover:bg-amber-600"
							onclick={() => flow.regenerate()}
						>
							<Icon name="lucide:refresh-cw" class="size-4" />New invoice
						</button>
					{:else}
						<button
							type="button"
							class="flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--ui-border)] bg-[var(--surface-bg)] px-3 py-2 text-[11.5px] font-semibold text-[var(--ui-text)] transition-colors hover:border-primary-500/40 hover:text-primary-600 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:text-primary-400"
							onclick={() => flow.checkNow()}
							disabled={flow.checking || flow.fetching}
						>
							{#if flow.checking}
								<Icon name="lucide:loader-circle" class="size-3.5 animate-spin" />Checking…
							{:else}
								<Icon name="lucide:refresh-cw" class="size-3.5" />Check payment
							{/if}
						</button>
					{/if}
					{#if flow.lastCheck === 'pending'}
						<p class="text-center text-[10.5px] font-medium text-[var(--ui-text-muted)]">
							No payment yet — the invoice is still unpaid. Check again after the customer pays.
						</p>
					{:else if flow.lastCheck === 'unknown'}
						<p class="text-center text-[10.5px] font-medium text-[var(--ui-text-muted)]">
							This provider exposes no payment status — confirm in your wallet app, then tap
							<span class="font-semibold text-[var(--ui-text)]">Mark paid</span>.
						</p>
					{:else if flow.lastCheck === 'error'}
						<p class="text-center text-[10.5px] font-medium text-[var(--tone-error-text)]">
							Check failed — could not reach the provider. Try again.
						</p>
					{/if}
				</div>
			{/if}

			<!-- Meta chips: invoice type + provider. -->
			<div class="flex flex-wrap items-center justify-center gap-1.5">
				{#if flow.isInvoice}
					<span
						class="rounded-full bg-amber-500/10 px-2 py-0.5 text-[9.5px] font-bold text-amber-600 dark:text-amber-400"
						>amount-locked invoice</span
					>
				{/if}
				{#if flow.provider?.label}
					<span
						class="rounded-full bg-[var(--ui-bg-accented)] px-2 py-0.5 text-[9.5px] font-bold text-[var(--ui-text-muted)]"
						>{flow.provider.label}</span
					>
				{/if}
			</div>

			{#if flow.note && isLightning && !flow.paid}
				<div
					class="w-full rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2.5 text-left"
				>
					<div
						class="mb-1 flex items-center gap-1.5 text-[10px] font-bold tracking-wide text-amber-700 uppercase dark:text-amber-300"
					>
						<Icon name="lucide:message-square-text" class="size-3.5" />Invoice memo
					</div>
					<p
						class="text-[12.5px] leading-relaxed font-medium whitespace-pre-wrap break-words text-[var(--ui-text)]"
					>
						{flow.note}
					</p>
					<p class="mt-1.5 flex items-start gap-1.5 text-[10px] leading-snug {memoDeliveryInfo.cls}">
						<Icon name={memoDeliveryInfo.icon} class="mt-px size-3 shrink-0" />
						{memoDeliveryInfo.text}
					</p>
				</div>
			{/if}

			<!-- Quiet utility row. -->
			{#if !flow.paid && flow.result.payload}
				<div class="flex w-full items-center justify-center gap-3">
					<button
						type="button"
						class="flex items-center gap-1 text-[11px] font-semibold text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]"
						onclick={() =>
							navigator.clipboard
								?.writeText(flow.result?.payload ?? '')
								.then(() => toast.success('Payment link copied'))}
					>
						<Icon name="lucide:copy" class="size-3.5" />Copy link
					</button>
					<a
						href={flow.result.payload.startsWith('lightning:')
							? flow.result.payload
							: `lightning:${flow.result.payload}`}
						class="flex items-center gap-1 text-[11px] font-semibold text-amber-600 hover:underline dark:text-amber-400"
					>
						<Icon name="lucide:external-link" class="size-3.5" />Open in wallet
					</a>
					{#if isLightning && !flow.expired && flow.provider}
						<button
							type="button"
							class="flex items-center gap-1 text-[11px] font-semibold text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]"
							onclick={() => flow.regenerate()}
						>
							<Icon name="lucide:refresh-cw" class="size-3.5" />{flow.isInvoice
								? 'New invoice'
								: 'Try live invoice'}
						</button>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
	{#snippet footer()}
		<Button color="neutral" variant="subtle" icon="lucide:x" onclick={onclose} disabled={flow.paid || flow.loading}
			>{t('common.cancel')}</Button
		>
		<Button
			color="primary"
			icon="lucide:check"
			onclick={onconfirm}
			disabled={flow.loading || flow.fetching || flow.paid}
		>
			{#if flow.loading}<Icon name="lucide:loader-circle" class="size-4 animate-spin" />…{:else}Mark paid{/if}
		</Button>
	{/snippet}
</Dialog>
