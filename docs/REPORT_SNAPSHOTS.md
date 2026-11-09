# Report snapshots — client implementation guide

Status: implemented. This is the client-side companion to
[`bnos-data-service/docs/REPORTING.md`](../../bnos-data-service/docs/REPORTING.md)
and [`PROTOCOL.md`](../../bnos-data-service/docs/PROTOCOL.md).

## 1. Goal

Produce small, signed, period-scoped **aggregate snapshots** so reports are fast
on the data service and consistent across devices, without exposing plaintext
business records on relays.

Snapshots are produced from data the client already has. They contain totals and
counts only — never customer data, line-item plaintext, or secrets.

## 2. Two destinations, one payload

| Destination  | What is sent                                                  | Why                                               | Encrypted              |
| ------------ | ------------------------------------------------------------- | ------------------------------------------------- | ---------------------- |
| Nostr relays | GLO **ciphertext** event (`report.snapshot`)                  | Cross-device sync for clients holding the org key | Yes, required          |
| Data service | Signed **plaintext aggregate** event over authenticated HTTPS | Fast server-side reporting                        | TLS only, service-only |

Rules:

- **Never publish plaintext aggregates to relays.** Relays are public.
- The relay copy must be an encryption envelope. If the org key is unavailable,
  do not publish the snapshot to relays at all.
- The data-service copy is sent only to `/v1/reports/snapshots`, never to
  `/v1/events`, and never through `recordServiceEvent` (that queue is for
  ciphertext backup and filters non-envelope content).
- A relay-only deployment keeps reports client-side; the service cannot read
  ciphertext without an explicit opt-in decryption feature (not v1).

## 3. Object model

Proposed GLO type: `report.snapshot`, proposed kind `30970`.

Register it in two places:

1. `@bitos/bnos-core`: add `NOSTR_KINDS.REPORT_SNAPSHOT = 30970` and
   `GLO_KIND_BY_TYPE['report.snapshot'] = 30970`, then publish a new version.
2. App-side until that ships, update **both** app kind maps:
   - `src/lib/domain/kind.ts`: add `reportSnapshot: 'report.snapshot'` to `TYPE`
     and `reportSnapshot: NOSTR_KINDS.REPORT_SNAPSHOT` to `APP_KIND_OVERRIDES`.
   - `src/lib/nostr/store.svelte.ts`: add the kind to its own map:

```ts
// src/lib/nostr/store.svelte.ts
const APP_KIND_BY_TYPE: Record<string, number> = {
	// …
	'report.snapshot': NOSTR_KINDS.REPORT_SNAPSHOT
};
```

The two maps are separate today; forgetting one makes relay sync and publish
resolve different kinds.

### 3.1 Payload

```ts
// src/lib/domain/report-snapshot.ts
export type ReportGranularity = 'hour' | 'day' | 'week' | 'month';

export interface ReportSnapshot {
	type: 'report.snapshot';
	version: 1;
	granularity: ReportGranularity;
	periodStart: string; // ISO-8601
	periodEnd: string; // ISO-8601, exclusive
	locationId?: string;
	currency: string;
	/** All amounts are integer minor units for `currency`. */
	grossMinor: number;
	netMinor: number;
	taxMinor: number;
	discountMinor: number;
	refundMinor: number;
	ordersCount: number;
	itemsCount: number;
	avgTicketMinor: number;
	payments: Record<string, number>;
	orderStatus: Record<string, number>;
	topProducts: { productId: string; qty: number; revenueMinor: number }[];
	generatedAt: string;
}
```

Rules:

- No customer identifiers, names, phone numbers, addresses, or free text.
- `topProducts` is capped (for example 50) and uses catalog ids only.
- One currency per snapshot. Produce separate snapshots for multi-currency
  periods.
- Money must be integer minor units. Do not send floats.

### 3.2 Amount conversion

The domain currently stores `total` as a number and also `totalSats` for Bitcoin
snapshots. Add one helper and use it everywhere:

```ts
// src/lib/domain/report-snapshot.ts
const MINOR_DIGITS: Record<string, number> = { USD: 2, THB: 2, LAK: 0, BTC: 8 };

export function toMinorUnits(amount: number, currency: string): number {
	const digits = MINOR_DIGITS[currency.toUpperCase()] ?? 2;
	return Math.round(amount * 10 ** digits);
}
```

Prefer already-integer sat values where available (`totalSats`) and document the
currency unit for BTC. Never derive minor units from formatted strings.

## 4. Where the numbers come from

Reuse existing pure functions instead of duplicating report math:

- `src/lib/dashboard/metrics.ts`: `toOrderRows`, `metricsSummary`,
  `paymentBreakdown`, `topProducts`, `startOfDay`, `startOfWeek`, `startOfMonth`.
- `src/routes/reports/+page.svelte` for the existing report ranges and filters.
- GLO collections: `glo.all('commerce.order')`, `glo.all('commerce.payment')`,
  `glo.all('commerce.refund')`, `glo.all('catalog.product')`,
  `glo.all(TYPE.expense)`, `glo.all(TYPE.income)`.

The builder must be a pure function of plain inputs so it can be unit-tested
without a browser or relays:

```ts
export function buildReportSnapshot(input: {
	periodStart: number;
	periodEnd: number;
	granularity: ReportGranularity;
	orders: GloOrder[];
	payments: GloPayment[];
	refunds: GloRefund[];
	products: GloProduct[];
	currency: string;
	locationId?: string;
	now?: number;
}): ReportSnapshot;
```

## 5. Implementation steps

### Step 1 — register the type and kind

- Add `report.snapshot` to `TYPE` in `src/lib/domain/kind.ts`.
- Add the app-side kind override in `src/lib/nostr/store.svelte.ts`.
- Open the bnos-core change so the kind becomes canonical.

### Step 2 — pure builder

Create `src/lib/domain/report-snapshot.ts` with the types, `toMinorUnits`, and
`buildReportSnapshot`. Add `src/lib/domain/report-snapshot.test.ts` covering:

- totals reconcile (`gross - discounts - refunds + tax` semantics per the existing
  report rules),
- payment method breakdown matches the orders,
- `topProducts` ordering and cap,
- period boundaries are exclusive at the end,
- no PII fields exist.

### Step 3 — encrypt relay snapshots

Plaintext aggregates must never reach relays.

- Add `'report'` to `SensitiveDataDomain` in `src/lib/crypto/privacy.ts`.
- Add `'report.snapshot': 'report'` to `ENCRYPTED_DOMAIN_BY_TYPE` in
  `src/lib/crypto/glo-cipher.ts`.
- Guard the publish path: for `report.snapshot`, require a ciphertext envelope.
  If `cipherActive()` is false or `encryptGloObject` returns `null`, do **not**
  publish to relays. Keep the object local and still push the service copy.

Suggested guard in `src/lib/nostr/store.svelte.ts` (`publish`):

```ts
const MUST_BE_CIPHERTEXT = new Set(['report.snapshot']);
// …
if (MUST_BE_CIPHERTEXT.has(type) && !enc) {
	// Never publish plaintext aggregates to relays.
	if (queueOnFailure) await this.queuePublish(type, object);
	return false;
}
```

Do not rely on the generic `shouldEncryptType` fallback, which currently
publishes plaintext when encryption is unavailable.

Snapshot encryption is independent of the device's global payload-encryption
toggle: `encryptGloObjectRequired` uses the organization key directly (minting
it for owner/admin devices or pulling a NIP-44 grant for staff) so relay-only
users do not need a data service or the global encryption setting. If no key can
be obtained, the snapshot stays local and is retried later; it is never
published as plaintext.

### Step 4 — produce and publish

Create `src/lib/reports/snapshot-service.ts`:

```ts
import { glo } from '$nostr/store.svelte';
import { tenant } from '$nostr/tenant.svelte';
import { buildReportSnapshot, type ReportGranularity } from '$lib/domain/report-snapshot';

export async function publishReportSnapshot(input: {
	granularity: ReportGranularity;
	periodStart: number;
	periodEnd: number;
}) {
	const data = buildReportSnapshot({
		...input,
		orders: glo.all('commerce.order'),
		payments: glo.all('commerce.payment'),
		refunds: glo.all('commerce.refund'),
		products: glo.all('catalog.product'),
		currency: tenant.state.currency,
		locationId: tenant.state.locationId
	});

	// Deterministic id makes re-publishing the same period idempotent.
	const id = snapshotId({
		workspaceId: tenant.state.organizationId,
		locationId: tenant.state.locationId,
		granularity: input.granularity,
		periodStart: input.periodStart,
		currency: data.currency
	});

	const object = await glo.upsert('report.snapshot', data, {
		id,
		visibility: 'organization' // required for encryption
	});

	// Service-only plaintext copy. Never relay this event.
	await dataService.pushReportSnapshot(data);
	return object;
}
```

Notes:

- `glo.upsert` caches locally and publishes to relays. With `report.snapshot` in
  the encrypted-domain map, the relay event is ciphertext.
- Do not send the relay event to `/v1/reports/snapshots`; its content is
  ciphertext. The service endpoint expects plaintext aggregates, so
  `pushReportSnapshot` signs a separate service-only event.
- `snapshotId` must be a valid GLO id segment: only `A-Z a-z 0-9 . _ ~ -`.
  Colons, pipes, and spaces are rejected by `createGloIdentifier`. Use a stable
  hash, for example:

```ts
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

function snapshotId(input: {
	workspaceId: string;
	locationId?: string;
	granularity: ReportGranularity;
	periodStart: number;
	currency: string;
}): string {
	const key = [
		input.workspaceId,
		input.locationId ?? 'all',
		input.granularity,
		input.periodStart,
		input.currency.toUpperCase()
	].join('|');
	// Truncated hash keeps the id short and segment-safe.
	return `snap-${bytesToHex(sha256(new TextEncoder().encode(key))).slice(0, 40)}`;
}
```

The id becomes the GLO object id and `d` tag, so re-publishing updates the same
addressable object and relays keep the latest version. The data service should
also dedupe by this logical period key, not only by event id.

### Step 5 — push the plaintext copy to the data service

Extend the client protocol and state:

`src/lib/data-service/protocol.ts`:

```ts
export const DATA_SERVICE_PATHS = {
	// …
	reportSnapshots: 'v1/reports/snapshots'
} as const;
```

`src/lib/data-service/state.svelte.ts` (imports already present in that file:
`session`, `requestJson`, `serviceEndpoint`, `DATA_SERVICE_PATHS`,
`parseIngestResult`):

```ts
async pushReportSnapshot(snapshot: ReportSnapshot): Promise<void> {
	if (!this.metadata?.capabilities.reporting) return;
	if (!this.sessionInfo) return;

	// Sign a service-only event whose content is the plaintext aggregate JSON.
	const event = await session.signEvent({
		kind: REPORT_SNAPSHOT_KIND,
		created_at: Math.floor(Date.now() / 1000),
		tags: [
			['d', `org.bitos.glo:v1:report.snapshot:${id}`],
			['organization', this.organizationId],
			...(snapshot.locationId ? [['location', snapshot.locationId]] : []),
			['granularity', snapshot.granularity],
			['period-start', String(Math.floor(Date.parse(snapshot.periodStart) / 1000))],
			['period-end', String(Math.floor(Date.parse(snapshot.periodEnd) / 1000))],
			['currency', snapshot.currency]
		],
		content: JSON.stringify(snapshot)
	});

	const metadata = this.metadata;
	const stored = this.sessionInfo;
	if (!metadata || !stored) return;
	const raw = await requestJson({
		url: serviceEndpoint(metadata.baseUrl, DATA_SERVICE_PATHS.reportSnapshots),
		method: 'POST',
		token: stored.token,
		body: { snapshot: event },
		timeoutMs: 15_000
	});
	parseIngestResult(raw);
}
```

Implementation requirements:

- Use the existing bearer token and the same 401 → refresh → retry-once behavior
  as `drainOnce`.
- Do not call `recordServiceEvent(event)` for this event. That path is the
  encrypted backup queue and filters non-envelope content.
- Add a small durable snapshot outbox keyed per workspace so offline snapshots
  are retried on reconnect. Reuse the pure helpers in
  `src/lib/data-service/queue.ts` (`enqueueEvent`, `acknowledgeEvents`,
  `applyIngestResult`) but **do not** use `encryptedUploadBatch`.
- Keep snapshots out of the `/v1/events` batch.

If signing a service-only event is not desired, an alternative is a plain JSON
POST authorized by the bearer session. The signed variant is preferred for audit
and consistency.

### Step 6 — triggers

- After shift close / day close (find the existing close flow under `src/lib/pos/`).
- When the reports page opens and the latest snapshot is stale.
- Manual "Publish snapshot" or "Sync now" in Settings → Data service.
- On reconnect for any queued snapshot.

Avoid tight loops: at most one snapshot per
`(workspace, location, granularity, period, currency)`; re-publishing replaces
the same logical period.

### Step 7 — read snapshots across devices

- `glo.hydrate('report.snapshot')` and include the type in the relevant
  `glo.sync(...)` scope.
- Decryption is automatic: `parseAppGloEvent` calls `decryptGloEvent` before
  `parseGloEvent`, so ciphertext snapshots become normal objects on devices that
  hold the org key.
- The reports page should prefer service summaries for speed but must clearly
  label them as snapshots; local GLO data remains the source of truth.

### Step 8 — tests

- Unit: `buildReportSnapshot` totals, boundaries, currency, PII absence.
- Unit: `toMinorUnits` per currency.
- Unit: deterministic id is stable and changes with period/currency/location.
- Unit: relay publish is blocked when ciphertext is unavailable.
- Integration: service push sends to `v1/reports/snapshots`, not `v1/events`.
- Integration: offline snapshot queues and drains on reconnect.
- Security: plaintext aggregate content never appears in a relay event.

## 6. Data-service contract used by the client

`POST /v1/reports/snapshots` with `Authorization: Bearer <token>`:

```json
{
	"snapshot": {
		"id": "...",
		"pubkey": "...",
		"created_at": 1760000000,
		"kind": 30970,
		"tags": [
			["d", "org.bitos.glo:v1:report.snapshot:<logical-id>"],
			["organization", "<workspaceId>"],
			["location", "<locationId>"],
			["granularity", "day"],
			["period-start", "1760000000"],
			["period-end", "1760086400"],
			["currency", "USD"]
		],
		"content": "{...aggregates...}",
		"sig": "..."
	}
}
```

`location` is omitted for organization-wide snapshots. The client also keeps a
local `snapshot-id` tag for outbox deduplication; the service uses `d` and the
period tags.

Response:

```json
{ "accepted": ["<id>"], "duplicates": [], "rejected": [] }
```

Rules:

- Only when `capabilities.reporting` is true.
- `401` → refresh once and retry; otherwise mark unauthorized.
- `403` → permission denied; keep the snapshot queued.
- `5xx` or network error → keep queued and retry later.
- `rejected` → keep locally, surface the reason, do not drop silently.

### 6.1 Summary query (confirmed)

`GET /v1/reports/summary?from=<unix>&to=<unix>&granularity=hour|day|week|month[&location=<id>][&currency=<code>]`

- `from` is inclusive and `to` is exclusive, both Unix seconds.
- The response carries `snapshot`, `generatedAt`, `range`, `currency`, `buckets`,
  and `watermark`.
- Each bucket has `start`, `end`, `gross_minor`, `orders_count`, and optional
  `completeness`.
- Missing buckets are gaps; the client never fabricates zeros.
- The Reports card sums returned buckets for display and shows the returned
  period count and watermark. It does not blend server totals into live data.

## 7. Security and privacy checklist

- [ ] Relay snapshots are always encrypted; plaintext is never published.
- [ ] Service snapshots go only to `/v1/reports/snapshots`.
- [ ] Snapshot content contains aggregates only, no PII.
- [ ] Money is integer minor units with an explicit currency.
- [ ] Object ids are deterministic per logical period.
- [ ] Offline snapshots are durable and retried.
- [ ] Reports are labeled as snapshots with a watermark.
- [ ] Missing periods are gaps, never fabricated zeros.

## 8. Coordination

| Item                                         | Owner              | Note                                          |
| -------------------------------------------- | ------------------ | --------------------------------------------- |
| `REPORT_SNAPSHOT` kind in `@bitos/bnos-core` | bnos-core          | App override works meanwhile                  |
| `/v1/reports/snapshots` + summary            | data service       | See service `PROTOCOL.md`                     |
| Server kind allowlist includes `30970`       | data service       | For encrypted backup of relay snapshots       |
| Snapshot aggregate schema                    | client + service   | Keep in sync; version it                      |
| Decryption policy                            | product + security | Not v1; snapshots stay unreadable server-side |

## 9. Acceptance criteria

- [ ] A completed day produces one snapshot, visible locally and on another
      device with the same key.
- [ ] Relays contain only ciphertext for `report.snapshot`.
- [ ] The data service stores the plaintext aggregate copy and serves a summary.
- [ ] Re-publishing the same period does not create duplicates.
- [ ] Snapshot push survives offline/restart and drains on reconnect.
- [ ] No snapshot path routes plaintext through `/v1/events`.
