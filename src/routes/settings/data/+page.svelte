<script lang="ts">
	import { browser } from '$app/environment';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { goto } from '$app/navigation';
	import { glo } from '$nostr/store.svelte';
	import { session } from '$nostr/session.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import { toast } from '$lib/stores/toast.svelte';

	const GLO_PREFIX = 'bnos-os:glo:';

	function allData() {
		if (!browser) return {};
		const out: Record<string, unknown> = {};
		for (let i = 0; i < localStorage.length; i++) {
			const k = localStorage.key(i);
			if (k && (k.startsWith(GLO_PREFIX) || k.startsWith('bnos-os:'))) {
				try {
					out[k] = JSON.parse(localStorage.getItem(k) ?? 'null');
				} catch {
					out[k] = localStorage.getItem(k);
				}
			}
		}
		return out;
	}
	function exportData() {
		if (!browser) return;
		const blob = new Blob([JSON.stringify(allData(), null, 2)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `bdgo-os-backup-${new Date().toISOString().slice(0, 10)}.json`;
		a.click();
		URL.revokeObjectURL(url);
		toast.success('Backup exported');
	}

	// Import / restore from JSON backup
	let importInput = $state<HTMLInputElement>();

	function triggerImport() {
		importInput?.click();
	}

	async function handleImport(e: Event) {
		if (!browser) return;
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		try {
			const text = await file.text();
			const parsed = JSON.parse(text);
			if (typeof parsed !== 'object' || parsed === null) {
				toast.error('Invalid backup file');
				return;
			}

			let count = 0;
			for (const [key, value] of Object.entries(parsed)) {
				if (key.startsWith('bnos-os:')) {
					const strVal = typeof value === 'string' ? value : JSON.stringify(value);
					localStorage.setItem(key, strVal);
					count++;
				}
			}

			if (count === 0) {
				toast.warning('No valid data found in backup file');
				return;
			}

			// Re-hydrate GLO objects from localStorage
			const types = ['catalog.product', 'catalog.category', 'catalog.unit', 'catalog.modifier-group',
				'commerce.order', 'commerce.payment', 'crm.customer', 'identity.staff',
				'location', 'organization', 'expense', 'supplier', 'coupon', 'promotion',
				'membership', 'shift'];
			for (const t of types) {
				glo.hydrate(t);
			}

			toast.success(`Restored ${count} records from backup`);
		} catch {
			toast.error('Failed to parse backup file');
		} finally {
			// Reset input so the same file can be selected again
			input.value = '';
		}
	}

	async function wipeData() {
		if (!browser) return;
		if (!confirm('Wipe all local data and sign out? This cannot be undone.')) return;
		for (let i = localStorage.length - 1; i >= 0; i--) {
			const k = localStorage.key(i);
			if (k && k.startsWith('bnos-os:')) localStorage.removeItem(k);
		}
		await session.logout();
		tenant.reset();
		glo.clearAll();
		toast.info('Local data wiped');
		goto('/login');
	}

	const counts = $derived.by(() => {
		const types = Object.values({
			product: 'catalog.product',
			category: 'catalog.category',
			order: 'commerce.order',
			customer: 'crm.customer',
			staff: 'identity.staff',
			expense: 'expense'
		});
		return types.map((t) => ({ t, n: glo.all(t).length }));
	});

	// Approximate storage usage
	const storageKb = $derived.by(() => {
		if (!browser) return 0;
		let total = 0;
		for (let i = 0; i < localStorage.length; i++) {
			const k = localStorage.key(i);
			if (k && k.startsWith('bnos-os:')) {
				total += (localStorage.getItem(k) ?? '').length;
			}
		}
		// bytes → KB
		return Math.round((total / 1024) * 10) / 10;
	});

	const storageQuota = $derived.by(() => {
		if (!browser) return null;
		// Try to get quota info (may not be available in all browsers)
		if (navigator.storage?.estimate) {
			return navigator.storage.estimate();
		}
		return null;
	});
</script>

<svelte:head><title>Data · Settings</title></svelte:head>

<div class="space-y-5">
	<!-- Storage usage -->
	<section class="surface-card p-5">
		<div class="mb-4 flex items-center gap-3">
			<Icon name="lucide:hard-drive" class="size-5 text-primary-500" />
			<div>
				<h2 class="font-display text-[15px] font-semibold tracking-tight">Storage usage</h2>
				<p class="text-[12px] text-[var(--ui-text-muted)]">Approximate local storage consumed</p>
			</div>
		</div>
		<div class="flex items-baseline gap-2">
			<span class="font-display text-2xl font-bold tabular-nums">{storageKb}</span>
			<span class="text-[13px] text-[var(--ui-text-muted)]">KB used</span>
		</div>
		<div class="mt-2 h-2 w-full overflow-hidden rounded-full bg-[var(--ui-bg-accented)]">
			<div
				class="h-full rounded-full bg-primary-500 transition-all"
				style="width: {Math.min(100, (storageKb / 5120) * 100)}%"
			></div>
		</div>
		<p class="mt-1.5 text-[11px] text-[var(--ui-text-dimmed)]">
			{storageKb < 50 ? 'Lightweight — mostly metadata and cached records.' : 'Includes cached product, order, and CRM data.'}
		</p>
	</section>

	<!-- Local records -->
	<section class="surface-card p-5">
		<div class="mb-4 flex items-center gap-3">
			<Icon name="lucide:database" class="size-5 text-primary-500" />
			<div>
				<h2 class="font-display text-[15px] font-semibold tracking-tight">Local records</h2>
				<p class="text-[12px] text-[var(--ui-text-muted)]">Cached GLO objects on this device</p>
			</div>
		</div>
		<div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
			{#each counts as c (c.t)}
				<div class="rounded-lg bg-[var(--ui-bg-muted)] p-3">
					<div class="font-mono text-[11px] text-[var(--ui-text-dimmed)]">{c.t}</div>
					<div class="font-display text-lg font-bold tabular-nums">{c.n}</div>
				</div>
			{/each}
		</div>
	</section>

	<!-- Backup & restore -->
	<section class="surface-card p-5">
		<div class="mb-3 flex items-center gap-3">
			<Icon name="lucide:download" class="size-5 text-primary-500" />
			<div>
				<h2 class="font-display text-[15px] font-semibold tracking-tight">Backup &amp; restore</h2>
				<p class="text-[12px] text-[var(--ui-text-muted)]">Export a JSON snapshot or restore from a backup file</p>
			</div>
		</div>
		<div class="flex flex-wrap gap-2">
			<Button color="neutral" variant="subtle" icon="lucide:download" onclick={exportData}>Export backup</Button>
			<Button color="neutral" variant="subtle" icon="lucide:upload" onclick={triggerImport}>Import / restore</Button>
			<input
				bind:this={importInput}
				type="file"
				accept="application/json,.json"
				onchange={handleImport}
				class="hidden"
			/>
		</div>
	</section>

	<!-- Danger zone -->
	<section class="surface-card danger-surface p-5">
		<div class="mb-3 flex items-center gap-3">
			<Icon name="lucide:triangle-alert" class="size-5 text-[var(--tone-error-text)]" />
			<div>
				<h2 class="font-display text-[15px] font-semibold tracking-tight">Danger zone</h2>
				<p class="text-[12px] text-[var(--ui-text-muted)]">Wipe all local records and sign out</p>
			</div>
		</div>
		<Button color="error" variant="subtle" icon="lucide:trash-2" onclick={wipeData}>Wipe local data</Button>
	</section>
</div>
