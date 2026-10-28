# BNOS Console desktop (Tauri)

The desktop shell embeds the SvelteKit SPA using the system webview; it does not
run a Node server. Install Node and pnpm as described in the README, plus Rust
and the platform prerequisites in the [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/).
On macOS this includes Xcode command-line tools; Linux needs WebKitGTK and other
development packages, and Windows needs Microsoft C++ build tools and WebView2.

```sh
pnpm install --frozen-lockfile
pnpm desktop:dev       # Vite on 127.0.0.1:1420, then the native window
pnpm desktop:build     # static SPA only, in desktop-build/
pnpm desktop:package   # release binary and platform bundles in src-tauri/target/release/
```

GitHub Actions builds installers on every push to `main` and on manual dispatch.
Download the macOS DMG, Linux Debian package, and Windows NSIS installer from the
workflow run's artifacts. To publish a GitHub Release with all three installers,
update the versions in `package.json`, `src-tauri/tauri.conf.json`, and
`src-tauri/Cargo.toml`, merge them into `main`, then push the matching tag (for
example, `git tag v0.1.3` and `git push origin v0.1.3`). The tagged commit must
be reachable from `main`, and the tag must match the package and Tauri versions.
The release is published only after all three builds succeed. Installers are
unsigned, so distribution may trigger OS security warnings.

Build on the target platform and install the required signing credentials if
shipping signed/notarized packages. `pnpm tauri` exposes the Tauri CLI for other
options. The static build uses `index.html` as the fallback for existing client
routes and disables the web PWA service worker. The normal `pnpm build` remains
the web deployment with adapter-auto and its PWA.

The static desktop app cannot serve SvelteKit server endpoints, including the
optional `/api/media/upload` Cloudinary proxy. Configure a direct media provider
instead; desktop builds do not include server credentials. Browser extensions
such as NIP-07 signers are generally unavailable in a system webview; use a
supported key-based login. Desktop webview storage is separate from browser web
storage, so existing local data is not automatically migrated. Relay sync still
requires network access; local-first operation does not.
