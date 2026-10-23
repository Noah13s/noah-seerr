# Noah Seerr test gates

The fork's active workflow is `.github/workflows/noah-player.yml`.
It has two independent jobs:

| Check | Execution | Evidence |
| --- | --- | --- |
| `bridge-and-build` | Node 22.19, complete backend/utility suite, runner failure metatest, native session contracts, both typechecks, backend and Next builds | JUnit artifact, 14 days |
| `browser-fixture` | Built Next UI in Electron/Cypress; loopback-only SSR/API fixture; no Cypress recording key | Browser video/screenshots and fixture log, 14 days |

## Local commands

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm typecheck
node --test scripts/test-runner.test.cjs scripts/native-playback-session.test.cjs
pnpm test
pnpm build:server
node -e "require('./dist/lib/native-playback-session.cjs')"
pnpm build:next
# Terminal 1; binds 127.0.0.1 only, uses port 5055:
node scripts/browser-fixture.cjs
# Terminal 2:
pnpm exec cypress run --config-file cypress.fixture.config.ts --browser electron
```

## Isolation and meaningful failures

`pnpm test` sets `NODE_ENV=test`, uses in-memory SQLite and blocks external
HTTP/HTTPS. The entrypoint now returns nonzero for failed child tests. Its
metatest runs the actual entrypoint with an intentionally failing temporary
test and verifies that exit code. Do not use `ALLOW_NETWORK` for CI fixtures.

`server/test/mediaPipeline.test.ts` composes the actual mounted API, Express
sessions, SQLite, ORM subscribers, real Arr HTTP client and scanner against a
loopback fake download service. It checks import/availability, service outage,
approved-deletion state followed by a different user's request, and profile/admin
boundaries. It does not download a torrent or delete a library file.

Browser fixtures test actual SSR plus client rendering at phone and desktop
widths. They test planned list/filter preservation, future metadata, anime opt
out, session ownership and anonymous redirection. They intentionally replace
the backend API, which is covered separately above. The inherited recorded
Cypress configuration is retained for upstream work; it is not the fork's gate.

The full gate exposed missing `WatchHistory`/`CleanupReview` entity and route
registrations and an unbundled native session helper. These are restored in
source so tests cannot pass against a backend that silently omits maintained
features. `showAnime` already has migrations; its missing ORM field is restored.

Disposable patched Jellyfin, storage-pressure and Android emulator tests belong
to the private Noah Stream integration repository. These jobs use generated
media and test credentials. They do not establish physical TV/Cast/Safari,
GPU tone mapping or long-run stability.

## SonarQube Cloud

`SonarCloud Code Analysis` supplements both test jobs. Its current automatic
analysis reads repository source; it does not execute these tests or import
coverage. A displayed zero/missing coverage value is not a measured result from
this suite. See [Sonar's coverage documentation](https://docs.sonarsource.com/sonarqube-cloud/analyzing-source-code/test-coverage/overview/).
Keep test/build and Sonar checks green for the exact PR commit before merging.
The workflow runs on PR updates and `main`, avoiding duplicate branch-push runs;
manual dispatch is available for a branch without a PR.
