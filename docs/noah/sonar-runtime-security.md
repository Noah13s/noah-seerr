# Runtime reliability, security and coverage

Local implementation batch, 26 October 2026. The starting default-branch Sonar
snapshot has 183 Seerr findings. The finding ledger records targets for fresh
analysis, not confirmed closures. No online dispositions have been changed.

## Request and account failures

Approve/decline actions own their promises and reject duplicate clicks while
changes are pending. A batch waits for every request, refreshes the resulting
state even after partial failure, and shows the existing localized error toast.
Modal completion owns refresh failures too. Linked-account deletion/revalidation
and link-modal refresh errors stay in the settings UI instead of becoming
unhandled rejections.

Notification agents remain independent background deliveries. Each agent owns
both synchronous exceptions and rejected deliveries; failure is logged without
preventing other agents or making a committed request appear to fail. This does
not introduce persistent notification retries or change delivery guarantees.

The infinite-scroll hook installs one listener/debouncer per mount, reads current
props and cancels both pending timers when unmounted. Scroll-state rerenders
no longer replace listeners or reset the debounce.

## Dependency installation

The ARM image build installs its compiler prerequisites with APK, then uses the
project's already pinned `node-gyp` dependency through the frozen pnpm lockfile.
The redundant unpinned global npm install is removed. Native lifecycle scripts
required by SQLite/bcrypt/sharp remain governed by `pnpm.onlyBuiltDependencies`.
This batch has not executed an ARM container build; the hosted production-image
smoke remains a required check.

## Why Sonar did not show coverage

SonarQube Cloud does not execute tests or calculate their coverage. Its automatic
analysis cannot import coverage; a CI scanner must run after the report exists.
See [Sonar's coverage guide](https://docs.sonarsource.com/sonarqube-cloud/analyzing-source-code/test-coverage/overview).

```mermaid
flowchart LR
  Tests[Tests instrument source] --> LCOV[LCOV report]
  LCOV --> Artifact[GitHub artifact]
  Artifact --> Scan[CI SonarScanner]
  Scan --> Cloud[Sonar coverage and quality gate]
```

The runner now creates report directories, fails on report-write errors, supports
both existing coverage flags and excludes test files from the production
coverage calculation. CI retains JUnit and LCOV for 14 days. Node coverage is
limited to loaded production modules; it is not coverage of every UI component.
The local suite reports 46.08% line coverage across 158 loaded source files.

### Activate CI analysis after reviewing and merging the workflow

All three repositories have a prepared `sonar` job and `sonar-project.properties`.
They remain disabled unless repository variable `SONAR_CI_ENABLED` is `true`.
This prevents automatic analysis and CI analysis from competing during migration.

1. Add a project-scoped analysis token as repository secret `SONAR_TOKEN`. Never
   place a token in source, a command argument, an artifact or a screenshot.
2. In each Sonar project, open Administration → Analysis Method and disable
   Automatic Analysis.
3. Set GitHub repository variable `SONAR_CI_ENABLED=true` and dispatch its normal
   workflow. Check the analyzed revision, coverage-import log and quality gate.
4. Enable the new job as a required check only after its first successful scan.

The jobs fetch full history, require nonempty reports, exclude fork PRs from
token-bearing scans and wait for Sonar's quality gate. They use normal
`pull_request`, never `pull_request_target`. Tests and coverage artifacts still
run on fork PRs. No cloud settings or credentials have been changed by this
source batch. On a failed migration, disable the variable and restore Automatic
Analysis until the scanner problem is resolved.

For Jellyfin Web the reports cover Vitest plus its independent Node casting
contracts. For Stream the scanner receives Flutter LCOV normalized to repository
paths plus compiled Android Java classes; Dart support also requires an eligible
Sonar plan for the private project. Host-test coverage is not native decoder or
physical-device coverage. Existing migrations remain in source analysis; only
their historical execution is excluded from unit-test coverage.

## Validation and remaining work

294 backend/client utility tests, four runner metatests, the final hook regression,
client/server typechecks, changed TypeScript ESLint and production server/Next
builds passed locally. Hosted container/browser gates and a fresh Sonar scan of
an approved commit remain necessary. No production deployment was performed.

Remaining work includes subscriber/entity and other screen promise paths,
active detail/request UI duplication, case-specific contextual security reviews,
and accessibility/localization debt. The green gate does not mean this backlog
is resolved. Never rewrite applied migrations merely to lower duplication.
