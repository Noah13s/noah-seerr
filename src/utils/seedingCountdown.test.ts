import assert from 'node:assert/strict';
import { test } from 'node:test';
import { seedingCountdown } from './seedingCountdown';
const at = '2026-11-05T08:00:00Z';
const now = Date.parse(at);
test('remaining seed time advances only while qBittorrent confirms active seeding', () => {
  assert.equal(seedingCountdown(3600, at, true, now + 60000)?.seconds, 3540);
  assert.equal(seedingCountdown(3600, at, false, now + 60000)?.seconds, 3600);
  assert.equal(
    seedingCountdown(3600, at, undefined, now + 60000)?.seconds,
    3600
  );
});
test('stale/future/malformed seed status never fabricates completion', () => {
  assert.equal(seedingCountdown(10, at, true, now + 700000)?.seconds, 10);
  assert.equal(seedingCountdown(10, at, true, now + 700000)?.stale, true);
  assert.equal(seedingCountdown(10, 'invalid', true, now)?.seconds, 10);
  assert.equal(seedingCountdown(10, at, true, now - 60000)?.stale, true);
  assert.equal(seedingCountdown(null, at, true, now), null);
  assert.equal(seedingCountdown(10, at, true, now + 20000)?.seconds, 0);
});
