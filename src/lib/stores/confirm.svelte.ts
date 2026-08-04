/**
 * Imperative confirm dialog — a premium, drop-in replacement for the native
 * `window.confirm()`. Rendered once by `<ConfirmDialog />` (mounted in
 * `+layout.svelte`); any component imports `{ confirm }` and `await`s it:
 *
 *   const ok = await confirm({
 *     title: 'Clear cart?',
 *     message: 'This removes every item from the current sale.',
 *     tone: 'danger',
 *     confirmText: 'Clear cart'
 *   });
 *   if (!ok) return;
 *
 * Returns a `Promise<boolean>` — `true` on confirm, `false` on cancel/Esc/
 * backdrop click. Replaces every `confirm(...)` call site in the app so we get a
 * consistent, on-brand dialog instead of the ugly browser one.
 */
export type ConfirmTone = 'danger' | 'warning' | 'primary' | 'neutral';

export interface ConfirmOptions {
	title: string;
	/** Body copy shown under the title. */
	message?: string;
	/** Optional highlighted box (e.g. the name of the thing being deleted). */
	detail?: string;
	/** Visual tone; picks the icon badge colour + default icon + button colour. */
	tone?: ConfirmTone;
	/** Override the leading icon (iconify name). */
	icon?: string;
	confirmText?: string;
	cancelText?: string;
	/** When true, the action is non-destructive and only an "OK" button is shown
	 *  (used by `alert()`-style prompts). */
	dismissOnly?: boolean;
	dismissText?: string;
}

interface ConfirmState {
	open: boolean;
	options: ConfirmOptions;
	resolve?: (value: boolean) => void;
}

const CLOSED: ConfirmState = { open: false, options: { title: '' } };

class ConfirmStore {
	state = $state<ConfirmState>({ ...CLOSED });

	confirm = (options: ConfirmOptions): Promise<boolean> => {
		// If a previous confirm is somehow still open, resolve it as cancelled.
		this.state.resolve?.(false);
		return new Promise((resolve) => {
			this.state = { open: true, options, resolve };
		});
	};

	resolve(ok: boolean) {
		this.state.resolve?.(ok);
		this.state = { ...CLOSED };
	}
}

export const confirmStore = new ConfirmStore();

/** Imperative confirm dialog. Resolves `true` on confirm, `false` otherwise. */
export function confirm(options: ConfirmOptions): Promise<boolean> {
	return confirmStore.confirm(options);
}

/** Imperative alert dialog (single OK button). Resolves when dismissed. */
export function alertBox(options: Omit<ConfirmOptions, 'dismissOnly'>): Promise<void> {
	return confirm({ ...options, dismissOnly: true }).then(() => undefined);
}
