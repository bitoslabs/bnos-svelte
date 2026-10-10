# Open Business Protocol: system design and migration plan

Status: proposal, 2026-10-06. Source idea: [idea.md](idea.md). This document describes a target architecture and implementation gates; it does not claim that OBP is already implemented.

For diagrams and a one-page system map, start with [OBP_OVERVIEW.md](OBP_OVERVIEW.md).

## Recommendation

Build one narrow, interoperable purchasing flow before defining a broad protocol. Keep **OBP** as a transport-neutral, versioned business message contract; **Business Node** as a durable runtime that enforces it; and **BNOS Console** as a client and adapter for existing merchant records. Start with two independently operated nodes exchanging RFQ → quote → purchase order → invoice → payment evidence → receipt. Make payment manual or simulated in the first interoperability test, then add verified Lightning settlement. Do not give an AI agent signing or wallet authority in v0.1.

The strongest part of the idea is the separation of protocol from application. The main risk is assuming today's local GLO records and relay sync already provide delivery, authorization, immutable history, or financial finality. They do not provide those guarantees by themselves.

## Current system and gaps

| Existing capability                                             | Evidence in this repo                                                                         | Gap for OBP                                                                                                             |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Local GLO collections and offline publish retry                 | `src/lib/nostr/store.svelte.ts` persists collections in IndexedDB and queues failed publishes | Queue coalesces by `type:id`, suitable for current record updates but not an immutable document/event outbox.           |
| Nostr identity, signing and relay transport                     | `src/lib/nostr/session.svelte.ts`, `src/lib/nostr/client.ts`                                  | A key or relay event alone does not establish an organization's authority or a recipient's acceptance.                  |
| Org encryption and grants                                       | `src/lib/crypto/`                                                                             | Existing GLO publication can fall back to plaintext when encryption fails. Confidential OBP documents must fail closed. |
| Supplier, purchase order, inventory adjustment, payment records | `src/lib/domain/types.ts`, `src/lib/domain/kind.ts`                                           | These are internal records, not signed bilateral documents or stock ledger events.                                      |
| Role permissions                                                | `src/lib/permissions.svelte.ts`                                                               | Client-side UI permissions are not a server-side policy boundary for autonomous purchases or payments.                  |
| Marketplace listings and orders                                 | `src/lib/domain/marketplace.ts`, `src/lib/domain/types.ts`                                    | A public listing is not an RFQ/quote commitment; channel integration and OBP discovery need distinct semantics.         |

`docs/MARKETPLACE_PLAN.md` describes an earlier marketplace design. Current `domain/kind.ts` and `types.ts` use dedicated marketplace kinds; do not use that plan's earlier 30078 mapping as a migration source. The README also describes localStorage persistence, while current GLO collections use IndexedDB. Verify actual code when implementing.

## System boundaries

```text
BNOS Console ── adapter ── Business Node A ── OBP messages ── Business Node B
  POS / GLO                 policy, durable outbox      independent storage
  existing records         inbox, documents, audit    and keys
                                   │
                            Nostr or HTTP transport
                                   │
                         wallet / blob store adapters
```

- **OBP specification** owns envelope schemas, canonical serialization/signature rules, state machines, error codes, conformance fixtures and transport bindings. It must have no dependency on Svelte or BNOS-specific GLO types.
- **Business Node** owns local durable storage, append-only inbox/outbox, deduplication, authorization, policy, projections, retries and audit. A relay acknowledgement means transport accepted a message; the buyer/seller application must separately accept or reject it.
- **BNOS adapter** maps current GLO `supplier`, `purchase-order`, `commerce.order`, `commerce.payment` and inventory records to local views/workflows. It never changes existing kind assignments just to fit OBP. Keep a stable `obpDocumentId ↔ localRecordId` mapping.
- **Transport adapters** carry the same canonical signed payload over Nostr or HTTPS. Transport metadata is outside the signed business payload. Nostr kinds, tags, recipient routing and encryption are a binding to specify and test, not assumptions in the core document schema.
- **Wallet and files** are separate adapters. A payment request is not proof of payment; a hash/reference to a blob is not a guarantee that recipients can retrieve it.

## OBP v0.1 contract

Use a deliberately small set of document types: `rfq`, `quote`, `purchase_order`, `invoice`, `payment_evidence`, `receipt`. Discovery can initially use a configured supplier directory; public search and shipment are later extensions. Keep inventory changes local to each node during this slice.

Every signed message needs: `protocol` (`obp`), `version`, globally unique `messageId`, `documentId`, `documentType`, `action`, issuer organization and signing key IDs, intended recipient organization, creation and expiry times, currency, line items with quantity/unit/unit price, integer minor-unit totals, references to prior document IDs/hashes, payload hash and signature. Define a canonical JSON/byte encoding and signature verification before any transport adapter. Specify currency precision per currency; do not assume a fixed decimal count or treat LAK, THB and BTC amounts as interchangeable. Put tax, shipping and exchange-rate terms in explicit fields when supported; reject unknown required terms rather than silently dropping them.

State changes should be append-only messages referencing a document, never an overwritten `status` field. A recipient verifies schema version, signature, issuer delegation, audience, expiry, referenced hash, allowed transition and replay/idempotency before accepting. Persist the inbound message and decision atomically; reply with a signed acceptance/rejection carrying `correlationId`. Duplicates return the same decision. Define cancellation as a new state transition with party/clock rules. Corrections to invoices and receipts need reversal or superseding documents, never deletion.

For private RFQs, quotes and invoices, encrypt to the intended recipients and **fail closed** if keys or encryption are unavailable. Public offers may be plaintext only by explicit visibility policy. Store PDFs/images separately using content hash, size, MIME type, access controls and retention policy; the document remains usable without a PDF. Do not put personal data, wallet secrets or channel API tokens in public relay events.

### Minimum lifecycle

| Step             | Required acceptance check                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| RFQ              | Supplier identity and recipient routing verified; requested items and expiry valid.                                |
| Quote            | References accepted RFQ; price, currency, validity and delivery terms explicit.                                    |
| Purchase order   | References valid quote; buyer policy authorizes the amount and signer.                                             |
| Invoice          | References accepted order; seller authorization and totals verified.                                               |
| Payment evidence | References invoice and external settlement identifier; verify against trusted wallet/provider before marking paid. |
| Receipt          | Seller signs only after verified settlement; buyer verifies invoice and payment references.                        |

## Identity and policy

Use organization identity plus scoped signing credentials for humans, devices and services. Record grants with scope, limits, validity, revocation and key rotation; verify them at the Business Node on every incoming and outgoing action. Define how counterparties learn a trusted org key and changes to it. A Nostr pubkey is a signing key, not a legal company identity by itself. Staff permissions already in the UI can guide UX but cannot be reused as the sole authorization check.

Policy evaluation returns `allow`, `deny` or `requires_approval`, with a signed decision record and reason. Amount limits must state currency and conversion source; enforce daily budgets atomically across devices. For v0.1, humans sign purchase orders and approve every payment. Later, agents may draft RFQs, compare quotes and propose orders; scoped service credentials can be considered only after audit, revocation, spending limits and approval workflows are proven. Never expose master keys or an unrestricted wallet connection to an agent.

## Inventory: defer the shared ledger

The idea correctly avoids syncing a mutable stock balance as a global truth. However, summing `+100/-3/...` events is safe only after each movement has a stable ID, location, unit, source document, causality, correction rule and exactly-once local application. Offline multi-device sales can still oversell; an append-only ledger does not prevent that on its own. Keep existing inventory projections during the first purchasing flow. Later, introduce a local stock-movement ledger per location and reconcile projected balances against current `inventory.adjustment`/order data. For external offers, publish an availability promise or reservation with expiry, not the raw internal balance.

## Migration sequence

1. **Baseline and mapping.** Inventory the active GLO kinds/fields, keys, relay visibility, sensitive records and current order/payment flows. Document field-by-field mappings and loss/ambiguity. Export a recoverable snapshot before any migration. Do not rewrite historical relay events.
2. **Contract and fixtures.** Draft schemas, canonical signing, lifecycle, authorization model and two independent conformance fixtures (valid exchange and rejected/replayed exchange). Publish a versioned compatibility policy. Keep the contract in a separate package/repo only once the first fixture and review are stable; start as a clearly isolated package if repository split would delay validation.
3. **Node foundation.** Build durable inbox/outbox, idempotency table, encrypted document storage, policy decisions and audit log. Treat publish retries separately from business acceptance. Make crash/restart, duplicate delivery and out-of-order references deterministic.
4. **Two-node vertical slice.** Run two nodes with separate databases, keys and transport settings. Complete the RFQ-to-receipt flow with explicit human approvals and simulated/manual payment evidence. Test both Nostr and HTTP bindings against the same contract only after one binding works end to end.
5. **BNOS integration.** Add an adapter behind a feature flag. Import supplier and product references as mappings, show inbound documents, and create/update local purchase-order and payment views from accepted OBP messages. Preserve old data and UX. Use a shadow read-only projection first, compare counts and totals, then enable new writes for a pilot organization.
6. **Verified payment and inventory.** Add wallet/provider verification, invoice matching, amount/currency checks and settlement reconciliation. Add stock movement projection with a separate migration/reconciliation plan. Roll out approval policy and agent drafting last.

For each stage, include schema version handling and rollback. On a failed pilot, disable OBP writes and return to existing GLO workflows; retain signed OBP messages and mapping records for audit. Do not delete or silently remap old objects. Backfill should be deterministic and idempotent, with a report of unmapped fields and records.

## Go/no-go checks for the pilot

- Two independently configured nodes complete the full flow without sharing a database or calling each other's internal application API.
- Both reject bad signatures, unknown/revoked signers, wrong recipient, expired quote, replayed ID, invalid transition and mismatched document hash.
- A node restart or offline interval cannot lose accepted messages or create duplicate orders, invoices, payments or receipts.
- Confidential documents never publish as plaintext when encryption fails.
- Payment state stays pending until settlement is independently verified; duplicate or partial payments have explicit handling.
- Pilot BNOS records retain their original IDs/kinds, totals reconcile, and switching the feature off restores the prior workflow.

## Decisions to resolve before implementation

1. Who operates the first two nodes, and is their trust relationship preconfigured or discovered? Recommend preconfigured pilot counterparties.
2. Which transport is first? Recommend Nostr if relay interoperability is the immediate goal; choose HTTP first if controlled delivery and operational debugging are more valuable. The contract remains identical.
3. Which legal/tax invoice requirements apply in Laos and Thailand? Confirm with local counsel/accounting before claiming invoices are compliant. Treat cross-border FX, customs and logistics as later scopes.
4. What exactly counts as final payment evidence for the chosen wallet/provider? Specify a verifiable settlement source before enabling automatic receipts.

## Near-term deliverables

First write `obp-v0.1` schemas and example signed exchanges, a GLO-to-OBP mapping table, and a two-node test harness. Then implement the durable node core and one transport. This sequence gives a concrete interoperability proof while keeping the existing BNOS Console usable throughout migration.
