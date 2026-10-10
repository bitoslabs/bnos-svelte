# OBP v0.1 normative specification

Status: implemented, 2026-10-07. Reference implementation: `src/lib/obp` (contract, identity, lifecycle, policy, node) and `src/lib/obp-adapter` (BNOS mapping). Conformance fixtures: `src/lib/obp/two-node.test.ts` and `src/lib/obp/contract.test.ts`.

This document closes the "still to specify" list in [OBP_OVERVIEW.md](OBP_OVERVIEW.md): exact schemas, canonical signature bytes, trust/delegation format, transport bindings, conformance fixtures and the GLO field mapping ([OBP_GLO_MAPPING.md](OBP_GLO_MAPPING.md)).

## 1. Envelope schema

Every signed message is a JSON object with exactly these fields. Unknown fields are ignored on read but excluded from canonical bytes.

| Field                        | Type              | Rules                                                                                                                                                   |
| ---------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `protocol`                   | string            | Must be `obp`.                                                                                                                                          |
| `version`                    | string            | Must be `0.1`.                                                                                                                                          |
| `messageId`                  | string            | Globally unique (UUID); the idempotency key.                                                                                                            |
| `documentId`                 | string            | Document this message belongs to; the append-only log key.                                                                                              |
| `documentType`               | enum              | `rfq` \| `quote` \| `purchase_order` \| `invoice` \| `payment_evidence` \| `receipt`.                                                                   |
| `action`                     | enum              | `issue` \| `accept` \| `reject` \| `cancel`.                                                                                                            |
| `issuer`                     | string            | Issuing organization id (`org:…`).                                                                                                                      |
| `signerKeyId`                | string            | Grant id resolving the signing key to the issuer org.                                                                                                   |
| `signerPubkey`               | hex(64)           | Schnorr pubkey of the signing key.                                                                                                                      |
| `recipient`                  | string            | Intended recipient organization id.                                                                                                                     |
| `createdAt`                  | ISO-8601          | Message creation time.                                                                                                                                  |
| `expiresAt`                  | ISO-8601          | Must be after `createdAt`.                                                                                                                              |
| `currency`                   | string            | Registered in the currency precision table (§2).                                                                                                        |
| `lines`                      | array             | Required non-empty for `issue` of goods types; each line has `description`, positive integer `quantity`, `unit`, non-negative integer `unitPriceMinor`. |
| `totalsMinor`                | integer           | Must equal Σ `quantity × unitPriceMinor` when lines exist.                                                                                              |
| `taxMinor` / `shippingMinor` | integer \| absent | Explicit terms; never silently dropped.                                                                                                                 |
| `references`                 | array             | Ordered prior-document refs: `documentId`, `documentType`, optional pinned `hash`.                                                                      |
| `settlement`                 | object \| absent  | `payment_evidence` only: `method`, `externalId`, optional `detail`.                                                                                     |
| `deliveryTerms`              | object \| absent  | `quote` only: `method`, `place`, `leadTimeDays`.                                                                                                        |
| `payloadHash`                | hex(64)           | SHA-256 of canonical bytes (§3).                                                                                                                        |
| `signature`                  | hex(128)          | BIP-340 schnorr over canonical bytes (§3).                                                                                                              |

## 2. Currency precision

Minor-unit digits are registered per currency; amounts never convert between currencies. v0.1 registry: `LAK: 0`, `THB: 2`, `USD: 2`, `BTC: 2` (sats), `SATS: 0`. Unregistered currencies are rejected with `OBP-E01`.

## 3. Canonical bytes, hash, signature

1. Serialize the envelope **without** `payloadHash` and `signature` using canonical JSON (RFC 8785-style): keys sorted by UTF-16 code units, no whitespace, minimal string escapes (short forms `\n` etc.), numbers must be safe integers.
2. `payloadHash = SHA-256(UTF-8(canonical bytes))`, lowercase hex.
3. `signature = schnorr.sign(canonical bytes, signerSecretKey)` (BIP-340 / secp256k1), lowercase hex.

See `src/lib/obp/canonical.ts` and `src/lib/obp/signature.ts`.

## 4. Lifecycle

State is a projection over each document's append-only message log (`issued → accepted | rejected | cancelled`; verified settlement flips an accepted invoice to `paid`). Issuing chains and party rules:

| New document       | References                                                          | Issued by (relative to reference) |
| ------------------ | ------------------------------------------------------------------- | --------------------------------- |
| `rfq`              | —                                                                   | buyer (any pilot participant)     |
| `quote`            | accepted `rfq`                                                      | RFQ recipient (seller)            |
| `purchase_order`   | accepted `quote`, not expired                                       | quote recipient (buyer)           |
| `invoice`          | accepted `purchase_order`                                           | order recipient (seller)          |
| `payment_evidence` | accepted `invoice`                                                  | invoice recipient (buyer)         |
| `receipt`          | invoice with **verified** settlement + delivered `payment_evidence` | invoice issuer (seller)           |

Actions: only the document recipient may `accept`/`reject`; only the issuer may `cancel`, and only before recipient acceptance and before expiry. Corrections require superseding documents, never deletion or overwrite.

## 5. Identity and delegation

An organization is `{ orgId, name, ownerPubkey }`. A key grant is `{ grantId, orgId, pubkey, role: owner|staff|device|agent, scope: { documentTypes, actions, maxAmountMinor?, currency?, dailyLimitMinor? }, validFrom?, validUntil?, revokedAt? }`. Counterparties are preconfigured in each node's registry; every inbound and outbound action re-verifies delegation (validity window, revocation, scope). A pubkey alone is never an organization identity.

**BNOS pilot derivation convention:** org ids and owner grant ids are derivable from Nostr keys alone so two nodes that know each other's pubkey compute identical ids with no shared registry: `orgId = "org:<pubkey>"` and the owner grant id is `"<orgId>:owner"` (see `src/lib/obp-adapter/node.svelte.ts`). Counterparty trust is seeded from GLO supplier records that carry a `pubkey`.

## 6. Node verification pipeline (inbound order)

1. Schema/version (`OBP-E01`)
2. Payload hash + signature (`OBP-E02`)
3. Issuer trust + signer delegation (`OBP-E03/04/05/06`)
4. Audience — recipient must be this node (`OBP-E07`)
5. Message expiry (`OBP-E08`)
6. Idempotency — replayed `messageId` returns the stored decision
7. References, hash pins, transitions, settlement state (`OBP-E09/10/11/15`)

The inbound message and its decision are persisted atomically (`ObpStores.recordInbox`). Transport delivery is tracked separately in the outbox; `transport delivered ≠ business accepted`.

## 7. Policy (v0.1)

Evaluation returns `allow | deny | requires_approval` with a signed decision record. Purchase orders: owner-signed within limits are allowed; everything else needs owner approval. Payments: an owner signature is the human approval; staff payments need an explicit approval record. Agents may only draft `rfq.issue`. Amount limits state their currency and are never converted; daily budgets are enforced atomically by the node.

## 8. Transport bindings

The envelope is transport-neutral. Confidential documents (all v0.1 types) must fail closed (`OBP-E14`-equivalent local hold) if the transport cannot encrypt.

- **Loopback** (implemented, `src/lib/obp/node/transport.ts`): deterministic harness transport with outage/loss/encryption-failure injection.
- **HTTPS** (implemented, `src/lib/obp/node/http-transport.ts`): `HttpTransport` POSTs the envelope as JSON to the counterparty's `/obp/inbox`; `handleObpInboxRequest` adapts a standard `Request` (SvelteKit `+server.ts`, Node undici) to the node pipeline and answers with the business decision JSON carrying `correlationId`. 4xx → permanent failure, 429/5xx/network/timeout → retryable outbox entries. Confidential delivery requires HTTPS (plain HTTP only with an explicit `allowInsecureHttp` pilot flag).
- **Nostr** (implemented, `src/lib/obp/node/nostr-transport.ts`): one event per envelope on kind 21099 (ephemeral range — relays are not expected to store confidential bilateral documents; the sender's outbox covers offline gaps; use a stored parameterized kind if store-and-forward is required). `content` is a NIP-44 v2 ciphertext keyed to the recipient's transport key — the relay never sees plaintext; the `p`-tag routes to the recipient transport pubkey. `bindNostrInbox` decrypts and feeds the node pipeline. Production relays via `SimplePoolNostrClient` (nostr-tools `SimplePool`); deterministic tests run on `MemoryRelayHub` (`src/lib/obp/testing/memory-relay.ts`) — the full RFQ→order flow passes over this second binding unchanged.

### 8.1 Settlement verification

`LightningPreimageVerifier` (`src/lib/obp/node/settlement.ts`) verifies Lightning evidence locally — `sha256(preimage) === paymentHash` — with no wallet RPC; manual/bank claims stay `pending` until a human or provider-backed verifier (e.g. NWC `lookup_invoice`) confirms.

### 8.2 Durable storage

`KvObpStores` (`src/lib/obp/node/idb-store.ts`) implements `ObpStores` over any key-value store with a single-writer mutex (atomic `recordInbox`, restart-safe). `createIdbKv()` is the browser persistence (IndexedDB via idb-keyval); `MemoryObpKv` covers tests and SSR; a SQLite adapter can follow server-side.

## 9. Conformance fixtures

`src/lib/obp/contract.test.ts` (canonicalization, signatures, schema), `src/lib/obp/identity-policy.test.ts` (delegation, policy), `src/lib/obp/two-node.test.ts` (the full RFQ → quote → order → invoice → payment → receipt flow between two independent nodes, plus every go/no-go rejection: bad signature, unknown/revoked signer, wrong recipient, expired quote, replay, invalid transition, hash mismatch, fail-closed encryption, pending/failed settlement, approval gates, outbox retry after simulated restart).

## 10. Compatibility policy

`version` gates parsing: `0.1` nodes reject other versions with `OBP-E01`. Additive fields may be introduced within `0.1` only if both sides ignore unknown fields; breaking changes require `0.2` and a migration note here.
