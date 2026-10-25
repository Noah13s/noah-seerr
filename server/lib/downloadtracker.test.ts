import downloadTracker from '@server/lib/downloadtracker';
import type { RadarrSettings, SonarrSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';

test('download synchronization waits for both Arr queues and preserves matching-server progress', async () => {
  let release!: () => void;
  let queueStarted!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    queueStarted = resolve;
  });
  const server = http.createServer(async (req, res) => {
    if (req.url?.startsWith('/sonarr/api/v3/queue')) {
      queueStarted();
      await gate;
    }
    const record = {
      movieId: 101,
      seriesId: 202,
      size: 100,
      sizeleft: 25,
      status: 'downloading',
      title: 'Fixture',
      downloadId: 'fixture-download',
    };
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify(
        req.url?.includes('/queue')
          ? { page: 1, pageSize: 1000, totalRecords: 1, records: [record] }
          : { id: 1 }
      )
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const settings = getSettings();
  const before = { radarr: settings.radarr, sonarr: settings.sonarr };
  const common = {
    hostname: '127.0.0.1',
    port: address.port,
    apiKey: 'fixture',
    syncEnabled: true,
    useSsl: false,
    name: 'Fixture',
  };
  settings.radarr = [1, 2].map(
    (id) => ({ ...common, id, baseUrl: '/radarr' }) as RadarrSettings
  );
  settings.sonarr = [
    { ...common, id: 3, baseUrl: '/sonarr' } as SonarrSettings,
  ];
  let tick: Promise<void> | undefined;
  try {
    await downloadTracker.resetDownloadTracker();
    let complete = false;
    tick = downloadTracker.updateDownloads().then(() => {
      complete = true;
    });
    await Promise.race([
      started,
      tick.then(() => {
        throw new Error(
          'Download tick ended before requesting the Sonarr queue'
        );
      }),
    ]);
    assert.equal(
      complete,
      false,
      'The slow Sonarr queue still belongs to this tick'
    );
    release();
    await tick;
    assert.equal(downloadTracker.getSeriesProgress(3, 202)[0].sizeLeft, 25);
    assert.equal(downloadTracker.getMovieProgress(1, 101)[0].sizeLeft, 25);
    assert.deepEqual(
      downloadTracker.getMovieProgress(1, 101),
      downloadTracker.getMovieProgress(2, 101)
    );
  } finally {
    release();
    await tick;
    Object.assign(settings, before);
    await downloadTracker.resetDownloadTracker();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
