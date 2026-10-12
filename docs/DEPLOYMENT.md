# BNOS deployment

## Server layout

| Domain            | App                    | Serving path                                      |
| ----------------- | ---------------------- | ------------------------------------------------- |
| `app.bitos.space` | SvelteKit console      | Nginx to systemd `bnos-svelte` on port 5174       |
| `app.bnos.space`  | Same SvelteKit console | Nginx to systemd `bnos-svelte` on port 5174       |
| `bnos.bnos.space` | Legacy Nuxt export     | Nginx static root `/var/www/bnos.bnos.space/html` |

The live Svelte release is `/srv/apps/bnos-svelte/current`, a symlink into
`/srv/apps/bnos-svelte/releases`. The service runs as `deploy`. The old Nuxt
source is `/srv/apps/bnos/legacy-nuxt`; its static export is separate from the
source. Other directories in `/srv/apps/bnos` serve separate BNOS components.

## Automatic deployment

The workflow in `.github/workflows/deploy.yml` runs on pushes to `main` and
manual dispatch. It builds on GitHub, then calls `/usr/local/bin/bnos-deploy` over
SSH. The server fetches and builds that exact commit in a new release directory,
switches `current`, restarts the service, and checks local HTTP. It restores the
previous release if that health check fails.

The repository is public; keep the private SSH key only in the GitHub
`production` environment secret named `BNOS_DEPLOY_SSH_KEY`. The public key on
the server is restricted to the deployment command. The workflow pins the
server's SSH host key. Never commit the private key or a production `.env` file.

On a machine with `gh` authenticated for `bitoslabs/bnos-svelte`, create the
`production` environment and add the secret from the private key file:

```sh
gh api -X PUT repos/bitoslabs/bnos-svelte/environments/production
gh secret set BNOS_DEPLOY_SSH_KEY --env production --repo bitoslabs/bnos-svelte < /private/tmp/bnos_github_actions_20261012
```

The current service still launches `vite preview`, preserving the existing
release behavior. Once the build gate is healthy, migrate to an explicit Node
adapter or static SPA build. A single Yarn lockfile should then replace the
three lockfiles currently in this repository.

**Current build gate:** both `main` and `develop` import catalog-kit symbols from
`@bitos/bnos-core` that are absent from published version `0.2.1`. Resolve and
publish that core API, or update the app to use the published API, before the
next production deploy. The workflow stops on a failed build and leaves the
current release running.
