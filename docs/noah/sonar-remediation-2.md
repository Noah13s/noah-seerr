# Duplication and asynchronous job ownership

## Batch two: local source, 25 October 2026

The starting Sonar snapshot contains 199 open findings and 8.7% duplication
(12,023 duplicated lines). Source changes in this batch target 16 recorded
floating-promise findings, plus the largest pair of active settings-form
duplication hotspots. Fresh Sonar closure and the new overall duplication
percentage require analysis of an approved commit; these are not local results.

### Shared ARR controls

`ArrFormFields.tsx` owns connection fields, quality/root/language selectors,
standard/anime tags and common service options. The Radarr and Sonarr modals
retain their own messages, schema, submissions and media-specific settings.

The two forms and shared implementation total 439 fewer source lines than the
original two forms. This is a source-size comparison, not an estimate of Sonar's
CPD algorithm. Existing label IDs, password masking, localized descriptors and
profile ordering are preserved. Standard and anime tags now have distinct
accessible input IDs and continue to store separate numeric selections.
Selectors stay disabled during connection testing; failed tag updates surface
a localized form error. Historical applied database migrations were not
rewritten to lower a duplication metric.

### Async work belongs to its job

All 13 scheduled callbacks use `scheduledTask`: await the task, report a failed
tick with job identity and allow the next scheduled invocation to run. This
replaces detached work, including image-cache cleanup, without changing cron
schedules, scanner running/cancel hooks or media deletion rules.

`DownloadTracker.updateDownloads()` now waits for both services; each service
waits for its queue requests. An isolated HTTP fixture verifies that a slow
Sonarr queue keeps the tick pending and duplicate Radarr server definitions
receive the same completed progress. No retry loop or production service call
was added to the tests.

### Verification

- Full suite: 286 passed before the final tag/language-selector extraction.
- Final focused suite: eight passed, including saved field values/password
  masking, optional anime paths, independent tag selections, failure/retry
  behavior and asynchronous download completion.
- Test-runner regression cases: two passed. A dedicated test tsconfig supports
  both client and server aliases without changing production compiler paths.
- Client/server typechecks, compiled backend and changed-file lint passed.
- Next production build passed.

These tests use disposable fixtures. They do not demonstrate parity between
the clean-source backend and the separately maintained live integration
backend; follow the existing deployment procedure. No live server or device
change is part of this source batch.

Remaining work includes other async call sites, Helm/CI trust boundaries and
additional runtime UI duplication. No Sonar rules or source exclusions changed.
