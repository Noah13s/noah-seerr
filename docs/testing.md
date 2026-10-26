# Noah Seerr test gates

The fork's active workflow is `.github/workflows/noah-player.yml`.
It has three regular jobs and a separately enabled Sonar job:

| Check | Execution | Evidence |
| --- | --- | --- |
| `bridge-and-build` | Node 22.19, complete backend/utility suite with coverage, runner failure/coverage metatests, native session contracts, both typechecks, backend and Next builds | JUnit and LCOV, 14 days |
| `container-smoke` | Production Docker image, non-root runtime and isolated startup | Container logs |
| `browser-fixture` | Built Next UI in Electron/Cypress; loopback-only SSR/API fixture; no Cypress recording key | Browser video/screenshots and fixture log, 14 days |
| `sonar` (opt-in) | Current-commit static analysis and LCOV import after tests/build | Sonar quality gate |

See [coverage and the CI migration](noah/sonar-runtime-security.md) before enabling
`SONAR_CI_ENABLED`. Reports alone do not populate automatic Sonar analysis.

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

CI analysis is enabled on this fork; Automatic Analysis is disabled. The `sonar`
job imports the c8 LCOV artifact from the same commit. A report that imports
successfully can still fail the unchanged 80% new-code coverage gate.
See [Sonar's coverage documentation](https://docs.sonarsource.com/sonarqube-cloud/analyzing-source-code/test-coverage/overview/).
Keep test/build and Sonar checks green for the exact PR commit before merging.
The workflow runs on PR updates and `main`, avoiding duplicate branch-push runs;
manual dispatch is available for a branch without a PR.

### Coverage-gate regressions

`server/job/schedule.test.ts` registers the real scheduled-job callbacks against
an in-memory scheduler and isolated scanner methods. It verifies media-server
routing, configured cron values, cancellation, download/cache maintenance and
recovery after a rejected scan. It starts no real timers or network requests.

`server/test/**` and `scripts/check-runtime-image.mjs` are test runners/fixtures,
not application code. Sonar classifies them as tests; production schedulers and
other application source remain in coverage analysis. Do not lower the gate or
move the new-code baseline to hide uncovered production paths.
