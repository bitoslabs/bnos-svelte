# Staff Management Feature Audit

**Date:** 2026-08-03  
**Project:** bnos-svelte  
**Reference:** bdgo-os-nuxt  

---

## 1. What Exists and Works

### 1.1 Authentication (`src/routes/login/+page.svelte`)
- ✅ NIP-07 browser extension login
- ✅ nsec private key login
- ✅ Account generation with backup flow (generate → backup → confirm → login)
- ✅ Session persistence to localStorage via `@bitos/bnos-core` canonical keys
- ✅ Relay configuration popover on login screen
- ✅ Theme toggle on login screen

### 1.2 Session Store (`src/lib/nostr/session.svelte.ts`)
- ✅ `loginWithNsec()`, `loginWithExtension()`, `generateAccount()`, `logout()`
- ✅ `isAuthenticated`, `pubkey`, `npub`, `shortNpub`, `loginMethod` getters
- ✅ Hydration from localStorage on mount
- ✅ NIP-07 signer exposure for event signing

### 1.3 Tenant Context (`src/lib/nostr/tenant.svelte.ts`)
- ✅ Organization ID, name, code
- ✅ Business model (`single`, `multi_branch`, `chain`, etc.)
- ✅ Business type (`retail`, `restaurant`, `cafe`, etc.)
- ✅ Location/branch ID and name
- ✅ Currency, tax rate, tax-inclusive flag
- ✅ `setupComplete` flag
- ✅ `restaurantEnabled` and `isMultiLocation` computed getters
- ✅ Workspace resolution from local + relay on login (`workspace.svelte.ts`)

### 1.4 Staff Page (`src/routes/staff/+page.svelte`)
- ✅ List staff with grid and table views
- ✅ Add/edit/delete staff (CRUD)
- ✅ Fields in form: name, role, email, phone, PIN, npub, hourlyRate
- ✅ Role filter dropdown (owner, manager, cashier, waiter, chef, stock)
- ✅ Stats cards: total, active, inactive, roles breakdown
- ✅ Search, sort (name, role, status), pagination
- ✅ Status indicator dot on cards
- ✅ Raw data viewer dialog
- ✅ Npub validation (must start with `npub1`)
- ✅ Nostr sync via `dataSync.pageSync([TYPE.staff])` on mount

### 1.5 Staff Type (`src/lib/domain/types.ts`)
- ✅ `Staff` interface with fields: `name`, `role`, `status`, `displayName`, `email`, `phone`, `avatar`, `pubkey`, `npub`, `companyId`, `companyName`, `companyCode`, `customPermissions`, `branchIds`, `employeeCode`, `department`, `hireDate`, `pinHash`, `pin`, `hourlyRate`
- ✅ `UserRole` type: `owner`, `manager`, `cashier`, `waiter`, `chef`, `stock`
- ✅ `StaffStatus` type: `active`, `inactive`, `suspended`, `on_leave`, `terminated`

### 1.6 Layout & Navigation
- ✅ Auth guard in `+layout.svelte`: redirects unauthenticated users to `/login`
- ✅ Redirects to `/setup` if tenant workspace not found
- ✅ Sidebar navigation with Staff link under Administration
- ✅ Mobile bottom tab bar
- ✅ "Checking workspace" loading overlay during workspace resolution

---

## 2. What's Missing (Gaps)

### 2.1 🔴 CRITICAL: No Permission System

**bdgo-os-nuxt has:** A full RBAC system in `app/composables/usePermissions.ts`:
- `ROLE_DEFAULTS` mapping for 11 roles (owner, admin, manager, cashier, waiter, warehouse, viewer, franchise_owner, customer, supplier, delivery)
- `can(resource, action)` function checking role defaults + custom permission overrides
- `canAccessBranch(branchId)` for branch-scoped access control
- `requirePermission()` that throws on denial
- Permission resources: `pos`, `orders`, `products`, `customers`, `inventory`, `staff`, `reports`, `settings`, `payments`, `refunds`, `discounts`, `accounting`, `marketplace`, `suppliers`, `purchase_orders`, `all`
- Permission actions: `read`, `write`, `delete`, `approve`, `export`
- Permission scopes: `global`, `branch`, `department`, `own`

**bnos-svelte has:** Nothing. All buttons and routes are visible to all authenticated users.

**Impact:** Any logged-in user can add/edit/delete staff, change settings, access all areas. No access control whatsoever.

### 2.2 🔴 CRITICAL: No Active Role / Staff Resolution

**bdgo-os-nuxt has:** `useTenantContext` with `activeRole`, `activeStaffId`, `activeBranchId`, `activeStaffInfo` — all persisted to localStorage. On login, the `resolve.vue` page + `useMemberships.ts` composable:
1. Finds staff records matching the logged-in pubkey
2. Auto-resolves company/branch/role if user has exactly one
3. Redirects to `/workspace` selector if multiple
4. Redirects to `/blocked` if suspended/inactive
5. Sets `activeStaff` (which sets `activeRole`) for permission checks

**bnos-svelte has:** `tenant.svelte.ts` stores organization/location info but has **no** `activeRole`, `activeStaffId`, `activeStaffInfo`. The workspace resolution (`workspace.svelte.ts`) only checks for organization/location GLO records — it does **not** match the logged-in npub to staff records.

**Impact:** The app cannot determine WHO you are within the organization, WHAT role you have, or WHICH branch you belong to. This makes permission checks impossible.

### 2.3 🔴 CRITICAL: No Login → Staff Matching Flow

**bdgo-os-nuxt has:** A `/resolve` page that:
1. Bootstraps data from relays for the current user's pubkey
2. Waits for staff records to arrive
3. Matches `auth.pubkey` against `staff.pubkey` to find memberships
4. Auto-selects company/branch/role if only one option
5. Routes to workspace selector or setup if ambiguous

**bnos-svelte has:** After login, `+layout.svelte` only resolves workspace (org/location GLO records). There is no staff matching step — the app never looks up the logged-in pubkey in the staff collection.

### 2.4 🟡 HIGH: Staff Form Missing Fields

**bdgo-os-nuxt staff form includes these fields that bnos-svelte's form is missing:**

| Field | bdgo-os-nuxt | bnos-svelte | Notes |
|-------|:---:|:---:|-------|
| name | ✅ | ✅ | |
| displayName | ✅ | ❌ | Type has it, form doesn't |
| role | ✅ | ✅ | bnos-svelte missing `admin`, `viewer`, `warehouse` roles |
| email | ✅ | ✅ | |
| phone | ✅ | ✅ | |
| pubkey/npub | ✅ (required) | ✅ (optional) | bdgo-os requires pubkey; bnos-svelte makes it optional |
| companyId | ✅ (required) | ❌ | Not in form at all |
| employeeCode | ✅ | ❌ | Type has it, form doesn't |
| department | ✅ | ❌ | Type has it, form doesn't |
| status | ✅ (5 statuses) | ❌ (hardcoded `active`) | Cannot change status after create |
| branchIds | ✅ (checkbox list) | ❌ | Type has it, form doesn't |
| customPermissions | ✅ (full UI) | ❌ | Type has it, form doesn't |
| pinHash | ✅ (hash + set/remove) | ❌ (plaintext PIN) | bnos-svelte stores raw PIN, no hashing |
| hourlyRate | ❌ | ✅ | bnos-svelte extra (not in bdgo-os staff form) |
| avatar | ✅ (type) | ❌ | Neither form has avatar upload |

### 2.5 🟡 HIGH: No Permission-Gated UI

**bdgo-os-nuxt** gates every action button with `v-if="can(...)"`:
- `can('staff', 'write')` — add/edit buttons
- `can('staff', 'delete')` — delete buttons
- `can('staff', 'read')` — page access (redirects if denied)
- `can('settings', 'write')` — export button, settings changes
- Same pattern across ALL settings pages (organization, branches, relays, receipt, store, general)

**bnos-svelte** shows all buttons (Add, Edit, Delete) to every authenticated user with zero gating.

### 2.6 🟡 HIGH: Staff Status Cannot Be Changed

**bdgo-os-nuxt** form has 5 status buttons: Active, Inactive, Suspended, On Leave, Terminated. Staff can be transitioned between any status.

**bnos-svelte** `save()` function hardcodes `status: 'active'` on both create and edit. There is no status field in the form. The type supports all 5 statuses, and the stats card counts active vs inactive, but there's no way to actually change a staff member's status.

### 2.7 🟠 MEDIUM: No Role-Based Route Guards

**bdgo-os-nuxt** checks `can('staff', 'read')` on the staff page `onMounted` and redirects to `/settings/profile` if denied. Same pattern on every settings page.

**bnos-svelte** has no per-route permission checks. The only guard is authentication (redirect to `/login` if not signed in).

### 2.8 🟠 MEDIUM: Missing Roles in UserRole Type

**bdgo-os-nuxt** `UserRole` includes 11 roles: `customer`, `cashier`, `waiter`, `manager`, `admin`, `owner`, `viewer`, `supplier`, `warehouse`, `delivery`, `franchise_owner`.

**bnos-svelte** `UserRole` includes only 6: `owner`, `manager`, `cashier`, `waiter`, `chef`, `stock`. Notably missing: `admin`, `viewer`, `warehouse`, `supplier`, `delivery`, `franchise_owner`. Also includes `chef` and `stock` which bdgo-os does not have.

### 2.9 🟠 MEDIUM: No Staff Export

**bdgo-os-nuxt** has an "Export Staff" button that exports staff keys backup as a `.txt` file via `exportStaffKeysTxt()`. This is important for key management — if an owner generates keys for staff, they need to back them up.

**bnos-svelte** has no export functionality.

### 2.10 🟠 MEDIUM: No Key Generation/Management for Staff

**bdgo-os-nuxt** staff form has:
- "Generate" button to create a new keypair for a staff member
- nsec display with show/hide/copy and a backup warning
- `saveStaffKey()` / `findStaffKeyByPubkey()` / `removeStaffKey()` in localStorage
- Key stored indicator on staff cards

**bnos-svelte** staff form accepts an npub but has no key generation, no key backup display, no key storage management.

### 2.11 🟠 MEDIUM: No PIN Hashing

**bdgo-os-nuxt** hashes PINs before storing: `hashPin(staffForm.pin)` → `pinHash`. The form has a dedicated "Set PIN" / "Remove PIN" flow separate from the main save.

**bnos-svelte** stores the PIN as plaintext in the `pin` field. No hashing. The `pinHash` field exists in the type but the form never uses it.

### 2.12 🟡 LOW: No Company Selector in Staff Form

**bdgo-os-nuxt** form has a required company selector dropdown — staff must belong to a company.

**bnos-svelte** form has no company field. Staff records are implicitly scoped by the GLO scope (organization ID), but the `companyId` field on the Staff type is never populated from the form.

### 2.13 🟡 LOW: No Branch Assignment in Staff Form

**bdgo-os-nuxt** form has a branch checkbox list filtered by the selected company. Staff can be assigned to one or more branches.

**bnos-svelte** form has no branch assignment. The `branchIds` field on the Staff type is never populated.

### 2.14 🟡 LOW: No Permission Preview / Customization UI

**bdgo-os-nuxt** form shows:
- A live permission preview based on the selected role
- A "Customize Permissions" toggle that switches from role defaults to a per-resource, per-action checklist
- Available resources: pos, orders, products, customers, inventory, staff, reports, settings, payments, refunds, discounts — each with read/write/delete/approve actions

**bnos-svelte** has nothing — no way to see or customize permissions.

### 2.15 🟡 LOW: No Suspended/Blocked User Handling

**bdgo-os-nuxt** checks staff status on login resolve:
- Suspended/inactive users → redirect to `/blocked`
- No active staff records → redirect to `/setup` (to create organization)

**bnos-svelte** has no such checks.

---

## 3. Specific Files That Need Changes

### New Files to Create

| File | Purpose |
|------|---------|
| `src/lib/permissions.svelte.ts` | Port of `usePermissions.ts` — `ROLE_DEFAULTS`, `can()`, `canAccessBranch()`, `requirePermission()` |
| `src/lib/staff-resolution.svelte.ts` | Port of `useMemberships.ts` — match logged-in pubkey to staff records, auto-resolve company/branch/role |
| `src/routes/resolve/+page.svelte` | Post-login resolution page (sync data, match staff, set active context, redirect) |
| `src/routes/workspace/+page.svelte` | Multi-workspace selector (if user belongs to multiple companies/branches) |
| `src/routes/blocked/+page.svelte` | "You are suspended" page |
| `src/lib/utils/pin.ts` | PIN hashing utility |

### Existing Files to Modify

| File | Changes Needed |
|------|----------------|
| `src/lib/domain/types.ts` | Expand `UserRole` to include `admin`, `viewer`, `warehouse` (align with bdgo-os). Consider adding `supplier`, `delivery`, `franchise_owner` if needed. |
| `src/lib/nostr/tenant.svelte.ts` | Add `activeRole`, `activeStaffId`, `activeBranchId`, `activeStaffInfo` to `TenantContext`. Add `setActiveStaff()`, `setActiveBranch()` methods. Persist to localStorage. |
| `src/lib/nostr/session.svelte.ts` | After login, trigger staff resolution flow. May call into `staff-resolution.svelte.ts`. |
| `src/routes/+layout.svelte` | Add post-login staff resolution step (similar to workspace resolution). Check `activeRole` is set before allowing access. Redirect suspended users. |
| `src/routes/staff/+page.svelte` | Major rework: (1) Add permission gates (`can('staff', 'write')`, `can('staff', 'delete')`). (2) Add missing form fields: displayName, status selector, employeeCode, department, companyId, branchIds, customPermissions. (3) Add PIN hashing flow. (4) Add key generation + backup display. (5) Add staff export button. (6) Add permission preview UI. (7) Remove hardcoded `status: 'active'`. |
| `src/routes/+layout.svelte` (or `src/routes/+layout.ts`) | Consider adding per-route permission guards (SvelteKit hooks or in-layout `$effect`). |
| `src/lib/nav.ts` | Optionally gate nav items by permission (hide Staff link if `!can('staff', 'read')`). |

---

## 4. Recommended Implementation Order

### Phase 1: Foundation (prerequisite for all other work)

1. **Expand `UserRole` type** — Align with bdgo-os-nuxt's 11 roles. Update the `ROLES` array in the staff page.
2. **Extend `TenantContext`** — Add `activeRole`, `activeStaffId`, `activeBranchId`, `activeStaffInfo` fields with localStorage persistence. Add `setActiveStaff()`, `setActiveBranch()`, `setActiveCompany()` methods.
3. **Create `permissions.svelte.ts`** — Port `ROLE_DEFAULTS`, `can()`, `canAccessBranch()`, `requirePermission()`. Wire it to read from the extended tenant context.

### Phase 2: Login → Staff Resolution

4. **Create `staff-resolution.svelte.ts`** — Port `useMemberships` logic: find staff by pubkey, resolve company/branch/role, auto-select if single option.
5. **Create `/resolve` page** — Post-login flow that syncs data, waits for staff records, auto-resolves or redirects to workspace selector.
6. **Update `+layout.svelte`** — After workspace resolution, also run staff resolution. Redirect to `/resolve` or `/workspace` as needed. Block suspended users.

### Phase 3: Staff Page Rework

7. **Add missing form fields** — displayName, employeeCode, department, status selector (5 states), companyId selector, branchIds checkboxes.
8. **Fix status management** — Remove hardcoded `status: 'active'`. Use the selected status from the form on both create and edit.
9. **Add PIN hashing** — Create `pin.ts` utility. Replace plaintext PIN field with set/remove PIN flow.
10. **Add key generation** — Generate keypair button, nsec backup display with warning, key storage management.

### Phase 4: Permission-Gated UI

11. **Gate staff page** — Wrap Add/Edit/Delete buttons in `can('staff', 'write')` / `can('staff', 'delete')` checks. Add `can('staff', 'read')` guard on mount.
12. **Gate all other pages** — Apply `can(resource, action)` checks across settings, catalog, inventory, orders, etc.
13. **Gate navigation** — Hide nav items the user doesn't have permission to access.
14. **Add permission preview UI** — Show role permissions in the staff form. Add custom permissions toggle and checklist.

### Phase 5: Polish

15. **Add staff export** — Export staff + keys backup as `.txt` file.
16. **Add suspended/blocked page** — `/blocked` route for suspended users.
17. **Add workspace selector** — `/workspace` route for multi-company/branch users.
18. **Add audit logging** — (Optional, bdgo-os has Kind 30502 audit trail; may be future scope).

---

## 5. Summary

The bnos-svelte staff page is a functional CRUD list with good UX (grid/table views, search, stats, pagination). The domain types are well-aligned with bdgo-os-nuxt's model. However, the app is missing the entire **access control layer** that makes the staff feature meaningful in a multi-user, role-based POS system:

- No way to determine the current user's role (no staff resolution)
- No permission checks anywhere (no `can()` function)
- No way to manage staff status, branch assignments, or custom permissions
- No route guards beyond authentication
- No key management or PIN hashing for POS security

The permission system and staff resolution flow are the two highest-priority gaps — they are prerequisites for safely running the app in a real multi-user environment. Everything else builds on top of them.
