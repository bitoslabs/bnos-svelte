/**
 * UI presentation metadata: status → color, expense category options. These are
 * view-layer constants that depend on the standardized domain unions.
 */
import type { ExpenseCategory } from './types';
import { t } from '$lib/i18n/i18n.svelte';
import { titleCase } from '$lib/utils/format';

export type BadgeColor = 'success' | 'info' | 'warning' | 'error' | 'neutral' | 'primary';

export const STATUS_COLORS: Record<string, BadgeColor> = {
	active: 'success',
	paid: 'success',
	completed: 'success',
	received: 'success',
	confirmed: 'success',
	allowed: 'success',
	expired: 'warning',
	pending: 'warning',
	scheduled: 'warning',
	grace: 'warning',
	past_due: 'warning',
	draft: 'neutral',
	sent: 'info',
	submitted: 'info',
	partial: 'info',
	in_progress: 'info',
	inactive: 'neutral',
	cancelled: 'error',
	disabled: 'error',
	blacklisted: 'error',
	suspended: 'error',
	denied: 'error',
	failed: 'error',
	void: 'error',
	force_closed: 'warning',
	on_leave: 'info',
	frozen: 'info',
	paused: 'info',
	// marketplace connection / listing / review statuses
	connected: 'success',
	disconnected: 'neutral',
	syncing: 'info',
	published: 'success',
	rejected: 'error',
	flagged: 'warning',
	replied: 'info',
	hidden: 'neutral',
	out_of_stock: 'warning',
	archived: 'neutral'
};

/** Map any status string to a safe Badge color (collapses error/primary). */
export function statusColor(status: string): 'success' | 'info' | 'warning' | 'neutral' {
	const c = STATUS_COLORS[status.toLowerCase()];
	if (c === 'error') return 'info';
	if (c === 'primary') return 'info';
	return c ?? 'neutral';
}

/**
 * Translated status label for badges. Falls back to title-cased raw value
 * when no `status.*` dictionary entry exists, so unknown statuses still render
 * gracefully instead of leaking the dot-path key.
 */
export function statusLabel(status: string): string {
	const key = `status.${String(status ?? '').toLowerCase()}`;
	const translated = t(key);
	return translated === key ? titleCase(status) : translated;
}

export const EXPENSE_CATEGORIES: {
	value: ExpenseCategory;
	label: string;
	icon: string;
}[] = [
	{ value: 'rent', label: 'Rent', icon: 'lucide:building-2' },
	{ value: 'utilities', label: 'Utilities', icon: 'lucide:plug' },
	{ value: 'supplies', label: 'Supplies', icon: 'lucide:package' },
	{ value: 'salaries', label: 'Salaries', icon: 'lucide:users' },
	{ value: 'marketing', label: 'Marketing', icon: 'lucide:megaphone' },
	{ value: 'maintenance', label: 'Maintenance', icon: 'lucide:wrench' },
	{ value: 'transport', label: 'Transport', icon: 'lucide:truck' },
	{ value: 'taxes', label: 'Taxes', icon: 'lucide:landmark' },
	{ value: 'insurance', label: 'Insurance', icon: 'lucide:shield' },
	{ value: 'depreciation', label: 'Depreciation', icon: 'lucide:trending-down' },
	{ value: 'professional_services', label: 'Professional services', icon: 'lucide:briefcase' },
	{ value: 'technology', label: 'Technology', icon: 'lucide:cpu' },
	{ value: 'food_cost', label: 'Food cost', icon: 'lucide:utensils' },
	{ value: 'other', label: 'Other', icon: 'lucide:circle-dot' }
];
