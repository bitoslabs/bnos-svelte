# Owner notices (in-app notifications from your owner)

BNOS can surface **alerts, security notes and update announcements** that the
workspace owner (or the platform operator) publishes over Nostr. There is no
server: the app watches an allow-list of owner pubkeys, reads their notes from
the configured relays, and mirrors them into the in-app notification center
(topbar bell and `/notifications`), with a detail view at `/notifications/[id]`.

Implementation: `src/lib/nostr/owner-feed.svelte.ts`, wired in
`src/routes/+layout.svelte` via `startOwnerFeed()`.

## 1. Allow-list

Only keys in the allow-list can push notices. Two sources are merged:

| Source               | Where                      | Changeable without rebuild |
| -------------------- | -------------------------- | -------------------------- |
| `PUBLIC_OWNER_NPUBS` | build/runtime env (`.env`) | depends on adapter         |
| Trusted keys         | Settings → Notifications   | yes (stored on device)     |

`PUBLIC_OWNER_NPUBS` is a comma-separated list of `npub1…` or 64-char hex
pubkeys:

```bash
PUBLIC_OWNER_NPUBS=npub1abc…,npub1def…
```

Users can add extra trusted keys in **Settings → Notifications → Trusted owner
keys**. The allow-list is the only trust boundary; notices from other keys are
ignored.

## 2. Publishing a notice

Publish a normal **kind `1` text note** from an allow-listed pubkey. Tags decide
the category, severity, title and link:

| Field        | Tag                                                 | Notes                            |
| ------------ | --------------------------------------------------- | -------------------------------- |
| Category     | `["t","…"]` (see below) or `bnos`                   | required to match the feed       |
| Severity     | `["t","critical"]`, `warning`, `success`, `info`    | optional override                |
| Title        | `["subject","Title"]` or a leading `# Heading` line | optional                         |
| Expiry       | `["expiration","<unix>"]`                           | NIP-40, optional                 |
| App link     | `["r","/orders"]`                                   | internal path only               |
| External URL | `["r","https://…"]`                                 | shown as text, never auto-opened |

### Category tags

Legacy `bnos.space-*` names and short aliases are both accepted. When several
are present, the most specific wins
(`security > maintenance > alert > update > feature > bugfix > announcement`).

| Category     | Legacy tag                | Short alias                        | Tone    | Icon      |
| ------------ | ------------------------- | ---------------------------------- | ------- | --------- |
| Security     | `bnos.space-security`     | `security`                         | error   | shield    |
| Maintenance  | `bnos.space-maintenance`  | `maintenance`                      | warning | wrench    |
| Alert        | —                         | `alert`                            | warning | triangle  |
| Update       | `bnos.space-update`       | `update`                           | info    | download  |
| Feature      | `bnos.space-feature`      | `feature`                          | info    | sparkles  |
| Bug fix      | `bnos.space-bugfix`       | `bugfix`                           | success | bug       |
| Announcement | `bnos.space-announcement` | `announcement` / `notice` / `bnos` | info    | megaphone |

### Title

The title is chosen in this order:

1. `["subject","…"]` tag.
2. First content line if it starts with `#` (markdown heading), e.g. `# Planned outage` — the rest of the content becomes the body.
3. The category's default title (e.g. “Security notice”).

## 3. Examples

### Security notice

```text
content: "Routine key rotation tonight at 22:00 UTC. Expect a brief sign-out."

tags:
  ["t","bnos.space-security"]
  ["t","critical"]
  ["subject","Scheduled key rotation"]
  ["r","/settings/notifications"]
```

### Update / feature

```text
content: "# New feature: split payments\nSplit a bill across methods at checkout."

tags:
  ["t","bnos.space-feature"]
  ["r","/pos"]
```

### Maintenance window with expiry

```text
content: "Nostr relays will be read-only during the maintenance window."

tags:
  ["t","bnos.space-maintenance"]
  ["expiration","1735689600"]
```

### Minimal (plain marker)

```text
content: "Welcome to your new BNOS workspace!"

tags:
  ["t","bnos"]
```

### Publish with `nostr-tools`

```ts
import { finalizeEvent, Relay } from 'nostr-tools';

const event = finalizeEvent(
	{
		kind: 1,
		created_at: Math.floor(Date.now() / 1000),
		tags: [
			['t', 'bnos.space-security'],
			['t', 'critical'],
			['subject', 'Security notice']
		],
		content: 'Please review the new staff permissions.'
	},
	ownerSecretKey // the key whose npub is allow-listed
);

const relay = await Relay.connect('wss://relay.example.com');
await relay.publish(event);
```

Any client that lets you add hashtags works too — just include the category tag.

## 4. Content formatting

The notice body is rendered with a small, HTML-free markdown subset (see
`src/lib/utils/note-markdown.ts`). Supported:

- **Blocks:** `# … ######` headings, `-`/`*`/`+` and `1.` lists, `>` quotes,
  fenced code blocks, `---` rules, blank-line paragraphs.
- **Inline:** `` `code` ``, `**bold**`, `_italic_`, `[text](url)`, `![alt](url)`,
  bare `http(s)` URLs, and `#hashtag`.
- **Media:** image/video URLs (by extension: `.png`, `.jpg`, `.webp`, `.gif`,
  `.avif`, `.svg`, `.mp4`, `.webm`, `.mov`) render inline as `<img>`/`<video>`.
  Two or more consecutive media become a thumbnail grid; click one to open a
  full-screen lightbox (arrow keys / Esc supported).
- **Tags:** inline `#tag` renders as a chip, alongside the event's `#t` tags
  shown in the detail view.

Rendering is token-based and never injects raw HTML, so a notice cannot run
script. Links are limited to `http(s)` and same-origin `/` paths.

## 5. Where notices appear

- **Topbar bell** — unread count, All/Unread tabs, per-row remove.
- **`/notifications`** — full list with a category chip; click a row to open it.
- **`/notifications/[id]`** — detail view: title, body, category + raw `#t` tag
  chips, source event id, times, and actions (open link, mark read/unread, remove).

Notices are de-duplicated by event id and persisted locally
(`bnos-os:notifications`), so re-syncing or reloading never re-announces one.

## 6. Security notes

- The allow-list is the whole trust boundary. It is enforced client-side, so it
  is not a server-authoritative control.
- Notice text is rendered as plain text. Only internal links (`/…`) become
  navigable; external URLs are shown as text and never opened automatically.
- Prefer short-lived notices: set `["expiration", …]` for time-bound
  announcements.
