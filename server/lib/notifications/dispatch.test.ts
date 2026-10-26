import logger from '@server/logger';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import type { NotificationAgent } from './agents/agent';
import { Notification, NotificationManager } from './index';

test('a failed notification agent cannot reject the request or prevent other deliveries', async (t) => {
  const errors: unknown[][] = [];
  t.mock.method(logger, 'error', (...args: unknown[]) => {
    errors.push(args);
  });
  const delivered: string[] = [];
  const agent = (send: NotificationAgent['send']): NotificationAgent => ({
    shouldSend: () => true,
    send,
  });
  const manager = new NotificationManager();
  manager.registerAgents([
    agent(async () => {
      throw new Error('delivery failed');
    }),
    agent(() => {
      throw new Error('synchronous delivery failure');
    }),
    {
      shouldSend: () => {
        throw new Error('invalid settings');
      },
      send: async () => true,
    },
    {
      shouldSend: () => false,
      send: async () => {
        throw new Error('must not send');
      },
    },
    agent(async () => {
      delivered.push('healthy');
      return true;
    }),
  ]);
  assert.equal(
    manager.sendNotification(Notification.MEDIA_FAILED, {
      subject: 'Example',
      notifyAdmin: true,
      notifySystem: true,
    }),
    undefined
  );
  await setImmediate();
  assert.deepEqual(delivered, ['healthy']);
  assert.equal(errors.length, 3);
  assert.ok(
    errors.every(([message]) => message === 'Notification agent failed')
  );
});

test('pending external delivery does not delay other agents', async () => {
  let finish!: (value: boolean) => void;
  let delivered = false;
  const manager = new NotificationManager();
  manager.registerAgents([
    {
      shouldSend: () => true,
      send: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    },
    {
      shouldSend: () => true,
      send: async () => {
        delivered = true;
        return true;
      },
    },
  ]);
  manager.sendNotification(Notification.MEDIA_PENDING, {
    subject: 'Example',
    notifyAdmin: true,
    notifySystem: true,
  });
  await setImmediate();
  assert.equal(delivered, true);
  finish(true);
});
