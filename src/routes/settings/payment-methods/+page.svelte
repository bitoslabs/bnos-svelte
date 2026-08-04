<script lang="ts">
	import { browser } from '$app/environment';
	import { flip } from 'svelte/animate';
	import Icon from '$lib/components/ui/Icon.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Switch from '$lib/components/ui/Switch.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { confirm } from '$lib/stores/confirm.svelte';

	// ── Types ──────────────────────────────────────────────
	type PaymentType =
		| 'cash'
		| 'card'
		| 'lightning'
		| 'qr'
		| 'ecash'
		| 'coupon'
		| 'credit'
		| 'bank_transfer'
		| 'mobile_payment'
		| 'gift_card'
		| 'store_credit'
		| 'cryptocurrency'
		| 'other';

	interface PaymentMethod {
		id: string;
		label: string;
		icon: string;
		enabled: boolean;
		type: PaymentType;
		order: number;
		builtin: boolean;
	}

	// ── Constants ──────────────────────────────────────────
	const STORAGE_KEY = 'bnos-os:payment-methods';

	const BUILTINS: PaymentMethod[] = [
		{
			id: 'cash',
			label: 'Cash',
			icon: 'lucide:banknote',
			enabled: true,
			type: 'cash',
			order: 0,
			builtin: true
		},
		{
			id: 'card',
			label: 'Card',
			icon: 'lucide:credit-card',
			enabled: true,
			type: 'card',
			order: 1,
			builtin: true
		},
		{
			id: 'qr',
			label: 'QR / Bank transfer',
			icon: 'lucide:qr-code',
			enabled: false,
			type: 'qr',
			order: 2,
			builtin: true
		},
		{
			id: 'lightning',
			label: 'Lightning',
			icon: 'lucide:zap',
			enabled: false,
			type: 'lightning',
			order: 3,
			builtin: true
		}
	];

	const TYPE_OPTIONS: { value: PaymentType; label: string }[] = [
		{ value: 'cash', label: 'Cash (change calculator)' },
		{ value: 'card', label: 'Card (confirm)' },
		{ value: 'qr', label: 'QR (scan)' },
		{ value: 'lightning', label: 'Lightning (invoice)' },
		{ value: 'ecash', label: 'E-Cash' },
		{ value: 'coupon', label: 'Coupon' },
		{ value: 'credit', label: 'Credit' },
		{ value: 'bank_transfer', label: 'Bank Transfer' },
		{ value: 'mobile_payment', label: 'Mobile Payment' },
		{ value: 'gift_card', label: 'Gift Card' },
		{ value: 'store_credit', label: 'Store Credit' },
		{ value: 'cryptocurrency', label: 'Cryptocurrency' },
		{ value: 'other', label: 'Other (confirm)' }
	];

	const ICON_OPTIONS: { label: string; value: string }[] = [
		{ label: 'Cash', value: 'lucide:banknote' },
		{ label: 'Card', value: 'lucide:credit-card' },
		{ label: 'QR', value: 'lucide:qr-code' },
		{ label: 'Lightning', value: 'lucide:zap' },
		{ label: 'Wallet', value: 'lucide:wallet' },
		{ label: 'Bank', value: 'lucide:landmark' },
		{ label: 'Mobile', value: 'lucide:smartphone' },
		{ label: 'Phone', value: 'lucide:phone' },
		{ label: 'Gift', value: 'lucide:gift' },
		{ label: 'Star', value: 'lucide:star' },
		{ label: 'Bitcoin', value: 'lucide:bitcoin' },
		{ label: 'Coins', value: 'lucide:coins' },
		{ label: 'Receipt', value: 'lucide:receipt' },
		{ label: 'Ticket', value: 'lucide:ticket' }
	];

	const TYPE_STYLES: Record<PaymentType, string> = {
		cash: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
		card: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
		lightning: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
		qr: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
		ecash: 'bg-teal-500/10 text-teal-600 dark:text-teal-400',
		coupon: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
		credit: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
		bank_transfer: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
		mobile_payment: 'bg-pink-500/10 text-pink-600 dark:text-pink-400',
		gift_card: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
		store_credit: 'bg-lime-500/10 text-lime-600 dark:text-lime-400',
		cryptocurrency: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
		other: 'bg-gray-500/10 text-gray-600 dark:text-gray-400'
	};

	// ── State ──────────────────────────────────────────────
	let methods = $state<PaymentMethod[]>([]);
	let loaded = $state(false);

	let showDialog = $state(false);
	let editing = $state<PaymentMethod | null>(null);

	// Form fields
	let formLabel = $state('');
	let formId = $state('');
	let formIcon = $state('lucide:wallet');
	let formType = $state<PaymentType>('other');
	let formEnabled = $state(true);

	// ── Derived ────────────────────────────────────────────
	let sortedMethods = $derived([...methods].sort((a, b) => a.order - b.order));

	// ── Init ───────────────────────────────────────────────
	function load() {
		if (!browser) return;
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (raw) {
				const parsed = JSON.parse(raw) as PaymentMethod[];
				// Merge: ensure all builtins exist (in case new ones were added in an update)
				const ids = new Set(parsed.map((m) => m.id));
				for (const b of BUILTINS) {
					if (!ids.has(b.id)) parsed.push({ ...b });
				}
				methods = parsed;
			} else {
				methods = BUILTINS.map((b) => ({ ...b }));
			}
		} catch {
			methods = BUILTINS.map((b) => ({ ...b }));
		}
		loaded = true;
	}

	function persist() {
		if (!browser) return;
		localStorage.setItem(STORAGE_KEY, JSON.stringify(methods));
	}

	// ── CRUD ───────────────────────────────────────────────
	function openAdd() {
		editing = null;
		formLabel = '';
		formId = '';
		formIcon = 'lucide:wallet';
		formType = 'other';
		formEnabled = true;
		showDialog = true;
	}

	function openEdit(m: PaymentMethod) {
		editing = m;
		formLabel = m.label;
		formId = m.id;
		formIcon = m.icon;
		formType = m.type;
		formEnabled = m.enabled;
		showDialog = true;
	}

	function handleSave() {
		const label = formLabel.trim();
		if (!label) {
			toast.error('Label is required');
			return;
		}

		if (editing) {
			const idx = methods.findIndex((m) => m.id === editing!.id);
			if (idx >= 0) {
				methods[idx] = {
					...methods[idx],
					label,
					icon: formIcon,
					type: formType,
					enabled: formEnabled
				};
			}
			toast.success('Payment method updated');
		} else {
			const id = formId.trim() || label.toLowerCase().replace(/\s+/g, '_');

			if (methods.some((m) => m.id === id)) {
				toast.error('A method with this ID already exists');
				return;
			}

			const newMethod: PaymentMethod = {
				id,
				label,
				icon: formIcon,
				enabled: formEnabled,
				type: formType,
				order: methods.length,
				builtin: false
			};
			methods = [...methods, newMethod];
			toast.success('Payment method added');
		}

		persist();
		showDialog = false;
		editing = null;
	}

	async function handleDelete(m: PaymentMethod) {
		if (m.builtin) {
			toast.error('Built-in methods cannot be deleted');
			return;
		}
		if (
			!(await confirm({
				title: 'Delete payment method?',
				message: 'This cannot be undone.',
				detail: m.label,
				tone: 'danger',
				confirmText: 'Delete'
			}))
		)
			return;
		methods = methods.filter((x) => x.id !== m.id);
		persist();
		toast.success('Payment method deleted');
	}

	function handleToggle(id: string) {
		const m = methods.find((x) => x.id === id);
		if (!m) return;
		m.enabled = !m.enabled;
		persist();
		toast.success(`${m.label} ${m.enabled ? 'enabled' : 'disabled'}`);
	}

	async function handleReset() {
		if (
			!(await confirm({
				title: 'Reset payment methods?',
				message: 'All custom payment methods will be lost and defaults restored.',
				tone: 'danger',
				icon: 'lucide:rotate-ccw',
				confirmText: 'Reset all'
			}))
		)
			return;
		methods = BUILTINS.map((b) => ({ ...b }));
		persist();
		toast.success('Payment methods reset to defaults');
	}

	function typeLabel(t: PaymentType): string {
		return TYPE_OPTIONS.find((o) => o.value === t)?.label ?? t;
	}

	// ── Lifecycle ──────────────────────────────────────────
	$effect(() => {
		load();
	});
</script>

<svelte:head><title>Payment methods · Settings</title></svelte:head>

<div class="space-y-4">
	<!-- Header -->
	<PageHeader
		icon="lucide:credit-card"
		title="Payment methods"
		description="Methods available at checkout"
	>
		{#snippet actions()}
			<Button
				variant="ghost"
				color="neutral"
				size="sm"
				icon="lucide:rotate-ccw"
				onclick={handleReset}>Reset</Button
			>
			<Button variant="solid" color="primary" size="sm" icon="lucide:plus" onclick={openAdd}
				>Add method</Button
			>
		{/snippet}
	</PageHeader>

	<!-- List -->
	{#if loaded && sortedMethods.length === 0}
		<EmptyState
			icon="lucide:credit-card"
			title="No payment methods"
			description="Add your first payment method to start accepting payments."
		>
			{#snippet actions()}
				<Button variant="solid" color="primary" size="sm" icon="lucide:plus" onclick={openAdd}>
					Add method
				</Button>
			{/snippet}
		</EmptyState>
	{:else if loaded}
		<div class="space-y-2">
			{#each sortedMethods as m (m.id)}
				<div
					animate:flip={{ duration: 200 }}
					class="surface-card flex items-center gap-3 px-4 py-3.5 transition-opacity {!m.enabled
						? 'opacity-50'
						: ''}"
				>
					<!-- Icon -->
					<div
						class="grid size-10 shrink-0 place-items-center rounded-xl {TYPE_STYLES[m.type] ??
							TYPE_STYLES.other}"
					>
						<Icon name={m.icon} class="size-5" />
					</div>

					<!-- Info -->
					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-2">
							<span class="text-[14px] font-semibold">{m.label}</span>
							<Badge color={m.type === 'other' ? 'neutral' : 'primary'}>{m.type}</Badge>
							{#if !m.enabled}
								<Badge color="error">disabled</Badge>
							{/if}
							{#if m.builtin}
								<Badge color="neutral" variant="outline">built-in</Badge>
							{/if}
						</div>
						<p class="mt-0.5 text-[11.5px] text-[var(--ui-text-dimmed)]">ID: {m.id}</p>
					</div>

					<!-- Actions -->
					<div class="flex shrink-0 items-center gap-1">
						<button
							type="button"
							onclick={() => handleToggle(m.id)}
							class="grid size-8 place-items-center rounded-lg text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]"
							title={m.enabled ? 'Disable' : 'Enable'}
						>
							<Icon name={m.enabled ? 'lucide:eye' : 'lucide:eye-off'} class="size-4" />
						</button>
						<button
							type="button"
							onclick={() => openEdit(m)}
							class="grid size-8 place-items-center rounded-lg text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-accented)] hover:text-primary-500"
							title="Edit"
						>
							<Icon name="lucide:pencil" class="size-4" />
						</button>
						{#if !m.builtin}
							<button
								type="button"
								onclick={() => handleDelete(m)}
								class="grid size-8 place-items-center rounded-lg text-[var(--ui-text-muted)] transition hover:bg-[var(--tone-error-bg)] hover:text-[var(--tone-error-text)]"
								title="Delete"
							>
								<Icon name="lucide:trash-2" class="size-4" />
							</button>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<!-- Add / Edit Dialog -->
<Dialog bind:open={showDialog} title={editing ? 'Edit payment method' : 'Add payment method'}>
	<div class="space-y-4">
		<!-- Label -->
		<div class="space-y-1.5">
			<label
				class="block text-[11px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase"
			>
				Label
			</label>
			<Input bind:value={formLabel} placeholder="e.g. Cash, Card, Bank Transfer" class="w-full" />
		</div>

		<!-- ID (only for new / non-builtin) -->
		{#if !editing || !editing.builtin}
			<div class="space-y-1.5">
				<label
					class="block text-[11px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase"
				>
					ID {#if editing}(read-only){/if}
				</label>
				<Input
					bind:value={formId}
					placeholder="auto-generated from label if blank"
					class="w-full"
					{...editing ? { disabled: true } : {}}
				/>
				<p class="text-[10px] text-[var(--ui-text-dimmed)]">
					Unique identifier used internally. Leave blank to auto-generate.
				</p>
			</div>
		{/if}

		<!-- Icon picker -->
		<div class="space-y-1.5">
			<label
				class="block text-[11px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase"
			>
				Icon
			</label>
			<div class="flex flex-wrap gap-2">
				{#each ICON_OPTIONS as opt (opt.value)}
					<button
						type="button"
						onclick={() => (formIcon = opt.value)}
						title={opt.label}
						class="grid size-10 place-items-center rounded-xl border transition {formIcon ===
						opt.value
							? 'border-primary-500 bg-primary-500/10 text-primary-600 dark:text-primary-400'
							: 'border-[var(--ui-border)] text-[var(--ui-text-muted)] hover:border-[var(--ui-border-accented)] hover:text-[var(--ui-text)]'}"
					>
						<Icon name={opt.value} class="size-5" />
					</button>
				{/each}
			</div>
			<!-- Live preview -->
			<div class="flex items-center gap-2 pt-1">
				<span class="text-[11px] text-[var(--ui-text-dimmed)]">Preview:</span>
				<div
					class="grid size-8 place-items-center rounded-lg {TYPE_STYLES[formType] ??
						TYPE_STYLES.other}"
				>
					<Icon name={formIcon} class="size-4" />
				</div>
			</div>
		</div>

		<!-- Type -->
		<div class="space-y-1.5">
			<label
				class="block text-[11px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase"
			>
				Type
			</label>
			<div class="flex flex-wrap gap-1.5">
				{#each TYPE_OPTIONS as opt (opt.value)}
					<button
						type="button"
						onclick={() => (formType = opt.value)}
						class="rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition {formType ===
						opt.value
							? 'border-primary-500 bg-primary-500/10 text-primary-600 dark:text-primary-400'
							: 'border-[var(--ui-border)] text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]'}"
					>
						{opt.label}
					</button>
				{/each}
			</div>
		</div>

		<!-- Enabled toggle -->
		<div class="flex items-center justify-between py-1">
			<span class="text-[13.5px] font-medium">Enabled</span>
			<Switch checked={formEnabled} onCheckedChange={(v) => (formEnabled = v)} />
		</div>
	</div>

	{#snippet footer()}
		<Button variant="ghost" color="neutral" onclick={() => (showDialog = false)}>Cancel</Button>
		<Button variant="solid" color="primary" onclick={handleSave}>
			{editing ? 'Save changes' : 'Add method'}
		</Button>
	{/snippet}
</Dialog>
