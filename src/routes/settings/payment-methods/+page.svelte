<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Switch from '$lib/components/ui/Switch.svelte';
	import { toast } from '$lib/stores/toast.svelte';

	const KEY = 'bnos-os:pay-methods';
	const METHODS = [
		{ key: 'cash', label: 'Cash', icon: 'lucide:banknote', desc: 'Accept physical currency' },
		{ key: 'card', label: 'Card', icon: 'lucide:credit-card', desc: 'Credit / debit terminals' },
		{ key: 'qr', label: 'QR / Bank transfer', icon: 'lucide:qr-code', desc: 'Scan-to-pay' },
		{ key: 'lightning', label: 'Lightning', icon: 'lucide:zap', desc: 'Bitcoin Lightning Network' }
	] as const;

	let enabled = $state<Record<string, boolean>>({ cash: true, card: true, qr: false, lightning: false });

	onMount(() => { if (browser) { try { const r = localStorage.getItem(KEY); if (r) enabled = { ...enabled, ...JSON.parse(r) }; } catch { /* */ } } });
	function toggle(k: string, v: boolean) { enabled[k] = v; if (browser) localStorage.setItem(KEY, JSON.stringify(enabled)); toast.success(`${METHODS.find((m) => m.key === k)?.label} ${v ? 'enabled' : 'disabled'}`); }
</script>

<svelte:head><title>Payment methods · Settings</title></svelte:head>

<div class="space-y-4">
	<div class="flex items-center gap-3"><Icon name="lucide:credit-card" class="size-5 text-primary-500" /><div><h2 class="font-display text-[15px] font-semibold tracking-tight">Payment methods</h2><p class="text-[12px] text-[var(--ui-text-muted)]">Methods available at checkout</p></div></div>
	<div class="surface-card divide-y divide-[var(--ui-border-muted)]">
		{#each METHODS as m (m.key)}
			<div class="flex items-center gap-3 px-4 py-3.5">
				<div class="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)]"><Icon name={m.icon} class="size-5" /></div>
				<div class="flex-1"><div class="font-semibold">{m.label}</div><div class="text-[12px] text-[var(--ui-text-muted)]">{m.desc}</div></div>
				<Switch checked={enabled[m.key] ?? false} onCheckedChange={(v) => toggle(m.key, v)} />
			</div>
		{/each}
	</div>
</div>
