# Sonar remediation

## Priority one: 25 October 2026

This batch addresses the 18 BLOCKER/CRITICAL findings in the initial 217-issue
open backlog. Source changes are prepared locally; they are not cleared in
Sonar until analysis of the approved commit confirms the result. No rules were
disabled or exclusions added. Severity counts refer to Sonar's legacy severity,
not its newer impact labels.

### Changes and behavioral boundaries

- Generate a fresh salted fixture password hash; guard standalone test-account
  seeding as well as database reset. The deliberately enabled, empty-database
  demo path retains its explicit opt-in. No production account was changed.
- Remove the unused legacy browser JellyAPI helper after checking imports. Its
  authorization header was not an exposed production token. Active account
  linking and scoped playback-session paths remain in use.
- Keep the DNS cache binding private and read its current instance through a
  getter when settings are requested.
- Canonically order cleanup revisions/requesters numerically and episode keys
  explicitly. Approval fingerprints ignore query order but change when requester
  membership or watched state changes. Existing requester checks, 14-day delay,
  approval and required private-tracker seeding still apply.
- Give six Cypress cases explicit outcome assertions and match nested API paths
  in pull-to-refresh. These historical external-service cases are separate from
  the maintained isolated browser fixture.
- Replace whole-checkout Docker copies with build/runtime allowlists and exclude
  secret/key/database/artifact files from context. Production runs as `node`,
  with a writable configuration directory. A new `container-smoke` CI job starts
  the image without networking and checks runtime startup and packaged content.

### Verification

| Check | Local result / remaining gate |
| --- | --- |
| Full backend/client utility suite | 279 passed before final test relocation and type-only edits |
| Final affected cleanup, seed and redirect tests | 17 passed |
| Client and server TypeScript; changed-file lint | Passed |
| Next production build and compiled backend build | Passed |
| Actual Docker image startup | Pending Linux CI; local Docker daemon unavailable |
| Historical external-data Cypress cases | Assertions reviewed; full suite not executed locally |

The production backend includes separately maintained integration behavior.
Passing a clean-source image test does not establish full parity with the live
backend. Follow [deployment boundaries](deployment.md) before any release; this
remediation batch has not replaced the production backend.

### Finding ledger

| Finding | Rule / source at initial scan | Disposition |
| --- | --- | --- |
| `AaFoJSXhOZDKsE3tmJAx` | `typescript:S2871`; `server/lib/cleanupPolicy.ts:75` | **Source fix pending analysis.** Explicit numeric or locale ordering; cleanup approval invariants covered. |
| `AaFoJSXhOZDKsE3tmJAy` | `typescript:S2871`; `server/lib/cleanupPolicy.ts:239` | **Source fix pending analysis.** Explicit numeric or locale ordering; cleanup approval invariants covered. |
| `AaFoJSXhOZDKsE3tmJAz` | `typescript:S2871`; `server/lib/cleanupPolicy.ts:269` | **Source fix pending analysis.** Explicit numeric or locale ordering; cleanup approval invariants covered. |
| `AaFoJSXhOZDKsE3tmJA0` | `typescript:S2871`; `server/lib/cleanupPolicy.ts:278` | **Source fix pending analysis.** Explicit numeric or locale ordering; cleanup approval invariants covered. |
| `AaFoJSb2OZDKsE3tmJBm` | `typescript:S2871`; `server/i18n/extractMessages.ts:98` | **Source fix pending analysis.** Explicit numeric or locale ordering; cleanup approval invariants covered. |
| `AaFoJSb0OZDKsE3tmJBi` | `typescript:S2871`; `server/test/index.mts:65` | **Source fix pending analysis.** Explicit numeric or locale ordering; cleanup approval invariants covered. |
| `AaFoJSbVOZDKsE3tmJBg` | `secrets:S8215`; `server/utils/seedTestDb.ts:18` | **Source fix pending analysis.** Fresh salted fixture hash and production seeding guard. |
| `AaFoJSl5OZDKsE3tmJD8` | `docker:S6470`; `Dockerfile:65` | **Source fix pending analysis.** Build/runtime COPY allowlists and secret context exclusions. |
| `AaFoJSbxOZDKsE3tmJBh` | `typescript:S6861`; `server/utils/dnsCache.ts:4` | **Source fix pending analysis.** Private DNS cache binding and getter. |
| `AaFoJSb2OZDKsE3tmJBl` | `typescript:S2871`; `server/i18n/extractMessages.ts:93` | **Source fix pending analysis.** Explicit numeric or locale ordering; cleanup approval invariants covered. |
| `AaFoJSliOZDKsE3tmJDa` | `typescript:S2699`; `cypress/e2e/pull-to-refresh.cy.ts:8` | **Source fix pending analysis.** Explicit Cypress outcome assertion. |
| `AaFoJSlmOZDKsE3tmJDe` | `typescript:S2699`; `cypress/e2e/discover.cy.ts:63` | **Source fix pending analysis.** Explicit Cypress outcome assertion. |
| `AaFoJSlmOZDKsE3tmJDf` | `typescript:S2699`; `cypress/e2e/discover.cy.ts:104` | **Source fix pending analysis.** Explicit Cypress outcome assertion. |
| `AaFoJSliOZDKsE3tmJDb` | `typescript:S2699`; `cypress/e2e/login.cy.ts:2` | **Source fix pending analysis.** Explicit Cypress outcome assertion. |
| `AaFoJSliOZDKsE3tmJDc` | `typescript:S2699`; `cypress/e2e/login.cy.ts:8` | **Source fix pending analysis.** Explicit Cypress outcome assertion. |
| `AaFoJSljOZDKsE3tmJDd` | `typescript:S2699`; `cypress/e2e/user/user-list.cy.ts:21` | **Source fix pending analysis.** Explicit Cypress outcome assertion. |
| `AaFoJSlAOZDKsE3tmJDO` | `typescript:S6418`; `src/utils/jellyfin.ts:31` | **Source fix pending analysis.** Removed unreferenced legacy helper; active scoped authentication unchanged. |
| `AaFoJSl4OZDKsE3tmJD4` | `docker:S6470`; `Dockerfile.local:7` | **Source fix pending analysis.** Build/runtime COPY allowlists and secret context exclusions. |

## Next priorities

1. Analyze the approved commit and reconcile every ledger entry with its new
   location/status; do not assume that moving code resolves a finding.
2. Address remaining security and reliability findings by impact and reachability,
   including build/install trust boundaries. Review false positives individually
   with data-flow evidence rather than marking whole rule groups safe.
3. Address remaining correctness, accessibility and maintainability debt. Handle
   asynchronous errors explicitly instead of hiding promise warnings with `void`.

A green new-code quality gate does not mean the overall backlog is empty. Update
this record after CI with exact commit/check references and distinguish local,
emulated and physical-device evidence.
