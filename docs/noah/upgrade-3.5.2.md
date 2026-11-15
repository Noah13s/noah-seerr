# Seerr 3.5.2 upgrade review

[Deployment and updates](deployment.md) · [Official release notes](https://github.com/seerr-team/seerr/releases/tag/v3.5.2)

The 3.5.0 → 3.5.2 review includes the intervening 3.5.1 security update.
The stable release is merged into the customized source rather than replacing
the installation with the upstream application. Runtime changes must pass the
compiled-handler and isolated-configuration gates before promotion.

| Upstream change | Relevance and integration decision |
| --- | --- |
| Three security fixes, request-option permission enforcement, image proxy hardening, credential-safe cache logging | Apply the upstream server changes and run their security regressions. Retain custom login, pairing and per-device session handling. |
| Node 22.23.5 and refreshed dependencies | Use the official pinned 3.5.2 runtime and build against the updated lockfile. Preserve the custom production-image allowlist. |
| Jellyfin season-ID filtering and recent season/episode scans | Apply alongside the existing missing-playback-link recovery. This helps anime and series availability without replacing Seerr watch history with Jellyfin play counts. |
| Download polling survives queue/import transitions | Merge with the custom progress behavior, including opening an already-processing request before any download was observed. |
| Abandoned-season resolution, deleted-media request decline, savepoint collision fixes | Apply together with custom deletion, seeding retention and re-request protections; verify existing request state survives the update. |
| Radarr searches only available releases | Apply the availability guard; unreleased requests remain monitored instead of repeatedly searching too early. |
| Server-specific override rules and API request permission checks | Apply without relaxing advanced-request permissions or changing the configured audio, subtitle, quality and size preferences. |
| Trending back-navigation, translated text and modal fixes | Preserve the custom anime preference, personal watch status, PWA navigation and French labels while merging the fixes. |
| Literal SQLite migration defaults | Include the corrected historical migration sources. Back up the database and verify the schema; do not replay already-applied migrations. |
| Plex PIN/watchlist fixes, Discord/Slack labels and notification documentation | Retain upstream compatibility. Plex-specific features do not require enabling a new service on this Jellyfin installation. |

## Useful follow-up work

Add end-to-end coverage for a request moving through search, download, import,
deletion and re-request, including anime season numbering. Exercise concurrent
request completion to detect transaction/savepoint regressions. These are
separate from enabling new providers or changing existing request preferences.

Upstream image-size reductions are useful, but the public fork keeps an explicit
production file allowlist. Its container build must not copy a checkout or
operator files into the runtime merely to match the upstream Dockerfile.

## Rollout evidence

The private integration repository records the exact upstream commit, runtime
image digest, changed compiled modules, frontend build identity, test results,
configuration/database backups and rollback procedure. Verify both normal and
administrator identities against an isolated copy before switching production.
An image version string or a successful frontend build alone is insufficient.
## Native playback contract follow-up

The initial upgrade retained the native-session handler but omitted its OpenAPI
path. The request validator therefore returned 404 before TV playback could
authenticate. The schema now includes `/auth/jellyfin-native-session`; cookie
authentication remains required. Regression tests check all maintained auth
routes against the production schema and run native-session requests through
the real validator, including anonymous and unknown-route rejection.

The schema-only correction is live in image `3.5.2-121`. Physical TCL build 1056
successfully authenticated and reached 1080p Direct Play in about 4.1 seconds
after a single retry. No APK update was required. The initial source-route gate
was insufficient to validate this boundary; keep the new schema tests in the
required suite for future upstream merges.

The CI coverage follow-up adds session linking/reuse, scoped logout, activity,
warmup and diagnostic-limit tests. The local full suite passed 460 cases; the
expanded focused auth/schema run passed 64 cases, and lint/server type checking
passed. The previously uncovered changed auth lines are now exercised. Fresh
Sonar confirmation remains pending; the 80% gate is unchanged.
