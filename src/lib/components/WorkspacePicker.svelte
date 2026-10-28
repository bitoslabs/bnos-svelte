<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { t } from '$lib/i18n/i18n.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { workspacePicker } from '$nostr/workspace-picker.svelte';

	const branches = $derived(workspacePicker.selectedCompanyBranches);

	async function confirm() {
		const name = workspacePicker.selectedCompanyName;
		const ok = await workspacePicker.confirm();
		if (!ok) return;
		toast.success(t('workspacePicker.switched'), name);
		if (page.url.pathname !== '/') await goto(resolve('/'));
	}
</script>

<Dialog
	bind:open={workspacePicker.open}
	title={t('workspacePicker.title')}
	size="md"
	dismissible={false}
>
	<div class="space-y-4">
		<div class="flex items-start gap-3">
			<span
				class="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-500/10 text-primary-600 dark:text-primary-400"
			>
				<Icon name="lucide:building-2" class="size-5" />
			</span>
			<p class="text-[12.5px] leading-relaxed text-(--ui-text-muted)">
				{t('workspacePicker.desc')}
			</p>
		</div>

		<div class="space-y-1.5" role="radiogroup" aria-label={t('workspacePicker.company')}>
			{#each workspacePicker.companies as company (company.id)}
				{@const selected = company.id === workspacePicker.selectedCompanyId}
				<button
					type="button"
					role="radio"
					aria-checked={selected}
					onclick={() => workspacePicker.selectCompany(company.id)}
					class="flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors {selected
						? 'border-primary-500 bg-primary-500/5'
						: 'border-(--ui-border) hover:border-(--ui-border-accented) hover:bg-(--ui-bg-muted)'}"
				>
					<span
						class="grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-primary-500/10 text-[12px] font-bold text-primary-600 dark:text-primary-400"
					>
						{#if company.logoUrl}
							<img src={company.logoUrl} alt="" class="h-full w-full object-cover" />
						{:else}
							{(company.name || '?').charAt(0).toUpperCase()}
						{/if}
					</span>
					<span class="min-w-0 flex-1">
						<span class="block truncate text-[13px] font-semibold text-(--ui-text)"
							>{company.name}</span
						>
						<span class="block truncate text-[11px] text-(--ui-text-muted)">
							{company.code} · {company.currency}
						</span>
					</span>
					{#if selected}
						<Icon name="lucide:check-circle-2" class="size-5 shrink-0 text-primary-500" />
					{:else}
						<span class="size-5 shrink-0 rounded-full border border-(--ui-border)"></span>
					{/if}
				</button>
			{/each}
		</div>

		{#if branches.length > 1}
			<label class="block">
				<span class="mb-1 block text-[12px] font-semibold text-(--ui-text-muted)"
					>{t('workspacePicker.branch')}</span
				>
				<Select
					bind:value={workspacePicker.selectedBranchId}
					options={branches.map((branch) => ({
						value: branch.id,
						label: `${branch.name} (${branch.code})`
					}))}
					class="w-full"
					disabled={workspacePicker.switching}
				/>
			</label>
		{/if}
	</div>

	{#snippet footer()}
		<Button
			color="neutral"
			variant="ghost"
			disabled={workspacePicker.switching}
			onclick={() => workspacePicker.keepCurrent()}
		>
			{t('workspacePicker.keepCurrent')}
		</Button>
		<Button
			color="primary"
			disabled={workspacePicker.switching || !workspacePicker.selectedCompanyId}
			onclick={confirm}
		>
			{#if workspacePicker.switching}
				<Icon name="lucide:loader-circle" class="size-4 animate-spin" />
				{t('workspacePicker.switching')}
			{:else}
				<Icon name="lucide:arrow-right" class="size-4" />
				{t('workspacePicker.continue')}
			{/if}
		</Button>
	{/snippet}
</Dialog>
