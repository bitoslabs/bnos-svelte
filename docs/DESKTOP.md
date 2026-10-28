# Desktop packaging

The console can also run as an Electron application on macOS, Windows, and Linux.
The regular `pnpm dev` and `pnpm build` web deployment are unchanged.

Install dependencies with the pinned pnpm version (`pnpm install --frozen-lockfile`),
then run from `bnos-svelte/`:

- `pnpm desktop:start` builds the offline desktop bundle and launches it.
- `pnpm desktop:dir` builds an unpacked application in `desktop-dist/`.
- `pnpm desktop:package` builds an installer in `desktop-dist/`: DMG on macOS,
  NSIS on Windows, or AppImage on Linux. Build on the target OS; platform signing,
  notarization, and distribution credentials are not configured.

The desktop build uses a static SPA fallback and a secure `bnos://app` origin;
assets are bundled locally and no web server is required. The web PWA service
worker is disabled for this build. Local storage and IndexedDB live in Electron's
application data directory and persist across restarts and updates. They are
separate from the web browser and from other Electron application identities;
existing browser data is not automatically migrated. Back up local data and
keys before changing or uninstalling the app. Nostr sync and its retry queue
continue to use the existing local-first data layer and require network access
only for synchronization. NIP-07 browser extensions are not installed in the
Electron window; use the supported private-key login instead.

Installers are unsigned by default and may trigger operating-system security
warnings. Desktop development uses a production build rather than a live-reload
server. No automatic update mechanism is configured.
