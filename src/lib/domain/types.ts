/**
 * Standardized domain data types.
 *
 * Each entity is the **canonical GLO type** widened with a typed `*BnosExt`
 * carrying the bdgo-os enterprise fields GLO does not yet define. The result
 * is a valid GLO payload (canonical names/types untouched) that also exposes
 * the full bdgo-os feature surface.
 *
 * Where a canonical GLO field and a bdgo-os field disagree (e.g. product
 * `status` adds `archived`/`draft`, customer `notes` is an array), the app
 * type `Omit`s the canonical field and redeclares it so the union widens
 * instead of silently narrowing.
 *
 * See `FIELDS.md` for the field-by-field coverage audit.
 */
import type {
	GloCategory,
	GloCustomer,
	GloLocation,
	GloObject,
	GloObjectInput,
	GloOrder,
	GloOrderLine,
	GloOrganization,
	GloPayment,
	GloProduct,
	GloScope,
	GloUnit,
	GloVisibility,
	GloExtensions
} from '@bitos/bnos-core/glo';

// ── Canonical re-exports (so `$lib/domain` is the single import surface) ──
export type {
	GloCategory,
	GloCustomer,
	GloLocation,
	GloObject,
	GloObjectInput,
	GloOrder,
	GloOrderLine,
	GloOrganization,
	GloPayment,
	GloProduct,
	GloScope,
	GloUnit,
	GloVisibility,
	GloExtensions
};

// ════════════════════════════════════════════════════════════════════
// CATALOG
// ════════════════════════════════════════════════════════════════════

export type ProductStatus = 'active' | 'inactive' | 'archived' | 'draft';
export type ProductType = 'standard' | 'variable' | 'composite' | 'digital' | 'service';

export interface ProductVariant {
	id: string;
	name: string;
	shortName?: string;
	sku?: string;
	barcode?: string;
	priceModifier?: number;
	priceModifierType?: 'fixed' | 'relative';
	costPrice?: number;
	image?: string;
	sortOrder?: number;
	available?: boolean;
	attributes?: Record<string, string>;
}

export interface VariantAttribute {
	name: string;
	values: string[];
	sortOrder?: number;
}

export interface NutritionalInfo {
	calories?: number;
	protein?: number;
	carbs?: number;
	fat?: number;
	fiber?: number;
	allergens?: string[];
}

export interface ProductInventoryLink {
	branchStockIds?: string[];
	defaultBranchStockId?: string;
	lowStockThreshold?: number;
	reorderPoint?: number;
	reorderQuantity?: number;
	allowBackorder?: boolean;
	denySaleWhenOutOfStock?: boolean;
	preferredSupplierId?: string;
	supplierSku?: string;
	unitCost?: number;
	supplierIds?: string[];
}

export interface ProductPromotionLink {
	promotionIds?: string[];
	couponIds?: string[];
	excludedPromotionIds?: string[];
}

/** bdgo-os fields not (yet) in canonical GloProduct. */
export interface ProductBnosExt {
	available?: boolean;
	isPublic?: boolean;
	type?: ProductType;
	prepTime?: number;
	sortOrder?: number;
	compareAtPrice?: number;
	taxInclusive?: boolean;
	minimumPrice?: number;
	hasVariants?: boolean;
	variantAttributes?: VariantAttribute[];
	variants?: ProductVariant[];
	modifierGroupIds?: string[];
	inventory?: ProductInventoryLink;
	promotion?: ProductPromotionLink;
	nutritionalInfo?: NutritionalInfo;
	status?: ProductStatus;
}

/** Standardized product = canonical GLO product widened with bdgo-os fields. */
export type Product = Omit<GloProduct, 'status'> & ProductBnosExt;

export interface CategoryBnosExt {
	icon?: string;
	color?: string;
	active?: boolean;
}
export type Category = GloCategory & CategoryBnosExt;
/** Back-compat alias used by the catalog UI. */
export type CatalogCategory = Category;

export interface UnitBnosExt {
	type?: 'count' | 'weight' | 'volume' | 'length' | 'time' | 'custom';
	baseUnitId?: string;
	conversionFactor?: number;
	isDefault?: boolean;
}
export type Unit = GloUnit & UnitBnosExt;
/** Back-compat alias used by the catalog UI. */
export type CatalogUnit = Unit;

export interface ModifierOption {
	id?: string;
	name: string;
	priceAdjustment?: number;
	price?: number;
	isDefault?: boolean;
	available?: boolean;
	sortOrder?: number;
	icon?: string;
}

/**
 * Modifier group. GLO has no canonical data type for `catalog.modifier-group`
 * yet, so the whole payload is a bnos extension. `options` / `singleChoice`
 * are kept as convenience aliases for the current UI; the bdgo-os names
 * (`modifiers`, `selectionType`) carry the full model.
 */
export interface ModifierGroup {
	name: string;
	description?: string;
	selectionType?: 'single' | 'multiple';
	singleChoice?: boolean;
	required?: boolean;
	minSelections?: number;
	maxSelections?: number;
	sortOrder?: number;
	modifiers?: ModifierOption[];
	options?: ModifierOption[];
	productId?: string;
	productIds?: string[];
	status?: 'active' | 'inactive';
}

// ════════════════════════════════════════════════════════════════════
// COMMERCE
// ════════════════════════════════════════════════════════════════════

export type OrderStatus =
	| 'pending'
	| 'confirmed'
	| 'preparing'
	| 'ready'
	| 'served'
	| 'completed'
	| 'cancelled'
	| 'refunded'
	| 'partially_refunded';
export type OrderType = 'dine_in' | 'takeaway' | 'delivery' | 'pickup' | 'online';
export type OrderSource =
	| 'pos'
	| 'orders_page'
	| 'online'
	| 'marketplace'
	| 'delivery'
	| 'manual'
	| 'tiktok'
	| 'facebook'
	| 'instagram'
	| 'website'
	| 'phone'
	| 'whatsapp'
	| 'line'
	| 'other';
export type OrderChannel = 'counter' | 'table' | 'pickup' | 'delivery' | 'online' | 'marketplace';

export interface OrderModifier {
	groupId?: string;
	modifierId?: string;
	name: string;
	priceAdjustment?: number;
	quantity?: number;
}

export interface OrderLineBnosExt {
	productName?: string;
	variantId?: string;
	variantName?: string;
	modifiers?: OrderModifier[];
	taxAmount?: number;
}
/** Standardized order line = canonical GLO line widened with bdgo-os fields. */
export type OrderLine = GloOrderLine & OrderLineBnosExt;

/** Delivery lifecycle for shipping tracking (independent of kitchen status). */
export type ShippingStatus =
	'pending' | 'packed' | 'shipped' | 'in_transit' | 'delivered' | 'failed' | 'returned';

export interface ShippingInfo {
	shippingStatus?: ShippingStatus;
	recipientName?: string;
	phone?: string;
	address?: string;
	city?: string;
	state?: string;
	zipCode?: string;
	country?: string;
	notes?: string;
	deliveryFee?: number;
	deliveryProvider?: string;
	driverName?: string;
	driverPhone?: string;
	estimatedDeliveryAt?: string;
	deliveredAt?: string;
	trackingNumber?: string;
}

export interface PickupInfo {
	pickupName?: string;
	phone?: string;
	pickupTime?: string;
	pickupLocation?: string;
	pickedUpAt?: string;
}

export interface OrderDiscountBnos {
	type?: 'percent' | 'fixed' | 'coupon';
	value?: number;
	amount?: number;
	couponCode?: string;
	promotionId?: string;
	reason?: string;
}

export interface OrderBnosExt {
	orderNumber?: number | string;
	type?: OrderType;
	source?: OrderSource;
	/** Free-text detail for a custom/"other" source (e.g. a Facebook post URL, influencer name). */
	sourceDetail?: string;
	channel?: OrderChannel;
	status?: OrderStatus;
	customerPubkey?: string;
	customerName?: string;
	cashierPubkey?: string;
	branchId?: string;
	tableId?: string;
	isHeld?: boolean;
	covers?: number;
	shiftId?: string;
	tags?: string[];
	completedAt?: string;
	shipping?: ShippingInfo;
	pickup?: PickupInfo;
	orderDiscount?: OrderDiscountBnos;
	totalsRounding?: number;
	/** Sats equivalent of `total` captured at sale time (Bitcoin snapshot). */
	totalSats?: number;
	/** Fiat-per-BTC rate used to derive `totalSats` (audit snapshot). */
	btcRate?: number;
	btcRateCurrency?: string;
}

/** Standardized order = canonical GLO order, with widened line + bdgo extras. */
export type Order = Omit<GloOrder, 'lines' | 'status'> &
	OrderBnosExt & { lines: OrderLine[]; status: string };

export type PaymentMethod =
	| 'cash'
	| 'lightning'
	| 'card'
	| 'qr'
	| 'ecash'
	| 'coupon'
	| 'loyalty_points'
	| 'credit'
	| 'mixed'
	| 'qr_static'
	| 'bank_transfer'
	| 'mobile_payment'
	| 'gift_card'
	| 'store_credit'
	| 'cryptocurrency'
	| 'external'
	| 'split'
	| 'other';

export interface PaymentBnosExt {
	cashReceived?: number;
	changeGiven?: number;
	lightningInvoice?: string;
	paymentHash?: string;
	preimage?: string;
	cardReference?: string;
	qrData?: string;
	cashierPubkey?: string;
	branchId?: string;
	/** Active shift this payment was tendered under (kind 30520). Enables
	 *  per-shift cash reconciliation without an order→payment join. */
	shiftId?: string;
}
export type Payment = GloPayment & PaymentBnosExt;

export type RefundStatus = 'pending' | 'approved' | 'processing' | 'completed' | 'rejected';
export type RefundReason =
	'customer_request' | 'defective' | 'wrong_item' | 'quality_issue' | 'overcharge' | 'other';
export interface RefundLine {
	orderLineItemId?: string;
	productId?: string;
	productName?: string;
	quantity: number;
	unitRefund?: number;
	totalRefund: number;
}
/** `commerce.refund` — no canonical GLO data type yet; full bnos extension. */
export interface Refund {
	orderId?: string;
	paymentId?: string;
	status?: RefundStatus;
	reason?: RefundReason;
	note?: string;
	items?: RefundLine[];
	totalAmount?: number;
	currency?: string;
	refundMethod?: PaymentMethod;
	approvedBy?: string;
	completedAt?: string;
	branchId?: string;
}

// ════════════════════════════════════════════════════════════════════
// CRM
// ════════════════════════════════════════════════════════════════════

export type CustomerSegment =
	'new' | 'regular' | 'vip' | 'wholesale' | 'corporate' | 'inactive' | 'at_risk';

export interface CustomerBnosExt {
	pubkey?: string;
	npub?: string;
	avatar?: string;
	segment?: CustomerSegment;
	loyaltyPoints?: number;
	membershipTierId?: string;
	totalSpend?: number;
	totalOrders?: number;
	averageOrderValue?: number;
	firstOrderAt?: string;
	lastOrderAt?: string;
	notes?: string[];
	customFields?: Record<string, unknown>;
}
/** Standardized customer = canonical GLO customer; notes widened to array. */
export type Customer = Omit<GloCustomer, 'notes'> & CustomerBnosExt;

export type LoyaltyTransactionType = 'earn' | 'redeem' | 'expire' | 'adjust' | 'transfer';
export interface LoyaltyPoints {
	customerId?: string;
	type?: LoyaltyTransactionType;
	points?: number;
	balanceAfter?: number;
	reason?: string;
	orderId?: string;
	expiresAt?: string;
}

export type CouponType = 'percent' | 'fixed' | 'free_shipping' | 'bogo' | 'free_item';
export interface Coupon {
	code: string;
	type: CouponType;
	value: number;
	status: 'active' | 'expired' | 'disabled';
	currency?: string;
	description?: string;
	minSpend?: number;
	maxDiscountAmount?: number;
	uses?: number;
	maxUses?: number;
	active?: boolean;
	validFrom?: string;
	validUntil?: string;
	productIds?: string[];
	categoryIds?: string[];
}

export type PromotionType =
	| 'percent'
	| 'fixed'
	| 'bogo'
	| 'bundle'
	| 'discount_percent'
	| 'discount_fixed'
	| 'flash_sale'
	| 'happy_hour'
	| 'spend_x_get_y';
export interface Promotion {
	name: string;
	status: 'active' | 'scheduled' | 'expired' | 'disabled';
	type: PromotionType;
	value: number;
	description?: string;
	minimumSpend?: number;
	buyQuantity?: number;
	getQuantity?: number;
	productIds?: string[];
	categoryIds?: string[];
	active?: boolean;
	maxUsage?: number;
	currentUsage?: number;
	startsAt?: string;
	endsAt?: string;
	validFrom?: string;
	validUntil?: string;
	timeRestrictions?: { daysOfWeek?: number[]; startTime?: string; endTime?: string };
}

export type MembershipMode = 'normal' | 'gym' | 'hybrid';
export type MembershipAccessType = 'none' | 'unlimited' | 'visit_limited' | 'class_limited';
export type MembershipPeriod = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'one_time';
export interface Membership {
	name: string;
	price: number;
	currency: string;
	period: MembershipPeriod;
	status: 'active' | 'inactive';
	mode?: MembershipMode;
	level?: number;
	description?: string;
	benefits?: string[];
	billingPeriod?: MembershipPeriod;
	durationDays?: number;
	pointsMultiplier?: number;
	discountPercent?: number;
	minimumSpend?: number;
	minimumOrders?: number;
	accessType?: MembershipAccessType;
	visitLimit?: number;
	classLimit?: number;
	allowedBranchIds?: string[];
	allowedZoneIds?: string[];
	color?: string;
	icon?: string;
	sortOrder?: number;
	active?: boolean;
}

export type MembershipSubscriptionStatus =
	'active' | 'expired' | 'cancelled' | 'suspended' | 'frozen' | 'paused';
export interface MembershipSubscription {
	status: MembershipSubscriptionStatus;
	startsAt: string;
	customerId?: string;
	customerName?: string;
	membershipId?: string;
	membershipName?: string;
	subscriptionId?: string;
	startedAt?: string;
	expiresAt?: string;
	endsAt?: string;
	renewsAt?: string;
	renewalPolicy?: 'manual' | 'auto';
	visitsUsed?: number;
	classesUsed?: number;
	lastCheckInAt?: string;
	branchId?: string;
}

export type CheckInResult = 'allowed' | 'denied' | 'override';
export interface MembershipCheckIn {
	result: CheckInResult;
	occurredAt: string;
	customerId?: string;
	customerName?: string;
	membershipId?: string;
	subscriptionId?: string;
	branchId?: string;
	reason?: string;
	checkedInAt?: string;
}

// ════════════════════════════════════════════════════════════════════
// IDENTITY / STAFF
// ════════════════════════════════════════════════════════════════════

export type UserRole =
	| 'owner'
	| 'admin'
	| 'manager'
	| 'cashier'
	| 'waiter'
	| 'chef'
	| 'stock'
	| 'warehouse'
	| 'viewer'
	| 'franchise_owner'
	| 'supplier'
	| 'delivery'
	| 'customer';
export type StaffStatus = 'active' | 'inactive' | 'suspended' | 'on_leave' | 'terminated';

/** `identity.staff` — no canonical GLO data type yet; full bnos extension. */
export interface Staff {
	name: string;
	role: UserRole;
	status: StaffStatus;
	displayName?: string;
	email?: string;
	phone?: string;
	avatar?: string;
	pubkey?: string;
	npub?: string;
	companyId?: string;
	companyName?: string;
	companyCode?: string;
	customPermissions?: string[];
	branchIds?: string[];
	employeeCode?: string;
	department?: string;
	hireDate?: number;
	pinHash?: string;
	pin?: string;
	hourlyRate?: number;
}

// ════════════════════════════════════════════════════════════════════
// INVENTORY
// ════════════════════════════════════════════════════════════════════

export type AdjustmentReason =
	| 'sale'
	| 'restock'
	| 'return'
	| 'damaged'
	| 'expired'
	| 'lost'
	| 'theft'
	| 'transfer_in'
	| 'transfer_out'
	| 'correction'
	| 'initial_count'
	| 'waste'
	| 'sample'
	| 'other';
export type AdjustmentType = 'increase' | 'decrease';

/**
 * `inventory.adjustment` — no canonical GLO data type yet; full bnos extension.
 * Compatible with the current UI alias set (`productName` is the display field).
 */
export interface StockAdjustment {
	type?: AdjustmentType;
	reason?: AdjustmentReason | string;
	productId?: string;
	productName: string;
	variantId?: string;
	quantity: number;
	previousStock?: number;
	newStock?: number;
	unitCost?: number;
	cost?: number;
	totalValueChange?: number;
	referenceId?: string;
	referenceType?: 'order' | 'purchase_order' | 'transfer' | 'count' | 'manual';
	notes?: string;
	warehouseId?: string;
	branchId?: string;
	performedBy?: string;
	occurredAt: string;
}

// ════════════════════════════════════════════════════════════════════
// ORGANIZATION / LOCATION
// ════════════════════════════════════════════════════════════════════

export type BusinessModel =
	'single' | 'multi_branch' | 'chain' | 'franchise_hq' | 'franchise_branch';
export type BusinessType = 'retail' | 'restaurant' | 'cafe' | 'service' | 'wholesale' | 'other';

export interface OperatingHours {
	mon?: { open: string; close: string };
	tue?: { open: string; close: string };
	wed?: { open: string; close: string };
	thu?: { open: string; close: string };
	fri?: { open: string; close: string };
	sat?: { open: string; close: string };
	sun?: { open: string; close: string };
}

export interface OrganizationBnosExt {
	businessModel?: BusinessModel;
	businessType?: BusinessType;
	description?: string;
	currencySymbol?: string;
	taxRate?: number;
	taxInclusive?: boolean;
	receiptHeader?: string;
	receiptFooter?: string;
	defaultPayment?: string;
	defaultOrderType?: string;
	hours?: OperatingHours;
	relays?: string[];
	lightning?: { backend?: string; apiUrl?: string };
	hardware?: { printerType?: string; cashDrawer?: boolean; barcodeScanner?: boolean };
	features?: {
		restaurant?: boolean;
		retail?: boolean;
		loyalty?: boolean;
		crm?: boolean;
		multiBranch?: boolean;
		marketplace?: boolean;
		ai?: boolean;
	};
	locale?: string;
}
export type Organization = GloOrganization & OrganizationBnosExt;

export interface LocationBnosExt {
	storeId?: string;
	hours?: OperatingHours;
	managerPubkey?: string;
	relays?: string[];
	geohash?: string;
}
export type Location = GloLocation & LocationBnosExt;

// ════════════════════════════════════════════════════════════════════
// SUPPLY CHAIN (extension types → 30078)
// ════════════════════════════════════════════════════════════════════

export interface Supplier {
	name: string;
	code?: string;
	description?: string;
	contactName?: string;
	email?: string;
	phone?: string;
	address?: string;
	pubkey?: string;
	website?: string;
	taxId?: string;
	paymentTerms?: string;
	currency?: string;
	leadTimeDays?: number;
	minimumOrderAmount?: number;
	categories?: string[];
	rating?: number;
	status?: 'active' | 'inactive' | 'blacklisted';
	notes?: string;
	tags?: string[];
}

export interface PurchaseOrderLine {
	productId?: string;
	productName?: string;
	name?: string;
	quantity: number;
	unitPrice: number;
	total?: number;
	receivedQuantity?: number;
	notes?: string;
}
export interface PurchaseOrder {
	number: string;
	supplierId?: string;
	supplierName?: string;
	status: 'draft' | 'submitted' | 'confirmed' | 'partial' | 'received' | 'cancelled' | 'sent';
	lines: PurchaseOrderLine[];
	subtotal?: number;
	taxAmount?: number;
	shippingCost?: number;
	total: number;
	currency: string;
	paymentStatus?: 'unpaid' | 'partial' | 'paid';
	branchId?: string;
	orderedAt?: string;
	expectedDeliveryAt?: string;
	actualDeliveryAt?: string;
	receivedAt?: string;
	createdBy?: string;
	approvedBy?: string;
	notes?: string;
}

export interface StockTransferLine {
	productId?: string;
	productName?: string;
	quantity: number;
	receivedQuantity?: number;
	notes?: string;
}
export interface StockTransfer {
	number: string;
	fromBranchId?: string;
	toBranchId?: string;
	status:
		| 'draft'
		| 'submitted'
		| 'approved'
		| 'in_transit'
		| 'received'
		| 'partial_received'
		| 'cancelled';
	lines: StockTransferLine[];
	totalItems?: number;
	totalQuantity?: number;
	requestedAt?: string;
	expectedArrivalAt?: string;
	shippedAt?: string;
	actualArrivalAt?: string;
	createdBy?: string;
	approvedBy?: string;
	notes?: string;
}

// ════════════════════════════════════════════════════════════════════
// ACCOUNTING (extension type → 30078)
// ════════════════════════════════════════════════════════════════════

export type ExpenseCategory =
	| 'rent'
	| 'utilities'
	| 'supplies'
	| 'salaries'
	| 'marketing'
	| 'maintenance'
	| 'transport'
	| 'taxes'
	| 'insurance'
	| 'depreciation'
	| 'professional_services'
	| 'technology'
	| 'food_cost'
	| 'other';

export type ExpenseStatus = 'draft' | 'submitted' | 'approved' | 'paid' | 'pending' | 'cancelled';
export interface Expense {
	number: string;
	description: string;
	category: ExpenseCategory;
	amount: number;
	currency: string;
	payee?: string;
	status: ExpenseStatus;
	method?: 'cash' | 'bank' | 'card' | 'other';
	reference?: string;
	branchId?: string;
	approvedBy?: string;
	occurredAt: string;
}

// ════════════════════════════════════════════════════════════════════
// STAFF OPS: SHIFT / CASH EVENT (extension types → 30078)
// ════════════════════════════════════════════════════════════════════

export type ShiftStatus = 'active' | 'closed' | 'force_closed' | 'cancelled';
export interface Shift {
	number: string;
	status: ShiftStatus;
	openedAt: string;
	openingCash: number;
	staffId?: string;
	staffName?: string;
	/** Canonical GLO branch id (kind 30520 `branchId`). `undefined` for
	 *  single-location tenants so legacy global shifts keep matching. */
	branchId?: string;
	/** Denormalized branch name for offline display on staff devices that
	 *  haven't yet synced the `location` record from the owner device. */
	branchName?: string;
	terminalId?: string;
	closingCash?: number;
	expectedCash?: number;
	difference?: number;
	variance?: number;
	varianceNote?: string;
	totalSales?: number;
	totalOrders?: number;
	totalRefunds?: number;
	totalRefundAmount?: number;
	cashSales?: number;
	cardSales?: number;
	lightningSales?: number;
	qrSales?: number;
	otherSales?: number;
	totalCashIn?: number;
	totalCashOut?: number;
	currency: string;
	closedAt?: string;
}

export type CashEventType =
	'cash_in' | 'cash_out' | 'no_sale_open' | 'paid_in' | 'paid_out' | 'bank_deposit';
export interface CashEvent {
	shiftId?: string;
	staffId?: string;
	type: CashEventType;
	amount: number;
	currency: string;
	reason?: string;
	approvedBy?: string;
	occurredAt: string;
}

// ════════════════════════════════════════════════════════════════════
// MARKETPLACE (dedicated BNOS marketplace kinds 30950–30955)
//   marketplace.connection → STORE_CONNECTION        (30953)
//   marketplace.product    → MARKETPLACE_PRODUCT     (30951)
//   marketplace.review     → MARKETPLACE_REVIEW      (30955)
//   orders from channels reuse commerce.order (30200) with source/channel.
// ════════════════════════════════════════════════════════════════════

/** The platform a channel connects to (TikTok, Facebook, own website…). */
export type MarketplaceChannelType =
	| 'tiktok'
	| 'facebook'
	| 'instagram'
	| 'website'
	| 'shopee'
	| 'lazada'
	| 'tokopedia'
	| 'amazon'
	| 'whatsapp'
	| 'shopify'
	| 'custom';

export type MarketplaceConnectionStatus = 'connected' | 'disconnected' | 'error' | 'pending';

/** A connected external sales channel / store partnership.
 *  Wire kind: STORE_CONNECTION (30953). */
export interface MarketplaceConnection {
	name: string;
	type: MarketplaceChannelType;
	status: MarketplaceConnectionStatus;
	/** Storefront / shop URL on the channel. */
	storeUrl?: string;
	/** Whether orders/listings auto-sync. */
	syncEnabled: boolean;
	/** Mark orders fulfilled automatically once shipped. */
	autoFulfill?: boolean;
	lastSyncAt?: string;
	/** Brand logo / emoji shown on chips. */
	logo?: string;
	/** Free-form channel config (apiKey masked in UI, region, currency…). */
	config?: Record<string, string>;
}

export type MarketplaceProductStatus = 'draft' | 'active' | 'paused' | 'out_of_stock' | 'archived';

/** A product published to one or more sales channels.
 *  Wire kind: MARKETPLACE_PRODUCT (30951). */
export interface MarketplaceProduct {
	productId: string;
	productName: string;
	sku?: string;
	/** Channel ids this listing is published to. */
	channelIds: string[];
	status: MarketplaceProductStatus;
	price: number;
	compareAtPrice?: number;
	/** Per-channel price overrides (channelId → price). */
	channelPrices?: Record<string, number>;
	inventoryTracked: boolean;
	stock?: number;
	images?: string[];
	description?: string;
	publishedAt?: string;
	/** Per-channel publish health. */
	channelStatus?: Record<string, 'published' | 'syncing' | 'rejected'>;
	// cached performance metrics
	views?: number;
	clicks?: number;
	conversions?: number;
}

export type MarketplaceReviewStatus = 'published' | 'pending' | 'flagged' | 'hidden' | 'replied';

/** A product/store review (synced from a channel or captured manually).
 *  Wire kind: MARKETPLACE_REVIEW (30955). */
export interface MarketplaceReview {
	productId?: string;
	productName?: string;
	channelId?: string;
	channelName?: string;
	customerName: string;
	rating: number; // 1–5
	title?: string;
	body?: string;
	status: MarketplaceReviewStatus;
	reply?: string;
	verified: boolean;
	helpful?: number;
}
