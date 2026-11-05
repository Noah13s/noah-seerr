import db, { getRepository } from '@server/datasource';
import { ActivityEvent } from '@server/entity/ActivityEvent';
import { User } from '@server/entity/User';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { observePlayback } from './playbackActivity';
import { getSettings } from './settings';
before(async () => {
  await db.initialize();
});
after(async () => {
  await db.destroy();
});
test('observer uses only GET, maps account IDs, captures tracks and ignores a failed poll', async () => {
  const user = await getRepository(User).save(
    new User({
      email: 'observer@example.invalid',
      username: 'Fixture',
      jellyfinUserId: 'fixture-user',
      avatar: 'fixture',
    })
  );
  let phase = 0;
  const methods: string[] = [];
  const server = http.createServer((req, res) => {
    methods.push(req.method!);
    res.setHeader('Content-Type', 'application/json');
    if (phase === 3) {
      res.statusCode = 503;
      res.end('{}');
      return;
    }
    const item = {
      Id: 'fixture-item',
      Name: 'Observer fixture',
      MediaStreams: [
        { Type: 'Audio', Index: 1, Language: 'jpn' },
        { Type: 'Audio', Index: 2, Language: 'fra' },
        { Type: 'Subtitle', Index: 3, Language: 'eng' },
      ],
    };
    const session = {
      Id: 'fixture-session',
      UserId: user.jellyfinUserId,
      DeviceName: 'Fixture TV',
      Client: 'Noah Stream',
      NowPlayingItem: item,
      PlayState: {
        PositionTicks: (phase === 0 ? 50 : 100) * 1e7,
        IsPaused: phase === 1,
        AudioStreamIndex: phase === 0 ? 1 : 2,
        SubtitleStreamIndex: phase === 0 ? 3 : -1,
        PlayMethod: 'DirectPlay',
      },
    };
    res.end(
      JSON.stringify(
        phase === 4
          ? []
          : [{ ...session, Id: 'unowned', UserId: undefined }, session]
      )
    );
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const config = getSettings().jellyfin;
  const old = { ...config };
  try {
    Object.assign(config, {
      ip: '127.0.0.1',
      port: (server.address() as AddressInfo).port,
      urlBase: '',
      useSsl: false,
      apiKey: 'fixture',
    });
    for (phase = 0; phase <= 4; phase++) await observePlayback();
    const events = await getRepository(ActivityEvent).find({
      order: { id: 'ASC' },
    });
    assert.deepEqual(
      events.map((e) => e.action),
      [
        'playback.detected',
        'playback.paused',
        'playback.seeked',
        'playback.audio',
        'playback.subtitle',
        'playback.resumed',
        'playback.ended',
      ]
    );
    assert.ok(events.every((e) => e.userId === user.id));
    assert.ok(methods.every((m) => m === 'GET'));
    assert.ok(events.some((e) => e.details.includes('fra')));
  } finally {
    Object.assign(config, old);
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve()))
    );
  }
});
