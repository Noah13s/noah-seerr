# One-tap search and catalog navigation on tablets

The old title card placed its only real media link inside a hover/detail
transition. A touch user's first tap merely exposed that preview. Mouse hover
made the same card seem to work normally on a desktop. The behavior was
reproduced with Android-tablet touch input both with and without simulated
standalone display mode; it was not proved exclusive to installed PWAs.

Every movie, series and collection poster now has a permanent, named Next link.
The first tap and keyboard Enter navigate directly to the media page. The
hover preview remains for mouse users, with a duplicate untabbable overlay link.
Keyboard focus can reveal that preview; touch focus cannot insert an overlay
between pointer-down and click and thereby replace the tapped target.

Decorative badges and empty action rows do not intercept poster taps. Actual
request/watchlist/continue controls remain independent of the poster link and
are not nested inside it. Placeholder images retain navigation too.

The existing service worker's network-first navigation and versioned asset cache
are preserved. This correction does not clear installed-app data or offline
media. An already-open app must load the new frontend through its normal reload
or a full close/reopen; reinstalling the PWA is unnecessary.

Verification includes four rendered-card link regressions, TypeScript/lint/build
checks and the full 362-test Seerr suite. Public browser tests activated a real
service worker and exercised a 1024×1366 touch viewport with Android tablet user
agent, simulated standalone mode, the 2003 film result and keyboard navigation.
This is tablet emulation, not remote verification on the reporting user's actual
device or proof that its particular browser has updated. The exact film named
in the report was not independently confirmed; the failure is in generic cards.
