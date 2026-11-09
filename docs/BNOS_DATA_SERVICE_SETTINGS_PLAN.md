# BNOS data service settings and integration plan

Status: the client integration described below is implemented in bnos-svelte and bdGo OS (protocol client, one-time setup-code flow, signed challenge, durable service upload queue, connection/backup status and disconnect). The data service, cloud offering, reporting and integration keys are still not implemented; both clients target a compatible external service. Coordinate protocol and privacy decisions with bdGo OS and the BNOS data service before changing the protocol.

## Goal

Let an authorized owner connect a workspace to a self-hosted BNOS data service by entering its URL and one-time setup code, or select bdGo Cloud when an actual endpoint and offering are available. Both use the same versioned protocol. Existing local-first operations and relay sync continue when the service is offline or disconnected. Service backup and reporting must never block checkout.

## User workflow

1. The owner deploys a compatible service or selects bdGo Cloud. The owner creates a short-lived, single-use workspace invitation on that service; QR setup is optional and must not leak a persistent secret.
2. In Settings → Data service, the owner chooses self-hosted or cloud. For self-hosted, enter the HTTPS service URL and setup code; use HTTP only on loopback for development. Cloud configuration must come from verified application configuration; do not invent or hardcode an endpoint.
3. Fetch public version/capability information safely, present the origin, service identity, intended workspace and privacy implications, then have the owner confirm. Define identity verification, cross-origin/CORS, redirects, version compatibility and local-network access before implementation. Never put credentials in URL/query strings, logs or relay events.
4. The service issues a nonce, bound to its audience, expiry and one use. The owner signs using the existing NIP-07 or nsec session. The server verifies the challenge, invitation, current owner membership and workspace, then consumes the invitation and returns a short-lived user-scoped session. Handle replay, expiry, retries and lost invitations explicitly.
5. Enable the connection only after successful authorization. Other staff authenticate using their own Nostr identities and server-verified current workspace and branch permissions; they never share the owner's admin credential.
6. Show queued, syncing, synced, offline, permission denied, incompatible and error states; provide retry and disconnect. A connection test checks compatibility and authorization. Show backup freshness and verified restore status separately: an online server is not proof of recoverability.

An integration API key is an optional separate future feature for server-to-server applications, scoped by workspace, branch and permission, expiring and revocable. If a service only offers a long-lived admin key, do not place it in the browser; design an appropriate trusted exchange first. One-time setup codes and user sessions are not interchangeable with reusable integration keys.

## Client architecture

- Inspect `src/routes/settings/data/+page.svelte`, the settings layout and navigation before adding a route or section; reuse existing settings patterns and guard management actions with the appropriate permission.
- Keep connection orchestration and state in an appropriate Svelte 5 rune singleton under `src/lib/nostr/` or `src/lib/settings/`; keep protocol validation and transport in testable TypeScript modules. Use the existing session signer and tenant context; do not introduce a new login path.
- Persist nonsecret connection metadata per workspace. Design token storage, renewal, expiry and logout/disconnect cleanup against browser threats before implementation; never sync secrets through Nostr or export them in backups. On workspace switch prevent credentials, queues and results from crossing tenants.
- Create durable service-specific upload state separately from relay publishing. Audit existing local persistence and event coverage before deciding how to persist unsent jobs; acknowledge only after server durability. Retry idempotently without blocking the UI, and handle duplicates, restart, offline state, tenant switch, revocation and partial failures.
- Read capability and report freshness from the service. Keep local pending data and server reports clearly distinguished; a server watermark does not prove offline devices have uploaded. Never replace the local source of truth with a stale report.
- Add translations in English, Lao and Thai, accessible controls, and loading, empty, offline and error states. Show actual backup and tested restore status only when the service supplies trustworthy evidence.

## Privacy and permissions

Private backup stores encrypted sensitive events without company keys, so the server cannot calculate reports on those fields. Managed reporting requires a separate explicit, informed workspace opt-in and a reviewed key, access, retention and deletion model. Even client-produced summaries can expose sensitive business information. Do not silently send decrypted orders, payments or customer data to either self-hosted servers or bdGo Cloud.

Server authorization must not rely on user-provided tenant IDs, event tags or hidden UI. Define trusted membership bootstrap and revocation, including offline behavior, before accepting data. Require appropriate settings permissions for connection, privacy changes and disconnect; enforce corresponding checks server-side. Cloud plan limits must not block local transactions or silently discard unsynced data.

## Delivery and acceptance

1. Specify identity, workspace ownership, permission and revocation contracts with both client teams; review the threat model and provider identity.
2. Build protocol/client modules and settings flow against a test service; validate origin, version, one-time invite and signed challenge.
3. Add a durable, independent service queue and sync visibility; test offline restart, retries, duplicate uploads, switching workspaces and revocation.
4. Add private backup and restore status only when real operations exist and restore has been tested. Add cloud selection after endpoint, provisioning and entitlements are defined.
5. Add opt-in server reporting and scoped integration keys only after separate privacy and security reviews.

Acceptance: two tenants and multiple branches remain isolated; users without settings permission cannot connect, alter privacy or disconnect; expired/replayed invitations and challenges fail; tokens are removed on logout; server outage leaves checkout working; queue retries are lossless and independent of relay state; backups and reports do not claim completeness or recovery without evidence.

Follow the repository's Svelte 5, i18n, permission, local-first and pnpm checks when implementing. This file is a plan and does not grant deployment approval.
