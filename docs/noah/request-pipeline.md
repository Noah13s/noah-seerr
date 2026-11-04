# Request progress

Request badges and download details use the same stage display: searching,
torrent metadata, downloading, importing and library synchronization. They show
actual transfer percentages only when a known payload is downloading. Search
can show a real episode step and elapsed time; import is never called available
solely because transfer reached 100%.

The optional server-side monitor atomically publishes a versioned snapshot to
`/app/config/request-pipeline.json` (`REQUEST_PIPELINE_FILE` can override it).
`server/lib/requestPipeline.ts` validates freshness, size and allowlisted fields,
then merges progress by Arr server, media identity and torrent hash. A five-second
cache bounds file reads. Existing queue data remains the fallback when the
monitor is missing, malformed or older than three minutes.

Administrators see monitor health, active stages and old/held attempts in
**Admin tools**. `GET /api/v1/admin-tools/pipeline` requires administrator
permission and returns `private, no-store`. It exposes no tracker URLs, service
credentials or local file paths. The normal per-media API remains the source
for user-facing badges; no new public administrative access is granted.

Recovery policy and its deployment belong to the private integration repository.
It rechecks live request ownership and uses bounded retries. Superseded jobs are
labelled and retained; media deletion still requires the existing approval flow.

Run the standard unit suite, TypeScript checks and production build when
changing this contract. Focused tests cover synthetic search rows, seasonal
filtering, stale snapshots, current byte progress, old attempts and French
rendering. Test production packaging with an isolated database and network
disabled before switching the live image; preserve the validated authentication
and playback-session handlers.
