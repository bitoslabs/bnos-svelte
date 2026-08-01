/**
 * UI presentation metadata: status → color, expense category options. These are
 * view-layer constants that depend on the standardized domain unions.
 */
import type { ExpenseCategory } from './types';

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
	paused: 'info'
};

/** Map any status string to a safe Badge color (collapses error/primary). */
export function statusColor(status: string): 'success' | 'info' | 'warning' | 'neutral' {
	const c = STATUS_COLORS[status.toLowerCase()];
	if (c === 'error') return 'info';
	if (c === 'primary') return 'info';
	return c ?? 'neutral';
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
