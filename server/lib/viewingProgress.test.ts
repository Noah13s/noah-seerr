import type { WatchHistory } from '@server/entity/WatchHistory';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyPlaybackReport,
  isRewatching,
  latestActiveViewing,
} from './viewingProgress';

const history = (mediaType = 'movie') =>
  ({
    mediaType,
    status: 'completed',
    watchCount: mediaType === 'movie' ? 2 : 0,
    seasonProgress: { '1': 12 },
    episodeOverrides: {},
    viewingProgress: {},
    rating: 5,
    notes: 'Keep my review',
    watchedAt: new Date('2026-09-01'),
  }) as unknown as WatchHistory;
const report = (sessionId = 'run-a', position = 60) => ({
  sessionId,
  position,
  duration: 1000,
});

test('rewatching a movie preserves completion, rating and previous viewing date until finished', () => {
  const entry = history();
  applyPlaybackReport(entry, report());
  assert.equal(entry.status, 'completed');
  assert.equal(entry.watchCount, 2);
  assert.equal(entry.rating, 5);
  assert.equal(entry.notes, 'Keep my review');
  assert.equal(entry.watchedAt?.toISOString(), '2026-09-01T00:00:00.000Z');
  assert.equal(isRewatching(entry.viewingProgress), true);
  assert.equal(latestActiveViewing(entry.viewingProgress)?.run.position, 60);
});

test('completion increments once across periodic, ended, close and recovery reports', () => {
  const entry = history();
  applyPlaybackReport(entry, report());
  applyPlaybackReport(entry, report('run-a', 950));
  applyPlaybackReport(entry, report('run-a', 990));
  applyPlaybackReport(entry, report('recovery-run', 995));
  assert.equal(entry.watchCount, 3);
  assert.equal(isRewatching(entry.viewingProgress), false);
  assert.equal(latestActiveViewing(entry.viewingProgress), undefined);
});

test('resume on another device continues the same viewing and counts once', () => {
  const entry = history();
  applyPlaybackReport(entry, report('desktop', 100));
  applyPlaybackReport(entry, report('phone', 600));
  applyPlaybackReport(entry, report('phone', 950));
  applyPlaybackReport(entry, report('desktop', 900));
  assert.equal(entry.watchCount, 3);
});

test('a later rewatch counts again; delayed events from the older pass are ignored', () => {
  const entry = history();
  applyPlaybackReport(entry, report());
  applyPlaybackReport(entry, report('run-a', 950));
  applyPlaybackReport(entry, report('run-b', 60));
  applyPlaybackReport(entry, report('run-a', 995));
  assert.equal(entry.viewingProgress.movie.position, 60);
  applyPlaybackReport(entry, report('run-b', 950));
  assert.equal(entry.watchCount, 4);
});

test('opening the credits of a legacy watched movie does not add another watch', () => {
  const entry = history();
  applyPlaybackReport(entry, report('credits', 990));
  assert.equal(entry.watchCount, 2);
  assert.equal(latestActiveViewing(entry.viewingProgress), undefined);
});

test('replaying earlier series or anime episodes never resets the season or watched overrides', () => {
  const entry = history('tv');
  entry.episodeOverrides = { '1:7': true, '1:12': true };
  const episode = { ...report(), seasonNumber: 1, episodeNumber: 7 };
  applyPlaybackReport(entry, episode);
  assert.equal(entry.status, 'completed');
  assert.equal(entry.seasonProgress['1'], 12);
  assert.equal(entry.episodeOverrides['1:12'], true);
  assert.equal(latestActiveViewing(entry.viewingProgress)?.key, '1:7');
  applyPlaybackReport(entry, { ...episode, position: 950 });
  assert.equal(entry.viewingProgress['1:7'].watchCount, 2);
  assert.equal(entry.seasonProgress['1'], 12);
  assert.equal(entry.watchCount, 0);
});

test('a first viewing still counts once and marks an episode watched', () => {
  const entry = history('tv');
  entry.status = 'watching' as WatchHistory['status'];
  entry.seasonProgress = {};
  const episode = { ...report(), seasonNumber: 2, episodeNumber: 1 };
  applyPlaybackReport(entry, episode);
  assert.equal(isRewatching(entry.viewingProgress), false);
  applyPlaybackReport(entry, { ...episode, position: 950 });
  assert.equal(entry.episodeOverrides['2:1'], true);
  assert.equal(entry.viewingProgress['2:1'].watchCount, 1);
});
