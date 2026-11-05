import db, { getRepository } from '@server/datasource';
import { ActivityEvent } from '@server/entity/ActivityEvent';
import { User } from '@server/entity/User';
import { recordActivity } from '@server/lib/activity';
import { Permission } from '@server/lib/permissions';
import express from 'express';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import request from 'supertest';
import routes from './adminInsights';
before(async () => {
  await db.initialize();
});
after(async () => {
  await db.destroy();
});
function app(permissions: number) {
  const a = express();
  a.use((req, _res, next) => {
    req.user = new User();
    req.user.id = 1;
    req.user.permissions = permissions;
    next();
  });
  a.use(routes);
  return a;
}
test('audit is administrator-only, cursor-paginated and scoped to selected users', async () => {
  const common = {
    userName: 'Fixture',
    category: 'playback',
    action: 'playback.paused',
    device: 'Fixture TV',
    title: 'Fixture episode',
    details: '{"position":42}',
  };
  for (const userId of [1, 2, 1]) await recordActivity({ ...common, userId });
  assert.equal((await request(app(0)).get('/activity')).status, 403);
  const first = await request(app(Permission.ADMIN)).get(
    '/activity?take=1&userId=1'
  );
  assert.equal(first.status, 200);
  assert.equal(first.body.events.length, 1);
  assert.equal(first.body.events[0].details.position, 42);
  assert.equal(first.headers['cache-control'], 'private, no-store');
  const second = await request(app(Permission.ADMIN)).get(
    '/activity?take=1&userId=1&before=' + first.body.next
  );
  assert.ok(second.body.events[0].id < first.body.events[0].id);
  assert.equal(second.body.next, null);
  assert.equal(
    (await request(app(Permission.ADMIN)).get('/activity?take=10000')).status,
    400
  );
  assert.equal(await getRepository(ActivityEvent).count(), 3);
});

test('successful and failed API mutations record the actor without request secrets', async () => {
  const { auditMutations } = await import('../middleware/activity');
  const endpoint = express();
  endpoint.use(express.json());
  endpoint.use((req, _res, next) => {
    req.user = new User();
    req.user.id = 7;
    req.user.displayName = 'Audit fixture';
    next();
  });
  endpoint.use(auditMutations);
  endpoint.post('/request', (_req, res) =>
    res.status(201).json({
      id: 82,
      media: { tmdbId: 4935, mediaType: 'movie' },
      token: 'private-response-fixture',
    })
  );
  endpoint.delete('/watchlist/12', (_req, res) =>
    res.status(409).json({ message: 'refused' })
  );
  await request(endpoint)
    .post('/request')
    .set('User-Agent', 'Edge fixture')
    .send({
      password: 'private-password-fixture',
      apiKey: 'private-key-fixture',
    });
  await request(endpoint).delete('/watchlist/12');
  for (let i = 0; i < 30; i++) {
    if ((await getRepository(ActivityEvent).countBy({ userId: 7 })) === 2)
      break;
    await new Promise((r) => setTimeout(r, 10));
  }
  const events = await getRepository(ActivityEvent).findBy({ userId: 7 });
  assert.equal(events.length, 2);
  assert.ok(events.some((e) => e.action === 'watchlist.removed.failed'));
  const created = events.find((e) => e.action === 'request.created')!;
  assert.equal(JSON.parse(created.details).tmdbId, 4935);
  assert.match(created.title, /4935/);
  assert.doesNotMatch(
    JSON.stringify(events),
    /private-password-fixture|private-key-fixture|private-response-fixture/
  );
});
