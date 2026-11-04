import { clientBuildId, frontendUpdated } from '@app/utils/frontendUpdate';
import assert from 'node:assert/strict';
import { test } from 'node:test';

test('retained backend and locally built frontend do not cause a reload loop', () => {
  assert.equal(
    frontendUpdated({
      serverBuildId: 'same-build',
      currentBuildId: 'same-build',
      serverCommit: 'retained-backend',
      currentCommit: 'local',
    }),
    false
  );
});
test('a genuine frontend change prompts once and clears after loading that build', () => {
  assert.equal(
    frontendUpdated({
      serverBuildId: 'new-build',
      currentBuildId: 'old-build',
    }),
    true
  );
  assert.equal(
    frontendUpdated({
      serverBuildId: 'new-build',
      currentBuildId: 'new-build',
    }),
    false
  );
});
test('hydration and missing or development identities never manufacture an update', () => {
  for (const currentBuildId of [undefined, '', 'local', 'development']) {
    assert.equal(
      frontendUpdated({ serverBuildId: 'real-build', currentBuildId }),
      false
    );
  }
  for (const value of [
    null,
    undefined,
    {},
    { buildId: 0 },
    { buildId: 'bad/path' },
  ])
    assert.equal(clientBuildId(value), undefined);
  assert.equal(clientBuildId({ buildId: 'valid-build_1' }), 'valid-build_1');
});
test('older servers use only comparable real commit identities', () => {
  assert.equal(
    frontendUpdated({ serverCommit: 'old', currentCommit: 'new' }),
    true
  );
  assert.equal(
    frontendUpdated({ serverCommit: 'same', currentCommit: 'same' }),
    false
  );
  assert.equal(
    frontendUpdated({ serverCommit: 'old', currentCommit: 'local' }),
    false
  );
  assert.equal(
    frontendUpdated({ serverCommit: 'local', currentCommit: 'old' }),
    false
  );
});
