import assert from 'node:assert/strict';
import test from 'node:test';
import {
  castDeadline,
  isCastTransportError,
  runCastCommand,
  type RecoverableCastBridge,
} from './castControlRecovery';

test('a suspended sender promise cannot block the visible controls forever', async () => {
  await assert.rejects(
    castDeadline(() => new Promise<never>(() => {}), 10),
    { code: 'timeout' }
  );
  assert.equal(await castDeadline(() => Promise.resolve('ack'), 20), 'ack');
});

const broken = (): RecoverableCastBridge => ({
  snapshot: () => ({ connected: true, itemId: 'episode' }),
  command: async () => {
    throw Object.assign(Error('channel lost'), { code: 'channel_error' });
  },
});
test('the SDK No active session error is a lost channel, while invalid control values are not', () => {
  assert.equal(
    isCastTransportError({
      code: 'invalid_parameter',
      message: 'No active session',
    }),
    true
  );
  assert.equal(
    isCastTransportError({
      code: 'invalid_parameter',
      message: 'Invalid volume',
    }),
    false
  );
});
test('a poisoned sender is recreated once and the same absolute control is retried', async () => {
  const old = broken(),
    calls: unknown[] = [];
  const fresh = {
    snapshot: old.snapshot,
    command: async (name: string, value?: number) => {
      calls.push([name, value]);
    },
  };
  let resets = 0;
  await runCastCommand(
    old,
    'seek',
    60,
    () => old,
    async () => {
      resets++;
      return fresh;
    },
    () => true
  );
  assert.equal(resets, 1);
  assert.deepEqual(calls, [['seek', 60]]);
});
test('a track change confirmed by the renewed receiver status is not sent twice', async () => {
  const old = broken();
  let sent = 0;
  const fresh = {
    snapshot: () => ({ ...old.snapshot(), subtitleIndex: 4 }),
    command: async () => {
      sent++;
    },
  };
  await runCastCommand(
    old,
    'subtitles',
    4,
    () => old,
    async () => fresh,
    () => true
  );
  assert.equal(sent, 0);
});
test('invalid controls and profile changes never recreate a sender', async () => {
  const old = broken();
  let resets = 0;
  const renew = async () => {
    resets++;
    return old;
  };
  await assert.rejects(
    runCastCommand(
      old,
      'pause',
      undefined,
      () => old,
      renew,
      () => false
    )
  );
  old.command = async () => {
    throw Error('Unsupported playback control.');
  };
  await assert.rejects(
    runCastCommand(
      old,
      'bad',
      undefined,
      () => old,
      renew,
      () => true
    )
  );
  assert.equal(resets, 0);
});
test('renewal never retries against an auto-advanced episode or another receiver item', async () => {
  const old = broken();
  let sent = 0;
  const fresh = {
    snapshot: () => ({ connected: true, itemId: 'next' }),
    command: async () => {
      sent++;
    },
  };
  await assert.rejects(
    runCastCommand(
      old,
      'seek',
      60,
      () => old,
      async () => fresh,
      () => true
    ),
    /episode changed/
  );
  assert.equal(sent, 0);
});
test('a command that already has a replacement sender reuses it', async () => {
  const old = broken();
  let sent = 0;
  const fresh = {
    snapshot: old.snapshot,
    command: async () => {
      sent++;
    },
  };
  await runCastCommand(
    old,
    'pause',
    undefined,
    () => fresh,
    async () => {
      throw Error('should not reset');
    },
    () => true
  );
  assert.equal(sent, 1);
});
