# AGENTS.md — BNOS Svelte

Guidance for AI agents working in this repo. Keep it short and follow it.

## What this is

BNOS (Bitcoin/Nostr point-of-sale & commerce) rebuilt on **SvelteKit 2 + Svelte 5
runes + Tailwind CSS v4**, using `@bitos/bnos-core` for the GLO / Nostr data

## Package manager

**yarn** (via corepack). The only lockfile is `yarn.lock` — CI runs
`yarn install --frozen-lockfile --non-interactive`. Do **not** add
`package-lock.json` or `pnpm-lock.yaml`.

Node version: see the deploy workflow (currently `22.21.1`).

## Commands

| Command          | What it does                                                            |
| ---------------- | ----------------------------------------------------------------------- |
| `yarn dev`       | Dev server                                                              |
| `yarn check`     | `svelte-kit sync && svelte-check` — types + a11y compiler warnings      |
| `yarn lint`      | `prettier --check . && eslint .`                                        |
| `yarn format`    | `prettier --write .`                                                    |
| `yarn build`     | Production build — **must finish with 0 `vite-plugin-svelte` warnings** |
| `yarn test:unit` | Vitest (`*.test.ts`, `*.svelte.test.ts`)                                |
| `yarn test:e2e`  | Playwright                                                              |

After non-trivial changes run `yarn format && yarn check && yarn build`.

> **Known pre-existing debt (do not churn it in unrelated changes):**
> `eslint` reports existing `@typescript-eslint/no-explicit-any` and
> `svelte/no-navigation-without-resolve` violations, and `svelte-check` reports
> pre-existing `@bitos/bnos-core` type errors (e.g. `GloOrder.createdAt`,
> `OrderLine.price`). A build with zero warnings is the bar; these are separate.

## Svelte conventions

- **Svelte 5 runes only** — `$state`, `$derived`, `$derived.by`, `$props`,
  `$bindable`, `$effect`. No legacy stores API, no `export let`.
- To make a derived value track a timer/reactive source, read it **inside**
  `$derived.by`:
  ```ts
  const list = $derived.by(() => {
  	void tick; // dependency
  	return build();
  });
  ```
  Never `void something;` at the top level of `<script>` — that captures only the
  initial value and triggers `state_referenced_locally`.

## Styling / Tailwind v4

- Tokens live in `src/app.css`. `@theme` holds base `--color-*` design tokens;
  runtime theming uses plain `--ui-*`, `--surface-*`, `--tone-*`,
  `--interactive-*` variables set on `:root` / `.dark` / `html[data-*]`.
- **Canonical arbitrary values** — use the v4 parenthesis shorthand:
  - ✅ `text-(--ui-text-muted)` · ✅ `bg-(--ui-bg-muted)/50`
  - ❌ `text-[var(--ui-text-muted)]`
- Class **order** is owned by `prettier-plugin-tailwindcss`. Run `yarn format`;
  never hand-sort classes.
- Reuse the primitives in `src/lib/components/ui/*` (Button, Input, Select,
  Switch, Checkbox, Dialog, Badge, …). `cn()` (`$lib/utils/cn`) merges classes.

## Accessibility (the build warns otherwise)

- A `<label>` must be associated with a control:
  - field beside an `Input`/`Select` → `<label for="id">` + matching `id`;
  - toggle row → plain `<div>` title + `Switch` `label={…}`;
  - button group / display-only caption → `<div>`, not `<label>`.
- Icon-only buttons need `aria-label` (or `title`) and `type="button"`.
- Never put `onclick` on a non-interactive element — use a `<button>`.
- Close non-void tags explicitly: `<span></span>`, not `<span />`.

## Components cheat-sheet

- `Input` / `Select` forward `id` and ARIA through rest props.
- `Switch` takes `label` (→ `aria-label`); it is a `role="switch"` button.
- `Checkbox` wraps a native `<input>` and renders its own `<label>`.
- `Icon` uses `@iconify/svelte` with the offline `icons.ts` registry.

## i18n

All user-visible text goes through `t('key')` from `$lib/i18n/i18n.svelte`;
strings live in `src/lib/i18n/locales/*.ts`. Never hard-code UI strings.

## Data layer

`src/lib/nostr/store.svelte.ts` is the single data entrypoint — local-first
(localStorage) with Nostr sync. Kinds come from `@bitos/bnos-core`. Auth
(NIP-07 + nsec) is in `session.svelte.ts`.

## Layout

- `src/routes/**` — pages (`+page.svelte`, `+layout.svelte`).
- `src/lib/{nostr,domain,pos,crypto,media,settings,theme,stores,utils,components}`.
- `src/lib/vendor/qrcodegen.ts` — vendored upstream QR generator; **do not edit**.
- Docs: `README.md`, `docs/*.md`, `AUDIT.md`, `STAFF_AUDIT.md`.
- `.kilo/` (gitignored) holds worktrees / runtime state — **do not edit by hand**.

## Don'ts

- Don't commit secrets — `.env` is ignored; keep `.env.example` current.
- Don't add comments that merely restate the code.
- Don't reformat unrelated files in a focused change.
