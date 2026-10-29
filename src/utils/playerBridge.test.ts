import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PlayerBridge } from './playerBridge';

test('a verified frame completes only the pending play command', async () => {
  const host = new EventTarget() as EventTarget & {
    location: { origin: string };
  };
  host.location = { origin: 'https://example.test' };
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: host,
  });
  const sent: Record<string, unknown>[] = [];
  const frame = {
    postMessage: (message: Record<string, unknown>) => sent.push(message),
  };
  const bridge = new PlayerBridge(
    frame as unknown as Window,
    'test-frame',
    () => undefined
  );
  const deliver = (
    data: Record<string, unknown>,
    source = frame,
    origin = host.location.origin
  ) => {
    const event = new Event('message');
    Object.assign(event, { data, source, origin });
    host.dispatchEvent(event);
  };
  const envelope = {
    channel: 'noah-player',
    version: 1,
    frameId: 'test-frame',
  };
  deliver({ ...envelope, kind: 'event', event: 'ready' });
  const play = bridge.play(100);
  const pause = bridge.command('pause');
  const state = { position: 2, duration: 30, state: 'playing' };
  let played = false;
  void play.then(() => {
    played = true;
  });
  deliver(
    { ...envelope, kind: 'event', event: 'firstFrame', state },
    frame,
    'https://wrong.test'
  );
  await Promise.resolve();
  assert.equal(played, false);
  deliver({ ...envelope, kind: 'event', event: 'firstFrame', state });
  assert.deepEqual(await play, state);
  const pauseCommand = sent.find((value) => value.action === 'pause');
  assert.ok(pauseCommand);
  deliver({ ...envelope, kind: 'reply', id: pauseCommand.id, ok: true, state });
  assert.deepEqual(await pause, state);
  bridge.close(false);
});
