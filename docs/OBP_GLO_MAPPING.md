# GLO ↔ OBP field mapping (v0.1)

Status: implemented as read-only helpers in `src/lib/obp-adapter/mapping.ts` behind the `obp` feature flag (`src/lib/features.svelte.ts`, default **off**). GLO records keep their original ids and kinds; the only join is the `obpDocumentId ↔ localRecordId` link store (`src/lib/obp-adapter/links.ts`).

## supplier → counterparty directory

| GLO `supplier`                                                   | OBP `ObpOrganization` | Notes                                              |
| ---------------------------------------------------------------- | --------------------- | -------------------------------------------------- |
| `pubkey`                                                         | `ownerPubkey`         | Supplier without `pubkey` → **unmapped**, skipped. |
| `name`                                                           | `name`                |                                                    |
| — (assigned)                                                     | `orgId`               | Pilot org ids are preconfigured, not discovered.   |
| `currency`, `paymentTerms`, `leadTimeDays`, `minimumOrderAmount` | —                     | No v0.1 equivalent; stay local.                    |

## purchase-order (draft) → rfq

| GLO `purchase-order`          | OBP `rfq` envelope       | Notes                                             |
| ----------------------------- | ------------------------ | ------------------------------------------------- |
| `lines[].productName \| name` | `lines[].description`    | Fallback chain; last resort `productId`.          |
| `lines[].quantity`            | `lines[].quantity`       | Rounded to integer units.                         |
| `lines[].unitPrice`           | `lines[].unitPriceMinor` | Major units → minor units via currency precision. |
| `currency`                    | `currency`               | Uppercased; must be registered.                   |
| `taxAmount`                   | `taxMinor`               | Optional, explicit.                               |
| `shippingCost`                | `shippingMinor`          | Optional, explicit.                               |
| `notes`                       | `note`                   | Human-readable only, not a contract term.         |
| `orderedAt` + 7d              | `expiresAt`              | RFQ validity window.                              |
| `number`                      | —                        | Stays local; linked via the link store.           |

## commerce.payment → payment_evidence.settlement

| GLO `commerce.payment`                   | OBP `ObpSettlement`                                                               | Notes                                                |
| ---------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `method: 'lightning'`                    | `method: 'lightning'`, `externalId = paymentHash`, `detail = preimage:<preimage>` | Verifiable by the settlement verifier.               |
| `method: 'cash'`                         | `method: 'manual'`, `detail: 'cash'`                                              | Honest manual evidence; still requires verification. |
| `method: bank_transfer / mobile_payment` | `method` passthrough, `externalId = reference`                                    |                                                      |
| `amount`, `currency`                     | `totalsMinor`                                                                     | Minor-unit conversion; fail closed on sub-unit LAK.  |

## invoice (OBP) → local payment view (shadow, read-only)

| OBP invoice projection                          | Local view field          |
| ----------------------------------------------- | ------------------------- |
| `documentId`                                    | `obpDocumentId`           |
| `issuer`                                        | `counterparty`            |
| `currency`, `totalsMinor`                       | `currency`, `amountMinor` |
| `settlement` (`unpaid/pending/verified/failed`) | `settlement`              |
| link store                                      | `localRecordId`           |

## Deliberately not mapped in v0.1

- **Inventory balances / adjustments** — stock stays local; the shared movement ledger is a later extension per the system plan.
- **`commerce.order`** — retail POS orders are not bilateral OBP documents; only the purchasing slice maps.
- **Marketplace listings** — public offers are a later discovery extension with explicit visibility policy (see below).

## Marketplace visibility (not an OBP flow)

OBP purchasing and the marketplace are separate paths and do not share events:

|            | OBP purchasing                                            | Marketplace                                                               |
| ---------- | --------------------------------------------------------- | ------------------------------------------------------------------------- |
| Direction  | Bilateral (buyer node ↔ seller node)                      | Public discovery (seller → any buyer)                                     |
| Transport  | Kind 21099, NIP-44 encrypted, `p`-tagged to the recipient | GLO `marketplace.product` / `.connection` / `.review` (30951/30953/30955) |
| Visibility | Confidential; relays are not expected to store it         | `visibility: "public"` only                                               |
| Source     | `src/lib/obp`, `src/lib/obp-adapter`                      | `bnos-svelte` marketplace pages → `bnos-marketplace` read path            |

Nothing in the OBP node or adapter publishes to the marketplace (there are no
`marketplace` references in `src/lib/obp` or `src/lib/obp-adapter`). An OBP
RFQ, quote, purchase order, invoice, or receipt will **not** appear as a shop or
listing.

For a shop or listing to appear on the marketplace, the console must publish a
public catalog record — `visibility: "public"`, a non-empty `name` /
`productName`, and `price` ≥ 0, with `status: "active"` for browse. The full
acceptance rules live in
[`bnos-marketplace/docs/CONTRACTS.md` § Visibility and purchase gating](../../bnos-marketplace/docs/CONTRACTS.md#visibility-and-purchase-gating).

Public OBP offers (discovery) remain a later extension; when added, they must
define their own visibility policy rather than reusing the confidential
purchasing documents.
