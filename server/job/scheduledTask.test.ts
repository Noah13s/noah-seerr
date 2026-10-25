import { scheduledTask } from '@server/job/scheduledTask';
import logger from '@server/logger';
import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';

afterEach(() => mock.restoreAll());

test('scheduled ticks wait for their asynchronous work', async () => {
  let finish!: () => void;
  const work = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let completed = false;
  const tick = scheduledTask('Slow fixture', () => work)().then(() => {
    completed = true;
  });
  await Promise.resolve();
  assert.equal(completed, false);
  finish();
  await tick;
  assert.equal(completed, true);
});

test('rejected work is reported and does not prevent a subsequent tick', async () => {
  const errors = mock.method(logger, 'error', () => logger);
  let calls = 0;
  const tick = scheduledTask('Retry fixture', async () => {
    if (++calls === 1) throw new Error('Queue unavailable');
  });
  await assert.doesNotReject(tick);
  await assert.doesNotReject(tick);
  assert.equal(calls, 2);
  assert.equal(errors.mock.callCount(), 1);
  assert.deepEqual(errors.mock.calls[0].arguments, [
    'Scheduled job failed',
    {
      label: 'Jobs',
      job: 'Retry fixture',
      errorMessage: 'Queue unavailable',
    },
  ]);
});

test('synchronous errors and non-Error rejections also remain contained', async () => {
  const errors = mock.method(logger, 'error', () => logger);
  await assert.doesNotReject(
    scheduledTask('Sync fixture', () => {
      throw new Error('Invalid configuration');
    })
  );
  await assert.doesNotReject(
    scheduledTask('Rejected fixture', () => Promise.reject('not an Error'))
  );
  assert.equal(errors.mock.callCount(), 2);
  assert.deepEqual(errors.mock.calls[1].arguments, [
    'Scheduled job failed',
    {
      label: 'Jobs',
      job: 'Rejected fixture',
      errorMessage: 'Unknown error',
    },
  ]);
});
