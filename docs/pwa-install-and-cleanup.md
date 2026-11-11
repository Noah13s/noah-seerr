# PWA installation and retained download cleanup

## Profile-menu installation

The application-level `PWAInstallProvider` captures `beforeinstallprompt` once
and shares it with the install banner and profile-menu **Install app** button.
Dismissing the banner affects only its automatic visibility. It does not remove
the profile-menu installation path. A browser prompt is consumed once; blocked,
expired or unsupported prompt cases show platform-specific manual instructions.

Safari on iPhone/iPad uses Share → Add to Home Screen; supported macOS Safari
uses File → Add to Dock. Chrome/Edge use the browser's installation prompt when
provided. This is browser-controlled installation, not an APK download. The
button is hidden in standalone mode or after an `appinstalled` event. New text
is localized in French and has English defaults. Private/blocked local storage
must not break installation or dismissal.

Verify desktop/mobile layout, a dismissed banner followed by menu installation,
a consumed prompt, manual instructions, installation completion and absence of
duplicate prompt calls. Synthetic browser events validate application handling;
they do not prove a real iOS installation completed.

## Cleanup safety

`cleanupQueueBlocks` distinguishes a rejected completed Sonarr replacement from
an active download/import. Ignoring a queue entry requires all of:

- completed transfer with zero bytes remaining;
- `importBlocked`, not `importPending` or `importing`;
- an identified download hash and episode ID;
- a current `/episode` response with an imported episode-file ID;
- the same conditions for every correlated pack row, with no shared unknown or
  other-series row.

Truncated/malformed queues, missing files, unidentified episodes and active
upgrades continue to protect the library. Radarr's existing protection remains.
Cleanup is scoped to the reviewed season using current episode identities.
Another season's pack is irrelevant only when every correlated queue row is
identified and outside that scope. Unknown or shared active packs are protected;
a new download for another episode of the reviewed season remains relevant.
After queue checking, the existing Jellyfin playback guard still protects both
playing and paused media. Approval tokens, reviewed-file checks, 14-day policy,
manual override and required private seeding retain their existing ownership.

The fix permits an administrator to reach the confirmation preview for a retained
rejected pack. It does not automatically approve or execute media deletion, or
remove Sonarr rows, torrent payloads or seeding obligations.

Regression tests are in `server/lib/cleanupQueue.test.ts` and
`server/lib/cleanupIdle.test.ts`; existing cleanup approval/file-change tests
remain in `server/lib/cleanup.test.ts`.
