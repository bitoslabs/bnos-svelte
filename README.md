# BNOS — Svelte

BNOS (Bitcoin Network Operations System) point-of-sale & commerce, rebuilt on
**SvelteKit** with the **Nostr / GLO** data standard from
[`@bitos/bnos-core`](../packages/bnos-core).

This is an open-source Svelte port of the original Vue/Nuxt app ([`../bdgo-os`](../bdgo-os)):

| Concern | Source | How it maps here |
| --- | --- | --- |
| **Data standard** (Nostr kinds + GLO model) | [`../packages/bnos-core`](../packages/bnos-core) | `src/lib/nostr/*` — every record is a GLO object carrying its Nostr kind (e.g. `catalog.product` → kind `30100`, `commerce.order` → `30200`). |
| **UX / component patterns** | Internal Svelte design-system reference | Design system (`src/app.css`), UI primitives (`src/lib/components/ui/*`), theme store, icon registry. macOS-inspired, Tailwind v4, Svelte 5 runes. |
| **UX flows / steps** | [`../bdgo-os`](../bdgo-os) | Routes mirror bdgo-os pages 1:1: `login` → `setup/*` wizard → dashboard / POS / orders / catalog / … |

## Data layer

All domain data flows through [`src/lib/nostr/store.svelte.ts`](src/lib/nostr/store.svelte.ts):

- **Local-first** — writes are instant and persisted to `localStorage`; the UI
  never blocks on the network (mirrors bdgo-os's "offline — changes will sync"
  guarantee).
- **Nostr sync** — when online + authenticated, objects are signed
  (`signNostrEvent`) and published to relays (`publishToRelays`), and the latest
  events are pulled back with `createGloFilter` + `parseGloEvent`.
- **Kinds** come straight from `@bitos/bnos-core` — see
  [`src/lib/nostr/kinds.ts`](src/lib/nostr/kinds.ts). No kind numbers are
  hard-coded in the app; they resolve through the GLO type → kind map.

### Auth

[`session.svelte.ts`](src/lib/nostr/session.svelte.ts) supports two Nostr login
methods (matching bdgo-os):

- **NIP-07 browser extension** (Alby, etc.)
- **nsec / hex private key**

Snapshots are persisted with the canonical BNOS storage keys, so this client is
interoperable with other BNOS clients, including bdgo-os and bnos-space.

## Structure

```
src/
├── app.css                     # design tokens, light/dark, surfaces (from school-erp)
├── lib/
│   ├── components/ui/          # Button, Input, Badge, Dialog, … (from school-erp)
│   ├── components/             # AppSidebar, AppTopbar, mobile/BottomTabBar
│   ├── nostr/                  # bnos-core data layer (kinds, session, relay, store, tenant)
│   ├── theme/                  # accent / density / surface preferences
│   ├── stores/                 # toast
│   ├── icons.ts                # offline Lucide registry + bdgo-os icon remap
│   └── nav.ts                  # bdgo-os nav sections → Svelte routes
└── routes/
    ├── +layout.svelte          # root: icons, theme, relay/session hydration, Toaster
    ├── login/                  # Nostr identity entry
    ├── setup/                  # onboarding wizard (identity → company → branch → relays → catalog → review → done)
    └── (app)/                  # authenticated shell: dashboard, pos, orders, catalog, …
```

## Develop

```bash
yarn install
yarn run dev      # http://localhost:5173
yarn run check    # svelte-check
yarn run build
```

> The `@bitos/bnos-core` dependency is linked from `../packages/bnos-core`
> (`file:`). Rebuild the package (`npm run build` there) after editing it.

## Acknowledgments

Built on the foundational architecture of the **Bitcoin Network Operations
System**, with thanks to **BitDigo** for sponsorship and support of the open
BNOS ecosystem.
