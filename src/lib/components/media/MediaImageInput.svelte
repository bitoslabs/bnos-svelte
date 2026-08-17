<script lang="ts">
	/**
	 * MediaImageInput — the single, reusable image upload widget for BNOS.
	 *
	 * One component backs every image field in the app: product images, logos,
	 * avatars, brand images, receipt logos. It delegates the actual upload to
	 * `media.upload()` (Cloudinary / S3 / free Blossom) and stores only the
	 * resulting URL — never a data URI.
	 *
	 * Inputs (in priority order):
	 *   1. Drag & drop onto the preview
	 *   2. Click "Upload" / the preview to pick a file
	 *   3. Paste a URL straight into the text field
	 *
	 * Props are intentionally minimal; styling tokens come from the design
	 * system so this drops into any settings/form context.
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
		label = 'Image',
		hint = '',
		preview = 'square',
		size = 80,
		placeholder = 'https://…',
		disabled = false
	}: {
		value: string;
		purpose: UploadPurpose;
		accept?: string;
		maxBytes?: number;
		label?: string;
		hint?: string;
		/** `square` | `round` (avatar) | `wide` (banner/product) | `none`. */
		preview?: 'square' | 'round' | 'wide' | 'none';
		size?: number;
		placeholder?: string;
		disabled?: boolean;
	} = $props();

	let inputEl: HTMLInputElement;
	let uploading = $state(false);
	let dragging = $state(false);

	const sizeLabel = $derived(humanBytes(maxBytes));

	function validate(file: File): string | null {
		if (!file.type.startsWith('image/')) return 'Please choose an image file';
		if (file.size > maxBytes) return `Image too large (max ${sizeLabel})`;
		return null;
	}

	async function handleFile(file: File | undefined | null) {
		if (!file || disabled) return;
		const err = validate(file);
		if (err) {
			toast.warning(err);
			return;
		}
		uploading = true;
		try {
			const result = await media.upload(file, undefined, { purpose });
			value = result.url;
			toast.success('Image uploaded', humanBytes(result.bytes));
		} catch (e) {
			toast.error('Upload failed', e instanceof Error ? e.message : undefined);
		} finally {
			uploading = false;
			// reset so the same file can be picked again after an error
			if (inputEl) inputEl.value = '';
		}
	}

	function onPick(e: Event) {
		const input = e.target as HTMLInputElement;
		handleFile(input.files?.[0]);
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		dragging = false;
		if (disabled) return;
		handleFile(e.dataTransfer?.files?.[0]);
	}

	const previewClass = $derived(
		cn(
			'relative grid shrink-0 place-items-center overflow-hidden border-2 border-dashed transition-colors',
			preview === 'round' && 'rounded-full',
			preview === 'square' && 'rounded-2xl',
			preview === 'wide' && 'rounded-xl',
			dragging
				? 'border-primary-500 bg-primary-500/10'
				: 'border-[var(--ui-border)] bg-[var(--ui-bg-muted)]'
		)
	);

	const previewStyle = $derived(
		preview === 'wide'
			? 'width: 100%; height: auto; aspect-ratio: 16 / 9;'
			: `width: ${size}px; height: ${size}px;`
	);
</script>

<div class="space-y-2">
	<!-- Dropzone + preview + actions -->
	<div class="flex items-start gap-3">
		{#if preview !== 'none'}
			<div
				role="button"
				tabindex={disabled ? -1 : 0}
				aria-label="Upload image"
				class={previewClass}
				style={previewStyle}
				onclick={() => !disabled && !uploading && inputEl.click()}
				onkeydown={(e) => {
					if ((e.key === 'Enter' || e.key === ' ') && !disabled && !uploading) {
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
				{#if value}
					<img src={value} alt={label} class="h-full w-full object-cover" />
					{#if uploading}
						<div
							class="absolute inset-0 grid place-items-center bg-black/40 backdrop-blur-sm"
						>
							<Icon name="lucide:loader-circle" class="size-5 animate-spin text-white" />
						</div>
					{/if}
				{:else if uploading}
					<Icon name="lucide:loader-circle" class="size-6 animate-spin text-primary-500" />
				{:else}
					<div class="flex flex-col items-center gap-1 text-[var(--ui-text-dimmed)]">
						<Icon name="lucide:image-plus" class="size-6" />
					</div>
				{/if}
			</div>
		{/if}

		<div class="min-w-0 flex-1 space-y-2">
			{#if label}
				<span class="block text-[12px] font-semibold text-[var(--ui-text-muted)]">{label}</span>
			{/if}
			<Input
				bind:value
				icon="lucide:link"
				{placeholder}
				{disabled}
				class="w-full"
			/>
			<div class="flex flex-wrap items-center gap-2">
				<Button
					type="button"
					color="primary"
					variant="subtle"
					size="sm"
					icon={uploading ? 'lucide:loader-circle' : 'lucide:upload'}
					disabled={disabled || uploading}
					onclick={() => inputEl.click()}
				>
					{uploading ? 'Uploading…' : 'Upload'}
				</Button>
				{#if value}
					<Button
						type="button"
						color="error"
						variant="ghost"
						size="sm"
						icon="lucide:trash-2"
						disabled={disabled}
						onclick={() => (value = '')}
					>
						{t('common.remove')}
					</Button>
				{/if}
				{#if hint}
					<span class="text-[10px] text-[var(--ui-text-dimmed)]">{hint}</span>
				{:else}
					<span class="text-[10px] text-[var(--ui-text-dimmed)]">Drag & drop · max {sizeLabel}</span>
				{/if}
			</div>
		</div>
	</div>

	<!-- Hidden native file input -->
	<input
		bind:this={inputEl}
		type="file"
		{accept}
		class="hidden"
		onchange={onPick}
	/>
</div>
