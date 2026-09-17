<script lang="ts">
	/**
	 * Refund / return dialog — premium, mass-production UX.
	 *
	 * Supports full or line-level partial refunds with per-line quantity +
	 * restock toggles, refund-method selection (defaults to original tender),
	 * reason code + note, a live refund total, a confirm gate, and (optionally)
	 * an auto-printed refund receipt. On confirm it:
	 *   1. persists a `commerce.refund` record (linked to order + active shift)
	 *   2. updates the order status + `refundedAmount`
	 *   3. restocks selected items (mirrors the checkout stock decrement)
	 *   4. nets against the active shift (cash refunds reduce expected drawer)
	 */
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import { t } from '$lib/i18n/i18n.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import { glo } from '$nostr/store.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { session } from '$nostr/session.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { confirm } from '$lib/stores/confirm.svelte';
	import { formatMoney } from '$lib/utils/format';
	import { newRecordId } from '$lib/utils/record-id';
	import { TYPE, type Order, type Payment, type Refund, type GloObject } from '$lib/domain';
	import { shifts as shiftStore } from '$lib/pos/shifts.svelte';
	import { loadGeneralSettings, loadHardwareSettings } from '$lib/settings/local';
	import {
		REFUND_REASONS,
		refundReasonIcon,
		refundableLinesFromOrder,
		buildRefundLines,
		buildRefund,
		computeRefundTotal
	} from '$lib/pos/refund';
	import { printRefundReceipt } from '$lib/pos/print';
	import { logActivity } from '$lib/audit.svelte';

	type Props = {
		open?: boolean;
		order: GloObject<Order, typeof TYPE.order>;
		currency: string;
		/** Amount already refunded against this order (excludes this refund). */
		alreadyRefunded: number;
		/** Original payment method — the refund method defaults to this. */
		originalMethod?: string;
		onDone?: () => void;
	};

	let {
		open = $bindable(false),
		order,
		currency,
		alreadyRefunded = 0,
		originalMethod = 'cash',
		onDone
	}: Props = $props();

	const orderTotal = $derived(order.data.total ?? 0);
	const refundableRemaining = $derived(Math.max(0, orderTotal - alreadyRefunded));

	const lines = $derived(refundableLinesFromOrder(order));

	// Selection state.
	let fullRefund = $state(false);
	let selection = $state<Record<string, number>>({}); // lineId → qty
	let restock = $state<Record<string, boolean>>({}); // lineId → restock?
	let method = $state<string>('cash');
	let reason = $state<Refund['reason']>('customer_request');
	let note = $state('');
	let processing = $state(false);

	// Initialise selection/restock when the dialog opens for a (new) order.
	let lastOrderId = '';
	$effect(() => {
		if (open && order.id !== lastOrderId) {
			lastOrderId = order.id;
			fullRefund = false;
			selection = {};
			restock = {};
			method = originalMethod;
			reason = 'customer_request';
			note = '';
			for (const l of lines) restock[l.id] = true;
		}
	});

	// Keep selection in sync with the "refund entire order" toggle.
	$effect(() => {
		if (fullRefund) {
			const next: Record<string, number> = {};
			for (const l of lines) next[l.id] = l.quantity;
			selection = next;
		}
	});

	const refundLines = $derived(buildRefundLines(lines, selection));
	const refundTotal = $derived(computeRefundTotal(refundLines));
	const selectedCount = $derived(refundLines.length);
	const isFull = $derived(refundTotal >= refundableRemaining - 0.001 && refundTotal > 0);
	const canSubmit = $derived(
		refundTotal > 0 && refundTotal <= refundableRemaining + 0.001 && !processing
	);
	// Large-refund guard — extra confirm for amounts ≥ this share of the order.
	const needsAttention = $derived(refundTotal > 0 && refundTotal >= orderTotal * 0.5);

	function setQty(id: string, qty: number, max: number) {
		if (fullRefund) return;
		const q = Math.max(0, Math.min(max, Math.round(qty)));
		selection = { ...selection, [id]: q };
	}
	function toggleLine(id: string, max: number) {
		if (fullRefund) return;
		const cur = selection[id] ?? 0;
		setQty(id, cur > 0 ? 0 : max, max);
	}

	async function process() {
		if (!canSubmit) return;
		const cashier = tenant.state.activeStaffInfo?.name ?? session.shortNpub ?? 'Cashier';
		const strong = await confirm({
			title: `Refund ${formatMoney(refundTotal, currency)}?`,
			message: `Via ${method}. ${isFull ? 'This is a FULL refund and marks the order refunded.' : 'This is a partial refund.'} It nets against the current shift and cannot be undone.`,
			tone: 'danger',
			icon: refundReasonIcon(reason),
			confirmText: t('common.confirmProcessRefund')
		});
		if (!strong) return;

		processing = true;
		try {
			const refundRecord = buildRefund({
				orderId: order.id,
				lines: refundLines,
				currency,
				method: method as Refund['refundMethod'],
				reason,
				note,
				approvedBy: cashier,
				branchId: tenant.state.locationId ?? undefined,
				shiftId: shiftStore.activeShift?.id ?? order.data.shiftId
			});

			// 1. Persist the refund record.
			await glo.upsert<Refund>(TYPE.refund, refundRecord, { id: newRecordId('refund') });

			// 1b. Audit log.
			await logActivity({
				action: 'refund',
				resource: 'order',
				resourceId: order.id,
				summary: `Refunded ${formatMoney(refundTotal, currency)} via ${method}${isFull ? ' (full)' : ' (partial)'}`,
				amount: refundTotal,
				currency,
				meta: {
					reason,
					lines: refundLines.length,
					restocked: refundLines.filter((l) => restock[l.orderLineItemId ?? ''] ?? true).length
				}
			});

			// 2. Update the order: status + cumulative refunded amount.
			const newRefunded = Math.round((alreadyRefunded + refundTotal) * 100) / 100;
			await glo.upsert<Order>(
				TYPE.order,
				{
					...order.data,
					status: isFull ? 'refunded' : 'partially_refunded',
					refundedAmount: newRefunded
				},
				{ id: order.id }
			);

			// 3. Restock selected items (mirror checkout's stockLevel handling).
			for (const rl of refundLines) {
				if (!rl.productId) continue;
				if (!(restock[rl.orderLineItemId ?? ''] ?? true)) continue; // skip damaged
				const product = glo.get(TYPE.product, rl.productId);
				if (product) {
					const pd = product.data as Record<string, unknown>;
					const cur = typeof pd.stockLevel === 'number' ? pd.stockLevel : 0;
					try {
						await glo.upsert(
							TYPE.product,
							{ ...pd, stockLevel: cur + rl.quantity },
							{ id: product.id }
						);
					} catch {
						/* non-fatal */
					}
				}
			}

			// 4. Auto-print refund receipt if enabled (mirrors checkout auto-print).
			const g = loadGeneralSettings();
			const h = loadHardwareSettings();
			if (g.autoPrint && h.printerType !== 'none') {
				printRefundReceipt(order, refundRecord, { currency, cashier });
			}

			toast.success(
				isFull ? 'Order refunded' : 'Partial refund processed',
				`${formatMoney(refundTotal, currency)} via ${method}`
			);
			open = false;
			onDone?.();
		} catch (e) {
			toast.error('Refund failed', e instanceof Error ? e.message : undefined);
		} finally {
			processing = false;
		}
	}
</script>

<Dialog bind:open title={t('orders.refundOrder')} size="md">
	<div class="space-y-3">
		<!-- Summary header -->
		<div class="flex items-center justify-between rounded-xl bg-[var(--ui-bg-muted)] px-3.5 py-2.5">
			<div>
				<div class="text-[11px] font-semibold text-[var(--ui-text-dimmed)]">{t('common.order')}</div>
				<div class="font-mono text-[13px] font-bold">
					{order.data.orderNumber ?? order.id.slice(0, 8)}
				</div>
			</div>
			<div class="text-right">
				<div class="text-[11px] font-semibold text-[var(--ui-text-dimmed)]">Refundable</div>
				<div
					class="font-display text-[15px] font-bold text-[var(--tone-success-text)] tabular-nums"
				>
					{formatMoney(refundableRemaining, currency)}
				</div>
			</div>
		</div>

		<!-- Full-refund toggle -->
		<button
			type="button"
			onclick={() => (fullRefund = !fullRefund)}
			class="flex w-full items-center justify-between rounded-lg border border-[var(--ui-border)] px-3 py-2 text-left transition-colors hover:bg-[var(--ui-bg-accented)] {fullRefund
				? 'border-primary-500/50 bg-primary-500/5'
				: ''}"
		>
			<span class="flex items-center gap-2 text-[12.5px] font-semibold">
				<Icon
					name="lucide:check-circle-2"
					class="size-4 {fullRefund ? 'text-primary-500' : 'text-[var(--ui-text-dimmed)]'}"
				/>
				Refund entire order
			</span>
			<Badge color={fullRefund ? 'primary' : 'neutral'}>{formatMoney(orderTotal, currency)}</Badge>
		</button>

		<!-- Line items -->
		<div class="space-y-1.5">
			<div
				class="flex items-center justify-between px-1 text-[10px] font-bold tracking-wide text-[var(--ui-text-dimmed)] uppercase"
			>
				<span>{t('common.items')}</span>
				<span>Restock</span>
			</div>
			{#each lines as l (l.id)}
				{@const qty = selection[l.id] ?? 0}
				{@const selected = qty > 0}
				<div
					class="flex items-center gap-2 rounded-lg border p-2 transition-colors {selected
						? 'border-[var(--tone-error-text)]/30 bg-[var(--tone-error-bg)]/40'
						: 'border-[var(--ui-border-muted)]'}"
				>
					<button
						type="button"
						onclick={() => toggleLine(l.id, l.quantity)}
						disabled={fullRefund}
						class="grid size-5 shrink-0 place-items-center rounded-md border transition-colors {selected
							? 'border-[var(--tone-error-text)] bg-[var(--tone-error-text)] text-white'
							: 'border-[var(--ui-border)] text-transparent'}"
						aria-label={selected ? 'Deselect' : 'Select'}
					>
						<Icon name="lucide:check" class="size-3" />
					</button>
					<div class="min-w-0 flex-1">
						<div class="truncate text-[12.5px] font-semibold">
							{l.name}{#if l.variantName}<span class="font-normal text-[var(--ui-text-dimmed)]">
									· {l.variantName}</span
								>{/if}
						</div>
						<div class="text-[11px] text-[var(--ui-text-dimmed)]">
							{formatMoney(l.unitPrice, currency)} each
						</div>
					</div>
					<!-- Qty stepper -->
					<div class="flex shrink-0 items-center gap-1">
						<button
							type="button"
							onclick={() => setQty(l.id, qty - 1, l.quantity)}
							disabled={fullRefund || !selected}
							class="grid size-6 place-items-center rounded-md border border-[var(--ui-border)] text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)] disabled:opacity-40"
							aria-label={t('common.decrease')}
						>
							<Icon name="lucide:minus" class="size-3" />
						</button>
						<span class="w-5 text-center text-[12px] font-bold tabular-nums">{qty}</span>
						<button
							type="button"
							onclick={() => setQty(l.id, qty + 1, l.quantity)}
							disabled={fullRefund || qty >= l.quantity}
							class="grid size-6 place-items-center rounded-md border border-[var(--ui-border)] text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)] disabled:opacity-40"
							aria-label={t('common.increase')}
						>
							<Icon name="lucide:plus" class="size-3" />
						</button>
					</div>
					<!-- Restock toggle -->
					<button
						type="button"
						onclick={() => (restock = { ...restock, [l.id]: !(restock[l.id] ?? true) })}
						disabled={!selected}
						class="grid size-7 shrink-0 place-items-center rounded-md transition-colors disabled:opacity-30 {(restock[
							l.id
						] ?? true)
							? 'bg-[var(--tone-success-bg)] text-[var(--tone-success-text)]'
							: 'bg-[var(--ui-bg-muted)] text-[var(--ui-text-dimmed)]'}"
						title={(restock[l.id] ?? true) ? 'Return to stock' : 'Damaged — do not restock'}
					>
						<Icon
							name={(restock[l.id] ?? true) ? 'lucide:package-check' : 'lucide:package-x'}
							class="size-3.5"
						/>
					</button>
				</div>
			{/each}
		</div>

		<!-- Method + reason -->
		<div class="grid grid-cols-2 gap-2">
			<label class="block">
				<span class="mb-1 block text-[11px] font-semibold text-[var(--ui-text-muted)]"
					>Refund method</span
				>
				<select
					bind:value={method}
					class="h-9.5 w-full rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg)] px-2.5 text-[13px]"
				>
					{#each ['cash', 'card', 'qr', 'lightning', 'store_credit'] as m (m)}
						<option value={m} selected={m === originalMethod}>{m.replace('_', ' ')}</option>
					{/each}
				</select>
			</label>
			<label class="block">
				<span class="mb-1 block text-[11px] font-semibold text-[var(--ui-text-muted)]">{t('common.reason')}</span>
				<select
					bind:value={reason}
					class="h-9.5 w-full rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg)] px-2.5 text-[13px]"
				>
					{#each REFUND_REASONS as r (r.value)}
						<option value={r.value}>{r.label}</option>
					{/each}
				</select>
			</label>
		</div>
		<Input
			bind:value={note}
			icon="lucide:message-square"
			placeholder="Optional note (e.g. customer wanted smaller size)"
			class="w-full"
		/>

		{#if needsAttention}
			<div
				class="flex items-center gap-2 rounded-lg bg-[var(--tone-warning-bg)] px-3 py-2 text-[11.5px] font-medium text-[var(--tone-warning-text)]"
			>
				<Icon name="lucide:triangle-alert" class="size-4 shrink-0" />
				Large refund — manager confirmation recommended.
			</div>
		{/if}
	</div>

	{#snippet footer()}
		<div class="flex w-full items-center gap-3">
			<div class="min-w-0 flex-1">
				<div class="text-[10px] font-bold tracking-wide text-[var(--ui-text-dimmed)] uppercase">
					{selectedCount} item{selectedCount !== 1 ? 's' : ''} · {isFull ? 'full' : 'partial'}
				</div>
				<div class="font-display text-lg font-black text-[var(--tone-error-text)] tabular-nums">
					−{formatMoney(refundTotal, currency)}
				</div>
			</div>
			<Button color="neutral" variant="ghost" onclick={() => (open = false)}>{t('common.cancel')}</Button>
			<Button
				color="error"
				variant="solid"
				icon={processing ? 'lucide:loader-circle' : 'lucide:undo-2'}
				disabled={!canSubmit}
				onclick={process}
			>
				{#if processing}<Icon
						name="lucide:loader-circle"
						class="size-4 animate-spin"
					/>Processing…{:else}Process refund{/if}
			</Button>
		</div>
	{/snippet}
</Dialog>
