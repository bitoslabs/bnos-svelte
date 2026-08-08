<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { t } from '$lib/i18n/i18n.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import { glo } from '$nostr/store.svelte';
	import { dataSync } from '$nostr/sync.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { session } from '$nostr/session.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatMoney, formatInt, titleCase } from '$lib/utils/format';
	import { btcRate } from '$lib/bitcoin/rate.svelte';
	import {
		TYPE,
		type Order,
		type OrderLine,
		type Product,
		type Customer,
		type OrderType,
		type OrderSource,
		type ShippingInfo,
		type ShippingStatus,
		type PickupInfo
	} from '$lib/domain';
	import { ORDER_SOURCES, SHIPPING_STATUSES } from '$lib/domain/order-sources';
	import { newRecordId, nextReadableNumber } from '$lib/utils/record-id';
	import { shifts as shiftStore } from '$lib/pos/shifts.svelte';

	onMount(() => {
		dataSync.pageSync([TYPE.product, TYPE.customer, TYPE.order], { scope: 'order-create' });
		// Autofocus the search so staff can start scanning/typing immediately.
		queueMicrotask(() => productInput?.focus());
	});

	const currency = $derived(tenant.state.currency);
	const products = $derived(glo.all<Product, typeof TYPE.product>(TYPE.product));
	const customers = $derived(glo.all<Customer, typeof TYPE.customer>(TYPE.customer));

	// ── Form state ───────────────────────────────────────────
	let orderType = $state<OrderType>('takeaway');
	let source = $state<OrderSource>('orders_page');
	let sourceDetail = $state('');
	let status = $state<string>('pending');
	let paymentMethod = $state('cash');
	let customerId = $state('');
	let customerName = $state('');
	let notes = $state('');
	let tagsInput = $state('');
	let priority = $state<'normal' | 'rush' | 'vip'>('normal');

	// Dine-in
	let tableId = $state('');
	let covers = $state<number | undefined>(undefined);

	// Shipping
	let shipping = $state<ShippingInfo>({
		shippingStatus: 'pending',
		recipientName: '',
		phone: '',
		address: '',
		city: '',
		state: '',
		zipCode: '',
		country: 'LA',
		notes: '',
		deliveryFee: 0,
		deliveryProvider: '',
		trackingNumber: '',
		estimatedDeliveryAt: '',
		driverName: '',
		driverPhone: ''
	});

	// Pickup
	let pickup = $state<PickupInfo>({
		pickupName: '',
		phone: '',
		pickupTime: '',
		pickupLocation: ''
	});

	let lines = $state<OrderLine[]>([]);

	// ── Smart product search (scan + search in one) ─────────
	let productInput: HTMLInputElement | undefined = $state();
	let productQuery = $state('');
	let productFocused = $state(false);
	let highlighted = $state(0);

	const filteredProducts = $derived.by(() => {
		const q = productQuery.trim().toLowerCase();
		const list = products
			.filter((p) => {
				const d = p.data as any;
				if (d.status === 'inactive') return false;
				if (!q) return true;
				return (
					(d.name ?? '').toLowerCase().includes(q) ||
					(d.sku ?? '').toLowerCase().includes(q) ||
					(d.barcode ?? '').toLowerCase().includes(q)
				);
			})
			.slice(0, q ? 8 : 6);
		return list;
	});
	const showProductResults = $derived(productFocused && filteredProducts.length > 0);

	function productImage(p: any): string {
		return Array.isArray(p.images) ? (p.images[0] ?? '') : (p.image ?? '');
	}

	function addLine(product: Product) {
		const d = product as any;
		const existing = lines.find((l) => l.productId === d.id);
		if (existing) {
			existing.quantity++;
			lines = [...lines];
		} else {
			const price = d.price ?? 0;
			lines = [
				...lines,
				{
					id: crypto.randomUUID(),
					productId: d.id ?? '',
					name: d.name ?? '',
					productName: d.name ?? '',
					quantity: 1,
					unitPrice: price,
					total: price
				}
			];
		}
	}

	/** Enter on the search: exact barcode/SKU → instant add (scanner), else add highlighted. */
	function commitProductSearch() {
		const q = productQuery.trim();
		if (!q) return;
		const exact = products.find((p) => {
			const d = p.data as any;
			return (
				(d.barcode ?? '').toLowerCase() === q.toLowerCase() ||
				(d.sku ?? '').toLowerCase() === q.toLowerCase()
			);
		});
		if (exact) {
			addLine(exact.data as Product);
		} else if (filteredProducts.length) {
			const pick = filteredProducts[Math.min(highlighted, filteredProducts.length - 1)];
			addLine(pick.data as Product);
		} else {
			toast.warning(`No product matches "${q}"`);
			return;
		}
		productQuery = '';
		highlighted = 0;
		productInput?.focus();
	}

	function onProductKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			highlighted = Math.min(highlighted + 1, filteredProducts.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			highlighted = Math.max(highlighted - 1, 0);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			commitProductSearch();
		} else if (e.key === 'Escape') {
			productQuery = '';
			productFocused = false;
		}
	}

	function removeLine(id: string) {
		lines = lines.filter((l) => l.id !== id);
	}
	function incQty(id: string) {
		lines = lines.map((l) => (l.id === id ? { ...l, quantity: l.quantity + 1 } : l));
	}
	function decQty(id: string) {
		lines = lines.map((l) => (l.id === id ? { ...l, quantity: Math.max(1, l.quantity - 1) } : l));
	}
	function setQty(id: string, q: number) {
		lines = lines.map((l) => (l.id === id ? { ...l, quantity: Math.max(1, q || 1) } : l));
	}

	// ── Customer (combobox + quick create) ──────────────────
	let customerInput: HTMLInputElement | undefined = $state();
	let customerQuery = $state('');
	let customerFocused = $state(false);
	const filteredCustomers = $derived.by(() => {
		const q = customerQuery.trim().toLowerCase();
		if (!q) return customers.slice(0, 6);
		return customers
			.filter((c) => {
				const d = c.data as any;
				return (
					(d.name ?? '').toLowerCase().includes(q) ||
					(d.phone ?? '').toLowerCase().includes(q) ||
					(d.email ?? '').toLowerCase().includes(q)
				);
			})
			.slice(0, 8);
	});
	const showCustomerResults = $derived(
		customerFocused && !customerId && filteredCustomers.length > 0
	);

	// Quick-create dialog
	let qcOpen = $state(false);
	let qcSaving = $state(false);
	let qcName = $state('');
	let qcPhone = $state('');
	let qcEmail = $state('');

	function prefillFromCustomer(c: { name?: string; phone?: string }) {
		if (orderType === 'delivery') {
			if (!shipping.recipientName && c.name) shipping.recipientName = c.name;
			if (!shipping.phone && c.phone) shipping.phone = c.phone;
		} else if (orderType === 'pickup') {
			if (!pickup.pickupName && c.name) pickup.pickupName = c.name;
			if (!pickup.phone && c.phone) pickup.phone = c.phone;
		}
	}

	function selectCustomer(obj: { id: string; data: Customer }) {
		customerId = obj.id;
		customerName = obj.data.name ?? obj.data.phone ?? '';
		customerQuery = '';
		customerFocused = false;
		prefillFromCustomer({ name: obj.data.name, phone: obj.data.phone });
	}

	function clearCustomer() {
		customerId = '';
		customerName = '';
		customerInput?.focus();
	}

	async function quickCreateCustomer() {
		if (!qcName.trim()) {
			toast.warning('Name is required');
			return;
		}
		qcSaving = true;
		const id = newRecordId('customer');
		const data = {
			name: qcName.trim(),
			phone: qcPhone.trim() || undefined,
			email: qcEmail.trim() || undefined,
			status: 'active' as const
		};
		await glo.upsert(TYPE.customer, data, { id });
		qcSaving = false;
		customerId = id;
		customerName = data.name!;
		prefillFromCustomer({ name: data.name, phone: data.phone });
		qcOpen = false;
		qcName = '';
		qcPhone = '';
		qcEmail = '';
		toast.success('Customer created', data.name!);
	}

	// ── Totals ───────────────────────────────────────────────
	const subtotal = $derived(
		lines.reduce((s, l) => s + (l.unitPrice ?? (l as any).price ?? 0) * l.quantity, 0)
	);
	const itemCount = $derived(lines.reduce((s, l) => s + l.quantity, 0));
	let discountAmount = $state(0);
	let tipAmount = $state(0);
	const defaultTaxRate = $derived(tenant.state.defaultTaxRate || 0);
	const taxAmount = $derived(
		tenant.state.taxIncludedInPrice ? 0 : subtotal * (defaultTaxRate / 100)
	);
	const deliveryFee = $derived(orderType === 'delivery' ? Number(shipping.deliveryFee) || 0 : 0);
	const total = $derived(
		Math.max(0, subtotal - discountAmount + taxAmount + tipAmount + deliveryFee)
	);

	// Bitcoin: live sats preview of the order total (currency-aware).
	const showSats = $derived(btcRate.canConvert(currency ?? 'USD'));
	const totalSats = $derived((showSats && btcRate.satsFromAmount(total, currency ?? 'USD')) || 0);
	$effect(() => {
		if (!tenant.hydrated) return;
		const cur = currency ?? 'USD';
		if (cur) untrack(() => void btcRate.ensureRate(cur));
	});

	// ── Save ─────────────────────────────────────────────────
	let saving = $state(false);

	async function save(asDraft = false) {
		if (lines.length === 0) return toast.warning('Add at least one item');
		saving = true;
		const orderId = newRecordId('order');
		const orderNumber = nextReadableNumber({ prefix: 'ORD', scope: tenant.state.locationId });
		const finalStatus = asDraft ? 'draft' : status;

		const savedTotalSats = btcRate.canConvert(currency)
			? btcRate.satsFromAmount(total, currency)
			: undefined;

		const orderData: any = {
			orderNumber,
			type: orderType,
			source,
			sourceDetail: source === 'other' ? sourceDetail.trim() || undefined : undefined,
			status: finalStatus,
			customerId: customerId || undefined,
			customerName: customerName || undefined,
			lines,
			subtotal,
			discount: discountAmount || undefined,
			taxAmount: taxAmount || undefined,
			tip: tipAmount || undefined,
			total,
			currency,
			totalSats: savedTotalSats,
			btcRate: savedTotalSats != null ? btcRate.rateFor(currency) : undefined,
			btcRateCurrency: savedTotalSats != null ? currency : undefined,
			paymentMethod,
			// Branch + staff + shift context (mirrors POS checkout so manual orders
			// flow through the same per-branch / per-shift reconciliation).
			branchId: tenant.state.locationId ?? undefined,
			cashierPubkey: session.pubkey ?? undefined,
			shiftId: shiftStore.activeShift?.id,
			notes: notes.trim() || undefined,
			tags: tagsInput.trim()
				? tagsInput
						.split(',')
						.map((t) => t.trim())
						.filter(Boolean)
				: undefined,
			tableId: orderType === 'dine_in' ? tableId || undefined : undefined,
			covers: orderType === 'dine_in' ? covers : undefined,
			shipping: orderType === 'delivery' ? shipping : undefined,
			pickup: orderType === 'pickup' ? pickup : undefined,
			priority,
			occurredAt: new Date().toISOString()
		};

		await glo.upsert<Order>(TYPE.order, orderData, { id: orderId });
		toast.success(`Order #${orderNumber} ${asDraft ? 'saved as draft' : 'created'}`);
		saving = false;
		goto(resolve('/orders'));
	}

	const ORDER_TYPES: { value: OrderType; label: string; icon: string }[] = [
		{ value: 'dine_in', label: 'Dine In', icon: 'lucide:utensils' },
		{ value: 'takeaway', label: 'Takeaway', icon: 'lucide:shopping-bag' },
		{ value: 'delivery', label: 'Delivery', icon: 'lucide:truck' },
		{ value: 'pickup', label: 'Pickup', icon: 'lucide:package' }
	];

	const PAYMENT_METHODS = [
		{ value: 'cash', label: 'Cash', icon: 'lucide:banknote' },
		{ value: 'card', label: 'Card', icon: 'lucide:credit-card' },
		{ value: 'qr', label: 'QR', icon: 'lucide:qr-code' },
		{ value: 'lightning', label: 'Lightning', icon: 'lucide:zap' }
	];

	function priorityColor(p: string): 'primary' | 'error' | 'warning' | 'neutral' {
		if (p === 'rush') return 'error';
		if (p === 'vip') return 'warning';
		return 'neutral';
	}

	// "/" focuses product search (POS power-user shortcut)
	function onGlobalKeydown(e: KeyboardEvent) {
		const tag = (e.target as HTMLElement)?.tagName;
		if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
			e.preventDefault();
			productInput?.focus();
		}
	}
</script>

<svelte:head><title>{t('common.new') + ' ' + t('common.order')} · {t('common.appName')}</title></svelte:head>
<svelte:window onkeydown={onGlobalKeydown} />

<div class="space-y-4">
	<!-- Header -->
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div class="flex items-center gap-3">
			<Button
				color="neutral"
				variant="ghost"
				size="icon-sm"
				icon="lucide:arrow-left"
				onclick={() => goto(resolve('/orders'))}
			/>
			<div>
				<h1 class="font-display text-xl font-bold tracking-tight">New Order</h1>
				<p class="text-[12px] text-[var(--ui-text-muted)]">Create a manual order</p>
			</div>
		</div>
		{#if lines.length > 0}
			<div
				class="flex items-center gap-2 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-3 py-1.5"
			>
				<Icon name="lucide:shopping-cart" class="size-4 text-primary-500" />
				<span class="text-[12px] font-semibold text-[var(--ui-text-muted)]"
					>{itemCount} item{itemCount === 1 ? '' : 's'}</span
				>
				<span class="text-[var(--ui-text-dimmed)]">·</span>
				<span class="font-display text-[13px] font-bold tabular-nums"
					>{formatMoney(total, currency ?? 'USD')}</span
				>
			</div>
		{/if}
	</div>

	<div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
		<!-- ═══ LEFT ═══ -->
		<div class="space-y-4 lg:col-span-2">
			<!-- ════ Add items (hero) ════ -->
			<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
				<div class="flex items-center justify-between gap-2 px-5 py-3">
					<div class="flex items-center gap-2">
						<Icon name="lucide:scan-barcode" class="size-4 text-primary-500" />
						<h2 class="font-display text-[14px] font-semibold">Add items</h2>
					</div>
					<span
						class="hidden items-center gap-1 rounded-md border border-[var(--ui-border)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--ui-text-dimmed)] sm:inline-flex"
					>
						<kbd class="font-mono">/</kbd> to search
					</span>
				</div>

				<!-- Smart search -->
				<div class="relative px-5 pt-4">
					<div
						class="flex items-center gap-2 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-3 py-2.5 transition-colors focus-within:border-primary-500"
					>
						<Icon name="lucide:search" class="size-4 shrink-0 text-[var(--ui-text-dimmed)]" />
						<input
							bind:this={productInput}
							bind:value={productQuery}
							onfocus={() => (productFocused = true)}
							onblur={() => setTimeout(() => (productFocused = false), 120)}
							onkeydown={onProductKeydown}
							type="text"
							placeholder="Scan barcode or search by name / SKU…"
							class="min-w-0 flex-1 bg-transparent text-[14px] text-[var(--ui-text)] placeholder:text-[var(--ui-text-dimmed)] focus:outline-none"
						/>
						{#if productQuery}
							<button
								type="button"
								class="grid size-5 place-items-center rounded text-[var(--ui-text-dimmed)] hover:text-[var(--ui-text)]"
								onclick={() => {
									productQuery = '';
									productInput?.focus();
								}}
							>
								<Icon name="lucide:x" class="size-3.5" />
							</button>
						{/if}
						<span class="hidden text-[10px] font-medium text-[var(--ui-text-dimmed)] sm:inline">
							↵ add
						</span>
					</div>

					<!-- Live results dropdown -->
					{#if showProductResults}
						<div
							class="absolute inset-x-5 z-30 mt-1.5 overflow-hidden rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg-elevated)] shadow-xl shadow-black/10"
							role="listbox"
						>
							{#each filteredProducts as p, i (p.id)}
								{@const img = productImage(p.data as any)}
								<button
									type="button"
									role="option"
									aria-selected={highlighted === i}
									onmousedown={(e) => e.preventDefault()}
									onclick={() => {
										addLine(p.data as Product);
										productQuery = '';
										highlighted = 0;
										productInput?.focus();
									}}
									onmouseenter={() => (highlighted = i)}
									class="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors {highlighted ===
									i
										? 'bg-primary-500/10'
										: 'hover:bg-[var(--ui-bg-accented)]'}"
								>
									{#if img}
										<img src={img} alt="" class="size-9 shrink-0 rounded-lg object-cover" />
									{:else}
										<div
											class="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-500/10 text-[12px] font-bold text-primary-600 dark:text-primary-400"
										>
											{((p.data as any).name ?? '?').charAt(0).toUpperCase()}
										</div>
									{/if}
									<div class="min-w-0 flex-1">
										<div class="truncate text-[13px] font-semibold">{(p.data as any).name}</div>
										<div class="flex items-center gap-1.5 text-[11px] text-[var(--ui-text-dimmed)]">
											{#if (p.data as any).sku}<span class="font-mono">{(p.data as any).sku}</span
												>{/if}
											{#if (p.data as any).barcode}
												<span>·</span>
												<span class="inline-flex items-center gap-0.5"
													><Icon name="lucide:barcode" class="size-3" />scan</span
												>
											{/if}
										</div>
									</div>
									<div class="shrink-0 text-[13px] font-bold tabular-nums">
										{formatMoney((p.data as any).price ?? 0, currency ?? 'USD')}
									</div>
								</button>
							{/each}
						</div>
					{/if}
				</div>

				<!-- Line items -->
				<div class="px-2 py-2 sm:px-5 sm:py-4">
					{#if lines.length === 0}
						<div class="flex flex-col items-center justify-center py-12 text-center">
							<div
								class="grid size-12 place-items-center rounded-2xl bg-[var(--ui-bg-muted)] text-[var(--ui-text-dimmed)]"
							>
								<Icon name="lucide:package-open" class="size-6" />
							</div>
							<p class="mt-3 text-[13px] font-medium">No items yet</p>
							<p class="mt-0.5 text-[12px] text-[var(--ui-text-dimmed)]">
								Scan a barcode or search above to add products
							</p>
							{#if products.length === 0}
								<Button href="/catalog" variant="subtle" size="sm" class="mt-3" icon="lucide:plus"
									>Go to catalog</Button
								>
							{/if}
						</div>
					{:else}
						<ul class="divide-y divide-[var(--ui-border-muted)]">
							{#each lines as line (line.id)}
								<li class="flex items-center gap-3 py-2.5">
									<div
										class="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-500/10 text-[12px] font-bold text-primary-600 dark:text-primary-400"
									>
										{(line.name ?? line.productName ?? '?').charAt(0).toUpperCase()}
									</div>
									<div class="min-w-0 flex-1">
										<div class="truncate text-[13px] font-semibold">
											{line.name ?? line.productName}
										</div>
										<div class="text-[11px] text-[var(--ui-text-dimmed)] tabular-nums">
											{formatMoney(line.unitPrice ?? (line as any).price ?? 0, currency ?? 'USD')}
											each
										</div>
									</div>
									<!-- qty stepper -->
									<div class="flex items-center gap-1">
										<button
											type="button"
											onclick={() => decQty(line.id ?? '')}
											aria-label={t('common.decrease')}
											class="grid size-7 place-items-center rounded-lg border border-[var(--ui-border)] text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--ui-bg-accented)]"
										>
											<Icon name="lucide:minus" class="size-3.5" />
										</button>
										<input
											value={line.quantity}
											onchange={(e) =>
												setQty(line.id ?? '', +(e.currentTarget as HTMLInputElement).value)}
											type="number"
											min="1"
											class="h-7 w-10 rounded-md border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] text-center text-[13px] font-semibold tabular-nums focus:outline-none"
										/>
										<button
											type="button"
											onclick={() => incQty(line.id ?? '')}
											aria-label={t('common.increase')}
											class="grid size-7 place-items-center rounded-lg border border-[var(--ui-border)] text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--ui-bg-accented)]"
										>
											<Icon name="lucide:plus" class="size-3.5" />
										</button>
									</div>
									<div class="w-24 shrink-0 text-right text-[13px] font-bold tabular-nums">
										{formatMoney(
											(line.unitPrice ?? (line as any).price ?? 0) * line.quantity,
											currency ?? 'USD'
										)}
									</div>
									<button
										type="button"
										onclick={() => removeLine(line.id ?? '')}
										aria-label={t('common.remove')}
										class="grid size-7 shrink-0 place-items-center rounded-lg text-[var(--ui-text-dimmed)] transition-colors hover:bg-red-500/10 hover:text-[var(--tone-error-text)]"
									>
										<Icon name="lucide:trash-2" class="size-3.5" />
									</button>
								</li>
							{/each}
						</ul>
						<div
							class="mt-1 flex items-center justify-between border-t border-[var(--ui-border-muted)] px-1 pt-3 text-[13px]"
						>
							<span class="text-[var(--ui-text-muted)]">{t('common.subtotal')}</span>
							<span class="font-semibold tabular-nums"
								>{formatMoney(subtotal, currency ?? 'USD')}</span
							>
						</div>
					{/if}
				</div>
			</section>

			<!-- ════ Customer ════ -->
			<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
				<div class="flex items-center justify-between gap-2 px-5 py-3">
					<div class="flex items-center gap-2">
						<Icon name="lucide:user-round" class="size-4 text-primary-500" />
						<h2 class="font-display text-[14px] font-semibold">
							Customer
							<span class="text-[12px] font-normal text-[var(--ui-text-dimmed)]">(optional)</span>
						</h2>
					</div>
					<Button size="sm" variant="soft" icon="lucide:user-plus" onclick={() => (qcOpen = true)}
						>New</Button
					>
				</div>

				<div class="px-5 py-4">
					{#if customerId}
						<!-- Selected chip -->
						<div
							class="flex items-center gap-3 rounded-xl border border-primary-500/30 bg-primary-500/10 p-3"
						>
							<div
								class="grid size-9 shrink-0 place-items-center rounded-full bg-primary-500/20 text-[12px] font-bold text-primary-600 dark:text-primary-400"
							>
								{(customerName || '?').charAt(0).toUpperCase()}
							</div>
							<div class="min-w-0 flex-1">
								<div
									class="truncate text-[13px] font-semibold text-primary-700 dark:text-primary-300"
								>
									{customerName}
								</div>
								{#if orderType === 'delivery' && shipping.phone}
									<div class="truncate text-[11px] text-[var(--ui-text-muted)]">
										{shipping.phone}
									</div>
								{/if}
							</div>
							<button
								type="button"
								onclick={clearCustomer}
								aria-label="Remove customer"
								class="grid size-7 place-items-center rounded-lg text-primary-700/70 transition-colors hover:bg-primary-500/15 dark:text-primary-300/70"
							>
								<Icon name="lucide:x" class="size-4" />
							</button>
						</div>
					{:else}
						<!-- Search combobox -->
						<div class="relative">
							<div
								class="flex items-center gap-2 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-3 py-2.5 transition-colors focus-within:border-primary-500"
							>
								<Icon name="lucide:search" class="size-4 shrink-0 text-[var(--ui-text-dimmed)]" />
								<input
									bind:this={customerInput}
									bind:value={customerQuery}
									onfocus={() => (customerFocused = true)}
									onblur={() => setTimeout(() => (customerFocused = false), 150)}
									type="text"
									placeholder="Search customer by name, phone or email…"
									class="min-w-0 flex-1 bg-transparent text-[14px] placeholder:text-[var(--ui-text-dimmed)] focus:outline-none"
								/>
								<button
									type="button"
									onclick={() => (qcOpen = true)}
									class="inline-flex shrink-0 items-center gap-1 rounded-lg border border-primary-500/30 px-2 py-1 text-[11px] font-semibold text-primary-600 transition-colors hover:bg-primary-500/10 dark:text-primary-400"
								>
									<Icon name="lucide:user-plus" class="size-3.5" />New
								</button>
							</div>

							{#if showCustomerResults}
								<div
									class="absolute inset-x-0 z-30 mt-1.5 overflow-hidden rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg-elevated)] shadow-xl shadow-black/10"
								>
									{#each filteredCustomers as c (c.id)}
										<button
											type="button"
											onmousedown={(e) => e.preventDefault()}
											onclick={() => selectCustomer(c)}
											class="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[var(--ui-bg-accented)]"
										>
											<div
												class="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--ui-bg-muted)] text-[11px] font-bold text-[var(--ui-text-muted)]"
											>
												{(c.data.name ?? '?').charAt(0).toUpperCase()}
											</div>
											<div class="min-w-0 flex-1">
												<div class="truncate text-[13px] font-semibold">
													{c.data.name ?? 'Unknown'}
												</div>
												<div class="truncate text-[11px] text-[var(--ui-text-dimmed)]">
													{[c.data.phone, c.data.email].filter(Boolean).join(' · ') || 'No contact'}
												</div>
											</div>
											{#if (c.data as any).segment && (c.data as any).segment !== 'new'}
												<Badge color="neutral">{(c.data as any).segment}</Badge>
											{/if}
										</button>
									{/each}
									{#if customers.length === 0}
										<div class="px-3 py-4 text-center text-[12px] text-[var(--ui-text-dimmed)]">
											No customers yet — create one with “New”.
										</div>
									{/if}
								</div>
							{/if}
						</div>
					{/if}
				</div>
			</section>

			<!-- ════ Order type & source ════ -->
			<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
				<div class="flex items-center gap-2 px-5 py-3">
					<Icon name="lucide:tag" class="size-4 text-primary-500" />
					<h2 class="font-display text-[14px] font-semibold">Type, source & priority</h2>
				</div>
				<div class="space-y-4 px-5 py-4">
					<div>
						<span
							class="mb-2 block text-[11px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase"
							>Order type</span
						>
						<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
							{#each ORDER_TYPES as ot (ot.value)}
								<button
									type="button"
									class="flex items-center justify-center gap-1.5 rounded-xl border-2 p-2.5 text-[13px] font-medium transition-all {orderType ===
									ot.value
										? 'border-primary-500 bg-primary-500/10 text-primary-700 dark:text-primary-300'
										: 'border-[var(--ui-border)] text-[var(--ui-text-muted)] hover:border-[var(--ui-text-dimmed)]'}"
									onclick={() => (orderType = ot.value)}
								>
									<Icon name={ot.icon} class="size-4" />
									{ot.label}
								</button>
							{/each}
						</div>
					</div>
					<div>
						<span
							class="mb-2 block text-[11px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase"
							>{t('common.source')}</span
						>
						<div class="flex flex-wrap gap-1.5">
							{#each ORDER_SOURCES as os (os.value)}
								<button
									type="button"
									class="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-all {source ===
									os.value
										? 'border-primary-500 bg-primary-500/10 text-primary-700 dark:text-primary-300'
										: 'border-[var(--ui-border)] text-[var(--ui-text-muted)] hover:border-[var(--ui-text-dimmed)]'}"
									onclick={() => (source = os.value)}
								>
									<Icon name={os.icon} class="size-3.5 shrink-0" />
									{os.label}
								</button>
							{/each}
						</div>
						{#if source === 'other'}
							<label class="mt-2 block">
								<span
									class="mb-1.5 block text-[11px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase"
									>Custom source / reference</span
								>
								<Input
									bind:value={sourceDetail}
									placeholder="e.g. influencer name, post URL, event…"
									class="w-full"
								/>
							</label>
						{/if}
					</div>
					<div class="flex items-center gap-3">
						<span class="text-[11px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase"
							>Priority</span
						>
						<div class="flex gap-2">
							{#each ['normal', 'rush', 'vip'] as p (p)}
								<button
									type="button"
									class="rounded-lg px-3 py-1 text-[12px] font-semibold capitalize transition-all {priority ===
									p
										? p === 'rush'
											? 'bg-red-500/15 text-red-600 dark:text-red-400'
											: p === 'vip'
												? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
												: 'bg-primary-500/15 text-primary-600 dark:text-primary-400'
										: 'border border-[var(--ui-border)] text-[var(--ui-text-muted)]'}"
									onclick={() => (priority = p as 'normal' | 'rush' | 'vip')}
								>
									{p}
								</button>
							{/each}
						</div>
					</div>
				</div>
			</section>

			<!-- Dine-in options -->
			{#if orderType === 'dine_in'}
				<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
					<div class="flex items-center gap-2 px-5 py-3">
						<Icon name="lucide:chef-hat" class="size-4 text-primary-500" />
						<h2 class="font-display text-[14px] font-semibold">Dine-in details</h2>
					</div>
					<div class="grid grid-cols-2 gap-3 px-5 py-4">
						<label class="block">
							<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
								>{t('common.table')}</span
							>
							<Input bind:value={tableId} placeholder="e.g. A1, 5" class="w-full" />
						</label>
						<label class="block">
							<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
								>Covers / guests</span
							>
							<Input
								bind:value={covers}
								type="number"
								placeholder={t('common.numberOfGuests')}
								min="1"
								class="w-full"
							/>
						</label>
					</div>
				</section>
			{/if}

			<!-- Shipping (delivery) -->
			{#if orderType === 'delivery'}
				<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
					<div class="flex items-center gap-2 px-5 py-3">
						<Icon name="lucide:truck" class="size-4 text-primary-500" />
						<h2 class="font-display text-[14px] font-semibold">Shipping / delivery</h2>
					</div>
					<div class="space-y-3 px-5 py-4">
						<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
							<label class="block">
								<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
									>Recipient name</span
								>
								<Input bind:value={shipping.recipientName} placeholder={t('common.fullName')} class="w-full" />
							</label>
							<label class="block">
								<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
									>{t('common.phone')}</span
								>
								<Input
									bind:value={shipping.phone}
									type="tel"
									placeholder="020 xx xxx xxx"
									class="w-full"
								/>
							</label>
						</div>
						<label class="block">
							<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
								>{t('common.address')}</span
							>
							<Input
								bind:value={shipping.address}
								textarea={true}
								rows={2}
								placeholder="Street address, house number, landmark"
								class="w-full"
							/>
						</label>
						<div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
							<label class="block">
								<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
									>{t('common.city')}</span
								>
								<Input bind:value={shipping.city} placeholder={t('common.city')} class="w-full" />
							</label>
							<label class="block">
								<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
									>State</span
								>
								<Input bind:value={shipping.state} placeholder={t('common.province')} class="w-full" />
							</label>
							<label class="block">
								<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
									>Zip code</span
								>
								<Input bind:value={shipping.zipCode} placeholder="00000" class="w-full" />
							</label>
						</div>
						<div class="grid grid-cols-2 gap-3">
							<label class="block">
								<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
									>Delivery fee</span
								>
								<Input
									bind:value={shipping.deliveryFee}
									type="number"
									min="0"
									placeholder="0"
									class="w-full"
								/>
							</label>
							<label class="block">
								<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
									>Delivery provider</span
								>
								<Input
									bind:value={shipping.deliveryProvider}
									placeholder={t('common.provider')}
									class="w-full"
								/>
							</label>
						</div>

						<div
							class="space-y-3 rounded-xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)]/40 p-3"
						>
							<div class="flex items-center gap-2">
								<Icon name="lucide:package-check" class="size-3.5 text-primary-500" />
								<span
									class="text-[11px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase"
									>Tracking & fulfilment</span
								>
							</div>
							<label class="block">
								<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
									>Shipping status</span
								>
								<select
									bind:value={shipping.shippingStatus}
									class="w-full rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-3 py-2 text-[13px] capitalize focus:outline-none"
								>
									{#each SHIPPING_STATUSES as ss (ss.value)}
										<option value={ss.value}>{ss.label}</option>
									{/each}
								</select>
							</label>
							<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
								<label class="block">
									<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
										>Tracking number</span
									>
									<Input
										bind:value={shipping.trackingNumber}
										placeholder="e.g. DHL123456"
										icon="lucide:hash"
										class="w-full"
									/>
								</label>
								<label class="block">
									<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
										>Est. delivery</span
									>
									<Input
										bind:value={shipping.estimatedDeliveryAt}
										type="datetime-local"
										class="w-full"
									/>
								</label>
								<label class="block">
									<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
										>Driver name</span
									>
									<Input
										bind:value={shipping.driverName}
										placeholder={t('common.driverCourier')}
										class="w-full"
									/>
								</label>
								<label class="block">
									<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
										>Driver phone</span
									>
									<Input
										bind:value={shipping.driverPhone}
										type="tel"
										placeholder="020 xx xxx xxx"
										class="w-full"
									/>
								</label>
							</div>
						</div>
						<label class="block">
							<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
								>Delivery notes</span
							>
							<Input
								bind:value={shipping.notes}
								textarea={true}
								rows={2}
								placeholder="Special instructions"
								class="w-full"
							/>
						</label>
					</div>
				</section>
			{/if}

			<!-- Pickup info -->
			{#if orderType === 'pickup'}
				<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
					<div class="flex items-center gap-2 px-5 py-3">
						<Icon name="lucide:package" class="size-4 text-primary-500" />
						<h2 class="font-display text-[14px] font-semibold">Pickup info</h2>
					</div>
					<div class="space-y-3 px-5 py-4">
						<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
							<label class="block">
								<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
									>Pickup name</span
								>
								<Input bind:value={pickup.pickupName} placeholder={t('common.customerName')} class="w-full" />
							</label>
							<label class="block">
								<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
									>{t('common.phone')}</span
								>
								<Input
									bind:value={pickup.phone}
									type="tel"
									placeholder="020 xx xxx xxx"
									class="w-full"
								/>
							</label>
						</div>
						<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
							<label class="block">
								<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
									>Ready time</span
								>
								<Input bind:value={pickup.pickupTime} type="datetime-local" class="w-full" />
							</label>
							<label class="block">
								<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
									>Pickup location</span
								>
								<Input
									bind:value={pickup.pickupLocation}
									placeholder="Counter 1, Main entrance…"
									class="w-full"
								/>
							</label>
						</div>
					</div>
				</section>
			{/if}

			<!-- Notes & tags -->
			<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
				<div class="flex items-center gap-2 px-5 py-3">
					<Icon name="lucide:file-text" class="size-4 text-primary-500" />
					<h2 class="font-display text-[14px] font-semibold">Notes & tags</h2>
				</div>
				<div class="space-y-3 px-5 py-4">
					<label class="block">
						<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
							>Order notes</span
						>
						<Input
							bind:value={notes}
							textarea={true}
							rows={2}
							placeholder="Special instructions, customer requests…"
							class="w-full"
						/>
					</label>
					<label class="block">
						<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
							>Tags (comma separated)</span
						>
						<Input bind:value={tagsInput} placeholder="e.g. catering, event, VIP" class="w-full" />
					</label>
				</div>
			</section>
		</div>

		<!-- ═══ RIGHT — sticky summary ═══ -->
		<div class="space-y-4 lg:sticky lg:top-20 lg:h-fit">
			<!-- Status -->
			<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
				<div class="flex items-center gap-2 px-5 py-3">
					<Icon name="lucide:clock" class="size-4 text-primary-500" />
					<h2 class="font-display text-[14px] font-semibold">{t('common.status')}</h2>
				</div>
				<div class="px-5 py-4">
					<span
						class="mb-2 block text-[11px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase"
						>Initial status</span
					>
					<div class="flex flex-wrap gap-2">
						{#each ['pending', 'confirmed', 'preparing', 'completed', 'cancelled'] as s (s)}
							<button
								type="button"
								class="rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-all {status === s
									? 'bg-primary-500 text-white'
									: 'border border-[var(--ui-border)] text-[var(--ui-text-muted)] hover:border-[var(--ui-text-dimmed)]'}"
								onclick={() => (status = s)}
							>
								{titleCase(s)}
							</button>
						{/each}
					</div>
					{#if priority !== 'normal'}
						<div class="mt-3">
							<Badge color={priorityColor(priority)}>{titleCase(priority)} priority</Badge>
						</div>
					{/if}
				</div>
			</section>

			<!-- Totals & payment -->
			<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
				<div class="flex items-center gap-2 px-5 py-3">
					<Icon name="lucide:wallet" class="size-4 text-primary-500" />
					<h2 class="font-display text-[14px] font-semibold">Totals & payment</h2>
				</div>
				<div class="space-y-2.5 px-5 py-4 text-[13px]">
					<div class="flex justify-between">
						<span class="text-[var(--ui-text-muted)]">{t('common.subtotal')}</span>
						<span class="tabular-nums">{formatMoney(subtotal, currency ?? 'USD')}</span>
					</div>
					<div class="flex items-center justify-between gap-3">
						<span class="text-[var(--ui-text-muted)]">{t('common.discount')}</span>
						<div
							class="inline-flex items-center gap-1 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-2 focus-within:border-primary-500"
						>
							<input
								bind:value={discountAmount}
								type="number"
								min="0"
								class="w-20 bg-transparent py-1 text-right tabular-nums focus:outline-none"
								placeholder="0"
							/>
						</div>
					</div>
					{#if taxAmount > 0}
						<div class="flex justify-between">
							<span class="text-[var(--ui-text-muted)]">Tax ({defaultTaxRate}%)</span>
							<span class="tabular-nums">{formatMoney(taxAmount, currency ?? 'USD')}</span>
						</div>
					{/if}
					{#if deliveryFee > 0}
						<div class="flex justify-between">
							<span class="text-[var(--ui-text-muted)]">Delivery fee</span>
							<span class="tabular-nums">{formatMoney(deliveryFee, currency ?? 'USD')}</span>
						</div>
					{/if}
					<div class="flex items-center justify-between gap-3">
						<span class="text-[var(--ui-text-muted)]">Tip</span>
						<div
							class="inline-flex items-center gap-1 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-2 focus-within:border-primary-500"
						>
							<input
								bind:value={tipAmount}
								type="number"
								min="0"
								class="w-20 bg-transparent py-1 text-right tabular-nums focus:outline-none"
								placeholder="0"
							/>
						</div>
					</div>
					<div
						class="flex justify-between border-t border-[var(--ui-border-muted)] pt-2.5 font-display text-[17px] font-bold"
					>
						<span>{t('common.total')}</span>
						<span class="tabular-nums">{formatMoney(total, currency ?? 'USD')}</span>
					</div>
					{#if showSats}
						<div
							class="flex items-center justify-end gap-1 text-[12px] font-semibold text-[var(--tone-warning-text)] tabular-nums"
						>
							<Icon name="lucide:zap" class="size-3.5" />≈ {formatInt(totalSats)} sats
						</div>
					{/if}

					<div class="border-t border-[var(--ui-border-muted)] pt-3">
						<span
							class="mb-2 block text-[11px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase"
							>Payment method</span
						>
						<div class="grid grid-cols-2 gap-2">
							{#each PAYMENT_METHODS as pm (pm.value)}
								<button
									type="button"
									class="flex flex-col items-center justify-center gap-0.5 rounded-xl border px-2 py-2 text-[12px] font-medium transition-all {paymentMethod ===
									pm.value
										? 'border-primary-500 bg-primary-500/10 text-primary-700 dark:text-primary-300'
										: 'border-[var(--ui-border)] text-[var(--ui-text-muted)] hover:border-[var(--ui-text-dimmed)]'}"
									onclick={() => (paymentMethod = pm.value)}
								>
									<Icon name={pm.icon} class="size-4" />
									{pm.label}
								</button>
							{/each}
						</div>
					</div>
				</div>
			</section>

			<!-- Actions -->
			<div class="space-y-2">
				<Button
					color="primary"
					block
					size="lg"
					icon="lucide:check"
					onclick={() => save(false)}
					disabled={saving || lines.length === 0}
				>
					{saving ? 'Creating…' : 'Create Order'}
				</Button>
				<Button
					color="neutral"
					variant="ghost"
					block
					icon="lucide:file-plus"
					onclick={() => save(true)}
					disabled={saving || lines.length === 0}
				>
					Save as draft
				</Button>
			</div>
		</div>
	</div>
</div>

<!-- Quick-create customer dialog -->
<Dialog bind:open={qcOpen} title="New customer" size="sm">
	<div class="space-y-3">
		<label class="block">
			<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]"
				>Name <span class="text-[var(--tone-error-text)]">*</span></span
			>
			<Input bind:value={qcName} placeholder={t('common.fullName')} class="w-full" autofocus />
		</label>
		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">{t('common.phone')}</span
				>
				<Input bind:value={qcPhone} type="tel" placeholder="020 xx xxx xxx" class="w-full" />
			</label>
			<label class="block">
				<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">{t('common.email')}</span
				>
				<Input bind:value={qcEmail} type="email" placeholder="name@email.com" class="w-full" />
			</label>
		</div>
		<p class="text-[11px] text-[var(--ui-text-dimmed)]">
			The customer is saved to your directory and selected for this order.
		</p>
	</div>
	{#snippet footer()}
		<Button variant="ghost" color="neutral" onclick={() => (qcOpen = false)}>{t('common.cancel')}</Button>
		<Button
			color="primary"
			icon="lucide:user-plus"
			disabled={qcSaving}
			onclick={quickCreateCustomer}
		>
			{qcSaving ? 'Creating…' : 'Create & select'}
		</Button>
	{/snippet}
</Dialog>
