<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { fade, scale } from 'svelte/transition';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { browser } from '$app/environment';
	import { formatMoney } from '$lib/utils/format';

	// Customer display: dark, full-screen, customer-facing
	// Listens for cart updates and checkout events via BroadcastChannel

	type CartItem = {
		name: string;
		quantity: number;
		unitPrice: number;
		variantName?: string;
		lineTotal: number;
	};

	type CartMessage = {
		type: 'cart';
		items: CartItem[];
		total: number;
		itemCount: number;
		customerName?: string;
		orderType?: string;
		currency: string;
	};

	type CheckoutMessage = {
		type: 'checkout-success';
		total: number;
		method: string;
		currency: string;
	};

	let currentSlide = $state(0);
	let slideTimer: ReturnType<typeof setInterval>;
	const SLIDE_INTERVAL = 5000;
	const SLIDES = 4;

	// Live cart state from POS
	let cartItems = $state<CartItem[]>([]);
	let cartTotal = $state(0);
	let cartItemCount = $state(0);
	let cartCustomerName = $state<string | undefined>(undefined);
	let cartOrderType = $state<string | undefined>(undefined);

	// Checkout success
	let showSuccess = $state(false);
	let successTimer: ReturnType<typeof setTimeout>;

	let channel: BroadcastChannel | null = null;

	onMount(() => {
		slideTimer = setInterval(() => {
			if (!cartItems.length && !showSuccess) {
				currentSlide = (currentSlide + 1) % SLIDES;
			}
		}, SLIDE_INTERVAL);

		// Listen for cart updates from POS
		if (typeof BroadcastChannel !== 'undefined') {
			channel = new BroadcastChannel('bnos-customer-display');
			channel.onmessage = (e: MessageEvent<CartMessage | CheckoutMessage>) => {
				const msg = e.data;
				if (msg.type === 'cart') {
					cartItems = msg.items;
					cartTotal = msg.total;
					cartItemCount = msg.itemCount;
					cartCustomerName = msg.customerName;
					cartOrderType = msg.orderType;
				} else if (msg.type === 'checkout-success') {
					cartItems = [];
					cartTotal = msg.total;
					cartItemCount = 0;
					showSuccess = true;
					clearTimeout(successTimer);
					successTimer = setTimeout(() => {
						showSuccess = false;
						currentSlide = 0;
					}, 4000);
				}
			};
		}
	});

	onDestroy(() => {
		if (slideTimer) clearInterval(slideTimer);
		if (successTimer) clearTimeout(successTimer);
		channel?.close();
	});

	const storeName = $derived(tenant.state.organizationName || 'Welcome');
	const currency = $derived(tenant.state.currency);

	const paymentMethods = [
		{ icon: 'lucide:banknote', label: 'Cash' },
		{ icon: 'lucide:credit-card', label: 'Card' },
		{ icon: 'lucide:qr-code', label: 'QR Pay' },
		{ icon: 'lucide:zap', label: 'Lightning' }
	];

	const hasActiveCart = $derived(cartItems.length > 0);
</script>

<svelte:head><title>Customer Display · BNOS</title></svelte:head>

<div class="flex h-screen w-screen select-none flex-col overflow-hidden bg-[#0B0E14] font-sans text-white">
	<!-- Ambient background -->
	<div class="pointer-events-none absolute inset-0 overflow-hidden">
		<div class="absolute -left-32 top-1/4 size-64 rounded-full bg-primary-500/5 blur-3xl"></div>
		<div class="absolute -right-32 bottom-1/4 size-64 rounded-full bg-emerald-500/5 blur-3xl"></div>
	</div>

	<!-- Payment success overlay -->
	{#if showSuccess}
		<div class="absolute inset-0 z-50 flex flex-col items-center justify-center" in:scale={{ duration: 300, start: 0.9 }} out:fade={{ duration: 300 }}>
			<div class="rounded-full bg-green-500/20 p-8">
				<div class="grid size-24 place-items-center rounded-full bg-green-500 text-white shadow-lg shadow-green-500/50">
					<Icon name="lucide:check" class="size-12" />
				</div>
			</div>
			<div class="mt-6 text-center">
				<p class="font-display text-3xl font-black text-white">Thank You!</p>
				<p class="mt-2 text-lg text-gray-400">{formatMoney(cartTotal, currency)}</p>
			</div>
		</div>
	{/if}

	<!-- Live cart view -->
	{#if hasActiveCart && !showSuccess}
		<div class="relative z-10 flex h-full flex-col px-12 py-10" in:fade={{ duration: 200 }}>
			<!-- Cart header -->
			<div class="mb-6 flex items-center justify-between">
				<div>
					<h1 class="font-display text-2xl font-black tracking-tight text-white">{storeName}</h1>
					<p class="mt-1 text-sm text-gray-500">
						{#if cartOrderType}
							<span class="capitalize">{cartOrderType.replace('_', ' ')}</span>
						{/if}
						{#if cartCustomerName}· {cartCustomerName}{/if}
					</p>
				</div>
				<div class="rounded-full bg-primary-500/15 px-4 py-1.5 text-sm font-bold text-primary-400">
					{cartItemCount} item{cartItemCount !== 1 ? 's' : ''}
				</div>
			</div>

			<!-- Cart items list -->
			<div class="min-h-0 flex-1 overflow-y-auto">
				<div class="space-y-2">
					{#each cartItems as item, i (i)}
						<div class="flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.03] px-5 py-3.5">
							<div class="flex items-center gap-4">
								<span class="grid size-8 shrink-0 place-items-center rounded-lg bg-primary-500/15 text-sm font-bold text-primary-400">
									{item.quantity}
								</span>
								<div>
									<p class="text-base font-semibold text-white">
										{item.name}
										{#if item.variantName}<span class="text-sm font-normal text-gray-500"> · {item.variantName}</span>{/if}
									</p>
								</div>
							</div>
							<p class="text-base font-bold tabular-nums text-gray-300">
								{formatMoney(item.lineTotal, currency)}
							</p>
						</div>
					{/each}
				</div>
			</div>

			<!-- Total -->
			<div class="mt-6 border-t border-white/10 pt-6">
				<div class="flex items-center justify-between">
					<span class="font-display text-xl font-bold text-gray-400">Total</span>
					<span class="font-display text-5xl font-black tabular-nums text-white">
						{formatMoney(cartTotal, currency)}
					</span>
				</div>
			</div>
		</div>
	{:else if !showSuccess}
		<!-- Idle / Onboarding slides -->
		<div class="relative z-10 flex flex-1 flex-col items-center justify-center px-12">
			{#if currentSlide === 0}
				<!-- Welcome slide -->
				<div class="flex flex-col items-center gap-6 text-center" in:fade={{ duration: 400 }}>
					<div class="grid size-28 place-items-center rounded-3xl border border-primary-500/20 bg-primary-500/10">
						<Icon name="lucide:store" class="size-14 text-primary-400" />
					</div>
					<div>
						<h1 class="font-display text-4xl font-black tracking-tight text-white">{storeName}</h1>
						<p class="mt-3 text-lg font-medium text-gray-400">Ready to serve you</p>
					</div>
				</div>
			{:else if currentSlide === 1}
				<!-- Payment methods -->
				<div class="flex max-w-lg flex-col items-center gap-6 text-center" in:fade={{ duration: 400 }}>
					<div class="grid size-16 place-items-center rounded-2xl border border-emerald-500/20 bg-emerald-500/10">
						<Icon name="lucide:wallet" class="size-8 text-emerald-400" />
					</div>
					<div>
						<h2 class="font-display text-2xl font-black text-white">We Accept</h2>
						<p class="mt-1 text-sm text-gray-500">Multiple payment methods</p>
					</div>
					<div class="mt-2 grid w-full max-w-sm grid-cols-2 gap-3">
						{#each paymentMethods as pm (pm.label)}
							<div class="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.03] px-4 py-3">
								<Icon name={pm.icon} class="size-5 text-gray-400" />
								<span class="text-sm font-semibold text-gray-300">{pm.label}</span>
							</div>
						{/each}
					</div>
				</div>
			{:else if currentSlide === 2}
				<!-- Promotions -->
				<div class="flex max-w-lg flex-col items-center gap-6 text-center" in:fade={{ duration: 400 }}>
					<div class="grid size-16 place-items-center rounded-2xl border border-amber-500/20 bg-amber-500/10">
						<Icon name="lucide:tags" class="size-8 text-amber-400" />
					</div>
					<div>
						<h2 class="font-display text-2xl font-black text-white">Today's Specials</h2>
						<p class="mt-1 text-sm text-gray-500">Ask the cashier for details</p>
					</div>
					<div class="mt-2 w-full max-w-sm space-y-3">
						<div class="flex items-center gap-4 rounded-xl border border-amber-500/15 bg-gradient-to-r from-amber-500/10 to-primary-500/10 px-5 py-4">
							<div class="grid size-10 shrink-0 place-items-center rounded-lg bg-amber-500/15">
								<Icon name="lucide:percent" class="size-5 text-amber-400" />
							</div>
							<div class="text-left"><p class="text-sm font-bold text-white">Special Discount</p><p class="text-xs text-gray-500">On selected items</p></div>
						</div>
						<div class="flex items-center gap-4 rounded-xl border border-emerald-500/15 bg-gradient-to-r from-emerald-500/10 to-primary-500/10 px-5 py-4">
							<div class="grid size-10 shrink-0 place-items-center rounded-lg bg-emerald-500/15">
								<Icon name="lucide:gift" class="size-5 text-emerald-400" />
							</div>
							<div class="text-left"><p class="text-sm font-bold text-white">Loyalty Rewards</p><p class="text-xs text-gray-500">Earn points with every purchase</p></div>
						</div>
					</div>
				</div>
			{:else}
				<!-- Store info -->
				<div class="flex max-w-md flex-col items-center gap-6 text-center" in:fade={{ duration: 400 }}>
					<div class="grid size-16 place-items-center rounded-2xl border border-blue-500/20 bg-blue-500/10">
						<Icon name="lucide:info" class="size-8 text-blue-400" />
					</div>
					<h2 class="font-display text-2xl font-black text-white">Visit Us</h2>
					<div class="w-full space-y-3">
						<div class="flex items-center gap-4 rounded-xl border border-white/5 bg-white/[0.03] px-5 py-3.5">
							<Icon name="lucide:clock" class="size-5 text-gray-400" />
							<div class="text-left"><p class="text-sm font-semibold text-gray-300">Open Daily</p><p class="text-xs text-gray-500">8:00 AM – 10:00 PM</p></div>
						</div>
						<div class="flex items-center gap-4 rounded-xl border border-white/5 bg-white/[0.03] px-5 py-3.5">
							<Icon name="lucide:globe" class="size-5 text-gray-400" />
							<div class="text-left"><p class="text-sm font-semibold text-gray-300">{storeName}</p><p class="text-xs text-gray-500">Nostr-native commerce</p></div>
						</div>
					</div>
				</div>
			{/if}
		</div>

		<!-- Slide indicators -->
		<div class="relative z-10 flex justify-center gap-2 pb-8">
			{#each Array(SLIDES) as _, i (i)}
				<button onclick={() => (currentSlide = i)} class="h-1.5 rounded-full transition-all {currentSlide === i ? 'w-8 bg-primary-500' : 'w-1.5 bg-white/20'}"></button>
			{/each}
		</div>
	{/if}
</div>
