<script lang="ts">
	import { t } from '$lib/i18n/i18n.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import { glo } from '$nostr/store.svelte';
	import { tenant } from '$nostr/tenant.svelte';
	import {
		BUILTIN_TEMPLATES,
		applyCatalogPreset,
		builtinTemplateForBusinessType,
		type BuiltinTemplate
	} from '$lib/domain';
	import { formatInt, formatMoney } from '$lib/utils/format';
	import type { GloProduct } from '@bitos/bnos-core/glo';

	// `glo.all()` is reactive and hydrates IndexedDB asynchronously, so a derived
	// count updates after hydration instead of showing a false zero.
	const count = $derived(glo.all<GloProduct, 'catalog.product'>('catalog.product').length);

	const recommended = $derived(
		builtinTemplateForBusinessType(tenant.state.businessType) ?? BUILTIN_TEMPLATES[0]
	);

	let applyingId = $state<string | null>(null);
	let appliedId = $state<string | null>(null);
	let error = $state('');

	let previewOpen = $state(false);
	let previewTemplate = $state<BuiltinTemplate | null>(null);

	function openPreview(template: BuiltinTemplate) {
		previewTemplate = template;
		previewOpen = true;
	}

	function categoryName(template: BuiltinTemplate, categoryKey?: string): string {
		if (!categoryKey) return '—';
		return (
			template.preset.categories.find((category) => category.key === categoryKey)?.name ??
			categoryKey
		);
	}

	function productPrice(template: BuiltinTemplate, price?: number, currency?: string): string {
		return formatMoney(
			price ?? template.preset.defaultPrice ?? 0,
			currency ?? template.preset.currency ?? tenant.state.currency
		);
	}

	async function applyTemplate(template: BuiltinTemplate) {
		applyingId = template.preset.id;
		error = '';
		try {
			const result = await applyCatalogPreset(
				template.preset,
				(type, data, options) => glo.upsert(type as never, data as never, options),
				{ currency: tenant.state.currency }
			);
			if (!result.ok) {
				error = result.errors.join(' ');
				return;
			}
			appliedId = template.preset.id;
			previewOpen = false;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not apply the starter kit.';
		} finally {
			applyingId = null;
		}
	}

	function clear() {
		for (const p of glo.all('catalog.product')) glo.remove('catalog.product', p.id);
		for (const c of glo.all('catalog.category')) glo.remove('catalog.category', c.id);
		for (const u of glo.all('catalog.unit')) glo.remove('catalog.unit', u.id);
		for (const m of glo.all('catalog.modifier-group')) glo.remove('catalog.modifier-group', m.id);
	}
</script>

<svelte:head><title>{t('setup.title')} · {t('setup.catalog')}</title></svelte:head>

<div class="space-y-5">
	<div>
		<h2 class="font-display text-xl font-bold tracking-tight">Seed your catalog</h2>
		<p class="mt-1 text-[13.5px] text-(--ui-text-muted)">
			Pick a ready-made starter kit to create products, categories, units and modifiers in one
			click. Everything is stored locally as GLO <code>catalog.product</code> (kind 30100) objects you
			can edit in Catalog.
		</p>
	</div>

	<div class="metric-card flex items-center justify-between p-4">
		<div class="flex items-center gap-3">
			<div
				class="grid size-10 place-items-center rounded-lg bg-primary-500/10 text-primary-600 dark:text-primary-400"
			>
				<Icon name="lucide:package" class="size-5" />
			</div>
			<div>
				<div class="text-[13px] font-semibold">
					{formatInt(count)} product{count === 1 ? '' : 's'}
				</div>
				<div class="text-[12px] text-(--ui-text-muted)">in your local catalog</div>
			</div>
		</div>
		<Button color="neutral" variant="ghost" size="sm" onclick={clear} disabled={count === 0}
			>{t('common.clear')}</Button
		>
	</div>

	{#if error}
		<p class="rounded-lg bg-(--tone-error-bg) px-3 py-2 text-[12px] text-(--tone-error-text)">
			{error}
		</p>
	{/if}

	{#if count === 0}
		<div class="rounded-xl border border-primary-500/30 bg-primary-500/5 p-4">
			<div class="flex flex-wrap items-center justify-between gap-2">
				<div class="flex items-center gap-2">
					<Icon name={recommended.icon} class="size-4 text-primary-600 dark:text-primary-400" />
					<div>
						<div class="text-[13px] font-semibold">
							Recommended for you · {recommended.preset.name}
						</div>
						<p class="text-[12px] text-(--ui-text-muted)">{recommended.preset.summary}</p>
					</div>
				</div>
				<Button
					color="primary"
					size="sm"
					icon="lucide:sparkles"
					disabled={applyingId !== null}
					onclick={() => applyTemplate(recommended)}
					>{applyingId === recommended.preset.id ? 'Applying…' : 'Apply kit'}</Button
				>
			</div>
		</div>
	{/if}

	<div>
		<div class="mb-2 text-[12px] font-semibold tracking-wide text-(--ui-text-muted) uppercase">
			Starter kits
		</div>
		<div class="grid gap-3 sm:grid-cols-2">
			{#each BUILTIN_TEMPLATES as template (template.preset.id)}
				<div class="rounded-xl border border-(--ui-border) bg-(--ui-bg-elevated) p-4">
					<div class="flex items-start justify-between gap-2">
						<div class="flex items-center gap-2">
							<div
								class="grid size-8 place-items-center rounded-lg bg-(--ui-bg-accented) text-(--ui-text-muted)"
							>
								<Icon name={template.icon} class="size-4" />
							</div>
							<div>
								<div class="text-[13px] font-semibold">{template.preset.name}</div>
								<div class="text-[11px] text-(--ui-text-dimmed)">
									{template.preset.products.length} products ·
									{template.preset.categories.length} categories ·
									{template.preset.modifierGroups.length} modifier groups
								</div>
							</div>
						</div>
						{#if appliedId === template.preset.id}
							<Badge color="success">Applied</Badge>
						{/if}
					</div>
					<p class="mt-2 text-[12px] text-(--ui-text-muted)">{template.preset.summary}</p>
					<ul
						class="mt-3 divide-y divide-(--ui-border-muted) overflow-hidden rounded-lg border border-(--ui-border-muted)"
					>
						{#each template.preset.products.slice(0, 4) as product (product.key)}
							<li class="flex items-center justify-between gap-2 px-2.5 py-1.5">
								<span class="min-w-0 flex-1 truncate text-[12px] text-(--ui-text)"
									>{product.name}</span
								>
								<span class="shrink-0 font-mono text-[11px] text-(--ui-text-muted)"
									>{productPrice(template, product.price, product.currency)}</span
								>
							</li>
						{/each}
					</ul>
					<div class="mt-3 flex items-center justify-between gap-2">
						<button
							type="button"
							class="text-[12px] font-semibold text-(--ui-text-muted) underline underline-offset-2 hover:text-(--ui-text)"
							onclick={() => openPreview(template)}
							>{template.preset.products.length > 4
								? `View all ${template.preset.products.length}`
								: 'Preview'}</button
						>
						<Button
							color="neutral"
							variant="subtle"
							size="sm"
							icon="lucide:download"
							disabled={applyingId !== null}
							onclick={() => applyTemplate(template)}
							>{applyingId === template.preset.id ? 'Applying…' : 'Apply'}</Button
						>
					</div>
				</div>
			{/each}
		</div>
		<p class="mt-2 text-[11.5px] text-(--ui-text-dimmed)">
			Applying a kit twice updates the same records instead of duplicating them. You can add more
			kits or create individual products later from Catalog → Starter kits.
		</p>
	</div>
</div>

<Dialog
	bind:open={previewOpen}
	title={previewTemplate ? `${previewTemplate.preset.name} · preview` : 'Starter kit preview'}
	size="lg"
>
	{#if previewTemplate}
		<div class="space-y-4">
			<div>
				<p class="text-[12.5px] text-(--ui-text-muted)">{previewTemplate.preset.summary}</p>
				<p class="mt-1 text-[11.5px] text-(--ui-text-dimmed)">
					{previewTemplate.preset.products.length} products ·
					{previewTemplate.preset.categories.length} categories ·
					{previewTemplate.preset.units.length} units ·
					{previewTemplate.preset.modifierGroups.length} modifier groups
				</p>
			</div>

			{#if previewTemplate.preset.categories.length}
				<div class="flex flex-wrap gap-1.5">
					{#each previewTemplate.preset.categories as category (category.key)}
						<Badge color="neutral">{category.name}</Badge>
					{/each}
				</div>
			{/if}

			<div class="overflow-hidden rounded-xl border border-(--ui-border)">
				<div
					class="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-3 border-b border-(--ui-border-muted) bg-(--ui-bg-accented) px-3 py-2 text-[11px] font-semibold tracking-wide text-(--ui-text-muted) uppercase"
				>
					<span>Product</span>
					<span class="text-right">Options</span>
					<span class="text-right">Price</span>
				</div>
				<ul class="max-h-[52vh] divide-y divide-(--ui-border-muted) overflow-y-auto">
					{#each previewTemplate.preset.products as product (product.key)}
						<li class="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-3 py-2">
							<div class="min-w-0">
								<div class="truncate text-[12.5px] font-medium text-(--ui-text)">
									{product.name}
								</div>
								<div class="truncate text-[11px] text-(--ui-text-dimmed)">
									{categoryName(previewTemplate, product.categoryKey)}
									{#if product.sku}· {product.sku}{/if}
								</div>
							</div>
							<span class="text-right text-[11px] text-(--ui-text-muted)">
								{product.modifierGroupKeys?.length
									? `${product.modifierGroupKeys.length} groups`
									: '—'}
							</span>
							<span class="text-right font-mono text-[11.5px] whitespace-nowrap text-(--ui-text)"
								>{productPrice(previewTemplate, product.price, product.currency)}</span
							>
						</li>
					{/each}
				</ul>
			</div>

			{#if previewTemplate.preset.modifierGroups.length}
				<div>
					<div
						class="mb-1.5 text-[11px] font-semibold tracking-wide text-(--ui-text-muted) uppercase"
					>
						Modifier groups
					</div>
					<ul class="space-y-1">
						{#each previewTemplate.preset.modifierGroups as group (group.key)}
							<li class="text-[12px] text-(--ui-text-muted)">
								<span class="font-medium text-(--ui-text)">{group.name}</span>
								{group.required ? ' · required' : ''} · {group.modifiers?.length ?? 0}
								options
								<span class="text-(--ui-text-dimmed)"
									>({group.modifiers?.map((m) => m.name).join(', ')})</span
								>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		</div>
	{/if}
	{#snippet footer()}
		<Button color="neutral" variant="ghost" onclick={() => (previewOpen = false)}>Close</Button>
		<Button
			color="primary"
			icon="lucide:download"
			disabled={!previewTemplate || applyingId !== null}
			onclick={() => previewTemplate && applyTemplate(previewTemplate)}
			>{applyingId === previewTemplate?.preset.id ? 'Applying…' : 'Apply kit'}</Button
		>
	{/snippet}
</Dialog>
