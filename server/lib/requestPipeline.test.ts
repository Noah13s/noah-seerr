import { MediaType } from '@server/constants/media';
import type { DownloadingItem } from '@server/lib/downloadtracker';
import {
  mergePipelineProgress,
  parsePipelineSnapshot,
  readPipelineSnapshot,
} from '@server/lib/requestPipeline';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const now = Date.UTC(2026, 10, 3, 19, 0);
const row = {
  mediaType: 'tv',
  serverId: 0,
  externalId: 14,
  downloadId: 'search:1',
  stage: 'searching',
  size: 0,
  sizeLeft: 0,
  seasonNumber: 4,
  title: 'Fixture series',
  startedAt: new Date(now - 600000).toISOString(),
  searchProgress: { episodeNumber: 4, totalEpisodes: 11 },
};
const snapshot = (records: unknown[] = [row], jobs: unknown[] = []) =>
  parsePipelineSnapshot(
    { version: 1, generatedAt: new Date(now).toISOString(), records, jobs },
    now
  );
const download = (id = 'a'.repeat(40)): DownloadingItem => ({
  mediaType: MediaType.TV,
  externalId: 14,
  downloadId: id,
  size: 100,
  sizeLeft: 50,
  status: 'downloading',
  timeLeft: '',
  estimatedCompletionTime: new Date(now),
  title: 'Release title',
});

test('tracker account budgets are sanitized without exposing adapter secrets', () => {
  const result = parsePipelineSnapshot(
    {
      version: 1,
      generatedAt: new Date(now).toISOString(),
      trackerHealth: [
        {
          id: 'c411',
          name: 'C411',
          budgeted: true,
          fresh: true,
          availableBytes: -132000000,
          reservedBytes: 5000000000,
          reservations: 2,
          checkedAt: new Date(now).toISOString(),
          reason: 'tracker-quota-exhausted',
          apiKey: 'private-token',
          url: 'https://private/announce/key',
        },
        { id: 'https://private-key', name: 'invalid' },
      ],
    },
    now
  );
  assert.equal(result.trackerHealth?.length, 1);
  assert.equal(result.trackerHealth?.[0].availableBytes, -132000000);
  assert.equal(result.trackerHealth?.[0].reservations, 2);
  assert.doesNotMatch(
    JSON.stringify(result),
    /private-token|private\/announce|apiKey/
  );
});

test('stale monitor files cannot advertise fresh account credit', () => {
  const result = parsePipelineSnapshot(
    {
      version: 1,
      generatedAt: new Date(now - 180001).toISOString(),
      trackerHealth: [
        { id: 'c411', name: 'C411', fresh: true, availableBytes: 50000000000 },
      ],
    },
    now
  );
  assert.equal(result.fresh, false);
  assert.equal(result.trackerHealth, undefined);
});

test('account observations retain health signals and discard cookies, passwords and untrusted warnings', () => {
  const result = parsePipelineSnapshot(
    {
      version: 1,
      generatedAt: new Date(now).toISOString(),
      trackerHealth: [
        {
          id: 'draupnirr',
          name: 'Draupnirr',
          monitored: true,
          healthFresh: true,
          healthCheckedAt: new Date(now).toISOString(),
          health: {
            source: 'api',
            ratio: null,
            freeleech: true,
            hnrCount: 2,
            credits: 1234,
            warnings: ['hit-and-run', 'PRIVATE'],
            password: 'PRIVATE',
            cookie: 'PRIVATE',
            api_key: 'PRIVATE',
          },
        },
      ],
    },
    now
  );
  const row = result.trackerHealth?.[0];
  assert.equal(row?.monitored, true);
  assert.equal(row?.health?.ratio, null);
  assert.equal(row?.health?.hnrCount, 2);
  assert.deepEqual(row?.health?.warnings, ['hit-and-run']);
  assert.doesNotMatch(
    JSON.stringify(result),
    /PRIVATE|cookie|password|api_key/
  );
});

test('real search progress exists before a torrent and remains scoped by service, media and season', () => {
  const data = snapshot();
  const result = mergePipelineProgress([], data, 'tv', 0, 14);
  assert.equal(result[0].stage, 'searching');
  assert.equal(result[0].seasonNumber, 4);
  assert.deepEqual(result[0].searchProgress, {
    episodeNumber: 4,
    totalEpisodes: 11,
  });
  assert.equal(result[0].size, 0);
  assert.equal(result[0].title, 'Fixture series');
  assert.deepEqual(mergePipelineProgress([], data, 'movie', 0, 14), []);
  assert.deepEqual(mergePipelineProgress([], data, 'tv', 1, 14), []);
  assert.deepEqual(mergePipelineProgress([], data, 'tv', 0, 15), []);
});

test('fresh qBittorrent progress overlays cached Arr bytes without duplicating season-pack rows', () => {
  const queue = [download()];
  const data = snapshot([
    {
      ...row,
      stage: 'downloading',
      downloadId: queue[0].downloadId.toUpperCase(),
      size: 100,
      sizeLeft: 10,
    },
  ]);
  const result = mergePipelineProgress(queue, data, 'tv', 0, 14);
  assert.equal(result.length, 1);
  assert.equal(result[0].sizeLeft, 10);
  assert.equal(result[0].title, 'Release title');
  assert.equal(result[0].mediaType, MediaType.TV);
  assert.equal(queue[0].sizeLeft, 50);
});

test('stale, future, invalid and unsupported monitor files never masquerade as active searches', () => {
  for (const invalid of [
    null,
    {},
    { version: 2 },
    {
      version: 1,
      generatedAt: new Date(now - 180001).toISOString(),
      records: [row],
    },
    {
      version: 1,
      generatedAt: new Date(now + 31000).toISOString(),
      records: [row],
    },
  ]) {
    const result = parsePipelineSnapshot(invalid, now);
    assert.equal(result.fresh, false);
    assert.deepEqual(result.records, []);
    assert.equal(
      mergePipelineProgress([download()], result, 'tv', 0, 14).length,
      1
    );
  }
});

test('snapshot sanitization excludes credentials, paths, invalid counters and unknown stages', () => {
  const result = snapshot([
    {
      ...row,
      apiKey: 'must-not-leak',
      path: '/private/path',
      reason: 'https://private.example/token',
      searchProgress: { episodeNumber: 12, totalEpisodes: 11 },
    },
    { ...row, stage: 'unexpected' },
    { ...row, externalId: NaN },
  ]);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].reason, undefined);
  assert.equal(result.records[0].searchProgress, undefined);
  assert.doesNotMatch(
    JSON.stringify(result),
    /must-not-leak|private\/path|private.example/
  );
});

test('superseded jobs disappear from active status while reused or held sources remain visible', () => {
  const item = download();
  const old = {
    downloadId: item.downloadId,
    stage: 'superseded',
    title: 'Old attempt',
  };
  assert.deepEqual(
    mergePipelineProgress([item], snapshot([], [old]), 'tv', 0, 14),
    []
  );
  for (const stage of ['held', 'reused', 'blocked']) {
    assert.equal(
      mergePipelineProgress(
        [item],
        snapshot([], [{ ...old, stage }]),
        'tv',
        0,
        14
      ).length,
      1
    );
  }
});

test('missing or malformed optional monitoring never breaks the normal queue', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'request-pipeline-'));
  const before = process.env.REQUEST_PIPELINE_FILE;
  process.env.REQUEST_PIPELINE_FILE = path.join(directory, 'snapshot.json');
  try {
    assert.equal((await readPipelineSnapshot()).fresh, false);
    await writeFile(process.env.REQUEST_PIPELINE_FILE, '{');
    assert.equal((await readPipelineSnapshot()).fresh, false);
    await writeFile(
      process.env.REQUEST_PIPELINE_FILE,
      JSON.stringify({
        version: 1,
        generatedAt: new Date().toISOString(),
        records: [],
      })
    );
    assert.equal((await readPipelineSnapshot()).fresh, true);
  } finally {
    if (before === undefined) delete process.env.REQUEST_PIPELINE_FILE;
    else process.env.REQUEST_PIPELINE_FILE = before;
    await rm(directory, { recursive: true });
  }
});
