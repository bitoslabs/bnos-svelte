# BNOS-Svelte vs BDGO-OS-Nuxt — Feature Audit

> Generated: 2026-08-02
> Goal: Identify missing fields, CRUD operations, features, and UX gaps in bnos-svelte compared to bdgo-os-nuxt.
> Pricing/subscription features are excluded.

---

## Executive Summary

bnos-svelte has solid bones for the core POS flow (catalog → cart → checkout → receipt) and covers most entity CRUD. However, **several settings pages are significantly thinner** than their Nuxt counterparts, and a few **critical POS features are missing** (shift gate, custom items, cash events from POS, payment sound on checkout). The reports page is a basic bar chart vs. a full ECharts dashboard. Promotions and expenses need more form fields.

---

## 1. Settings Pages

### 1.1 Payment Methods — `settings/payment-methods`
| Aspect | Nuxt | Svelte | Gap |
|--------|------|--------|-----|
| Custom methods | Full CRUD: add/edit/delete custom methods | 4 hardcoded toggles only | **Critical** |
| Fields per method | id, label, icon, type, enabled | key, label, icon, desc, enabled | Missing type & id |
| Icon picker | 8+ icon options | Fixed per method | No customization |
| **Severity** | — | — | 🔴 **Critical** — users cannot add bank-transfer, QR-codes, or other custom methods |

**Recommendation:** Add full CRUD with dialog form (id, label, icon picker, type, enabled toggle). Persist to localStorage + tenant config.

---

### 1.2 Receipt — `settings/receipt`
| Aspect | Nuxt | Svelte | Gap |
|--------|------|--------|-----|
| Receipt logo | Upload + URL + show/hide toggle | ❌ Missing | **Medium** |
| Custom header text | ✅ | ✅ (basic) | OK |
| Custom footer text | ✅ | ✅ | OK |
| Tax ID field | Show/hide + value | ❌ Missing | **Medium** |
| Show store name toggle | ✅ | ❌ (uses storeName always) | Low |
| Show phone toggle | ✅ | ❌ | Low |
| Show address toggle | ✅ | ❌ | Low |
| Show QR code | ✅ + QR data input | ❌ Missing | **Medium** |
| Show barcode | ✅ | ❌ | Low |
| Show date | ✅ | ❌ (always shown) | Low |
| Show order number | ✅ | ❌ | Low |
| Paper size | ✅ (58mm/80mm) | ✅ (58mm/80mm) | OK |
| Receipt preview | ✅ Full | ✅ Basic | OK |
| **Severity** | — | — | 🟡 **Medium** — missing logo, tax ID, QR, and granular toggles |

**Recommendation:** Add `receiptLogo`, `receiptShowLogo`, `receiptTaxId`, `receiptShowTaxId`, `receiptShowQr`, `receiptQrData`, and per-field visibility toggles.

---

### 1.3 Appearance — `settings/appearance`
| Aspect | Nuxt | Svelte | Gap |
|--------|------|--------|-----|
| Theme modes | Light / Dark / System (3 cards) | Light / Dark / System (3 cards) | OK |
| Accent color picker | ✅ Color swatches | ❌ Missing | **Medium** |
| Density/compact | ✅ | ❌ | Low |
| Font size | ✅ | ❌ | Low |
| **Severity** | — | — | 🟡 **Medium** |

---

### 1.4 Data — `settings/data`
| Aspect | Nuxt | Svelte | Gap |
|--------|------|--------|-----|
| Export backup | ✅ JSON | ✅ JSON | OK |
| Import backup | ✅ | ❌ Missing | **Medium** |
| Record counts | Via DB stats | ✅ (inline) | OK |
| Wipe data | ✅ | ✅ | OK |
| **Severity** | — | — | 🟡 **Medium** — import is important for device migration |

---

### 1.5 Branches — `settings/branches`
| Aspect | Nuxt | Svelte | Gap |
|--------|------|--------|-----|
| Branch CRUD | Part of organization page (rich) | Basic add/list/delete | **Medium** |
| Fields | name, code, address, phone, email, status | name, code, status only | **Medium** |
| Edit branch | ✅ | ❌ No edit | **Medium** |
| **Severity** | — | — | 🟡 **Medium** |

**Recommendation:** Add edit, plus address/phone/email fields to branch form.

---

### 1.6 Features — `settings/features`
| Aspect | Nuxt | Svelte | Gap |
|--------|------|--------|-----|
| Toggle list | ✅ | ✅ (7 toggles) | OK |
| Permission-gated | ✅ | ❌ | Low |
| **Severity** | — | — | 🟢 **Low** |

---

### 1.7 Notifications — `settings/notifications`
| Aspect | Nuxt | Svelte | Gap |
|--------|------|--------|-----|
| Sound toggle | ✅ | ✅ | OK |
| Order complete | ✅ | ✅ | OK |
| Low stock | ✅ | ✅ | OK |
| Daily summary | ✅ | ✅ | OK |
| Notification prefs map | ✅ Granular per-type | ✅ Basic | Low |
| **Severity** | — | — | 🟢 **Low** |

---

### 1.8 Hardware — `settings/hardware`
| Aspect | Nuxt | Svelte | Gap |
|--------|------|--------|-----|
| Scale / scanner test | ✅ Basic | ✅ Basic | OK |
| Printer test | ✅ | ✅ | OK |
| **Severity** | — | — | 🟢 **Low** |

---

### 1.9 Bitcoin — `settings/bitcoin`
| Aspect | Nuxt | Svelte | Gap |
|--------|------|--------|-----|
| Lightning address | ✅ | ✅ | OK |
| Bitcoin units | ✅ | ✅ | OK |
| Exchange rate | ✅ | ✅ | OK |
| **Severity** | — | — | 🟢 **Low** — Svelte is actually richer (611 vs 492 lines) |

---

### 1.10 Printers — `settings/printers`
| Aspect | Nuxt | Svelte | Gap |
|--------|------|--------|-----|
| Printer CRUD | ✅ Full (957 lines) | ✅ Basic (563 lines) | Low |
| WebUSB / WebBluetooth | ✅ | ✅ | OK |
| **Severity** | — | — | 🟢 **Low** |

---

## 2. POS Page

### 2.1 Missing POS Components
| Feature | Nuxt Component | Svelte | Severity |
|---------|---------------|--------|----------|
| **Shift gate** | `PosShiftGate`, `PosOpenShift`, `PosCloseShift` | ❌ Not in POS | 🔴 **Critical** — POS should require an open shift |
| **Shift indicator** | `PosShiftIndicator` | ❌ Not shown in POS | 🟡 Medium |
| **Custom item** | `PosCustomItemModal` — add ad-hoc items to cart | ❌ Missing | 🔴 **Critical** |
| **Cash event** | `PosCashEvent` — cash in/out from POS | ❌ Missing (exists only on shifts page) | 🟡 Medium |
| **History modal** | `PosHistoryModal` — recent orders from POS | ❌ Missing | 🟡 Medium |
| **Pending orders** | `PosPendingOrdersModal` | ❌ Missing | 🟡 Medium |
| **Bundle confirm** | `PosBundleConfirm` | ❌ Missing | Low |
| **Size selector** | `PosSizeSelectorModal` | Handled via variants | OK |
| **Settings modal** | `PosSettingsModal` (quick prefs from POS) | ❌ Missing | Low |
| Held orders | ✅ | ✅ (in-cart held) | OK |
| Discount | ✅ | ✅ | OK |
| Modifier modal | ✅ | ✅ | OK |
| Note on line item | ✅ | ✅ | OK |
| Receipt modal | ✅ | ✅ | OK |
| Checkout | ✅ | ✅ | OK |
| **Payment sound** | ✅ AudioContext chime | ❌ No sound on payment | 🟡 Medium |

**Recommendation:** Add shift gate (block POS until shift open), custom item modal, cash event shortcut, and payment success sound.

---

## 3. Catalog

### 3.1 Missing Catalog Tabs
| Tab | Nuxt Component | Svelte | Severity |
|-----|---------------|--------|----------|
| Products | ✅ Full | ✅ Full | OK |
| Categories | ✅ | ✅ | OK |
| Units | ✅ | ✅ | OK |
| Modifiers | ✅ | ✅ | OK |
| **Bundles** | `CatalogBundles.vue` | ❌ Missing tab | 🟡 **Medium** |

### 3.2 Product Fields
| Field | Nuxt | Svelte | Gap |
|-------|------|--------|-----|
| name | ✅ | ✅ | OK |
| price | ✅ | ✅ | OK |
| category | ✅ | ✅ | OK |
| unit | ✅ | ✅ | OK |
| barcode/SKU | ✅ | ✅ | OK |
| image | ✅ | ✅ | OK |
| description | ✅ | ✅ | OK |
| variants | ✅ | ✅ | OK |
| track inventory | ✅ | ✅ | OK |
| low stock threshold | ✅ | ✅ | OK |
| modifier groups | ✅ | ✅ | OK |
| **Severity** | — | — | 🟢 **Low** — products are near parity |

---

## 4. Inventory

### 4.1 Missing Tabs
| Tab | Nuxt Component | Svelte | Severity |
|-----|---------------|--------|----------|
| Adjustments | ✅ Rich | ✅ Basic | OK |
| **Counts** (stocktakes) | `InventoryCountsTab` | ❌ Missing | 🟡 **Medium** |
| **Overview** (stock dashboard) | `InventoryOverviewTab` | ❌ Missing | 🟡 **Medium** |
| Suppliers | ✅ | ✅ | OK |
| Purchase Orders | ✅ | ✅ | OK |

### 4.2 Stock Overview Dashboard
Nuxt has a full overview tab with stock value, low-stock alerts, and per-product stock levels. Svelte has nothing equivalent.

**Recommendation:** Add stock overview tab and stock counts (stocktake) tab.

---

## 5. Reports / Dashboard

### 5.1 Missing Features
| Feature | Nuxt | Svelte | Severity |
|---------|------|--------|----------|
| Date range picker (today/7d/30d/month/custom) | ✅ | ❌ Fixed 7-day | 🔴 **Critical** |
| Previous period comparison | ✅ | ❌ | 🟡 Medium |
| Summary cards (revenue, orders, avg, items) | ✅ Full | ❌ Only total revenue | 🔴 **Critical** |
| Daily revenue chart (ECharts) | ✅ | Basic CSS bar chart | 🟡 Medium |
| Payment method breakdown (pie chart) | ✅ | ❌ Missing | 🟡 Medium |
| Hourly sales chart | ✅ | ❌ Missing | 🟡 Medium |
| Top products by revenue | ✅ | ❌ (only by quantity) | 🟡 Medium |
| Top products by quantity | ✅ | ✅ | OK |
| Product/category map | ✅ | ❌ | Low |
| CSV export | ✅ | ❌ Missing | 🟡 Medium |
| **Lines of code** | 513 | 125 | — |

**Recommendation:** This is the biggest functional gap. Add date range selector, summary stats cards, payment breakdown, hourly chart, and CSV export.

---

## 6. Customers

### 6.1 Missing Fields
| Field | Nuxt | Svelte | Severity |
|-------|------|--------|----------|
| name | ✅ | ✅ | OK |
| phone | ✅ | ✅ | OK |
| email | ✅ | ✅ | OK |
| address | ✅ | ❌ Missing | 🟡 Medium |
| notes | ✅ | ❌ Missing | 🟡 Medium |
| npub (Nostr pubkey) | ✅ + validation | ❌ Missing | 🟡 Medium |
| segment (VIP/Regular/etc) | ✅ | ❌ Missing | 🟡 Medium |
| active toggle | ✅ | ❌ Missing (uses status) | Low |
| **Customer detail page** | ❌ (list only in Nuxt) | ❌ (list only) | OK |

### 6.2 Missing List Features
| Feature | Nuxt | Svelte | Gap |
|---------|------|--------|-----|
| Order count per customer | ✅ | ❌ | 🟡 Medium |
| Total spend per customer | ✅ | ❌ | 🟡 Medium |
| Segment badge/color | ✅ | ❌ | Low |
| Edit customer | ✅ (modal) | ❌ (add only) | 🟡 Medium |
| **Severity** | — | — | 🟡 **Medium** |

**Recommendation:** Add address, notes, npub, segment fields. Add edit action. Show order count + total spend.

---

## 7. Expenses

### 7.1 Missing Form Fields
| Field | Nuxt | Svelte | Severity |
|-------|------|--------|----------|
| description | ✅ | ✅ | OK |
| amount | ✅ | ✅ | OK |
| category | ✅ | ✅ | OK |
| date | ✅ (date picker) | ❌ Uses current date | 🟡 Medium |
| payment method | ✅ (select) | ✅ (method select) | OK |
| vendor | ✅ | ❌ (has payee instead) | Low |
| receipt URL | ✅ | ❌ Missing | Low |
| status | ✅ (draft/submitted/approved/paid) | ✅ (paid only) | 🟡 Medium |
| **Edit expense** | ✅ | ❌ (add only) | 🟡 Medium |

**Recommendation:** Add date picker, status workflow (draft → submitted → approved → paid), and receipt URL field.

---

## 8. Promotions

### 8.1 Missing Form Fields (big gap)
| Field | Nuxt | Svelte | Severity |
|-------|------|--------|----------|
| name | ✅ | ✅ (basic) | OK |
| description | ✅ | ❌ | 🟡 Medium |
| type (fixed/percent/bogo/bxgy) | ✅ 5+ types | ❌ (basic percent only) | 🔴 **Critical** |
| value | ✅ | ✅ | OK |
| minimum spend | ✅ | ❌ | 🟡 Medium |
| buy/get quantity (BOGO) | ✅ | ❌ | 🔴 **Critical** |
| valid from / until | ✅ | ❌ | 🟡 Medium |
| max usage | ✅ | ❌ | 🟡 Medium |
| time restrictions (days/hours) | ✅ | ❌ | 🟡 Medium |
| product/category applicability | ✅ (picker) | ❌ | 🟡 Medium |
| active toggle | ✅ | ❌ | Medium |
| **Lines of code** | 1143 | 116 | — |

**Recommendation:** This page needs a near-complete rewrite. Add promotion type selector, BOGO fields, schedule, usage limits, and product/category picker.

---

## 9. Staff

### 9.1 Staff Page Location
- **Nuxt**: Full page at `settings/staff.vue` (1117 lines)
- **Svelte**: At top-level `/staff` route (121 lines), NOT under settings

### 9.2 Missing Features
| Feature | Nuxt | Svelte | Severity |
|---------|------|--------|----------|
| Stats cards (total/active/roles) | ✅ | ❌ | 🟡 Medium |
| Role filter | ✅ | ❌ | 🟡 Medium |
| Export staff | ✅ | ❌ | Low |
| Staff member pubkey | ✅ (npub input) | ❌ | 🟡 Medium |
| PIN login | ✅ (hash stored) | ✅ (plaintext field) | 🟡 Medium — PIN should be hashed |
| Permission assignment | ✅ (role-based) | ❌ | 🟡 Medium |
| **Edit staff** | ✅ | ❌ (add only) | 🟡 Medium |
| **Severity** | — | — | 🟡 **Medium** |

**Recommendation:** Add stats, role filter, pubkey field, edit action, and hash PINs before storing.

---

## 10. Organization

### 10.1 Missing Features
| Feature | Nuxt | Svelte | Gap |
|---------|------|--------|-----|
| Company CRUD | ✅ (relay-synced) | ✅ (localStorage) | OK for offline |
| Branch CRUD | ✅ (relay-synced) | ✅ (localStorage) | OK for offline |
| **Code availability checker** | ✅ (checks relays) | ❌ | 🟡 Medium |
| **Data encryption** (company keys) | ✅ NIP-44 | ❌ | 🟡 Medium |
| Quick switch | ✅ | ✅ | OK |
| **Severity** | — | — | 🟡 **Medium** |

---

## 11. Store & Profile Settings

### Store (`settings/store`)
- **Near parity.** Both have logo upload, name, phone, address, website, preview card.
- 🟢 **Low** gap.

### Profile (`settings/profile`)
- **Near parity.** Both have identity management, profile metadata, login methods, key generation.
- Svelte adds avatar file upload and key download (nice UX touches).
- 🟢 **Low** gap.

### General (`settings/general`)
- **Near parity.** Both have language, currency, tax, payment options, sound, auto-print, compact mode.
- 🟢 **Low** gap.

---

## 12. Orders

### 12.1 Route Parity
| Route | Nuxt | Svelte | Status |
|-------|------|--------|--------|
| List | ✅ | ✅ | ✅ |
| Create | ✅ | ✅ | ✅ |
| Detail `[id]` | ✅ | ✅ | ✅ |
| Edit `[id]/edit` | ✅ | ✅ | ✅ |

🟢 **Low** gap.

---

## 13. Transactions / Shifts

| Feature | Nuxt | Svelte | Severity |
|---------|------|--------|----------|
| Shift list | ✅ (composable) | ✅ (shifts page) | OK |
| Open/close shift | ✅ (from POS) | ✅ (shifts page) | OK |
| Cash events | ✅ (from POS) | ✅ (shifts page) | OK |
| Transaction detail | ✅ | ✅ | OK |
| PIN-protected shift | ✅ | ❌ | 🟡 Medium |

---

## 14. Restaurant

| Page | Nuxt | Svelte | Status |
|------|------|--------|--------|
| Kitchen display | ✅ | ✅ | ✅ |
| Queue | ✅ | ✅ | ✅ |
| Tables | ✅ | ✅ | ✅ |
| Waiter | ✅ | ✅ | ✅ |

🟢 **Low** gap — all 4 restaurant pages exist.

---

## 15. Setup Wizard

| Step | Nuxt | Svelte | Status |
|------|------|--------|--------|
| Index/welcome | ✅ | ✅ | ✅ |
| Identity | ✅ | ✅ | ✅ |
| Company | ✅ | ✅ | ✅ |
| Branch | ✅ | ✅ | ✅ |
| Catalog | ✅ | ✅ | ✅ |
| POS | ✅ | ✅ | ✅ |
| Relays | ✅ | ✅ | ✅ |
| Review | ✅ | ✅ | ✅ |
| Done | ✅ | ✅ | ✅ |

🟢 **Low** gap — full parity on wizard steps.

---

## Priority Summary

### 🔴 Critical (blocks core operations)
1. **Payment Methods** — no custom method CRUD, only 4 hardcoded toggles
2. **POS Shift Gate** — no shift requirement to start selling
3. **POS Custom Item** — cannot add ad-hoc items to cart
4. **Reports** — no date range, no summary cards, no charts beyond basic bar
5. **Promotions** — only basic percent discount; no BOGO, schedule, limits, or product targeting

### 🟡 Medium (functional gaps that should be filled)
6. Receipt — missing logo, tax ID, QR code, and visibility toggles
7. Appearance — missing accent color picker
8. Data — missing import/restore
9. Branches — missing edit + address/phone/email fields
10. Inventory — missing stock overview tab and stock counts
11. Customers — missing address, notes, npub, segment; no edit
12. Expenses — missing date picker, status workflow, receipt URL; no edit
13. Staff — missing stats, role filter, pubkey field, edit; PIN not hashed
14. Organization — missing code availability checker and encryption
15. POS History modal — can't see recent orders from POS
16. POS Cash event shortcut — can't do cash in/out without leaving POS
17. Payment sound — no audio feedback on successful payment

### 🟢 Low (polish / nice-to-have)
18. Catalog bundles tab
19. Customer order count / total spend display
20. Permission-gated feature toggles
21. Export staff CSV
22. POS quick settings modal

---

## Recommendations (ordered)

1. **Promotions rewrite** — port the Nuxt form with type selector, BOGO, schedule, limits, product/category picker
2. **Reports upgrade** — add date range selector, summary stat cards, payment breakdown pie, hourly sales chart, CSV export
3. **Payment Methods CRUD** — replace hardcoded toggles with a CRUD list + dialog form
4. **POS shift gate** — require open shift before allowing checkout; add indicator in POS header
5. **POS custom item** — add "custom item" button that creates an ad-hoc cart line with name + price
6. **Receipt settings** — add logo, tax ID, QR, and per-field visibility toggles
7. **Customer form expansion** — add address, notes, npub, segment; add edit action
8. **Expenses form expansion** — add date picker, status workflow, vendor, receipt URL; add edit action
9. **Staff improvements** — add stats, role filter, pubkey, edit; hash PINs
10. **Inventory overview** — add stock dashboard tab and stock counts tab
