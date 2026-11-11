import type { CleanupPlan } from '@server/lib/cleanupPlan';
import { assertCleanupIdle } from '@server/lib/cleanupPlan';
import { getSettings } from '@server/lib/settings';
import axios from 'axios';
import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';

test('cleanup verifies live episode files and still protects an active download or paused playback', async () => {
  let state = 'importBlocked';
  let imported = true;
  let playing = false;
  let playbackChecks = 0;
  const filename = '/srv/media/series/Fixture/Season 2/episode.mkv';
  const fixture = http.createServer((req, res) => {
    let data: unknown;
    if (req.url?.startsWith('/queue')) {
      data = {
        totalRecords: 1,
        records: [
          {
            seriesId: 14,
            episodeId: 609,
            downloadId: 'retained-pack',
            status: 'completed',
            sizeleft: 0,
            trackedDownloadState: state,
            // This stale snapshot must never override current /episode evidence.
            episode: { hasFile: true },
          },
        ],
      };
    } else if (req.url?.startsWith('/episode')) {
      data = [{ id: 609, seasonNumber: 2, episodeFileId: imported ? 302 : 0 }];
    } else if (req.url === '/Sessions') {
      playbackChecks++;
      data = playing
        ? [
            {
              NowPlayingItem: { Id: 'fixture', Path: filename },
              PlayState: { IsPaused: true },
            },
          ]
        : [];
    } else {
      res.statusCode = 404;
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data));
  });
  await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve));
  const address = fixture.address();
  assert.ok(address && typeof address !== 'string');
  const settings = getSettings();
  const before = { ...settings.jellyfin };
  Object.assign(settings.jellyfin, {
    ip: '127.0.0.1',
    port: address.port,
    useSsl: false,
    urlBase: '',
    apiKey: 'fixture',
  });
  const client = axios.create({ baseURL: `http://127.0.0.1:${address.port}` });
  const plan: CleanupPlan = {
    hash: 'fixture',
    bytes: 100,
    files: [
      {
        kind: 'sonarr',
        serverId: 0,
        itemId: 14,
        fileId: 302,
        path: filename,
        bytes: 100,
        added: '',
        episodeIds: [609],
      },
    ],
  };
  try {
    await assertCleanupIdle(plan, () => client);
    assert.equal(playbackChecks, 1);
    state = 'importing';
    await assert.rejects(
      assertCleanupIdle(plan, () => client),
      /download or import/
    );
    assert.equal(playbackChecks, 1);
    state = 'importBlocked';
    imported = false;
    await assert.rejects(
      assertCleanupIdle(plan, () => client),
      /download or import/
    );
    imported = true;
    playing = true;
    await assert.rejects(
      assertCleanupIdle(plan, () => client),
      /playing this media/
    );
  } finally {
    Object.assign(settings.jellyfin, before);
    fixture.closeAllConnections();
    await new Promise<void>((resolve) => fixture.close(() => resolve()));
  }
});
