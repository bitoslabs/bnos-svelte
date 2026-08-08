<script lang="ts">
	/**
	 * MediaImageGallery — multi-image input that backs the `images: string[]`
	 * field (products, marketplace listings). The first image is the cover.
	 *
	 * Reuses `media.upload()` (Cloudinary / S3 / server fallback) so it stores
	 * URLs only — never data URIs. Supports:
	 *   • drag & drop multiple files onto the dropzone
	 *   • click to pick one or more files
	 *   • paste a URL (adds to the end)
	 *   • reorder (promote to cover / move), remove, clear-all
	 */
	import Icon from '$lib/components/ui/Icon.svelte';
	import { t } from '$lib/i18n/i18n.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import { media } from '$lib/media/media.svelte';
	import type { UploadPurpose } from '$lib/media/uploaders';
	import { humanBytes } from '$lib/media/uploaders';
	import { toast } from '$lib/stores/toast.svelte';
	import { cn } from '$lib/utils/cn';

	let {
		value = $bindable(),
		purpose,
		accept = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml',
		maxBytes = 5 * 1024 * 1024,
		maxImages = 8,
		label = 'Images',
		hint = '',
		disabled = false
	}: {
		value: string[];
		purpose: UploadPurpose;
		accept?: string;
		maxBytes?: number;
		maxImages?: number;
		label?: string;
		hint?: string;
		disabled?: boolean;
	} = $props();

	let inputEl: HTMLInputElement;
	let urlInput = $state('');
	let uploadingCount = $state(0);
	let dragging = $state(false);

	const sizeLabel = $derived(humanBytes(maxBytes));
	const canAdd = $derived(!disabled && value.length < maxImages);

	function validate(file: File): string | null {
		if (!file.type.startsWith('image/')) return 'Please choose image files only';
		if (file.size > maxBytes) return `${file.name} is too large (max ${sizeLabel})`;
		return null;
	}

	function slotsLeft(n: number): number {
		return Math.max(0, maxImages - value.length - n);
	}

	async function handleFiles(files: FileList | File[] | null | undefined) {
		if (!files || disabled) return;
		const list = Array.from(files);
		if (list.length === 0) return;

		const room = slotsLeft(0);
		if (room <= 0) {
			toast.warning(`Maximum ${maxImages} images reached`);
			return;
		}
		const queue = list.slice(0, room);
		if (list.length > room) {
			toast.info(`Added ${room} of ${list.length} — image limit is ${maxImages}`);
		}

		for (const file of queue) {
			const err = validate(file);
			if (err) {
				toast.warning(err);
				continue;
			}
			uploadingCount++;
			try {
				const result = await media.upload(file, undefined, { purpose });
				value = [...value, result.url];
			} catch (e) {
				toast.error('Upload failed', e instanceof Error ? e.message : undefined);
			} finally {
				uploadingCount--;
			}
		}
		toast.success(`${queue.length} image${queue.length > 1 ? 's' : ''} added`);
		if (inputEl) inputEl.value = '';
	}

	function onPick(e: Event) {
		const input = e.target as HTMLInputElement;
		handleFiles(input.files);
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		dragging = false;
		handleFiles(e.dataTransfer?.files);
	}

	function addUrl() {
		const url = urlInput.trim();
		if (!url || disabled) return;
		if (value.length >= maxImages) {
			toast.warning(`Maximum ${maxImages} images reached`);
			return;
		}
		value = [...value, url];
		urlInput = '';
	}

	function removeAt(i: number) {
		value = value.filter((_, idx) => idx !== i);
	}

	function promote(i: number) {
		if (i <= 0) return;
		const next = [...value];
		[next[0], next[i]] = [next[i], next[0]];
		value = next;
		toast.success('Set as cover');
	}

	function move(i: number, dir: -1 | 1) {
		const j = i + dir;
		if (j < 0 || j >= value.length) return;
		const next = [...value];
		[next[i], next[j]] = [next[j], next[i]];
		value = next;
	}

	function clearAll() {
		value = [];
	}
</script>

<div class="space-y-2.5">
	{#if label}
		<div class="flex items-center justify-between">
			<span class="text-[12px] font-semibold text-[var(--ui-text-muted)]">{label}</span>
			<span class="text-[10px] text-[var(--ui-text-dimmed)]">{value.length}/{maxImages}</span>
		</div>
	{/if}

	<!-- Dropzone (hidden when at capacity) -->
	{#if canAdd}
		<div
			role="button"
			tabindex={disabled ? -1 : 0}
			aria-label="Upload images"
			class={cn(
				'flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-5 text-center transition-colors',
				dragging
					? 'border-primary-500 bg-primary-500/10'
					: 'border-[var(--ui-border)] bg-[var(--ui-bg-muted)] hover:border-[var(--ui-border-accented)] hover:bg-[var(--ui-bg-accented)]'
			)}
			onclick={() => !disabled && uploadingCount === 0 && inputEl.click()}
			onkeydown={(e) => {
				if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
					e.preventDefault();
					inputEl.click();
				}
			}}
			ondragover={(e) => {
				e.preventDefault();
				if (!disabled) dragging = true;
			}}
			ondragleave={() => (dragging = false)}
			ondrop={onDrop}
		>
			{#if uploadingCount > 0}
				<Icon name="lucide:loader-circle" class="size-6 animate-spin text-primary-500" />
				<span class="text-[11.5px] font-medium text-[var(--ui-text-muted)]">Uploading {uploadingCount}…</span>
			{:else}
				<Icon name="lucide:image-up" class="size-6 text-[var(--ui-text-dimmed)]" />
				<span class="text-[12px] font-semibold text-[var(--ui-text-muted)]">
					Drag & drop or <span class="text-primary-600 dark:text-primary-400">browse</span>
				</span>
				<span class="text-[10px] text-[var(--ui-text-dimmed)]">
					{#if value.length > 0}Add more · {/if}up to {maxImages} images · max {sizeLabel}
				</span>
			{/if}
		</div>
	{/if}

	<!-- URL paste -->
	{#if canAdd}
		<div class="flex gap-2">
			<Input
				bind:value={urlInput}
				icon="lucide:link"
				placeholder="Paste an image URL…"
				{disabled}
				class="flex-1"
				onkeydown={(e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						addUrl();
					}
				}}
			/>
			<Button type="button" color="neutral" variant="subtle" size="md" icon="lucide:plus" onclick={addUrl} disabled={disabled || !urlInput.trim()}>
				{t('common.add')}
			</Button>
		</div>
	{/if}

	<!-- Thumbnail grid -->
	{#if value.length > 0}
		<div class="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
			{#each value as img, i (img + '-' + i)}
				<div
					class="group relative aspect-square overflow-hidden rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg-muted)]"
				>
					<img src={img} alt={`Image ${i + 1}`} class="h-full w-full object-cover" loading="lazy" />

					<!-- Cover badge -->
					{#if i === 0}
						<span class="absolute top-1 left-1 inline-flex items-center gap-0.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[9px] font-bold text-white backdrop-blur-sm">
							<Icon name="lucide:star" class="size-2.5" />Cover
						</span>
					{/if}

					<!-- Hover toolbar -->
					<div class="absolute inset-0 flex items-end justify-center gap-1 bg-gradient-to-t from-black/70 via-black/0 to-black/0 opacity-0 transition-opacity group-hover:opacity-100">
						<div class="mb-1.5 flex items-center gap-0.5">
							{#if i > 0}
								<button type="button" title={t('common.setAsCover')} onclick={() => promote(i)} class="grid size-6 place-items-center rounded-md bg-white/20 text-white backdrop-blur-sm transition-colors hover:bg-white/40">
									<Icon name="lucide:star" class="size-3" />
								</button>
								<button type="button" title="Move left" onclick={() => move(i, -1)} class="grid size-6 place-items-center rounded-md bg-white/20 text-white backdrop-blur-sm transition-colors hover:bg-white/40">
									<Icon name="lucide:chevron-left" class="size-3" />
								</button>
							{/if}
							{#if i < value.length - 1}
								<button type="button" title="Move right" onclick={() => move(i, 1)} class="grid size-6 place-items-center rounded-md bg-white/20 text-white backdrop-blur-sm transition-colors hover:bg-white/40">
									<Icon name="lucide:chevron-right" class="size-3" />
								</button>
							{/if}
							<button type="button" title={t('common.remove')} onclick={() => removeAt(i)} class="grid size-6 place-items-center rounded-md bg-red-500/80 text-white backdrop-blur-sm transition-colors hover:bg-red-500">
								<Icon name="lucide:trash-2" class="size-3" />
							</button>
						</div>
					</div>
				</div>
			{/each}
		</div>
		{#if value.length > 1}
			<button type="button" onclick={clearAll} disabled={disabled} class="text-[11px] font-medium text-[var(--ui-text-dimmed)] transition-colors hover:text-[var(--tone-error-text)]">
				Clear all
			</button>
		{/if}
	{/if}

	{#if hint}
		<p class="text-[10px] text-[var(--ui-text-dimmed)]">{hint}</p>
	{/if}

	<!-- Hidden native file input (multiple) -->
	<input bind:this={inputEl} type="file" {accept} multiple class="hidden" onchange={onPick} />
</div>
