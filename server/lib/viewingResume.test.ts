import type { WatchHistorySummaryItem } from '@server/interfaces/api/watchHistoryInterfaces';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { viewingResumeTicks } from './viewingResume';
const history = () =>
  ({
    mediaType: 'tv',
    status: 'watching',
    watchCount: 0,
    seasonProgress: { '1': 12 },
    episodeOverrides: {},
    viewingProgress: {
      '1:6': {
        position: 820.203359,
        duration: 1453.127,
        completed: false,
        rewatching: true,
      },
    },
  }) as unknown as WatchHistorySummaryItem;
test('Grand Blue watched episode resumes its unfinished replay at 13:40', () => {
  assert.equal(viewingResumeTicks(history(), 'tv', 1, 6), 8202033590);
});
test('episode identity isolates resume from another watched episode or season', () => {
  assert.equal(viewingResumeTicks(history(), 'tv', 1, 5), 0);
  assert.equal(viewingResumeTicks(history(), 'tv', 2, 6), undefined);
  assert.equal(viewingResumeTicks(history(), 'tv'), undefined);
});
test('completed/stopped replay starts fresh rather than reopening credits', () => {
  const h = history();
  h.viewingProgress!['1:6'].completed = true;
  assert.equal(viewingResumeTicks(h, 'tv', 1, 6), 0);
});
test('movie replay progress survives completed lifetime status', () => {
  const h = {
    ...history(),
    mediaType: 'movie',
    status: 'completed',
    watchCount: 3,
    viewingProgress: {
      movie: { ...history().viewingProgress!['1:6'], position: 120 },
    },
  } as WatchHistorySummaryItem;
  assert.equal(viewingResumeTicks(h, 'movie'), 1200000000);
  assert.equal(viewingResumeTicks(undefined, 'movie'), undefined);
});
test('corrupt/out-of-range progress cannot seek beyond the media', () => {
  for (const position of [-1, NaN, Infinity, 1453.127, 1440]) {
    const h = history();
    h.viewingProgress!['1:6'].position = position;
    assert.equal(viewingResumeTicks(h, 'tv', 1, 6), 0);
  }
});
