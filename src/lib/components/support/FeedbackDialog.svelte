<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { t } from '$lib/i18n/i18n.svelte';
	import { session } from '$nostr/session.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { sendFeedback, type FeedbackCategory, type FeedbackAttachment } from '$nostr/feedback';
	import { media } from '$lib/media/media.svelte';
	import { humanBytes } from '$lib/media/uploaders';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import ChoiceGroup from '$lib/components/ui/ChoiceGroup.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';

	type Props = { open?: boolean };
	let { open = $bindable(false) }: Props = $props();

	const MAX_ATTACH_BYTES = 10 * 1024 * 1024;
	const ATTACH_ACCEPT = 'image/*,video/*,application/pdf,text/plain';

	let category = $state('bug');
	let message = $state('');
	let contact = $state('');
	let attachment = $state<FeedbackAttachment | null>(null);
	let attachEl = $state<HTMLInputElement | null>(null);
	let uploading = $state(false);
	let dragging = $state(false);
	let submitting = $state(false);
	let errorKey = $state('');

	const isAuthenticated = $derived(!!session.pubkey);
	const canSend = $derived(!!message.trim() && isAuthenticated && !uploading);
	const categories = $derived([
		{ value: 'bug', label: t('feedback.categoryBug') },
		{ value: 'feature', label: t('feedback.categoryFeature') },
		{ value: 'other', label: t('feedback.categoryOther') }
	]);

	function reset() {
		category = 'bug';
		message = '';
		contact = '';
		attachment = null;
		dragging = false;
		uploading = false;
		errorKey = '';
		submitting = false;
	}

	function close() {
		open = false;
		reset();
	}

	async function handleAttach(file: File | undefined | null) {
		if (!file || uploading) return;
		if (file.size > MAX_ATTACH_BYTES) {
			toast.warning(t('feedback.attachTooLarge'));
			return;
		}
		uploading = true;
		try {
			const result = await media.upload(file, undefined);
			attachment = {
				url: result.url,
				kind: result.kind,
				mimeType: result.mimeType,
				bytes: result.bytes,
				name: file.name
			};
		} catch (e) {
			toast.error(t('feedback.attachFailed'), e instanceof Error ? e.message : undefined);
		} finally {
			uploading = false;
			if (attachEl) attachEl.value = '';
		}
	}

	function onAttachPick(e: Event) {
		handleAttach((e.target as HTMLInputElement).files?.[0]);
	}

	function onAttachDrop(e: DragEvent) {
		e.preventDefault();
		dragging = false;
		handleAttach(e.dataTransfer?.files?.[0]);
	}

	function reasonToKey(reason: string): string {
		switch (reason) {
			case 'not-authenticated':
				return 'feedback.signInTitle';
			case 'empty':
				return 'feedback.empty';
			case 'no-recipient':
				return 'feedback.noRecipient';
			case 'encrypt-failed':
				return 'feedback.encryptFailed';
			default:
				return 'feedback.failed';
		}
	}

	async function submit() {
		if (submitting || !canSend) return;
		submitting = true;
		errorKey = '';
		const result = await sendFeedback({
			category: category as FeedbackCategory,
			message,
			contact,
			route: page.url.pathname,
			attachment: attachment ?? undefined
		});
		submitting = false;
		if (result.ok) {
			toast.success(t('feedback.sent'), t('feedback.sentDesc'));
			close();
			return;
		}
		errorKey = reasonToKey(result.reason);
	}
</script>

<Dialog bind:open title={t('feedback.title')} size="md">
	{#if !isAuthenticated}
		<div class="flex flex-col items-center gap-3 py-4 text-center">
			<span class="grid size-11 place-items-center rounded-2xl bg-primary-500/10 text-primary-600">
				<Icon name="lucide:lock" class="size-5" />
			</span>
			<h3 class="font-display text-[15px] font-semibold">{t('feedback.signInTitle')}</h3>
			<p class="max-w-sm text-[12.5px] leading-relaxed text-(--ui-text-muted)">
				{t('feedback.signInDesc')}
			</p>
			<Button href={resolve('/login')} color="primary" variant="soft" icon="lucide:log-in">
				{t('feedback.signIn')}
			</Button>
		</div>
	{:else}
		<div class="space-y-4">
			<p class="text-[12.5px] leading-relaxed text-(--ui-text-muted)">
				{t('feedback.description')}
			</p>

			<div class="space-y-1.5">
				<span class="block text-[12px] font-semibold text-(--ui-text-muted)"
					>{t('feedback.category')}</span
				>
				<ChoiceGroup bind:value={category} options={categories} label={t('feedback.category')} />
			</div>

			<div class="space-y-1.5">
				<label for="feedback-message" class="block text-[12px] font-semibold text-(--ui-text-muted)"
					>{t('feedback.message')}</label
				>
				<Input
					id="feedback-message"
					textarea
					rows={5}
					bind:value={message}
					placeholder={t('feedback.messagePlaceholder')}
				/>
			</div>

			<div class="space-y-1.5">
				<label for="feedback-contact" class="block text-[12px] font-semibold text-(--ui-text-muted)"
					>{t('feedback.contact')}</label
				>
				<Input
					id="feedback-contact"
					bind:value={contact}
					placeholder={t('feedback.contactPlaceholder')}
					class="w-full"
				/>
				<p class="text-[11px] text-(--ui-text-dimmed)">{t('feedback.contactHint')}</p>
			</div>

			<div class="space-y-1.5">
				<span class="block text-[12px] font-semibold text-(--ui-text-muted)"
					>{t('feedback.attach')}</span
				>
				{#if attachment}
					<div
						class="flex items-center gap-3 rounded-xl border border-(--ui-border) bg-(--ui-bg-muted) p-2.5"
					>
						{#if attachment.kind === 'image'}
							<img
								src={attachment.url}
								alt={attachment.name ?? t('feedback.attach')}
								class="size-11 shrink-0 rounded-lg object-cover"
							/>
						{:else}
							<span
								class="grid size-11 shrink-0 place-items-center rounded-lg bg-(--ui-bg-accented) text-(--ui-text-dimmed)"
							>
								<Icon
									name={attachment.kind === 'video' ? 'lucide:file-video' : 'lucide:file-text'}
									class="size-5"
								/>
							</span>
						{/if}
						<div class="min-w-0 flex-1">
							<p class="truncate text-[12.5px] font-semibold">
								{attachment.name ?? attachment.url}
							</p>
							<p class="text-[11px] text-(--ui-text-dimmed)">{humanBytes(attachment.bytes)}</p>
						</div>
						<Button
							type="button"
							color="error"
							variant="ghost"
							size="icon-sm"
							icon="lucide:trash-2"
							aria-label={t('common.remove')}
							onclick={() => (attachment = null)}
						/>
					</div>
				{:else}
					<button
						type="button"
						disabled={uploading}
						onclick={() => attachEl?.click()}
						ondragover={(e) => {
							e.preventDefault();
							dragging = true;
						}}
						ondragleave={() => (dragging = false)}
						ondrop={onAttachDrop}
						class="flex w-full items-center gap-2.5 rounded-xl border border-dashed px-3 py-2.5 text-left transition-colors {dragging
							? 'border-primary-500 bg-primary-500/10'
							: 'border-(--ui-border) hover:border-primary-500/40 hover:bg-(--ui-bg-accented)'}"
					>
						<Icon
							name={uploading ? 'lucide:loader-circle' : 'lucide:paperclip'}
							class="size-4 shrink-0 text-(--ui-text-dimmed) {uploading ? 'animate-spin' : ''}"
						/>
						<span class="min-w-0 flex-1">
							<span class="block text-[12.5px] font-semibold text-(--ui-text)">
								{uploading ? t('feedback.attachUploading') : t('feedback.attachAction')}
							</span>
							<span class="block text-[11px] text-(--ui-text-dimmed)"
								>{t('feedback.attachHint')}</span
							>
						</span>
					</button>
				{/if}
				<p class="flex items-start gap-1.5 text-[11px] text-(--ui-text-dimmed)">
					<Icon name="lucide:info" class="mt-0.5 size-3.5 shrink-0" />
					{t('feedback.attachPublicNote')}
				</p>
			</div>

			{#if errorKey}
				<p
					role="alert"
					class="flex items-start gap-2 rounded-xl bg-(--tone-error-bg) px-3 py-2 text-[11.5px] font-semibold text-(--tone-error-text)"
				>
					<Icon name="lucide:triangle-alert" class="mt-0.5 size-3.5 shrink-0" />
					<span>{t(errorKey)}</span>
				</p>
			{/if}

			<p class="flex items-center gap-1.5 text-[11px] text-(--ui-text-dimmed)">
				<Icon name="lucide:shield-check" class="size-3.5 shrink-0" />
				{t('feedback.encryptedNote')}
			</p>

			<input
				bind:this={attachEl}
				type="file"
				accept={ATTACH_ACCEPT}
				class="hidden"
				onchange={onAttachPick}
			/>
		</div>
	{/if}

	{#snippet footer()}
		<Button color="neutral" variant="ghost" onclick={close}>{t('common.cancel')}</Button>
		{#if isAuthenticated}
			<Button
				color="primary"
				icon={submitting ? 'lucide:loader-circle' : 'lucide:send'}
				disabled={!canSend || submitting}
				onclick={submit}
			>
				{submitting ? t('feedback.sending') : t('feedback.send')}
			</Button>
		{/if}
	{/snippet}
</Dialog>
