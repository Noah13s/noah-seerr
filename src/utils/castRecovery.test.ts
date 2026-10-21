import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  castRecoveryKey,
  castRecoveryUrl,
  parseCastRecovery,
} from './castRecovery';
const origin = 'https://stream.noah-work.com';
const id = 'b2cb227f4e34797e421fda40bc7bd821';
const url = `${origin}/player/web/index.html?api_key=secret#!/details?id=${id}&token=secret`;
test('Cast recovery persists only a local item route without credentials', () => {
  const saved = castRecoveryUrl(url, origin);
  assert.ok(saved.includes(id));
  assert.ok(saved.includes('seerrPlayer=85-15'));
  assert.equal(saved.includes('secret'), false);
  assert.equal(saved.includes('token'), false);
});
test('Cast recovery rejects cross-origin routes, redirects and malformed item IDs', () => {
  for (const invalid of [
    url.replace(origin, 'https://evil.example'),
    url.replace('/player/web/index.html', '/login'),
    url.replace(id, 'bad'),
  ])
    assert.throws(() => castRecoveryUrl(invalid, origin));
});
test('Cast recovery is profile-specific, bounded and validates history ownership context', () => {
  assert.notEqual(castRecoveryKey(1), castRecoveryKey(5));
  const record = {
    version: 1,
    updated: Date.now(),
    url,
    context: { tmdbId: 79166, mediaType: 'tv', title: 'Grand Blue' },
  };
  assert.equal(
    parseCastRecovery(JSON.stringify(record), origin)?.context?.tmdbId,
    79166
  );
  for (const changed of [
    { version: 2 },
    { updated: Date.now() - 13 * 3600000 },
    { updated: Date.now() + 120000 },
    { context: { ...record.context, tmdbId: -1 } },
    { context: { ...record.context, mediaType: 'invalid' } },
  ])
    assert.equal(
      parseCastRecovery(JSON.stringify({ ...record, ...changed }), origin),
      undefined
    );
  assert.equal(parseCastRecovery('{bad', origin), undefined);
});
