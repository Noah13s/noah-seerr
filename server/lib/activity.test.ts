import { mutationAction } from '@server/middleware/activity';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  activityText,
  playbackChanges,
  type PlaybackObservation,
} from './activity';
const state = (
  more: Partial<PlaybackObservation> = {}
): PlaybackObservation => ({
  at: 0,
  position: 50,
  paused: false,
  item: 'episode',
  title: 'Episode',
  device: 'TV',
  audio: 'jpn',
  subtitle: 'eng',
  ...more,
});
test('normal playback and a stalled timeline do not invent user jumps', () => {
  assert.deepEqual(
    playbackChanges(state(), state({ at: 5000, position: 55 })),
    []
  );
  assert.deepEqual(
    playbackChanges(state(), state({ at: 5000, position: 50 })),
    []
  );
});
test('playback observations retain pause, track switches and timeline discontinuities', () => {
  const events = playbackChanges(
    state(),
    state({
      at: 5000,
      paused: true,
      position: 100,
      audio: 'fra',
      subtitle: 'off',
    })
  );
  assert.deepEqual(
    events.map((e) => e.action),
    [
      'playback.paused',
      'playback.seeked',
      'playback.audio',
      'playback.subtitle',
    ]
  );
  assert.deepEqual(events[1].details, { from: 50, to: 100 });
  assert.equal(
    playbackChanges(
      state({ paused: true }),
      state({ at: 5000, position: 50 })
    )[0].action,
    'playback.resumed'
  );
});
test('different episodes start a new event without a spurious backwards jump', () => {
  assert.equal(
    playbackChanges(state(), state({ item: 'other', position: 0 })).length,
    1
  );
  assert.equal(
    playbackChanges(undefined, state())[0].action,
    'playback.started'
  );
});
test('mutation events exclude progress, preview and secrets; cleanup labels are allowlisted', () => {
  assert.equal(mutationAction('GET', '/request'), undefined);
  assert.equal(mutationAction('POST', '/watch-history/playback'), undefined);
  assert.equal(
    mutationAction('POST', '/cleanup-reviews/abc/preview'),
    undefined
  );
  assert.equal(
    mutationAction('POST', '/auth/native-playback-session'),
    undefined
  );
  assert.deepEqual(mutationAction('POST', '/request'), {
    category: 'request',
    action: 'request.created',
  });
  assert.deepEqual(
    mutationAction('POST', '/cleanup-reviews/abc/decision', {
      action: 'delete-now',
      password: 'secret',
    }),
    { category: 'cleanup', action: 'cleanup-reviews.delete-now' }
  );
  assert.ok(
    !JSON.stringify(
      mutationAction('POST', '/cleanup-reviews/abc/decision', {
        action: 'secret',
      })
    ).includes('secret')
  );
  assert.equal(activityText('bad\nname\u0000'), 'badname');
});
