<script lang="ts">
	/**
	 * Global ⌘K command palette — the app's signature "pro" shortcut. Three
	 * result sources, ranked by intent:
	 *
	 *   1. Live DATA (when typing) — fuzzy match across orders, products and
	 *      customers from the `glo` cache, each linking to its record.
	 *   2. Navigation — every permitted page (mirrors sidebar permissions +
	 *      feature gating).
	 *   3. Actions — New sale, Sync, Toggle theme, Relays, Settings.
	 *
	 * When the query is empty it instead surfaces recent commands first.
	 * Mounted once in `+layout.svelte`; opened via `command.show()` or ⌘K.
	 */
	import { scale } from 'svelte/transition';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { command } from '$lib/stores/command.svelte';
	import { navSections, permissionForNavItem, type NavItem, type NavSection } from '$lib/nav';
	import { permissions } from '$lib/permissions.svelte';
	import { TYPE, type Order, type Product, type Customer } from '$lib/domain';
	import { glo } from '$nostr/store.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { session } from '$nostr/session.svelte';
	import { features } from '$lib/features.svelte';
	import { dataSync } from '$nostr/sync.svelte';
	import { setMode, userPrefersMode } from 'mode-watcher';
	import { formatMoney } from '$lib/utils/format';

	type CmdTone = 'nav' | 'action' | 'data';
	interface Cmd {
		id: string;
		label: string;
		icon: string;
		group: string;
		tone?: CmdTone;
		keywords?: string;
		/** Right-aligned value (order total, product price, phone…). */
		trailing?: string;
		run: () => void | Promise<void>;
	}

	const currency = $derived(tenant.state.currency);

	// ── Navigation visibility (mirrors AppSidebar exactly) ────────────────
	function canSeeNav(item: NavItem): boolean {
		if (tenant.state.activeRole === null) return true;
		const gate = permissionForNavItem(item);
		if (!gate) return true;
		return permissions.can(gate.resource, gate.action);
	}
	function sectionVisible(section: NavSection): boolean {
		if (!section.feature) return true;
		if (section.feature === 'restaurant') return !!tenant.restaurantEnabled;
		return features.isEnabled(section.feature);
	}
	function toCmd(item: NavItem, group: string): Cmd {
		return {
			id: 'nav:' + item.to,
			label: item.label,
			icon: item.icon,
			group,
			tone: 'nav',
			keywords: item.to,
			run: () => goto(resolve(item.to as '/'))
		};
	}
	const navCmds = $derived<Cmd[]>(
		navSections
			.filter(sectionVisible)
			.flatMap((section) =>
				section.items
					.filter(canSeeNav)
					.flatMap((item) =>
						item.children
							? item.children.filter(canSeeNav).map((c) => toCmd(c, section.label))
							: [toCmd(item, section.label)]
					)
			)
	);

	// ── Actions ───────────────────────────────────────────────────────────
	const actionCmds = $derived<Cmd[]>([
		{
			id: 'act:pos',
			label: 'Start a new sale',
			icon: 'lucide:scan-line',
			group: 'Actions',
			tone: 'action',
			keywords: 'pos checkout cart terminal',
			run: () => goto(resolve('/pos'))
		},
		{
			id: 'act:sync',
			label: 'Sync all data',
			icon: 'lucide:refresh-cw',
			group: 'Actions',
			tone: 'action',
			keywords: 'refresh update online relay',
			run: () => void dataSync.manualSync()
		},
		{
			id: 'act:theme',
			label: 'Toggle dark mode',
			icon: 'lucide:sun-moon',
			group: 'Actions',
			tone: 'action',
			keywords: 'theme light dark appearance color',
			run: () => setMode(userPrefersMode.current === 'dark' ? 'light' : 'dark')
		},
		{
			id: 'act:relays',
			label: 'Manage relays',
			icon: 'lucide:radio',
			group: 'Actions',
			tone: 'action',
			keywords: 'network connection sync nostr',
			run: () => goto(resolve('/settings/relays'))
		},
		{
			id: 'act:settings',
			label: 'Open settings',
			icon: 'lucide:settings',
			group: 'Actions',
			tone: 'action',
			keywords: 'preferences config',
			run: () => goto(resolve('/settings'))
		}
	]);

	// ── Live data search (orders / products / customers) ──────────────────
	/** Subsequence fuzzy matcher with a substring boost. Returns -1 if no match. */
	function fuzzy(q: string, label: string, keywords = ''): number {
		const needle = q.trim().toLowerCase();
		if (!needle) return 1;
		const hay = `${label} ${keywords}`.toLowerCase();
		const idx = hay.indexOf(needle);
		if (idx >= 0) return 1000 - idx; // substring wins; earlier = better
		let qi = 0;
		let score = 0;
		let prev = -1;
		for (let ti = 0; ti < hay.length && qi < needle.length; ti++) {
			if (hay[ti] === needle[qi]) {
				score += prev === -1 ? 5 : Math.max(0, 5 - (ti - prev - 1));
				prev = ti;
				qi++;
			}
		}
		return qi === needle.length ? score : -1;
	}
	function topMatches(items: { c: Cmd; s: number }[], n: number): Cmd[] {
		return items
			.filter((x) => x.s >= 0)
			.sort((a, b) => b.s - a.s)
			.slice(0, n)
			.map((x) => x.c);
	}

	const orderCmds = $derived.by(() => {
		if (!query.trim()) return [];
		return topMatches(
			glo.all<Order, typeof TYPE.order>(TYPE.order).map((o) => {
				const d = o.data;
				const num = d.number ?? o.id.slice(0, 8);
				const kw = `${num} ${d.customerName ?? ''} ${d.status ?? ''}`;
				return {
					c: {
						id: 'order:' + o.id,
						label: `Order ${num}`,
						icon: 'lucide:receipt-text',
						group: 'Orders',
						tone: 'data',
						keywords: kw,
						trailing: formatMoney(d.total ?? 0, d.currency ?? currency),
						run: () => goto(resolve('/orders/[id]', { id: o.id }))
					} as Cmd,
					s: fuzzy(query, `Order ${num}`, kw)
				};
			}),
			3
		);
	});

	const productCmds = $derived.by(() => {
		if (!query.trim()) return [];
		return topMatches(
			glo.all<Product, typeof TYPE.product>(TYPE.product).map((p) => {
				const d = p.data;
				const name = d.name ?? 'Product';
				const sku = d.sku ?? '';
				return {
					c: {
						id: 'product:' + p.id,
						label: name,
						icon: 'lucide:package',
						group: 'Products',
						tone: 'data',
						keywords: sku,
						trailing: d.price != null ? formatMoney(d.price, d.currency ?? currency) : undefined,
						run: () => goto(resolve('/catalog'))
					} as Cmd,
					s: fuzzy(query, name, sku)
				};
			}),
			3
		);
	});

	const customerCmds = $derived.by(() => {
		if (!query.trim()) return [];
		return topMatches(
			glo.all<Customer, typeof TYPE.customer>(TYPE.customer).map((c) => {
				const d = c.data;
				const name = d.name ?? 'Customer';
				const phone = d.phone ?? '';
				const email = d.email ?? '';
				return {
					c: {
						id: 'customer:' + c.id,
						label: name,
						icon: 'lucide:user',
						group: 'Customers',
						tone: 'data',
						keywords: `${phone} ${email}`,
						trailing: phone || email || undefined,
						run: () => goto(resolve('/customers'))
					} as Cmd,
					s: fuzzy(query, name, `${phone} ${email}`)
				};
			}),
			3
		);
	});

	// ── Recent commands (persisted) ───────────────────────────────────────
	const RECENTS_KEY = 'bnos-os:cmd-recents';
	function loadRecents(): string[] {
		if (!browser) return [];
		try {
			const raw = localStorage.getItem(RECENTS_KEY);
			return raw ? (JSON.parse(raw) as string[]) : [];
		} catch {
			return [];
		}
	}
	function saveRecents(ids: string[]) {
		if (!browser) return;
		try {
			localStorage.setItem(RECENTS_KEY, JSON.stringify(ids));
		} catch {
			/* quota / private mode */
		}
	}
	let recents = $state<string[]>(loadRecents());
	function pushRecent(id: string) {
		recents = [id, ...recents.filter((r) => r !== id)].slice(0, 4);
		saveRecents(recents);
	}

	const staticCmds = $derived([...actionCmds, ...navCmds]);
	const recentCmds = $derived.by(() => {
		if (query.trim()) return [];
		const byId = new Map(staticCmds.map((c) => [c.id, c] as const));
		return recents
			.map((id) => byId.get(id))
			.filter((c): c is Cmd => !!c)
			.map((c) => ({ ...c, group: 'Recent' }))
			.slice(0, 3);
	});

	// ── Ranked results ────────────────────────────────────────────────────
	const results = $derived.by(() => {
		const q = query.trim();
		if (!q) {
			// Empty: recents → actions → nav (de-duped by id).
			const seen: Record<string, true> = {};
			return [...recentCmds, ...actionCmds, ...navCmds]
				.filter((c) => (seen[c.id] ? false : ((seen[c.id] = true), true)))
				.slice(0, 8);
		}
		// Typing: live data first (find my order/product/customer), then nav/actions.
		const data = [...orderCmds, ...productCmds, ...customerCmds];
		const matched = staticCmds
			.map((c) => ({ c, s: fuzzy(query, c.label, c.keywords) }))
			.filter((x) => x.s >= 0)
			.sort((a, b) => b.s - a.s)
			.map((x) => x.c);
		return [...data, ...matched].slice(0, 8);
	});

	function badgeClass(c: Cmd): string {
		if (c.tone === 'data') return 'bg-primary-500/15 text-primary-600 dark:text-primary-400';
		if (c.tone === 'action') return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
		return 'bg-[var(--ui-bg-muted)] text-[var(--ui-text-dimmed)]';
	}

	// ── Selection + focus ─────────────────────────────────────────────────
	let query = $state('');
	let selected = $state(0);
	let inputEl: HTMLInputElement | undefined = $state();

	$effect(() => {
		void results;
		selected = 0;
	});
	$effect(() => {
		if (command.open) {
			query = '';
			selected = 0;
			queueMicrotask(() => inputEl?.focus());
		}
	});
	$effect(() => {
		const sel = selected;
		document.querySelector(`[data-cmd-idx="${sel}"]`)?.scrollIntoView({ block: 'nearest' });
	});

	async function activate(c: Cmd) {
		command.hide();
		if (c.tone !== 'data') pushRecent(c.id);
		await c.run();
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			selected = Math.min(results.length - 1, selected + 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			selected = Math.max(0, selected - 1);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const c = results[selected];
			if (c) void activate(c);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			command.hide();
		}
	}

	function globalKey(e: KeyboardEvent) {
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
			if (!session.isAuthenticated) return;
			e.preventDefault();
			command.toggle();
		}
	}

	const syncing = $derived(dataSync.status === 'syncing');
</script>

<svelte:window onkeydown={globalKey} />

{#if command.open}
	<div class="fixed inset-0 z-[95] flex items-start justify-center p-4 pt-[10vh] sm:pt-[12vh]">
		<button
			type="button"
			tabindex="-1"
			aria-label="Close command palette"
			class="animate-fade fixed inset-0 bg-black/50 backdrop-blur-[2px]"
			onclick={() => command.hide()}
		></button>
		<div
			in:scale={{ duration: 160, start: 0.97 }}
			class="relative w-full max-w-xl overflow-hidden rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-bg-elevated)] shadow-2xl shadow-black/25"
			role="dialog"
			aria-modal="true"
			aria-label="Command palette"
		>
			<!-- Search field -->
			<div class="flex items-center gap-2.5 border-b border-[var(--ui-border-muted)] px-4">
				<Icon
					name={syncing ? 'lucide:loader-circle' : 'lucide:search'}
					class="size-4 shrink-0 text-[var(--ui-text-dimmed)] {syncing ? 'animate-spin' : ''}"
				/>
				<input
					bind:this={inputEl}
					bind:value={query}
					onkeydown={onKey}
					placeholder="Search orders, products, customers…"
					class="h-12 flex-1 bg-transparent text-[14px] font-medium text-[var(--ui-text-highlighted)] outline-none placeholder:font-normal placeholder:text-[var(--ui-text-dimmed)]"
					autocomplete="off"
					spellcheck="false"
				/>
				<kbd
					class="hidden shrink-0 rounded border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--ui-text-dimmed)] sm:block"
					>ESC</kbd
				>
			</div>

			<!-- Results -->
			<div class="max-h-[55vh] overflow-y-auto p-1.5">
				{#if results.length === 0}
					<div class="px-3 py-10 text-center text-[13px] text-[var(--ui-text-dimmed)]">
						No matches for <span class="font-semibold text-[var(--ui-text-muted)]">"{query}"</span>
					</div>
				{:else}
					{#each results as c, i (c.id)}
						<button
							type="button"
							data-cmd-idx={i}
							onmouseenter={() => (selected = i)}
							onclick={() => activate(c)}
							class="flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors {i ===
							selected
								? 'bg-primary-500/10'
								: 'hover:bg-[var(--ui-bg-accented)]'}"
						>
							<span
								class="grid size-7 shrink-0 place-items-center rounded-md {i === selected
									? 'bg-primary-500/15 text-primary-600 dark:text-primary-400'
									: badgeClass(c)}"
							>
								<Icon name={c.icon} class="size-4" />
							</span>
							<span
								class="min-w-0 flex-1 truncate text-[13px] font-semibold {i === selected
									? 'text-[var(--ui-text-highlighted)]'
									: 'text-[var(--ui-text-muted)]'}"
							>
								{c.label}
							</span>
							{#if c.trailing}
								<span
									class="shrink-0 text-[12px] font-bold tabular-nums {c.tone === 'data'
										? 'text-[var(--ui-text)]'
										: 'text-[var(--ui-text-dimmed)]'}"
								>
									{c.trailing}
								</span>
							{/if}
							<span class="shrink-0 text-[10.5px] font-medium text-[var(--ui-text-dimmed)]">
								{c.group}
							</span>
						</button>
					{/each}
				{/if}
			</div>

			<!-- Footer hints -->
			<div
				class="flex items-center justify-between gap-2 border-t border-[var(--ui-border-muted)] px-4 py-2 text-[10.5px] text-[var(--ui-text-dimmed)]"
			>
				<span class="flex items-center gap-1">
					<kbd class="rounded border border-[var(--ui-border-muted)] px-1.5 py-0.5 font-semibold"
						>↑</kbd
					>
					<kbd class="rounded border border-[var(--ui-border-muted)] px-1.5 py-0.5 font-semibold"
						>↓</kbd
					>
					navigate
				</span>
				<span class="flex items-center gap-1">
					<kbd class="rounded border border-[var(--ui-border-muted)] px-1.5 py-0.5 font-semibold"
						>↵</kbd
					>
					select
				</span>
				<span class="hidden items-center gap-1 sm:flex">
					<kbd class="rounded border border-[var(--ui-border-muted)] px-1.5 py-0.5 font-semibold"
						>esc</kbd
					>
					close
				</span>
				<span class="flex items-center gap-1.5 font-semibold text-[var(--ui-text-dimmed)]">
					<Icon name="lucide:command" class="size-3" />K
				</span>
			</div>
		</div>
	</div>
{/if}
