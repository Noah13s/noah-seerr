import type { CleanupReview } from '@server/entity/CleanupReview';
import type { MediaRequest } from '@server/entity/MediaRequest';
import type { WatchHistory } from '@server/entity/WatchHistory';
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import pug from 'pug';
import type { CleanupClientFactory, CleanupPlan } from './cleanupPlan';
import { buildCleanupPlan, executeCleanupPlan } from './cleanupPlan';
import { assessCleanup, assessManualCleanup } from './cleanupPolicy';
import { previewToken, validPreview } from './cleanupReviews';
import type { DVRSettings } from './settings';

const now = Date.parse('2026-10-01T12:00:00Z');
const old = new Date(now - 15 * 86400000);
const seasonInfo = async () => ({ count: 12, hasFutureEpisodes: false });
const request = (userId = 1, type = 'movie'): MediaRequest =>
  ({
    id: userId,
    type,
    status: 5,
    is4k: false,
    updatedAt: old,
    requestedBy: { id: userId, displayName: `User ${userId}` },
    media: { tmdbId: 100, status: 5 },
    seasons: [{ seasonNumber: 1, status: 5 }],
  }) as MediaRequest;
const history = (userId = 1, mediaType = 'movie'): WatchHistory =>
  ({
    id: userId,
    user: { id: userId },
    mediaType,
    tmdbId: 100,
    title: 'Test media',
    status: 'completed',
    updatedAt: old,
    watchedAt: old,
    watchCount: 1,
    seasonProgress: { '1': 12 },
    episodeOverrides: {},
  }) as unknown as WatchHistory;

test('cleanup approval fingerprints ignore query order but change with requester membership', async () => {
  const requests = [request(10), request(2)];
  const histories = [history(10), history(2)];
  const ordered = await assessCleanup(requests, histories, seasonInfo, now);
  const reversed = await assessCleanup(
    [...requests].reverse(),
    [...histories].reverse(),
    seasonInfo,
    now
  );
  assert.equal(ordered[0].fingerprint, reversed[0].fingerprint);
  assert.equal(ordered[0].eligible, true);
  const added = await assessCleanup(
    [...requests, request(3)],
    [...histories, history(3)],
    seasonInfo,
    now
  );
  assert.notEqual(ordered[0].fingerprint, added[0].fingerprint);
  assert.equal(
    assessManualCleanup(requests, histories)[0].fingerprint,
    assessManualCleanup([...requests].reverse(), histories)[0].fingerprint
  );
});

test('season override order is canonical and a changed watched state invalidates approval', async () => {
  const entry = history(2, 'tv');
  entry.episodeOverrides = { '1:10': true, '1:2': true };
  const original = (
    await assessCleanup([request(2, 'tv')], [entry], seasonInfo, now)
  )[0];
  entry.episodeOverrides = { '1:2': true, '1:10': true };
  assert.equal(
    (await assessCleanup([request(2, 'tv')], [entry], seasonInfo, now))[0]
      .fingerprint,
    original.fingerprint
  );
  entry.episodeOverrides['1:2'] = false;
  assert.equal(
    (await assessCleanup([request(2, 'tv')], [entry], seasonInfo, now)).length,
    0
  );
});

test('active rewatches postpone cleanup without changing completed history', async () => {
  for (const type of ['movie', 'tv']) {
    const entry = history(1, type);
    entry.viewingProgress = {
      [type === 'movie' ? 'movie' : '1:2']: {
        sessionIds: ['rewatch'],
        retiredSessionIds: [],
        position: 100,
        duration: 1000,
        completed: false,
        rewatching: true,
        watchCount: 1,
        updatedAt: old.toISOString(),
      },
    };
    const item = request(1, type);
    item.media.tvdbId = 100;
    const candidates = await assessCleanup([item], [entry], seasonInfo, now);
    assert.equal(candidates[0]?.eligible ?? false, false);
  }
});

test('manual override includes unwatched available movies and only available seasons', () => {
  const movie = request();
  movie.updatedAt = new Date(now);
  assert.equal(assessManualCleanup([movie], []).length, 1);
  movie.media.status = 2;
  assert.equal(assessManualCleanup([movie], []).length, 0);
  const series = request(1, 'tv');
  series.media.seasons = [
    { seasonNumber: 1, status: 5 },
    { seasonNumber: 2, status: 2 },
  ] as typeof series.media.seasons;
  const candidates = assessManualCleanup([series], []);
  assert.deepEqual(
    candidates.map((candidate) => candidate.seasonNumber),
    [1]
  );
  const original = candidates[0].fingerprint;
  series.updatedAt = new Date(now);
  assert.notEqual(assessManualCleanup([series], [])[0].fingerprint, original);
});
test('override confirmations cannot reuse a normal deletion token', () => {
  const review = {
    id: 'override',
    fingerprint: 'media',
    planHash: 'files',
    status: 'stale',
  } as CleanupReview;
  const token = previewToken(review, 1, 'delete-now');
  assert.equal(validPreview(token, review, 1, 'delete-now'), true);
  assert.equal(validPreview(token, review, 1, 'delete'), false);
  assert.equal(validPreview(token, review, 2, 'delete-now'), false);
});
test('cleanup requires every requester and the full 14-day delay', async () => {
  assert.equal(
    (await assessCleanup([request(), request(2)], [history()], seasonInfo, now))
      .length,
    0
  );
  const recent = history(2);
  recent.watchedAt = new Date(now - 13 * 86400000);
  const pending = await assessCleanup(
    [request(), request(2)],
    [history(), recent],
    seasonInfo,
    now
  );
  assert.equal(pending[0].eligible, false);
  recent.watchedAt = old;
  assert.equal(
    (
      await assessCleanup(
        [request(), request(2)],
        [history(), recent],
        seasonInfo,
        now
      )
    )[0].eligible,
    true
  );
});
test('a fresh request restarts retention and unavailable movies are excluded', async () => {
  const fresh = request();
  fresh.updatedAt = new Date(now);
  assert.equal(
    (await assessCleanup([fresh], [history()], seasonInfo, now))[0].eligible,
    false
  );
  fresh.media.status = 2;
  assert.equal(
    (await assessCleanup([fresh], [history()], seasonInfo, now)).length,
    0
  );
});
test('seasons reject unwatched overrides, future episodes and unavailable metadata', async () => {
  const r = request(1, 'tv');
  const h = history(1, 'tv');
  assert.equal(
    (await assessCleanup([r], [h], seasonInfo, now))[0].seasonNumber,
    1
  );
  h.episodeOverrides = { '1:3': false };
  assert.equal((await assessCleanup([r], [h], seasonInfo, now)).length, 0);
  h.episodeOverrides = {};
  assert.equal(
    (
      await assessCleanup(
        [r],
        [h],
        async () => ({ count: 12, hasFutureEpisodes: true }),
        now
      )
    ).length,
    0
  );
  assert.equal(
    (
      await assessCleanup(
        [r],
        [h],
        async () => {
          throw new Error('offline');
        },
        now
      )
    ).length,
    0
  );
  h.status = 'dropped' as WatchHistory['status'];
  assert.equal(
    (
      await assessCleanup(
        [r],
        [h],
        async () => {
          throw new Error('unused');
        },
        now
      )
    )[0].eligible,
    true
  );
});
test('confirmation is bound to admin, action, files, status and expiry', () => {
  const review = {
    id: 'review',
    fingerprint: 'history',
    planHash: 'files',
    status: 'pending',
  } as CleanupReview;
  const token = previewToken(review, 1, 'delete');
  assert.equal(validPreview(token, review, 1, 'delete'), true);
  assert.equal(validPreview(token, review, 2, 'delete'), false);
  assert.equal(validPreview(token, review, 1, 'keep'), false);
  assert.equal(
    validPreview(token, { ...review, planHash: 'changed' }, 1, 'delete'),
    false
  );
  assert.equal(
    validPreview(token, { ...review, status: 'kept' }, 1, 'delete'),
    false
  );
  assert.equal(
    validPreview(
      previewToken(review, 1, 'delete', Date.now() - 1),
      review,
      1,
      'delete'
    ),
    false
  );
});
const file = {
  kind: 'sonarr' as const,
  serverId: 1,
  itemId: 8,
  fileId: 9,
  path: '/media/series/Test/S01E01.mkv',
  bytes: 100,
  added: 'date',
  episodeIds: [10],
};
const plan: CleanupPlan = { files: [file], hash: 'hash', bytes: 100 };
test('approved deletion unmonitors only its season and episodes before deleting', async () => {
  const calls: string[] = [];
  const client = {
    get: async (url: string) => ({
      data: url.startsWith('/series/')
        ? {
            seasons: [
              { seasonNumber: 1, monitored: true },
              { seasonNumber: 2, monitored: true },
            ],
          }
        : { path: file.path, size: 100, dateAdded: 'date' },
    }),
    put: async (
      url: string,
      data: {
        seasons?: { seasonNumber: number; monitored: boolean }[];
        episodeIds?: number[];
      }
    ) => {
      calls.push(`put ${url}`);
      if (data.seasons)
        assert.deepEqual(
          data.seasons.map((s) => s.monitored),
          [false, true]
        );
      if (data.episodeIds) assert.deepEqual(data.episodeIds, [10]);
    },
    delete: async (url: string) => {
      calls.push(`delete ${url}`);
    },
  };
  assert.equal(
    await executeCleanupPlan(
      plan,
      1,
      (() => client) as unknown as CleanupClientFactory
    ),
    1
  );
  assert.deepEqual(calls, [
    'put /series/8',
    'put /episode/monitor',
    'delete /episodefile/9',
  ]);
});
test('a changed file cannot be deleted after approval', async () => {
  let deleted = false;
  const client = {
    get: async (url: string) => ({
      data: url.startsWith('/series/')
        ? { seasons: [] }
        : { path: file.path, size: 101, dateAdded: 'date' },
    }),
    put: async () => undefined,
    delete: async () => {
      deleted = true;
    },
  };
  await assert.rejects(
    executeCleanupPlan(
      plan,
      1,
      (() => client) as unknown as CleanupClientFactory
    ),
    /changed/
  );
  assert.equal(deleted, false);
});
test('cross-season files and paths outside the library fail closed', async () => {
  const client = {
    get: async (url: string) => ({
      data:
        url === '/series'
          ? [{ id: 8, tvdbId: 42, path: '/media/series/Test' }]
          : url === '/episode'
            ? [
                { id: 10, seasonNumber: 1, episodeFileId: 9 },
                { id: 11, seasonNumber: 2, episodeFileId: 9 },
              ]
            : [{ id: 9, path: file.path, size: 100 }],
    }),
  };
  await assert.rejects(
    buildCleanupPlan(
      { mediaType: 'tv', tmdbId: 100, seasonNumber: 1 },
      { tvdbId: 42 },
      { radarr: [], sonarr: [{ id: 1 } as DVRSettings] },
      (() => client) as unknown as CleanupClientFactory
    ),
    /another season/
  );
  const movieClient = {
    get: async () => ({
      data: [
        {
          id: 1,
          tmdbId: 100,
          path: '/media/films/Test',
          movieFile: { id: 2, path: '/media/films/Other/file.mkv', size: 100 },
        },
      ],
    }),
  };
  await assert.rejects(
    buildCleanupPlan(
      { mediaType: 'movie', tmdbId: 100 },
      { tvdbId: undefined },
      { radarr: [{ id: 1 } as DVRSettings], sonarr: [] },
      (() => movieClient) as unknown as CleanupClientFactory
    ),
    /outside/
  );
});
test('email has two authenticated review links and escapes media titles', () => {
  for (const french of [false, true]) {
    const html = pug.renderFile(
      path.join(__dirname, '../templates/email/cleanup-review/html.pug'),
      {
        french,
        label: '<script>bad</script>',
        applicationTitle: 'Seerr',
        requesters: 'Admin',
        retentionDays: 14,
        eligibleAt: '01/10/2026',
        deleteUrl:
          'https://stream.noah-work.com/admin-tools?review=id&intent=delete',
        keepUrl:
          'https://stream.noah-work.com/admin-tools?review=id&intent=keep',
      }
    );
    assert.match(html, /intent=delete/);
    assert.match(html, /intent=keep/);
    assert.doesNotMatch(html, /<script>/);
    assert.equal((html.match(/<a /g) || []).length, 2);
  }
});
