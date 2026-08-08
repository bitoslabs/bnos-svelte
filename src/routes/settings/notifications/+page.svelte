<script lang="ts">
	import { onMount } from 'svelte';
	import { t } from '$lib/i18n/i18n.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import Switch from '$lib/components/ui/Switch.svelte';
	import { browser } from '$app/environment';
	import { toast } from '$lib/stores/toast.svelte';

	const KEY = 'bnos-os:settings-notifications';

	type NType =
		| 'order_new'
		| 'order_ready'
		| 'order_cancelled'
		| 'kitchen_new'
		| 'inventory_low'
		| 'inventory_received'
		| 'shift_ending'
		| 'shift_variance'
		| 'customer_new'
		| 'membership_expiring'
		| 'system_sync'
		| 'system_error'
		| 'system_update';

	let notifySound = $state(true);
	let notifyOrderComplete = $state(true);
	let notifyLowStock = $state(true);
	let notifyDailySummary = $state(false);
	let prefs = $state<Record<NType, boolean>>({
		order_new: true,
		order_ready: true,
		order_cancelled: true,
		kitchen_new: true,
		inventory_low: true,
		inventory_received: false,
		shift_ending: true,
		shift_variance: true,
		customer_new: false,
		membership_expiring: true,
		system_sync: false,
		system_error: true,
		system_update: false
	});

	onMount(() => {
		if (!browser) return;
		try {
			const s = JSON.parse(localStorage.getItem(KEY) ?? '{}');
			if (s.notifySound !== undefined) notifySound = s.notifySound;
			if (s.notifyOrderComplete !== undefined) notifyOrderComplete = s.notifyOrderComplete;
			if (s.notifyLowStock !== undefined) notifyLowStock = s.notifyLowStock;
			if (s.notifyDailySummary !== undefined) notifyDailySummary = s.notifyDailySummary;
			if (s.prefs) prefs = { ...prefs, ...s.prefs };
		} catch {
			/* */
		}
	});

	function save() {
		if (!browser) return;
		localStorage.setItem(
			KEY,
			JSON.stringify({
				notifySound,
				notifyOrderComplete,
				notifyLowStock,
				notifyDailySummary,
				prefs
			})
		);
		toast.success(t('settings.toastNotificationsSaved'));
	}

	function togglePref(k: NType) {
		prefs[k] = !prefs[k];
		save();
	}

	const groups: {
		category: string;
		icon: string;
		types: { key: NType; icon: string; label: string; desc: string }[];
	}[] = [
		{
			category: 'Orders',
			icon: 'lucide:shopping-cart',
			types: [
				{
					key: 'order_new',
					icon: 'lucide:cart-plus',
					label: t('common.new') + ' ' + t('common.order'),
					desc: 'When a new order is placed'
				},
				{
					key: 'order_ready',
					icon: 'lucide:check-circle',
					label: 'Order ready',
					desc: 'Kitchen marks order as ready'
				},
				{
					key: 'order_cancelled',
					icon: 'lucide:x-circle',
					label: 'Order cancelled',
					desc: 'When an order is cancelled'
				},
				{
					key: 'kitchen_new',
					icon: 'lucide:chef-hat',
					label: 'Kitchen ticket',
					desc: 'New prep ticket received'
				}
			]
		},
		{
			category: 'Inventory',
			icon: 'lucide:package',
			types: [
				{
					key: 'inventory_low',
					icon: 'lucide:triangle-alert',
					label: 'Low stock',
					desc: 'Product falls below threshold'
				},
				{
					key: 'inventory_received',
					icon: 'lucide:inbox',
					label: 'Stock received',
					desc: 'Purchase order items checked in'
				}
			]
		},
		{
			category: 'Staff',
			icon: 'lucide:users-round',
			types: [
				{
					key: 'shift_ending',
					icon: 'lucide:clock',
					label: 'Shift ending',
					desc: 'Approaching shift end time'
				},
				{
					key: 'shift_variance',
					icon: 'lucide:wallet',
					label: 'Cash variance',
					desc: 'Unexpected cash difference at close'
				}
			]
		},
		{
			category: 'Customers',
			icon: 'lucide:user-plus',
			types: [
				{
					key: 'customer_new',
					icon: 'lucide:user-plus',
					label: 'New customer',
					desc: 'A new customer registers'
				},
				{
					key: 'membership_expiring',
					icon: 'lucide:card-receipt',
					label: 'Membership expiring',
					desc: 'Subscription nearing expiry'
				}
			]
		},
		{
			category: 'System',
			icon: 'lucide:server',
			types: [
				{
					key: 'system_sync',
					icon: 'lucide:refresh-cw',
					label: 'Sync events',
					desc: 'Nostr relay sync status'
				},
				{
					key: 'system_error',
					icon: 'lucide:shield-alert',
					label: 'System errors',
					desc: 'Critical errors needing attention'
				},
				{
					key: 'system_update',
					icon: 'lucide:download',
					label: 'Updates',
					desc: 'New app version available'
				}
			]
		}
	];

	function enabledCount(types: { key: NType }[]) {
		return types.filter((t) => prefs[t.key]).length;
	}
</script>

<svelte:head><title>{t('settings.notifications')} · {t('common.settings')}</title></svelte:head>

<div class="space-y-5">
	<PageHeader
		icon="lucide:bell"
		title={t('settings.notifications')}
		description={t('settings.notificationsDesc')}
	/>

	<!-- Quick alerts -->
	<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
		<div class="flex items-center gap-2 px-5 py-3">
			<Icon name="lucide:bell" class="size-4 text-primary-500" />
			<h2 class="font-display text-[14px] font-semibold">{t('settings.generalAlerts')}</h2>
		</div>
		<div class="flex items-center justify-between gap-4 px-5 py-4">
			<div class="flex items-start gap-3">
				<div
					class="grid size-9 shrink-0 place-items-center rounded-xl bg-pink-500/10 text-pink-500"
				>
					<Icon name="lucide:music" class="size-4" />
				</div>
				<div>
					<label class="text-[13px] font-semibold">{t('settings.notificationSound')}</label>
					<p class="text-[11px] text-[var(--ui-text-dimmed)]">
						{t('settings.notificationSoundDesc')}
					</p>
				</div>
			</div>
			<Switch bind:checked={notifySound} onCheckedChange={save} />
		</div>
		<div class="flex items-center justify-between gap-4 px-5 py-4">
			<div class="flex items-start gap-3">
				<div
					class="grid size-9 shrink-0 place-items-center rounded-xl bg-emerald-500/10 text-emerald-500"
				>
					<Icon name="lucide:circle-check" class="size-4" />
				</div>
				<div>
					<label class="text-[13px] font-semibold">{t('settings.orderComplete')}</label>
					<p class="text-[11px] text-[var(--ui-text-dimmed)]">{t('settings.orderCompleteDesc')}</p>
				</div>
			</div>
			<Switch bind:checked={notifyOrderComplete} onCheckedChange={save} />
		</div>
		<div class="flex items-center justify-between gap-4 px-5 py-4">
			<div class="flex items-start gap-3">
				<div
					class="grid size-9 shrink-0 place-items-center rounded-xl bg-amber-500/10 text-amber-500"
				>
					<Icon name="lucide:box" class="size-4" />
				</div>
				<div>
					<label class="text-[13px] font-semibold">{t('settings.lowStockAlerts')}</label>
					<p class="text-[11px] text-[var(--ui-text-dimmed)]">{t('settings.lowStockAlertsDesc')}</p>
				</div>
			</div>
			<Switch bind:checked={notifyLowStock} onCheckedChange={save} />
		</div>
		<div class="flex items-center justify-between gap-4 px-5 py-4">
			<div class="flex items-start gap-3">
				<div
					class="grid size-9 shrink-0 place-items-center rounded-xl bg-blue-500/10 text-blue-500"
				>
					<Icon name="lucide:chart-pie" class="size-4" />
				</div>
				<div>
					<label class="text-[13px] font-semibold">{t('settings.dailySummary')}</label>
					<p class="text-[11px] text-[var(--ui-text-dimmed)]">{t('settings.dailySummaryDesc')}</p>
				</div>
			</div>
			<Switch bind:checked={notifyDailySummary} onCheckedChange={save} />
		</div>
	</section>

	<!-- Category groups -->
	{#each groups as g (g.category)}
		<section class="surface-card divide-y divide-[var(--ui-border-muted)]">
			<div class="flex items-center gap-2 px-5 py-3">
				<Icon name={g.icon} class="size-4 text-primary-500" />
				<h2 class="font-display text-[14px] font-semibold">{g.category}</h2>
				<span
					class="ml-auto rounded-full bg-[var(--ui-bg-accented)] px-2 py-0.5 text-[10px] font-medium text-[var(--ui-text-dimmed)]"
					>{enabledCount(g.types)}/{g.types.length}</span
				>
			</div>
			{#each g.types as nt (nt.key)}
				<div class="flex items-center justify-between gap-4 px-5 py-4">
					<div>
						<label class="text-[13px] font-semibold">{nt.label}</label>
						<p class="text-[11px] text-[var(--ui-text-dimmed)]">{nt.desc}</p>
					</div>
					<Switch checked={prefs[nt.key]} onCheckedChange={() => togglePref(nt.key)} />
				</div>
			{/each}
		</section>
	{/each}
</div>
