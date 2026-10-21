import assert from 'node:assert/strict';
import { test } from 'node:test';
import { filterPresentCleanup } from './cleanupLibrary';

test('upcoming and manual cleanup exclude library files already removed', async () => {
  const candidates = [
    { id: 'gone' },
    { id: 'present' },
    { id: 'seeding-only' },
  ];
  assert.deepEqual(
    await filterPresentCleanup(candidates, async (c) => c.id === 'present'),
    [{ id: 'present' }]
  );
});
test('an unavailable Arr service is not treated as an empty library', async () => {
  await assert.rejects(
    filterPresentCleanup(['movie'], async () => {
      throw new Error('Arr offline');
    }),
    /Arr offline/
  );
});
test('parallel library checks are bounded and preserve candidate order', async () => {
  let active = 0,
    max = 0;
  const ids = Array.from({ length: 15 }, (_, i) => i);
  const kept = await filterPresentCleanup(ids, async (id) => {
    max = Math.max(max, ++active);
    await new Promise((resolve) => setTimeout(resolve, (15 - id) % 4));
    active--;
    return id % 2 === 0;
  });
  assert.ok(max <= 4);
  assert.deepEqual(
    kept,
    ids.filter((i) => i % 2 === 0)
  );
});
