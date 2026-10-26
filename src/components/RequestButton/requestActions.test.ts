import assert from 'node:assert/strict';
import { test } from 'node:test';
import { updateRequestBatch } from './requestActions';

test('partial failure waits for remaining requests and refreshes the final state', async () => {
  const events: string[] = [];
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const result = updateRequestBatch(
    [1, 2],
    'approve',
    async (id, decision) => {
      assert.equal(decision, 'approve');
      if (id === 1) throw new Error('permission denied');
      await pending;
      events.push('finished');
    },
    async () => {
      events.push('refreshed');
    }
  );
  const rejection = assert.rejects(result, AggregateError);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(events, []);
  finish();
  await rejection;
  assert.deepEqual(events, ['finished', 'refreshed']);
});

test('successful changes refresh once and empty batches do nothing', async () => {
  const changed: number[] = [];
  let refreshed = 0;
  const change = async (id: number) => {
    changed.push(id);
  };
  const refresh = async () => {
    refreshed++;
  };
  await updateRequestBatch([3, 4], 'decline', change, refresh);
  assert.deepEqual(changed, [3, 4]);
  await updateRequestBatch([], 'decline', change, refresh);
  assert.equal(refreshed, 1);
});

test('refresh failure is reported after changes finish', async () => {
  await assert.rejects(
    updateRequestBatch(
      [1],
      'approve',
      async () => {},
      async () => {
        throw new Error('refresh failed');
      }
    ),
    /refresh failed/
  );
});
