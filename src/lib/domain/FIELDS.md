# bdgo-os → bnos-svelte data-model field audit

This document tracks how every field in the **bdgo-os** enterprise type system
(`bdgo-os/app/types/*`) maps onto the standardized **GLO** data model in
`@bitos/bnos-core` (`packages/bnos-core/src/glo`), as adopted by **bnos-svelte**.

## The three layers

| Layer                  | Role                                                                                       | Source                                          |
| ---------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| **GLO canonical**      | Stable cross-client wire contract. Minimal fields. Authoritative **kind** per object type. | `@bitos/bnos-core/glo` (`model.ts`, `kinds.ts`) |
| **bdgo-os rich model** | Enterprise "best code system". Full feature surface.                                       | `bdgo-os/app/types/*`                           |
| **bnos-svelte domain** | This module. `data = canonical ∪ bnos extension`.                                          | `src/lib/domain/*`                              |

## Standardization rules

1. **Kind is authoritative.** Every object type resolves to exactly one Nostr
   kind through `GLO_KIND_BY_TYPE` (`@bitos/bnos-core/glo`). `domain/kind.ts`
   never hard-codes a number; it derives `KIND` from that map. Known types keep
   their domain kind; extension types fall back to NIP-78 `30078`.
2. **Canonical fields stay canonical.** Where GLO defines a field (`name`,
   `price`, `lines`, `occurredAt`, …) the bnos interface uses that exact name
   and type, so the object is a valid GLO payload out of the box.
3. **bdgo-os extras are typed extensions.** Fields bdgo-os needs that GLO does
   not yet define are carried as a typed `*BnosExt` interface intersected onto
   the canonical type. On the wire they ride under the reverse-domain
   extension namespace `org.bitos.bnos` (see `domain/helpers.ts`), per the GLO
   spec "application-specific data belongs under a reverse-domain extension
   key". They are promoted to canonical only when two clients share them.
4. **No silent drops.** Every bdgo-os field is either (a) canonical, (b) a
   typed bnos extension, or (c) explicitly listed as out-of-scope below.

## Per-entity coverage

Legend: ✅ canonical GLO field · ➕ bnos extension field · — out of scope
(server-only / event-only / derived).

### catalog.product → kind 30100

Canonical: `name sku barcode description categoryId unitId price cost currency
images tags taxable taxRate trackInventory status` ✅
bdgo-os extras ➕: `available isPublic type prepTime sortOrder nutritionalInfo
hasVariants variantAttributes variants modifierGroupIds compareAtPrice
taxInclusive minimumPrice inventory{…} promotion{…}`
Event-only —: `id` (= GLO object id), `pricing` (flattened to canonical),
`metadata` (→ extensions), `trackStock` (alias of `trackInventory`).

### catalog.category → kind 30101

Canonical ✅: `name description parentId image sortOrder status`.
bdgo-os ➕: `icon color active`.

### catalog.unit → kind 30102

Canonical ✅: `name symbol precision`.
bdgo-os ➕: `type baseUnitId conversionFactor isDefault`.

### catalog.modifier-group → kind 30103

Canonical —: no GLO data type defined yet; full payload is bnos extension.
bdgo-os ➕: `name description selectionType required minSelections maxSelections
sortOrder modifiers[] productIds[]`.

### commerce.order → kind 30200

Canonical ✅: `number customerId status currency lines subtotal discount tax
tip total paymentStatus fulfillmentType notes occurredAt`.
bdgo-os ➕: `type source channel customerPubkey customerName cashierPubkey
branchId tableId isHeld covers shiftId completedAt shipping pickup
totalsRounding orderNumber`.
Line canonical ✅: `id productId name sku quantity unitPrice discount tax total
notes`; bdgo ➕: `productName variantId variantName modifiers taxAmount`.

### commerce.payment → kind 30201

Canonical ✅: `orderId invoiceId amount currency method status reference
paidAt`.
bdgo-os ➕: `cashReceived changeGiven lightningInvoice paymentHash preimage
cardReference qrData cashierPubkey branchId`.

### commerce.refund → kind 30202

Canonical —: no GLO data type; bnos extension full payload.
bdgo-os ➕: `orderId paymentId status reason note items[] totalAmount currency
refundMethod approvedBy completedAt branchId`.

### crm.customer → kind 30300

Canonical ✅: `name nostrPubkey email phone address notes tags status`.
bdgo-os ➕: `pubkey npub avatar segment loyaltyPoints membershipTierId
totalSpend totalOrders averageOrderValue firstOrderAt lastOrderAt`.

### identity.staff → kind 30500

Canonical —: no GLO data type; bnos extension full payload.
bdgo-os ➕: `name displayName email phone avatar pubkey npub companyId
companyName companyCode role customPermissions branchIds status employeeCode
department hireDate pinHash`.

### inventory.adjustment → kind 30400

Canonical —: no GLO data type; bnos extension full payload.
bdgo-os ➕: `type reason productId variantId quantity previousStock newStock
unitCost totalValueChange referenceId referenceType notes warehouseId
performedBy`.

### location (branch) → kind 30600

Canonical ✅: `name code address email phone timezone status`.
bdgo-os ➕: `storeId hours managerPubkey relays geohash`.

### organization (store settings) → kind 30078

Canonical ✅: `name legalName code email phone address taxId currency timezone
language status`.
bdgo-os ➕: `businessModel businessType description currencySymbol taxRate
taxInclusive receiptHeader receiptFooter defaultPayment defaultOrderType hours
relays lightning hardware features locale`.

### supplier (extension) → kind 30078

bdgo-os ➕: `name code description contactName email phone address pubkey
website taxId paymentTerms currency leadTimeDays minimumOrderAmount categories
rating status notes tags`.

### purchase-order (extension) → kind 30078

bdgo-os ➕: `number supplierId supplierName status lines[] total currency
orderedAt receivedAt branchId paymentStatus notes`.

### stock-transfer (extension) → kind 30078

bdgo-os ➕: `number fromBranchId toBranchId status lines[] totalQuantity
requestedAt expectedArrivalAt shippedAt actualArrivalAt notes`.

### expense (extension) → kind 30078

bdgo-os ➕: `number description category amount currency payee status method
occurredAt`.

### coupon (extension) → kind 30078

bdgo-os ➕: `code type value currency minSpend uses maxUses status expiresAt`.

### promotion (extension) → kind 30078

bdgo-os ➕: `name type value description startsAt endsAt status`.

### loyalty-points (extension) → kind 30078

bdgo-os ➕: `customerId type points balanceAfter reason orderId expiresAt`.

### membership (extension) → kind 30078

bdgo-os ➕: `name mode level price currency period durationDays benefits
accessType visitLimit classLimit allowedBranchIds discountPercent
pointsMultiplier minimumSpend status color icon sortOrder`.

### membership-subscription (extension) → kind 30078

bdgo-os ➕: `customerId customerName membershipId membershipName status
startedAt expiresAt renewsAt visitsUsed classesUsed lastCheckInAt`.

### membership-check-in (extension) → kind 30078

bdgo-os ➕: `customerId customerName membershipId subscriptionId result
reason occurredAt`.

### shift (extension) → kind 30078

bdgo-os ➕: `number staffId staffName branchId status openedAt closedAt
openingCash closingCash expectedCash totalSales totalOrders totalRefunds
totalRefundAmount cashSales cardSales lightningSales qrSales otherSales
totalCashIn totalCashOut difference varianceNote currency`.

### cash-event (extension) → kind 30078

bdgo-os ➕: `shiftId staffId type amount currency reason approvedBy occurredAt`.

## Out of scope (intentionally not ported to bnos-svelte v1)

These bdgo-os domains are server-side, derived, or not yet built in the
Svelte client. They are tracked here so the audit is complete:

- `accounting` (Account / JournalEntry / FinancialReport) — double-entry ledger
- `recipe` / `ingredient` (kinds 30104–30106) — kitchen prep
- `pos-session` / `audit-log` / `permission-grant` / `staff-sync` /
  `user-workspaces` (30501, 30502, 30510–30512, 30590, 30591) — runtime/auth
- `company-index` (30503) — discovery
- `marketplace.*` (30950–30955) — inter-store commerce
- `rental`/`contract` (30205–30209) — property rentals
- `table-session` / `kitchen-ticket` / `printer-job` (30210–30213) — runtime
- `subscription.*` (30960–30965) — platform billing (system-managed)
- `loyalty-reward` (30302), `promotion-usage` (30314) — counters
- `branch-stock` (30701) — derived from inventory.adjustment
- `stock-level` — computed, not an event

When any of these becomes a client feature it gets a new GLO type entry in
`kind.ts` + a typed interface in `types.ts` + a row in this table.
