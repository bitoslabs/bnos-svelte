# BNOS — Svelte

**BNOS (Bitcoin Network Operations System)** — open-source point of sale and
commerce on Nostr, rebuilt on **SvelteKit** with the **GLO v1** data standard
from [`@bitos/bnos-core`](https://github.com/bitoslabs/bnos-core).

This is the Svelte client of the BNOS ecosystem and a Svelte port of the original
Vue/Nuxt app (`bdgo-os`). It runs as a web app, an installable
PWA, or a native desktop shell (Tauri), and stays usable offline.

- **Local-first** — records are written instantly to local storage; the UI never
  waits on a relay.
- **Nostr-native** — data is signed with the user's key and synced to relays.
- **Self-custodial** — private keys never leave the device.
- **Open source** — MIT, with an optional self-hosted data service.

## Features

| Area                  | What it covers                                                                  |
| --------------------- | ------------------------------------------------------------------------------- |
| **Point of sale**     | Cart, payments (cash, QR, Lightning), shifts, receipts, success overlay         |
| **Orders & payments** | Order history, refunds, transactions, daily shifts                              |
| **Catalog**           | Products, categories, units, modifier groups, images, catalog kits              |
| **Inventory**         | Stock levels, adjustments, transfers, multi-branch support                      |
| **Customers & CRM**   | Customer records, history, loyalty points, memberships                          |
| **Reports**           | Sales and operational insights, period snapshots, fast service-backed summaries |
| **Accounting**        | Expenses, income, ledger views                                                  |
| **Staff & access**    | Roles, permissions, staff profiles                                              |
| **Marketing**         | Promotions and memberships                                                      |
| **Marketplace**       | Listings, channels, marketplace orders, shipping, reviews                       |
| **Restaurant**        | Tables, kitchen display, waiter station (feature flag)                          |
| **OBP**               | Open Business Protocol purchasing flow (pilot, read-only shadow)                |
| **Platform**          | PWA, desktop app, i18n (English, Lao, Thai), feature flags                      |

## Tech stack

- **SvelteKit 2** + **Svelte 5** runes
- **Tailwind CSS v4** with a token-based design system
- **TypeScript** (strict)
- **Vitest** and **Playwright** for tests
- **Tauri v2** for desktop packaging
- **`@bitos/bnos-core`** for kinds, GLO objects, auth, relays, and sync

## Quick start

Use Node.js `22.21.1` and the pnpm version pinned in `package.json` (`pnpm@12.15.0`).

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run dev        # http://localhost:5173
```

The `@bitos/bnos-core` dependency is installed from the npm registry.

### Environment

Copy `.env.example` to `.env` and fill in only what you need. All variables are
optional and exposed to the browser — never put secrets in `PUBLIC_*` values.

| Variable                        | Purpose                                                                                  |
| ------------------------------- | ---------------------------------------------------------------------------------------- |
| `PUBLIC_RELAYS`                 | Comma-separated default relay URLs for new/reset configurations                          |
| `PUBLIC_DATA_SERVICE_CLOUD_URL` | Verified HTTPS URL that enables the "bdGo Cloud" data-service option                     |
| `PUBLIC_OWNER_NPUBS`            | Allow-list of npubs that may publish in-app owner notices and receive encrypted feedback |
| `BNOS_CLOUDINARY_*`             | Optional server-side Cloudinary fallback for media uploads                               |

Media uploads are optional. Without server credentials, users can configure their
own Cloudinary or S3 account in **Settings → Media & uploads**, or keep BNOS
fully local-first with no uploads.

## Architecture

### Data layer

All domain data flows through
[`src/lib/nostr/store.svelte.ts`](src/lib/nostr/store.svelte.ts):

- **Local-first** — writes are instant and persisted to `localStorage`; the UI
  never blocks on the network (mirrors bdgo-os's "offline — changes will sync"
  guarantee).
- **Nostr sync** — when online and authenticated, objects are signed
  (`signNostrEvent`) and published to relays (`publishToRelays`), and the latest
  events are pulled back with `createGloFilter` + `parseGloEvent`.
- **Kinds** come from `@bitos/bnos-core` — see
  [`src/lib/nostr/kinds.ts`](src/lib/nostr/kinds.ts). No kind numbers are
  hard-coded in the app; they resolve through the GLO type → kind map.

### Auth

[`session.svelte.ts`](src/lib/nostr/session.svelte.ts) supports two Nostr login
methods (matching bdgo-os):

- **NIP-07 browser extension** (Alby, etc.)
- **nsec / hex private key**

Snapshots are persisted with the canonical BNOS storage keys, so this client is
interoperable with other BNOS clients, including bdgo-os and bnos-space.

### Data service and report snapshots

The optional backend integration lives in
[`src/lib/data-service/`](src/lib/data-service). Its contract covers encrypted
event backup, signed-challenge auth, report snapshots, and status. The service is
optional and never required for checkout or local operation.

Report snapshots are implemented. Each snapshot has two destinations: an
**encrypted GLO ciphertext event** on relays for cross-device sync, and a
**signed plaintext aggregate** over authenticated HTTPS to the service for fast
reporting. Plaintext aggregates are never published to relays, and the relay copy
is skipped when the organization key is unavailable.

See [`docs/REPORT_SNAPSHOTS.md`](docs/REPORT_SNAPSHOTS.md) for the client
implementation guide and
[`../bnos-data-service/docs/REPORTING.md`](https://github.com/bitoslabs/bnos-data-service/blob/main/docs/REPORTING.md)
for the backend design.

## Project structure

```text
src/
├── app.css                     # design tokens: @theme colors + runtime --ui-*/--surface-*/--tone-* vars
├── lib/
│   ├── components/ui/          # primitives: Button, Input, Select, Switch, Dialog, Badge, …
│   ├── components/             # app shell: AppSidebar, AppTopbar, mobile/BottomTabBar
│   ├── nostr/                  # bnos-core data layer: store, session, relay, tenant, sync
│   ├── domain/                 # GLO domain model: kinds, types, helpers, meta, catalog kits
│   ├── pos/                    # POS engines: cart, payments, shifts, success overlay
│   ├── crypto/                 # GLO encryption / key grants / privacy
│   ├── media/                  # image upload + gallery
│   ├── settings/               # settings pages and stores
│   ├── theme/                  # accent / density / surface preferences
│   ├── stores/                 # toast, confirm, command, notifications
│   ├── i18n/                   # translations (en, lo, th) + locale store
│   ├── utils/                  # cn, format, qr, record-id, …
│   ├── icons.ts                # offline Lucide registry + bdgo-os icon remap
│   └── nav.ts                  # bdgo-os nav sections → Svelte routes
└── routes/
    ├── +layout.svelte          # root: icons, theme, relay/session hydration, Toaster
    ├── login/                  # Nostr identity entry
    ├── setup/                  # onboarding wizard (identity → company → branch → relays → catalog → review → done)
    └── pos · orders · catalog · inventory · customers · reports · settings …  # app pages
```

### Modules and routes

`pos`, `orders`, `catalog`, `inventory`, `customers`, `transactions`,
`expenses`, `income`, `reports`, `promotions`, `memberships`, `staff`,
`marketplace`, `restaurant`, `obp`, `notifications`, `activity`, `profile`,
`settings`, `workspace`, `setup`, `login`.

Module visibility is controlled by the reactive feature-flag store
([`src/lib/features.svelte.ts`](src/lib/features.svelte.ts)); route access is
guarded by role permissions in [`src/lib/nav.ts`](src/lib/nav.ts).

### Feature flags

`restaurant`, `retail`, `loyalty`, `crm`, `multiBranch`, `marketplace`, `ai`,
and `obp` can be toggled at runtime. Flags persist to local storage and update
the sidebar without a reload.

## Develop

```bash
pnpm run dev        # dev server
pnpm run check      # svelte-kit sync + svelte-check (types + a11y)
pnpm run lint       # prettier --check + eslint
pnpm run format     # prettier --write
pnpm run build      # production build (0 vite-plugin-svelte warnings expected)
pnpm run test:unit  # vitest
pnpm run test:e2e   # playwright
```

After non-trivial changes, run `pnpm format && pnpm check && pnpm build`.

## Desktop and PWA

- **PWA** — the web build registers a service worker and can be installed from
  the browser. Relays use a network-only caching policy.
- **Desktop** — the Tauri shell embeds the SvelteKit SPA in the system webview.

```bash
pnpm desktop:dev       # Vite on 127.0.0.1:1420 + native window
pnpm desktop:build     # static SPA in desktop-build/
pnpm desktop:package   # release binary and platform bundles
```

Desktop builds cannot serve SvelteKit endpoints (including the Cloudinary media
proxy) and generally cannot use NIP-07 browser extensions; use key-based login.
See [`TAURI.md`](TAURI.md) for prerequisites and the release process.

## Server deployment

CI installs with `pnpm install --frozen-lockfile`, then verifies and builds the
checked commit. The server uses a pnpm installation with the same pinned version.
When migrating an existing server, install the updated deployment helper once
using an administrator account before deploying the first pnpm commit:

```bash
sudo env PATH=/opt/node/v22.21.1/bin:/usr/bin:/bin npm install -g pnpm@12.15.0
sudo install -m 755 ops/bnos-deploy /usr/local/bin/bnos-deploy
```

Run this from a checkout containing the updated helper on the server. Node.js
`22.21.1` and pnpm must be available at the paths configured in the helper.
Deployment details are in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Documentation

| Document                                                               | Contents                               |
| ---------------------------------------------------------------------- | -------------------------------------- |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)                             | Server layout, CI, and release process |
| [`docs/REPORT_SNAPSHOTS.md`](docs/REPORT_SNAPSHOTS.md)                 | Client report-snapshot implementation  |
| [`docs/REPORT_SNAPSHOTS_UI_PLAN.md`](docs/REPORT_SNAPSHOTS_UI_PLAN.md) | Reporting UI plan                      |
| [`docs/OBP_OVERVIEW.md`](docs/OBP_OVERVIEW.md)                         | Open Business Protocol overview        |
| [`docs/MARKETPLACE_PLAN.md`](docs/MARKETPLACE_PLAN.md)                 | Marketplace design                     |
| [`TAURI.md`](TAURI.md)                                                 | Desktop shell and packaging            |
| [`AGENTS.md`](AGENTS.md)                                               | Contributor/agent conventions          |

## Ecosystem

| Project                                                               | Description                                            |
| --------------------------------------------------------------------- | ------------------------------------------------------ |
| [`@bitos/bnos-core`](https://github.com/bitoslabs/bnos-core)          | Shared kinds, GLO model, auth, relays, sync, migration |
| [`bnos-data-service`](https://github.com/bitoslabs/bnos-data-service) | Optional encrypted backup and report service           |
| `bdgo-os`                                                             | Original Vue/Nuxt BNOS console                         |
| [bnos.space](https://bnos.space)                                      | Project website                                        |

Project support key: `npub1e65vutc5cfgutyvjetu5wp3ael48asklchtrut8m2svtt4lxdp4sruf0pk`.

## Acknowledgments

BNOS is a **BitDigo** project, built on the foundational architecture of the
**Bitcoin Network Operations System**. Thanks to the BitDigo team for supporting
the open BNOS ecosystem.

## License

MIT.
