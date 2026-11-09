# Report snapshots — UI & operations plan

Status: All phases implemented and verified against the data service protocol.

Companion to [`REPORT_SNAPSHOTS.md`](REPORT_SNAPSHOTS.md), which defines the
snapshot payload, encryption, and service contract. This document covers how
users see, trust, and operate snapshots.

## Goal

Make snapshots a visible, trustworthy reporting feature instead of a silent
background artifact:

- the current period stays live and clearly labeled;
- closed/period snapshots are labeled and easy to inspect;
- publishing works with relays only, a data service, or both;
- gaps are visible and are never fabricated as zeros.

## Phase 1 — Reports integration (implemented)

### Reports page

- A snapshot status bar:
  - latest snapshot for today (or “no snapshot yet”);
  - granularity, scope, currency, generated time;
  - `Live only`, `Snapshot`, `In sync`, or `N orders behind`;
  - **Save snapshot** action (works without a data service).
- A **Snapshots** history section:
  - newest first, paginated with “Show all”;
  - columns: period, granularity, scope, gross, net, orders, generated,
    status, actions;
  - status is `Published` when the local GLO object carries a signed event id,
    otherwise `Local`;
  - actions: re-publish the same logical period, copy the GLO id;
  - aggregates only, always labeled with the snapshot currency.

### Data service settings

- Pending snapshot count.
- Rejections surface through the existing rejected/error messaging.
- “Sync now” drains both the encrypted event queue and the snapshot outbox.

### Business timezone

Period boundaries use the organization timezone when set, falling back to the
device timezone. The timezone is stored in the snapshot payload and included in
the deterministic id, so two devices in different timezones do not create
different snapshots for the same business day.

## Phase 2 — Service summaries (implemented)

- Client reader `dataService.fetchReportSummary()` calls
  `GET v1/reports/summary?from&to&granularity[&location][&currency]` with Unix
  seconds, matching the data service `PROTOCOL.md` and `REPORTING.md`.
- Responses are parsed as buckets (`gross_minor`, `orders_count`,
  `completeness`); missing buckets remain gaps and are never zero-filled.
- Reports shows an optional **Server summary** card with a snapshot badge,
  freshness, watermark, summed gross/orders, returned period count, and a delta
  against the locally recomputed period.
- Multi-day and closed ranges load automatically when reporting is available;
  today's range loads on demand.
- Failures fall back to local snapshots/live data with a visible message.
- Local orders remain the source of truth; the server summary is never silently
  blended into live totals.

## Phase 3 — History page (implemented)

- Route `/reports/snapshots`, linked from Reports.
- Filters: granularity, scope (organization/branch), currency, date range.
- Row details: tax, discount, refunds, items, average ticket, payment
  breakdown, order statuses, and top products.
- Actions: sync from relays, re-publish, copy id, export filtered JSON/CSV.
- Local-only status is shown as `Published` or `Local`.

## Phase 4 — Operations (implemented)

- Backfill the last 30 days from local orders; periods without orders or with an
  existing snapshot are skipped.
- Configurable per-device hourly retention (default 90 days) with a manual
  **Prune now** action. Daily/weekly/monthly snapshots are always kept.
- Activity-log entries for manual save, re-publish, and backfill operations.
- Snapshot detail rows include a drift check against locally recomputed
  aggregates for that specific period.

## Product rules

- Snapshots are immutable generated aggregates; re-publishing replaces the same
  logical period.
- One currency per snapshot; multi-currency periods produce separate rows.
- Missing periods are gaps, never zero-filled snapshots.
- Relay copies are always ciphertext; service copies are plaintext aggregates
  over authenticated HTTPS.
- Org-wide snapshots are only available to roles that can see all branches.

## Acceptance

- Reports shows the latest snapshot and its freshness.
- A relay-only user can save/publish a snapshot without configuring a service.
- Snapshot history lists local snapshots with correct currency and scope.
- Re-publishing does not create duplicate logical periods.
- Period boundaries follow the organization timezone.
- No snapshot path publishes plaintext to relays.
