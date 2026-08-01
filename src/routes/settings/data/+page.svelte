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
	function wipeData() {
		if (!browser) return;
		if (!confirm('Wipe all local data and sign out? This cannot be undone.')) return;
		for (let i = localStorage.length - 1; i >= 0; i--) {
			const k = localStorage.key(i);
			if (k && k.startsWith('bnos-os:')) localStorage.removeItem(k);
		}
		session.logout();
		tenant.reset();
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
</script>

<svelte:head><title>Data · Settings</title></svelte:head>

<div class="space-y-5">
	<section class="surface-card p-5">
		<div class="mb-4 flex items-center gap-3">
			<Icon name="lucide:database" class="size-5 text-primary-500" />
			<div>
				<h2 class="font-display text-[15px] font-semibold tracking-tight">Local records</h2>
				<p class="text-[12px] text-[var(--ui-text-muted)]">Cached GLO objects on this device</p>
			</div>
		</div>
		<div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
			{#each counts as c (c.t)}<div class="rounded-lg bg-[var(--ui-bg-muted)] p-3">
					<div class="font-mono text-[11px] text-[var(--ui-text-dimmed)]">{c.t}</div>
					<div class="font-display text-lg font-bold tabular-nums">{c.n}</div>
				</div>{/each}
		</div>
	</section>
	<section class="surface-card p-5">
		<div class="mb-3 flex items-center gap-3">
			<Icon name="lucide:download" class="size-5 text-primary-500" />
			<div>
				<h2 class="font-display text-[15px] font-semibold tracking-tight">Backup & restore</h2>
				<p class="text-[12px] text-[var(--ui-text-muted)]">
					Export a JSON snapshot of all local data
				</p>
			</div>
		</div>
		<div class="flex flex-wrap gap-2">
			<Button color="neutral" variant="subtle" icon="lucide:download" onclick={exportData}
				>Export backup</Button
			>
		</div>
	</section>
	<section class="surface-card danger-surface p-5">
		<div class="mb-3 flex items-center gap-3">
			<Icon name="lucide:triangle-alert" class="size-5 text-[var(--tone-error-text)]" />
			<div>
				<h2 class="font-display text-[15px] font-semibold tracking-tight">Danger zone</h2>
				<p class="text-[12px] text-[var(--ui-text-muted)]">Wipe all local records and sign out</p>
			</div>
		</div>
		<Button color="error" variant="subtle" icon="lucide:trash-2" onclick={wipeData}
			>Wipe local data</Button
		>
	</section>
</div>
