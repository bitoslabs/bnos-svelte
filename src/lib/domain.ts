/**
 * Domain model — maps bdgo-os entities to GLO object types. Known GLO types
 * (catalog.*, commerce.*, crm.*, identity.staff, inventory.adjustment, …) keep
 * their domain Nostr kind; extension types (expense, supplier, coupon, …) fall
 * back to NIP-78 application data (kind 30078) per the GLO spec — see
 * `@bitos/bnos-core` docs/GLO.md. Every object is still a signed GLO envelope.
 */
import type {
	GloProduct,
	GloCategory,
	GloUnit,
	GloOrder,
	GloCustomer,
	GloLocation
} from '@bitos/bnos-core/glo';

export const TYPE = {
	// catalog (known kinds)
	product: 'catalog.product',
	category: 'catalog.category',
	unit: 'catalog.unit',
	modifierGroup: 'catalog.modifier-group',
	// commerce (known kinds)
	order: 'commerce.order',
	payment: 'commerce.payment',
	refund: 'commerce.refund',
	// crm (known kind)
	customer: 'crm.customer',
	// identity (known kind)
	staff: 'identity.staff',
	// inventory (known kind)
	adjustment: 'inventory.adjustment',
	// extension types (kind 30078)
	supplier: 'supplier',
	purchaseOrder: 'purchase-order',
	stockTransfer: 'stock-transfer',
	expense: 'expense',
	coupon: 'coupon',
	promotion: 'promotion',
	membership: 'membership',
	membershipSubscription: 'membership-subscription',
	membershipCheckIn: 'membership-check-in',
	loyaltyPoints: 'loyalty-points',
	shift: 'shift',
	cashEvent: 'cash-event',
	branch: 'location'
} as const;

// ── Catalog ─────────────────────────────────────────────
export type { GloProduct, GloCategory, GloUnit, GloOrder, GloCustomer, GloLocation };

/** Catalog category extended with bdgo-os display fields (GloCategory has no icon/color). */
export type CatalogCategory = GloCategory & { icon?: string; color?: string };
/** Catalog unit extended with bdgo-os unit-type classification. */
export type CatalogUnit = GloUnit & { type?: 'count' | 'weight' | 'volume' | 'length' | 'time' | 'custom' };

export interface ModifierGroup {
	name: string;
	productId?: string;
	required?: boolean;
	singleChoice?: boolean;
	options: { name: string; price?: number }[];
	status?: 'active' | 'inactive';
}

// ── Supply chain ─────────────────────────────────────────
export interface Supplier {
	name: string;
	code?: string;
	contactName?: string;
	email?: string;
	phone?: string;
	address?: string;
	paymentTerms?: string;
	status?: 'active' | 'inactive' | 'blacklisted';
}

export interface PurchaseOrder {
	number: string;
	supplierId?: string;
	supplierName?: string;
	status: 'draft' | 'sent' | 'partial' | 'received' | 'cancelled';
	lines: { productId?: string; name: string; quantity: number; unitPrice: number; total: number }[];
	total: number;
	currency: string;
	orderedAt: string;
	receivedAt?: string;
}

export interface StockAdjustment {
	productId?: string;
	productName: string;
	type: 'increase' | 'decrease';
	quantity: number;
	reason: string;
	cost?: number;
	occurredAt: string;
}

// ── Accounting ───────────────────────────────────────────
export type ExpenseCategory =
	| 'rent'
	| 'utilities'
	| 'supplies'
	| 'salaries'
	| 'marketing'
	| 'maintenance'
	| 'transport'
	| 'taxes'
	| 'other';

export interface Expense {
	number: string;
	description: string;
	category: ExpenseCategory;
	amount: number;
	currency: string;
	payee?: string;
	status: 'pending' | 'paid' | 'cancelled';
	method?: 'cash' | 'bank' | 'card' | 'other';
	occurredAt: string;
}

// ── CRM: loyalty & promotions ────────────────────────────
export interface Coupon {
	code: string;
	type: 'percent' | 'fixed' | 'bogo';
	value: number;
	currency?: string;
	minSpend?: number;
	uses?: number;
	maxUses?: number;
	status: 'active' | 'expired' | 'disabled';
	expiresAt?: string;
}

export interface Promotion {
	name: string;
	type: 'percent' | 'fixed' | 'bogo' | 'bundle';
	value: number;
	description?: string;
	startsAt?: string;
	endsAt?: string;
	status: 'active' | 'scheduled' | 'expired' | 'disabled';
}

// ── Memberships ──────────────────────────────────────────
export interface Membership {
	name: string;
	mode: 'normal' | 'gym' | 'hybrid';
	price: number;
	currency: string;
	period: 'daily' | 'weekly' | 'monthly' | 'yearly';
	durationDays?: number;
	benefits?: string[];
	status: 'active' | 'inactive';
}

export interface MembershipSubscription {
	customerId?: string;
	customerName?: string;
	membershipId?: string;
	membershipName?: string;
	status: 'active' | 'expired' | 'cancelled' | 'paused';
	startsAt: string;
	endsAt?: string;
}

export interface MembershipCheckIn {
	customerId?: string;
	customerName?: string;
	membershipId?: string;
	result: 'allowed' | 'denied' | 'override';
	occurredAt: string;
}

// ── Staff & ops ──────────────────────────────────────────
export interface Staff {
	name: string;
	role: 'owner' | 'manager' | 'cashier' | 'waiter' | 'chef' | 'stock';
	email?: string;
	phone?: string;
	pin?: string;
	status: 'active' | 'inactive' | 'suspended' | 'on_leave';
	hourlyRate?: number;
}

export interface Shift {
	number: string;
	staffName?: string;
	status: 'active' | 'closed' | 'force_closed';
	openingCash: number;
	closingCash?: number;
	expectedCash?: number;
	difference?: number;
	currency: string;
	openedAt: string;
	closedAt?: string;
}

export interface CashEvent {
	shiftId?: string;
	type: 'cash_in' | 'cash_out' | 'paid_out' | 'bank_deposit';
	amount: number;
	currency: string;
	reason?: string;
	occurredAt: string;
}

// ── Meta helpers ─────────────────────────────────────────
export const STATUS_COLORS: Record<string, 'success' | 'info' | 'warning' | 'error' | 'neutral' | 'primary'> = {
	active: 'success',
	paid: 'success',
	completed: 'success',
	received: 'success',
	allowed: 'success',
	expired: 'warning',
	pending: 'warning',
	scheduled: 'warning',
	draft: 'neutral',
	sent: 'info',
	partial: 'info',
	inactive: 'neutral',
	cancelled: 'error',
	disabled: 'error',
	blacklisted: 'error',
	suspended: 'error',
	denied: 'error',
	'force_closed': 'warning',
	'on_leave': 'info'
};

export function statusColor(status: string): 'success' | 'info' | 'warning' | 'neutral' {
	const c = STATUS_COLORS[status.toLowerCase()];
	if (c === 'error') return 'info';
	if (c === 'primary') return 'info';
	return c ?? 'neutral';
}

export const EXPENSE_CATEGORIES: { value: ExpenseCategory; label: string; icon: string }[] = [
	{ value: 'rent', label: 'Rent', icon: 'lucide:building-2' },
	{ value: 'utilities', label: 'Utilities', icon: 'lucide:plug' },
	{ value: 'supplies', label: 'Supplies', icon: 'lucide:package' },
	{ value: 'salaries', label: 'Salaries', icon: 'lucide:users' },
	{ value: 'marketing', label: 'Marketing', icon: 'lucide:megaphone' },
	{ value: 'maintenance', label: 'Maintenance', icon: 'lucide:wrench' },
	{ value: 'transport', label: 'Transport', icon: 'lucide:truck' },
	{ value: 'taxes', label: 'Taxes', icon: 'lucide:landmark' },
	{ value: 'other', label: 'Other', icon: 'lucide:circle-dot' }
];
