<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { permissionForPath } from '$lib/nav';
	import { permissions } from '$lib/permissions.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { cn } from '$lib/utils/cn';
	import { t } from '$lib/i18n/i18n.svelte';

	/**
	 * Settings navigation, responsive:
	 *  - mobile  → iOS/macOS-style grouped list (inset rounded cards, large tap
	 *              targets, trailing chevrons). Shown in-page on the index.
	 *  - desktop → compact sticky sidebar list.
	 * Self-contained: computes groups, filters by permissions, tracks active.
	 */
	let { class: cls }: { class?: string } = $props();

	const groups: {
		label: string;
		labelKey: string;
		items: { to: string; icon: string; label: string; labelKey: string }[];
	}[] = [
		{
			label: 'Account',
			labelKey: 'settings.grpAccount',
			items: [
				{
					to: '/settings/profile',
					icon: 'lucide:user',
					label: t('settings.profile'),
					labelKey: 'settings.profile'
				}
			]
		},
		{
			label: 'Store',
			labelKey: 'settings.grpStore',
			items: [
				{
					to: '/settings/organization',
					icon: 'lucide:building-2',
					label: t('settings.workspace'),
					labelKey: 'settings.workspace'
				},
				{
					to: '/settings/store',
					icon: 'lucide:store',
					label: t('settings.store'),
					labelKey: 'settings.store'
				},
				{
					to: '/settings/general',
					icon: 'lucide:sliders-horizontal',
					label: t('settings.general'),
					labelKey: 'settings.general'
				},
				{
					to: '/settings/features',
					icon: 'lucide:layout-grid',
					label: t('settings.features'),
					labelKey: 'settings.features'
				},
				{
					to: '/settings/payment-methods',
					icon: 'lucide:credit-card',
					label: t('settings.paymentMethods'),
					labelKey: 'settings.paymentMethods'
				},
				{
					to: '/settings/receipt',
					icon: 'lucide:receipt-text',
					label: t('settings.receipt'),
					labelKey: 'settings.receipt'
				},
				{
					to: '/settings/media',
					icon: 'lucide:image-up',
					label: t('settings.media'),
					labelKey: 'settings.media'
				},
				{
					to: '/settings/bitcoin',
					icon: 'lucide:bitcoin',
					label: t('settings.bitcoin'),
					labelKey: 'settings.bitcoin'
				},
				{
					to: '/settings/pay-qr',
					icon: 'lucide:qr-code',
					label: t('settings.payQr'),
					labelKey: 'settings.payQr'
				}
			]
		},
		{
			label: 'Hardware',
			labelKey: 'settings.grpHardware',
			items: [
				{
					to: '/settings/hardware',
					icon: 'lucide:cpu',
					label: t('settings.hardware'),
					labelKey: 'settings.hardware'
				},
				{
					to: '/settings/printers',
					icon: 'lucide:printer',
					label: t('settings.printers'),
					labelKey: 'settings.printers'
				}
			]
		},
		{
			label: 'Billing',
			labelKey: 'settings.grpBilling',
			items: [
				{
					to: '/settings/billing',
					icon: 'lucide:credit-card',
					label: t('settings.billing'),
					labelKey: 'settings.billing'
				}
			]
		},
		{
			label: 'System',
			labelKey: 'settings.grpSystem',
			items: [
				{
					to: '/settings/notifications',
					icon: 'lucide:bell',
					label: t('settings.notifications'),
					labelKey: 'settings.notifications'
				},
				{
					to: '/settings/relays',
					icon: 'lucide:radio',
					label: t('settings.relays'),
					labelKey: 'settings.relays'
				},
				{
					to: '/settings/appearance',
					icon: 'lucide:palette',
					label: t('settings.appearance'),
					labelKey: 'settings.appearance'
				},
				{
					to: '/settings/data',
					icon: 'lucide:database',
					label: t('settings.data'),
					labelKey: 'settings.data'
				},
				{
					to: '/settings/about',
					icon: 'lucide:info',
					label: t('settings.about'),
					labelKey: 'settings.about'
				}
			]
		},
		{
			label: 'Legal',
			labelKey: 'settings.grpLegal',
			items: [
				{
					to: '/legal/privacy',
					icon: 'lucide:shield-check',
					label: t('legal.privacy'),
					labelKey: 'legal.privacy'
				},
				{
					to: '/legal/terms',
					icon: 'lucide:file-text',
					label: t('legal.terms'),
					labelKey: 'legal.terms'
				},
				{
					to: '/legal/license',
					icon: 'lucide:scale',
					label: t('legal.license'),
					labelKey: 'legal.license'
				}
			]
		}
	];

	function active(to: string) {
		const p = page.url.pathname;
		return to === '/settings' ? p === '/settings' : p.startsWith(to);
	}

	function canSee(to: string) {
		if (tenant.state.activeRole === null) return true;
		const gate = permissionForPath(to);
		if (!gate) return true;
		return permissions.can(gate.resource, gate.action);
	}

	const visibleGroups = $derived(
		groups
			.map((group) => ({ ...group, items: group.items.filter((item) => canSee(item.to)) }))
			.filter((group) => group.items.length > 0)
	);
</script>

<nav class={cn('settings-nav space-y-5 lg:space-y-4', cls)} aria-label={t('nav.settings')}>
	{#each visibleGroups as g (g.label)}
		<section class="settings-nav-group">
			<div
				class="settings-nav-label px-1 pb-1.5 text-[11px] font-semibold tracking-wider text-[var(--ui-text-dimmed)] uppercase lg:px-3 lg:text-[10px] lg:tracking-[0.16em]"
			>
				{g.labelKey ? t(g.labelKey) : g.label}
			</div>
			<ul
				class="settings-nav-list divide-y divide-[var(--ui-border-muted)] overflow-hidden rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] lg:divide-y-0 lg:rounded-none lg:border-0 lg:bg-transparent"
			>
				{#each g.items as it (it.to)}
					{@const isActive = active(it.to)}
					<li>
						<a
							href={resolve(it.to)}
							aria-current={isActive ? 'page' : undefined}
							class="settings-nav-link group flex items-center gap-3 px-3.5 py-3 text-[14px] font-medium transition-colors lg:gap-2.5 lg:rounded-lg lg:px-3 lg:py-2 lg:text-[13px] {isActive
								? 'is-active-surface'
								: 'text-[var(--ui-text)] hover:bg-[var(--ui-bg-accented)] lg:text-[var(--ui-text-muted)] lg:hover:text-[var(--ui-text)]'}"
						>
							<Icon
								name={it.icon}
								class={cn(
									'size-5 shrink-0 transition-colors lg:size-4',
									isActive
										? 'text-primary-500'
										: 'text-[var(--ui-text-dimmed)] group-hover:text-[var(--ui-text-muted)]'
								)}
							/>
							<span class="flex-1 truncate">{it.labelKey ? t(it.labelKey) : it.label}</span>
							<Icon
								name="lucide:chevron-right"
								class="size-4 shrink-0 text-[var(--ui-text-dimmed)] lg:hidden"
							/>
						</a>
					</li>
				{/each}
			</ul>
		</section>
	{/each}
</nav>
