<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import { glo } from '$nostr/store.svelte';
	import { dataSync } from '$nostr/sync.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatMoney, titleCase } from '$lib/utils/format';
	import { TYPE, type Order, type OrderLine, type Product, type Customer, type OrderType, type OrderSource, type ShippingInfo, type PickupInfo } from '$lib/domain';

	onMount(() => {
		dataSync.pageSync([TYPE.product, TYPE.customer, TYPE.order], { scope: 'order-create' });
	});

	const currency = $derived(tenant.state.currency);
	const products = $derived(glo.all<Product, typeof TYPE.product>(TYPE.product));
	const customers = $derived(glo.all<Customer, typeof TYPE.customer>(TYPE.customer));

	// ── Form state ───────────────────────────────────────────
	let search = $state('');
	let barcodeInput = $state('');
	let orderType = $state<OrderType>('takeaway');
	let source = $state<OrderSource>('orders_page');
	let status = $state<string>('pending');
	let paymentMethod = $state('cash');
	let customerId = $state('');
	let customerName = $state('');
	let notes = $state('');
	let tagsInput = $state('');
	let priority = $state<'normal' | 'rush' | 'vip'>('normal');
	let showProductPicker = $state(false);
	let showCustomerSelect = $state(false);

	// Dine-in
	let tableId = $state('');
	let covers = $state<number | undefined>(undefined);

	// Shipping
	let shipping = $state<ShippingInfo>({
		recipientName: '', phone: '', address: '', city: '', state: '', zipCode: '', country: 'LA', notes: '', deliveryFee: 0, deliveryProvider: ''
	});

	// Pickup
	let pickup = $state<PickupInfo>({
		pickupName: '', phone: '', pickupTime: '', pickupLocation: ''
	});

	let lines = $state<OrderLine[]>([]);

	// ── Barcode scan ─────────────────────────────────────────
	function handleBarcodeScan() {
		const code = barcodeInput.trim();
		if (!code) return;
		const product = products.find((p) => {
			const d = p.data as any;
			return d.barcode === code || d.sku === code || d.barcode?.toLowerCase() === code.toLowerCase() || d.sku?.toLowerCase() === code.toLowerCase();
		});
		if (product) {
			addLine(product.data as Product);
			barcodeInput = '';
			toast.info(`Added: ${(product.data as any).name}`);
		} else {
			toast.warning(`No product for barcode/SKU: ${code}`);
		}
	}

	const filteredProducts = $derived(
		search.trim()
			? products.filter((p) => {
					const d = p.data as any;
					return (d.name ?? '').toLowerCase().includes(search.toLowerCase()) || (d.sku ?? '').toLowerCase().includes(search.toLowerCase());
				})
			: products.slice(0, 12)
	);

	function addLine(product: Product) {
		const existing = lines.find((l) => l.productId === product.id);
		if (existing) {
			existing.quantity++;
			lines = [...lines];
		} else {
			const price = (product as any).price ?? 0;
			lines = [...lines, {
				id: crypto.randomUUID(),
				productId: (product as any).id ?? '',
				name: (product as any).name ?? '',
				productName: (product as any).name ?? '',
				quantity: 1,
				unitPrice: price,
				price: price,
				total: price
			}];
		}
		showProductPicker = false;
		search = '';
	}

	function removeLine(id: string) { lines = lines.filter((l) => l.id !== id); }
	function incQty(id: string) { lines = lines.map((l) => l.id === id ? { ...l, quantity: l.quantity + 1 } : l); }
	function decQty(id: string) { lines = lines.map((l) => l.id === id ? { ...l, quantity: Math.max(1, l.quantity - 1) } : l); }

	// ── Customer ─────────────────────────────────────────────
	function selectCustomer(c: any) {
		customerId = c.id ?? '';
		customerName = c.name ?? c.phone ?? '';
		showCustomerSelect = false;
	}
	function clearCustomer() {
		customerId = '';
		customerName = '';
	}

	// ── Totals ───────────────────────────────────────────────
	const subtotal = $derived(lines.reduce((s, l) => s + (l.unitPrice ?? l.price ?? 0) * l.quantity, 0));
	let discountAmount = $state(0);
	let tipAmount = $state(0);
	const defaultTaxRate = $derived(tenant.state.defaultTaxRate || 0);
	const taxAmount = $derived(tenant.state.taxIncludedInPrice ? 0 : subtotal * (defaultTaxRate / 100));
	const total = $derived(Math.max(0, subtotal - discountAmount + taxAmount + tipAmount));

	// ── Save ─────────────────────────────────────────────────
	let saving = $state(false);

	async function save(asDraft = false) {
		if (lines.length === 0) return toast.warning('Add at least one item');
		saving = true;
		const customer = customers.find((c) => c.id === customerId);
		const orderNumber = Date.now().toString().slice(-6);
		const finalStatus = asDraft ? 'draft' : status;

		const orderData: any = {
			orderNumber,
			type: orderType,
			source,
			status: finalStatus,
			customerId: customerId || undefined,
			customerName: customerName || (customer?.data as any)?.name || undefined,
			lines,
			subtotal,
			discount: discountAmount || undefined,
			taxAmount: taxAmount || undefined,
			tip: tipAmount || undefined,
			total,
			currency,
			paymentMethod,
			notes: notes.trim() || undefined,
			tags: tagsInput.trim() ? tagsInput.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
			tableId: orderType === 'dine_in' ? tableId || undefined : undefined,
			covers: orderType === 'dine_in' ? covers : undefined,
			shipping: orderType === 'delivery' ? shipping : undefined,
			pickup: orderType === 'pickup' ? pickup : undefined,
			occurredAt: new Date().toISOString()
		};

		await glo.upsert<Order>(TYPE.order, orderData);
		toast.success(`Order #${orderNumber} ${asDraft ? 'saved as draft' : 'created'}`);
		saving = false;
		goto('/orders');
	}

	const ORDER_TYPES: { value: OrderType; label: string; icon: string }[] = [
		{ value: 'dine_in', label: 'Dine In', icon: 'lucide:utensils' },
		{ value: 'takeaway', label: 'Takeaway', icon: 'lucide:shopping-bag' },
		{ value: 'delivery', label: 'Delivery', icon: 'lucide:truck' },
		{ value: 'pickup', label: 'Pickup', icon: 'lucide:package' }
	];

	const SOURCES: { value: OrderSource; label: string; icon: string }[] = [
		{ value: 'orders_page', label: 'Orders Page', icon: 'lucide:clipboard-list' },
		{ value: 'pos', label: 'POS', icon: 'lucide:scan-line' },
		{ value: 'online', label: 'Online', icon: 'lucide:globe' },
		{ value: 'phone', label: 'Phone', icon: 'lucide:phone' },
		{ value: 'whatsapp', label: 'WhatsApp', icon: 'lucide:message-circle' }
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
</script>

<svelte:head><title>New Order · BNOS</title></svelte:head>

<div class="space-y-4">
	<!-- Header -->
	<div class="flex items-center gap-3">
		<Button color="neutral" variant="ghost" size="icon-sm" icon="lucide:arrow-left" onclick={() => goto('/orders')} />
		<div>
			<h1 class="font-display text-xl font-bold tracking-tight">New Order</h1>
			<p class="text-[12px] text-[var(--ui-text-muted)]">Create a manual order</p>
		</div>
	</div>

	<div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
		<!-- ═══ LEFT: Products + Line Items ═══ -->
		<div class="space-y-4 lg:col-span-2">
			<!-- Order Type & Source -->
			<div class="surface-card divide-y divide-[var(--ui-border-muted)]">
				<div class="px-5 py-3 flex items-center gap-2">
					<Icon name="lucide:tag" class="size-4 text-primary-500" />
					<h2 class="font-display text-[14px] font-semibold">Order Type & Source</h2>
				</div>
				<div class="px-5 py-4 space-y-4">
					<!-- Order type buttons -->
					<div>
						<span class="mb-2 block text-[11px] font-bold uppercase tracking-wider text-[var(--ui-text-muted)]">Order Type</span>
						<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
							{#each ORDER_TYPES as ot (ot.value)}
								<button
									type="button"
									class="flex items-center justify-center gap-1.5 rounded-xl border-2 p-2.5 text-[13px] font-medium transition-all {orderType === ot.value ? 'border-primary-500 bg-primary-500/10 text-primary-700 dark:text-primary-300' : 'border-[var(--ui-border)] text-[var(--ui-text-muted)] hover:border-[var(--ui-text-dimmed)]'}"
									onclick={() => (orderType = ot.value)}
								>
									<Icon name={ot.icon} class="size-4" />
									{ot.label}
								</button>
							{/each}
						</div>
					</div>
					<!-- Source -->
					<div>
						<span class="mb-2 block text-[11px] font-bold uppercase tracking-wider text-[var(--ui-text-muted)]">Source</span>
						<div class="flex flex-wrap gap-1.5">
							{#each SOURCES as os (os.value)}
								<button
									type="button"
									class="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-all {source === os.value ? 'border-primary-500 bg-primary-500/10 text-primary-700 dark:text-primary-300' : 'border-[var(--ui-border)] text-[var(--ui-text-muted)] hover:border-[var(--ui-text-dimmed)]'}"
									onclick={() => (source = os.value)}
								>
									<Icon name={os.icon} class="size-3.5 shrink-0" />
									{os.label}
								</button>
							{/each}
						</div>
					</div>
					<!-- Priority -->
					<div class="flex items-center gap-3">
						<span class="text-[11px] font-bold uppercase tracking-wider text-[var(--ui-text-muted)]">Priority:</span>
						<div class="flex gap-2">
							{#each ['normal', 'rush', 'vip'] as p (p)}
								<button
									type="button"
									class="rounded-lg px-3 py-1 text-[12px] font-semibold transition-all {priority === p ? (p === 'rush' ? 'bg-red-500/15 text-red-600 dark:text-red-400' : p === 'vip' ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' : 'bg-primary-500/15 text-primary-600 dark:text-primary-400') : 'border border-[var(--ui-border)] text-[var(--ui-text-muted)]'}"
									onclick={() => (priority = p as 'normal' | 'rush' | 'vip')}
								>
									{titleCase(p)}
								</button>
							{/each}
						</div>
					</div>
				</div>
			</div>

			<!-- Customer -->
			<div class="surface-card divide-y divide-[var(--ui-border-muted)]">
				<div class="px-5 py-3 flex items-center gap-2">
					<Icon name="lucide:user" class="size-4 text-primary-500" />
					<h2 class="font-display text-[14px] font-semibold">Customer <span class="text-[12px] font-normal text-[var(--ui-text-dimmed)]">(optional)</span></h2>
				</div>
				<div class="px-5 py-4">
					{#if customerName}
						<div class="flex items-center justify-between rounded-xl bg-primary-500/10 p-3">
							<div class="flex items-center gap-2">
								<Icon name="lucide:user-check" class="size-4 text-primary-600 dark:text-primary-400" />
								<span class="text-[13px] font-medium text-primary-700 dark:text-primary-300">{customerName}</span>
							</div>
							<Button color="neutral" variant="ghost" size="icon-sm" icon="lucide:x" onclick={clearCustomer} />
						</div>
					{:else}
						<button
							type="button"
							class="w-full rounded-xl border border-dashed border-[var(--ui-border)] px-3 py-2.5 text-left text-[13px] text-[var(--ui-text-muted)] transition-colors hover:border-primary-400 hover:text-primary-600 flex items-center gap-2"
							onclick={() => (showCustomerSelect = !showCustomerSelect)}
						>
							<Icon name="lucide:search" class="size-4" />
							Select a customer…
						</button>
						{#if showCustomerSelect}
							<div class="mt-2 max-h-48 overflow-y-auto rounded-xl border border-[var(--ui-border)]">
								{#each customers as c (c.id)}
									<button
										type="button"
										class="w-full border-b border-[var(--ui-border-muted)] px-3 py-2.5 text-left text-[13px] transition-colors last:border-0 hover:bg-[var(--ui-bg-accented)]"
										onclick={() => selectCustomer(c.data)}
									>
										<div class="font-medium">{c.data.name ?? 'Unknown'}</div>
										{#if (c.data as any).phone}<div class="text-[11px] text-[var(--ui-text-dimmed)]">{(c.data as any).phone}</div>{/if}
									</button>
								{/each}
								{#if customers.length === 0}
									<div class="px-3 py-4 text-center text-[13px] text-[var(--ui-text-dimmed)]">No customers found.</div>
								{/if}
							</div>
						{/if}
					{/if}
				</div>
			</div>

			<!-- Dine-in options -->
			{#if orderType === 'dine_in'}
				<div class="surface-card divide-y divide-[var(--ui-border-muted)]">
					<div class="px-5 py-3 flex items-center gap-2">
						<Icon name="lucide:chef-hat" class="size-4 text-primary-500" />
						<h2 class="font-display text-[14px] font-semibold">Dine-In Details</h2>
					</div>
					<div class="grid grid-cols-2 gap-3 px-5 py-4">
						<label class="block">
							<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Table</span>
							<Input bind:value={tableId} placeholder="e.g. A1, 5" class="w-full" />
						</label>
						<label class="block">
							<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Covers / Guests</span>
							<Input bind:value={covers} type="number" placeholder="Number of guests" min="1" class="w-full" />
						</label>
					</div>
				</div>
			{/if}

			<!-- Shipping (delivery) -->
			{#if orderType === 'delivery'}
				<div class="surface-card divide-y divide-[var(--ui-border-muted)]">
					<div class="px-5 py-3 flex items-center gap-2">
						<Icon name="lucide:truck" class="size-4 text-primary-500" />
						<h2 class="font-display text-[14px] font-semibold">Shipping / Delivery</h2>
					</div>
					<div class="px-5 py-4 space-y-3">
						<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
							<label class="block">
								<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Recipient Name</span>
								<Input bind:value={shipping.recipientName} placeholder="Full name" class="w-full" />
							</label>
							<label class="block">
								<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Phone</span>
								<Input bind:value={shipping.phone} type="tel" placeholder="020 xx xxx xxx" class="w-full" />
							</label>
						</div>
						<label class="block">
							<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Address</span>
							<Input bind:value={shipping.address} textarea={true} rows={2} placeholder="Street address, house number, landmark" class="w-full" />
						</label>
						<div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
							<label class="block">
								<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">City</span>
								<Input bind:value={shipping.city} placeholder="City" class="w-full" />
							</label>
							<label class="block">
								<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">State</span>
								<Input bind:value={shipping.state} placeholder="Province" class="w-full" />
							</label>
							<label class="block">
								<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Zip Code</span>
								<Input bind:value={shipping.zipCode} placeholder="00000" class="w-full" />
							</label>
						</div>
						<div class="grid grid-cols-2 gap-3">
							<label class="block">
								<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Delivery Fee</span>
								<Input bind:value={shipping.deliveryFee} type="number" min="0" placeholder="0" class="w-full" />
							</label>
							<label class="block">
								<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Delivery Provider</span>
								<Input bind:value={shipping.deliveryProvider} placeholder="Provider" class="w-full" />
							</label>
						</div>
						<label class="block">
							<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Delivery Notes</span>
							<Input bind:value={shipping.notes} textarea={true} rows={2} placeholder="Special instructions" class="w-full" />
						</label>
					</div>
				</div>
			{/if}

			<!-- Pickup info -->
			{#if orderType === 'pickup'}
				<div class="surface-card divide-y divide-[var(--ui-border-muted)]">
					<div class="px-5 py-3 flex items-center gap-2">
						<Icon name="lucide:package" class="size-4 text-primary-500" />
						<h2 class="font-display text-[14px] font-semibold">Pickup Info</h2>
					</div>
					<div class="px-5 py-4 space-y-3">
						<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
							<label class="block">
								<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Pickup Name</span>
								<Input bind:value={pickup.pickupName} placeholder="Customer name" class="w-full" />
							</label>
							<label class="block">
								<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Phone</span>
								<Input bind:value={pickup.phone} type="tel" placeholder="020 xx xxx xxx" class="w-full" />
							</label>
						</div>
						<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
							<label class="block">
								<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Ready Time</span>
								<Input bind:value={pickup.pickupTime} type="datetime-local" class="w-full" />
							</label>
							<label class="block">
								<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Pickup Location</span>
								<Input bind:value={pickup.pickupLocation} placeholder="Counter 1, Main entrance…" class="w-full" />
							</label>
						</div>
					</div>
				</div>
			{/if}

			<!-- Barcode scan + Product search + Line items -->
			<div class="surface-card divide-y divide-[var(--ui-border-muted)]">
				<div class="px-5 py-3 flex items-center justify-between">
					<div class="flex items-center gap-2">
						<Icon name="lucide:shopping-cart" class="size-4 text-primary-500" />
						<h2 class="font-display text-[14px] font-semibold">Order Items</h2>
						{#if lines.length > 0}
							<span class="inline-flex items-center justify-center rounded-md bg-[var(--ui-bg-muted)] px-1.5 py-0.5 text-[10px] font-bold">{lines.length}</span>
						{/if}
					</div>
					<Button size="sm" color="primary" variant="soft" icon="lucide:plus" onclick={() => showProductPicker = !showProductPicker}>Select Product</Button>
				</div>
				<div class="px-5 py-4 space-y-3">
					<!-- Barcode -->
					<div class="flex items-center gap-2">
						<div class="relative flex-1">
							<div class="inline-flex w-full items-center gap-2 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-3 py-2 transition-colors focus-within:border-primary-500">
								<Icon name="lucide:barcode" class="size-4 shrink-0 text-[var(--ui-text-dimmed)]" />
								<input
									bind:value={barcodeInput}
									onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleBarcodeScan(); } }}
									type="text"
									placeholder="Scan barcode or type SKU + Enter…"
									class="min-w-0 flex-1 bg-transparent text-[13px] focus:outline-none"
								/>
							</div>
						</div>
						<Button size="sm" color="neutral" variant="subtle" icon="lucide:barcode" onclick={handleBarcodeScan}>Scan</Button>
					</div>

					<!-- Product picker -->
					{#if showProductPicker}
						<div class="space-y-2">
							<Input bind:value={search} icon="lucide:search" placeholder="Search products by name or SKU…" class="w-full" />
							{#if search.trim() && filteredProducts.length > 0}
								<div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
									{#each filteredProducts.slice(0, 9) as p (p.id)}
										<button type="button" onclick={() => addLine(p.data as Product)} class="flex items-center gap-2 rounded-lg border border-[var(--ui-border)] px-3 py-2 text-left text-[12.5px] transition-colors hover:border-primary-500/40 hover:bg-primary-500/5">
											<Icon name="lucide:plus" class="size-3.5 shrink-0 text-primary-500" />
											<div class="min-w-0">
												<div class="truncate font-semibold">{(p.data as any).name}</div>
												<div class="text-[11px] text-[var(--ui-text-dimmed)]">{formatMoney((p.data as any).price ?? 0, currency ?? 'USD')}</div>
											</div>
										</button>
									{/each}
								</div>
							{:else if search.trim()}
								<p class="text-center text-[12.5px] text-[var(--ui-text-dimmed)]">No products found for "{search}"</p>
							{/if}
						</div>
					{/if}

					<!-- Line items table -->
					{#if lines.length === 0}
						<div class="py-10 text-center text-[var(--ui-text-dimmed)]">
							<Icon name="lucide:cart" class="mx-auto size-8" />
							<p class="mt-2 text-[13px]">Scan a barcode or search to add products</p>
						</div>
					{:else}
						<table class="w-full text-left text-[13px]">
							<thead>
								<tr>
									<th class="px-3 py-2.5">Item</th>
									<th class="px-3 py-2.5 text-center">Qty</th>
									<th class="px-3 py-2.5 text-right">Price</th>
									<th class="px-3 py-2.5 text-right">Total</th>
									<th class="w-10 px-3 py-2.5"></th>
								</tr>
							</thead>
							<tbody class="divide-y divide-[var(--ui-border-muted)]">
								{#each lines as line (line.id)}
									<tr>
										<td class="px-3 py-3">
											<div class="font-semibold">{line.name ?? line.productName}</div>
											{#if line.variantName}<div class="text-[11px] text-[var(--ui-text-dimmed)]">{line.variantName}</div>{/if}
											{#if line.modifiers?.length}<div class="text-[11px] text-[var(--ui-text-dimmed)]">{line.modifiers.map((m: any) => m.name).join(', ')}</div>{/if}
										</td>
										<td class="px-3 py-3">
											<div class="flex items-center justify-center gap-1.5">
												<button onclick={() => decQty(line.id ?? '')} class="grid size-6 place-items-center rounded-md bg-[var(--ui-bg-muted)] hover:bg-[var(--ui-bg-accented)]"><Icon name="lucide:minus" class="size-3" /></button>
												<span class="w-8 text-center font-semibold tabular-nums">{line.quantity}</span>
												<button onclick={() => incQty(line.id ?? '')} class="grid size-6 place-items-center rounded-md bg-[var(--ui-bg-muted)] hover:bg-[var(--ui-bg-accented)]"><Icon name="lucide:plus" class="size-3" /></button>
											</div>
										</td>
										<td class="px-3 py-3 text-right tabular-nums">{formatMoney((line as any).unitPrice ?? (line as any).price ?? 0, currency ?? 'USD')}</td>
										<td class="px-3 py-3 text-right font-semibold tabular-nums">{formatMoney(((line as any).unitPrice ?? (line as any).price ?? 0) * line.quantity, currency ?? 'USD')}</td>
										<td class="px-3 py-3 text-right"><Button color="neutral" variant="ghost" size="icon-sm" icon="lucide:x" onclick={() => removeLine(line.id ?? '')} /></td>
									</tr>
								{/each}
							</tbody>
						</table>
					{/if}
				</div>
			</div>

			<!-- Notes & Tags -->
			<div class="surface-card divide-y divide-[var(--ui-border-muted)]">
				<div class="px-5 py-3 flex items-center gap-2">
					<Icon name="lucide:file-text" class="size-4 text-primary-500" />
					<h2 class="font-display text-[14px] font-semibold">Notes & Tags</h2>
				</div>
				<div class="px-5 py-4 space-y-3">
					<label class="block">
						<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Order Notes</span>
						<Input bind:value={notes} textarea={true} rows={2} placeholder="Special instructions, customer requests…" class="w-full" />
					</label>
					<label class="block">
						<span class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">Tags (comma separated)</span>
						<Input bind:value={tagsInput} placeholder="e.g. catering, event, VIP" class="w-full" />
					</label>
				</div>
			</div>
		</div>

		<!-- ═══ RIGHT: Order details sidebar ═══ -->
		<div class="space-y-4">
			<!-- Status -->
			<div class="surface-card divide-y divide-[var(--ui-border-muted)]">
				<div class="px-5 py-3 flex items-center gap-2">
					<Icon name="lucide:clock" class="size-4 text-primary-500" />
					<h2 class="font-display text-[14px] font-semibold">Status</h2>
				</div>
				<div class="px-5 py-4">
					<span class="mb-2 block text-[11px] font-bold uppercase tracking-wider text-[var(--ui-text-muted)]">Initial Status</span>
					<div class="flex flex-wrap gap-2">
						{#each ['pending', 'confirmed', 'preparing', 'completed', 'cancelled'] as s (s)}
							<button
								type="button"
								class="rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-all {status === s ? 'bg-primary-500 text-white' : 'border border-[var(--ui-border)] text-[var(--ui-text-muted)] hover:border-[var(--ui-text-dimmed)]'}"
								onclick={() => (status = s)}
							>
								{titleCase(s)}
							</button>
						{/each}
					</div>
					{#if priority !== 'normal'}
						<div class="mt-3">
							<Badge color={priorityColor(priority)}>{titleCase(priority)} Priority</Badge>
						</div>
					{/if}
				</div>
			</div>

			<!-- Totals & Payment -->
			<div class="surface-card divide-y divide-[var(--ui-border-muted)]">
				<div class="px-5 py-3 flex items-center gap-2">
					<Icon name="lucide:wallet" class="size-4 text-primary-500" />
					<h2 class="font-display text-[14px] font-semibold">Totals & Payment</h2>
				</div>
				<div class="px-5 py-4 space-y-2.5 text-[13px]">
					<div class="flex justify-between"><span class="text-[var(--ui-text-muted)]">Subtotal</span><span class="tabular-nums">{formatMoney(subtotal, currency ?? 'USD')}</span></div>
					<div class="flex items-center justify-between gap-3">
						<span class="text-[var(--ui-text-muted)]">Discount</span>
						<input bind:value={discountAmount} type="number" min="0" class="w-24 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-2 py-1 text-right text-[13px] focus:outline-none" placeholder="0" />
					</div>
					{#if taxAmount > 0}
						<div class="flex justify-between"><span class="text-[var(--ui-text-muted)]">Tax ({defaultTaxRate}%)</span><span class="tabular-nums">{formatMoney(taxAmount, currency ?? 'USD')}</span></div>
					{/if}
					<div class="flex items-center justify-between gap-3">
						<span class="text-[var(--ui-text-muted)]">Tip</span>
						<input bind:value={tipAmount} type="number" min="0" class="w-24 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-2 py-1 text-right text-[13px] focus:outline-none" placeholder="0" />
					</div>
					<div class="flex justify-between border-t border-[var(--ui-border-muted)] pt-2.5 font-display text-[16px] font-bold">
						<span>Total</span><span class="tabular-nums">{formatMoney(total, currency ?? 'USD')}</span>
					</div>

					<!-- Payment method -->
					<div class="border-t border-[var(--ui-border-muted)] pt-3">
						<span class="mb-2 block text-[11px] font-bold uppercase tracking-wider text-[var(--ui-text-muted)]">Payment Method</span>
						<div class="grid grid-cols-2 gap-2">
							{#each PAYMENT_METHODS as pm (pm.value)}
								<button
									type="button"
									class="flex flex-col items-center justify-center gap-0.5 rounded-xl border px-2 py-2 text-[12px] font-medium transition-all {paymentMethod === pm.value ? 'border-primary-500 bg-primary-500/10 text-primary-700 dark:text-primary-300' : 'border-[var(--ui-border)] text-[var(--ui-text-muted)] hover:border-[var(--ui-text-dimmed)]'}"
									onclick={() => (paymentMethod = pm.value)}
								>
									<Icon name={pm.icon} class="size-4" />
									{pm.label}
								</button>
							{/each}
						</div>
					</div>
				</div>
			</div>

			<!-- Actions -->
			<div class="space-y-2">
				<Button color="primary" block icon="lucide:check" onclick={() => save(false)} disabled={saving || lines.length === 0}>
					{saving ? 'Creating…' : 'Create Order'}
				</Button>
				<Button color="neutral" variant="ghost" block icon="lucide:file-plus" onclick={() => save(true)} disabled={saving || lines.length === 0}>
					Save as Draft
				</Button>
			</div>
		</div>
	</div>
</div>
