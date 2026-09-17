/**
 * Minimal toast system — Svelte equivalent of Nuxt UI's `useToast()`.
 * Rendered by <Toaster /> (mounted in +layout.svelte).
 */
import { browser } from '$app/environment';
import { i18n } from '$lib/i18n/i18n.svelte';
import { resolve as resolveMsg, messages, DEFAULT_LOCALE, type DeepDict } from '$lib/i18n/messages';

export type ToastColor = 'success' | 'info' | 'warning' | 'error' | 'neutral';
export interface ToastItem {
	id: number;
	title: string;
	description?: string;
	icon?: string;
	color?: ToastColor;
	count?: number;
}

let counter = 0;
const MAX_TOASTS = 3;

class ToastStore {
	items = $state<ToastItem[]>([]);
	private timers = new Map<number, ReturnType<typeof setTimeout>>();

	add = (t: Omit<ToastItem, 'id'>) => {
		const existing = this.items.find(
			(item) =>
				item.title === t.title && item.description === t.description && item.color === t.color
		);
		if (existing) {
			existing.count = (existing.count ?? 1) + 1;
			this.restartTimer(existing.id);
			return existing.id;
		}

		const id = ++counter;
		this.items.push({ id, color: 'neutral', ...t });
		this.restartTimer(id);
		if (this.items.length > MAX_TOASTS) this.dismiss(this.items[0].id);
		return id;
	};

	success = (title: string, description?: string) =>
		this.add({ title, description, color: 'success' });
	info = (title: string, description?: string) => this.add({ title, description, color: 'info' });
	warning = (title: string, description?: string) =>
		this.add({ title, description, color: 'warning' });
	error = (title: string, description?: string) => this.add({ title, description, color: 'error' });

	dismiss = (id: number) => {
		this.items = this.items.filter((t) => t.id !== id);
		const timer = this.timers.get(id);
		if (timer) {
			clearTimeout(timer);
			this.timers.delete(id);
		}
	};

	/** Resolve a toast text field at render time. Accepts either a raw string
	 *  (shown as-is) or an i18n key such as `toast.saved` (translated using the
	 *  current locale). Reactive: re-renders when the language changes. */
	renderText = (value: string): string => {
		const locale = i18n.locale;
		return resolveMsg(
			messages[locale] as unknown as DeepDict,
			value,
			undefined,
			messages[DEFAULT_LOCALE] as unknown as DeepDict
		);
	};

	private restartTimer = (id: number) => {
		if (!browser) return;
		const current = this.timers.get(id);
		if (current) clearTimeout(current);
		const timer = setTimeout(() => this.dismiss(id), 4200);
		this.timers.set(id, timer);
	};
}

export const toast = new ToastStore();
