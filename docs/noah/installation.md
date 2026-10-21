# Installation and setup

[Documentation](README.md) · [Development](development.md)

## Choose the intended setup

| Setup | Requirements |
| --- | --- |
| Check/build the frontend | This fork, pinned Node/pnpm and dependencies |
| Run the UI against a test API | Frontend plus an approved test backend and development proxy |
| Run the complete custom server | Runtime helper, server dependencies/configuration and a backend parity review |
| Replace production | Coordinated private integration release; authenticated runtime gates |

This is not a self-contained copy of the deployed runtime. In particular,
`server/routes/auth.ts` requires `server/lib/native-playback-session.cjs`, which
is maintained in the private integration repo. A missing-helper error is a
checkout/deployment prerequisite, not a reason to reset users or recreate tokens.

## Dependency setup

Match [package.json](https://github.com/Noah13s/noah-seerr/blob/main/package.json): Node 22.19.0 for custom CI and
pnpm 10.24.0. Run these from a shell with that Node version active:

```sh
git clone https://github.com/Noah13s/noah-seerr.git
cd noah-seerr
corepack enable
pnpm install --frozen-lockfile
pnpm typecheck:client
pnpm build:next
```

For CI/frontend-only work, `CYPRESS_INSTALL_BINARY=0` skips downloading Cypress;
set it using your shell before installing. Keep `pnpm-lock.yaml` intact.

## Local UI and full application

`pnpm exec next dev -p 3000` starts the frontend development server. Use a
development reverse proxy to route `/api/` to an approved isolated backend on
the same browser origin. Without that backend, catalog/auth APIs cannot work.

`pnpm dev` starts the Express/Next application and requires the complete server
runtime, including the approved session helper. The application default port is
5055 (`PORT` overrides it). `CONFIG_DIRECTORY` selects isolated configuration;
otherwise the normal local config location applies. Do not reuse production
settings/session databases for local development.

## Service configuration

Configure Jellyfin, Radarr and Sonarr through the standard setup/settings UI.
The integrated player additionally needs the reviewed Jellyfin Web fork served
at `/player/web/` and API/media under `/player/` on the same origin.
Keep service credentials server-side; never embed an admin API key in the UI.
For generic settings, use the [upstream docs](../README.md).
