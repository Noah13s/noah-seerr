import { MediaServerType } from '@server/constants/server';
import blocklistedTagsProcessor from '@server/job/blocklistedTagsProcessor';
import { scheduledJobs, startJobs } from '@server/job/schedule';
import availabilitySync from '@server/lib/availabilitySync';
import downloadTracker from '@server/lib/downloadtracker';
import ImageProxy from '@server/lib/imageproxy';
import refreshToken from '@server/lib/refreshToken';
import {
  jellyfinFullScanner,
  jellyfinRecentScanner,
} from '@server/lib/scanners/jellyfin';
import { plexFullScanner, plexRecentScanner } from '@server/lib/scanners/plex';
import { radarrScanner } from '@server/lib/scanners/radarr';
import { sonarrScanner } from '@server/lib/scanners/sonarr';
import { getSettings } from '@server/lib/settings';
import watchlistSync from '@server/lib/watchlistsync';
import logger from '@server/logger';
import schedule from 'node-schedule';
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';

function fixture(t: TestContext, type: MediaServerType) {
  const settings = getSettings();
  const previous = settings.main.mediaServerType;
  settings.main.mediaServerType = type;
  const callbacks = new Map<schedule.Job, () => Promise<void>>();
  t.after(() => {
    settings.main.mediaServerType = previous;
    scheduledJobs.splice(0);
  });
  t.mock.method(schedule, 'scheduleJob', (...args: unknown[]) => {
    const job = {} as schedule.Job;
    callbacks.set(job, args.at(-1) as () => Promise<void>);
    return job;
  });
  const scanners = [
    plexRecentScanner,
    plexFullScanner,
    jellyfinRecentScanner,
    jellyfinFullScanner,
    radarrScanner,
    sonarrScanner,
    blocklistedTagsProcessor,
  ];
  const runs = scanners.map((scanner) =>
    t.mock.method(scanner, 'run', async () => {})
  );
  const cancellations = scanners.map((scanner) =>
    t.mock.method(scanner, 'cancel', () => {})
  );
  for (const scanner of scanners)
    t.mock.method(scanner, 'status', () => ({ running: true }));
  t.mock.method(refreshToken, 'run', async () => {});
  t.mock.method(watchlistSync, 'syncWatchlist', async () => {});
  t.mock.method(availabilitySync, 'run', async () => {});
  t.mock.method(availabilitySync, 'cancel', () => {});
  const update = t.mock.method(
    downloadTracker,
    'updateDownloads',
    async () => {}
  );
  const reset = t.mock.method(
    downloadTracker,
    'resetDownloadTracker',
    () => {}
  );
  const clear = t.mock.method(ImageProxy, 'clearCache', async () => {});
  return { callbacks, runs, cancellations, update, reset, clear };
}

for (const type of [
  MediaServerType.PLEX,
  MediaServerType.JELLYFIN,
  MediaServerType.EMBY,
  MediaServerType.NOT_CONFIGURED,
]) {
  test(`scheduled jobs route scans only to the configured media server (${type})`, async (t) => {
    const f = fixture(t, type);
    startJobs();
    const ids = scheduledJobs.map((job) => job.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(ids.includes('plex-full-scan'), type === MediaServerType.PLEX);
    assert.equal(
      ids.includes('plex-watchlist-sync'),
      type === MediaServerType.PLEX
    );
    assert.equal(
      ids.includes('jellyfin-full-scan'),
      type === MediaServerType.JELLYFIN || type === MediaServerType.EMBY
    );
    for (const job of scheduledJobs) {
      assert.equal(job.cronSchedule, getSettings().jobs[job.id].schedule);
      await f.callbacks.get(job.job)!();
      if (job.running && job.id !== 'availability-sync')
        assert.equal(job.running(), true);
      job.cancelFn?.();
    }
    assert.equal(
      f.runs[0].mock.callCount(),
      type === MediaServerType.PLEX ? 1 : 0
    );
    assert.equal(
      f.runs[2].mock.callCount(),
      type === MediaServerType.JELLYFIN || type === MediaServerType.EMBY ? 1 : 0
    );
    assert.equal(f.runs[4].mock.callCount(), 1);
    assert.equal(f.runs[5].mock.callCount(), 1);
    assert.equal(f.cancellations[4].mock.callCount(), 1);
    assert.equal(f.update.mock.callCount(), 1);
    assert.equal(f.reset.mock.callCount(), 1);
    assert.deepEqual(
      f.clear.mock.calls.map((call) => call.arguments),
      [['tmdb'], ['avatar']]
    );
  });
}

test('a registered scan owns rejection and can run on the next scheduled tick', async (t) => {
  const f = fixture(t, MediaServerType.JELLYFIN);
  const errors = t.mock.method(logger, 'error', () => logger);
  let attempts = 0;
  t.mock.method(jellyfinRecentScanner, 'run', async () => {
    if (++attempts === 1) throw new Error('temporary library outage');
  });
  startJobs();
  const job = scheduledJobs.find(
    (entry) => entry.id === 'jellyfin-recently-added-scan'
  )!;
  await assert.doesNotReject(f.callbacks.get(job.job)!);
  await assert.doesNotReject(f.callbacks.get(job.job)!);
  assert.equal(attempts, 2);
  assert.equal(errors.mock.callCount(), 1);
});
