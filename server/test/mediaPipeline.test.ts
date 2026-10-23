import TheMovieDb from '@server/api/themoviedb';
import type { TmdbMovieDetails } from '@server/api/themoviedb/interfaces';
import { MediaRequestStatus, MediaStatus } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import MediaRequest from '@server/entity/MediaRequest';
import { User } from '@server/entity/User';
import { WatchHistory, WatchHistoryStatus } from '@server/entity/WatchHistory';
import {
  applyDeletedLibraryState,
  deletedRequestUpdates,
} from '@server/lib/deletedLibraryState';
import { radarrScanner } from '@server/lib/scanners/radarr';
import { getSettings } from '@server/lib/settings';
import apiRoutes from '@server/routes';
import express from 'express';
import session from 'express-session';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, mock, test } from 'node:test';
import request from 'supertest';
import { setupTestDb } from './db';
import { runWithMockTimers } from './runWithMockTimers';

// Real Express routes, ORM/subscribers and Arr HTTP client; only the external
// metadata/download services are fixtures. No internet or production database.
setupTestDb();
mock.method(MediaRequest, 'sendNotification', async () => undefined);
const movie = {
  id: 900001,
  title: 'Pipeline fixture',
  release_date: '2020-01-01',
  genres: [],
  original_language: 'en',
  keywords: { keywords: [] },
  external_ids: {},
} as unknown as TmdbMovieDetails;
Object.defineProperty(TheMovieDb.prototype, 'getMovie', {
  configurable: true,
  get: () => async () => movie,
  set() {},
});
let imported = false,
  added = false,
  unavailable = false;
const calls: string[] = [];
const arrMovie = () => ({
  id: 91,
  tmdbId: movie.id,
  title: movie.title,
  titleSlug: 'pipeline-fixture',
  monitored: true,
  hasFile: imported,
  tags: [],
  movieFile: imported
    ? { id: 8, quality: { quality: { resolution: 1080 } } }
    : undefined,
});
const arr = http.createServer(async (req, res) => {
  calls.push(`${req.method} ${new URL(req.url!, 'http://fixture').pathname}`);
  assert.equal(
    new URL(req.url!, 'http://fixture').searchParams.get('apikey'),
    'fixture-arr-key'
  );
  if (unavailable) {
    res.writeHead(503).end();
    return;
  }
  res.setHeader('Content-Type', 'application/json');
  if (req.url?.startsWith('/api/v3/movie/lookup')) {
    res.end(
      JSON.stringify([
        added ? arrMovie() : { tmdbId: movie.id, title: movie.title },
      ])
    );
  } else if (
    req.method === 'POST' &&
    req.url?.split('?')[0] === '/api/v3/movie'
  ) {
    let body = '';
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    assert.equal(input.tmdbId, movie.id);
    assert.equal(input.addOptions.searchForMovie, true);
    added = true;
    res.end(JSON.stringify(arrMovie()));
  } else if (req.method === 'GET' && req.url?.startsWith('/api/v3/movie')) {
    res.end(JSON.stringify(added ? [arrMovie()] : []));
  } else if (req.url?.split('?')[0] === '/api/v3/command') {
    res.end(JSON.stringify({ id: 1, status: 'completed' }));
  } else {
    res.writeHead(404).end('{}');
  }
});
before(async () => {
  await new Promise<void>((resolve) => arr.listen(0, '127.0.0.1', resolve));
});
after(async () => {
  await new Promise<void>((resolve) => arr.close(() => resolve()));
});
const app = express();
app.use(
  express.json(),
  session({
    secret: 'isolated-pipeline-fixture',
    resave: false,
    saveUninitialized: false,
  })
);
app.use('/api/v1', apiRoutes);
app.use(
  (
    error: { status?: number; message: string },
    _req: express.Request,
    res: express.Response,
    // Express identifies error middleware by its four-argument signature.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _next: express.NextFunction
  ) => {
    res.status(error.status ?? 500).json({ message: error.message });
  }
);
async function login(email: string) {
  getSettings().main.localLogin = true;
  const agent = request.agent(app);
  const response = await agent
    .post('/api/v1/auth/local')
    .send({ email, password: 'test1234' });
  assert.equal(response.status, 200, response.text);
  return agent;
}
async function until(condition: () => Promise<boolean>) {
  const deadline = Date.now() + 8000;
  while (!(await condition())) {
    assert.ok(Date.now() < deadline, 'Detached Arr processing did not settle');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test('request → Arr download/import → available → approved deletion → another requester', async () => {
  const settings = getSettings();
  settings.sonarr = [];
  settings.radarr = [
    {
      id: 0,
      name: 'Fixture Arr',
      hostname: '127.0.0.1',
      port: (arr.address() as AddressInfo).port,
      apiKey: 'fixture-arr-key',
      baseUrl: '',
      useSsl: false,
      activeProfileId: 1,
      activeProfileName: 'Fixture',
      tagRequests: false,
      overrideRule: [],
      activeDirectory: '/fixture/movies',
      is4k: false,
      minimumAvailability: 'released',
      tags: [],
      isDefault: true,
      syncEnabled: true,
      preventSearch: false,
      externalUrl: '',
    },
  ];
  const owner = await login('admin@seerr.dev');
  const response = await owner
    .post('/api/v1/request')
    .send({ mediaType: 'movie', mediaId: movie.id });
  assert.equal(response.status, 201, response.text);
  const mediaRepo = getRepository(Media);
  await until(
    async () =>
      (await mediaRepo.findOneBy({ tmdbId: movie.id }))?.externalServiceId ===
      91
  );
  // The scanner publishes the downloading phase; the detached Arr callback
  // establishes the link before the subscriber's parent-state write settles.
  await runWithMockTimers(() => radarrScanner.run());
  let media = await mediaRepo.findOneByOrFail({ tmdbId: movie.id });
  assert.equal(media.status, MediaStatus.PROCESSING);
  imported = true;
  await runWithMockTimers(() => radarrScanner.run());
  media = await mediaRepo.findOneOrFail({
    where: { tmdbId: movie.id },
    relations: ['requests', 'requests.seasons', 'requests.requestedBy'],
  });
  assert.equal(media.status, MediaStatus.AVAILABLE);
  assert.ok(calls.includes('POST /api/v3/movie'));
  unavailable = true;
  await runWithMockTimers(() => radarrScanner.run());
  assert.equal(
    (await mediaRepo.findOneByOrFail({ id: media.id })).status,
    MediaStatus.AVAILABLE,
    'An unavailable service must not erase imported availability'
  );
  unavailable = false;
  // Invoke the same state transition used after approved cleanup; never unlink
  // a real media file. Old ownership/history is retained, not cleared.
  applyDeletedLibraryState(media);
  const closed = deletedRequestUpdates(media.requests, true);
  if (closed.requestIds.length) {
    await getRepository(MediaRequest).update(closed.requestIds, {
      status: MediaRequestStatus.COMPLETED,
    });
  }
  await mediaRepo.save(media);
  added = imported = false;
  const other = await login('demo@seerr.dev');
  const again = await other
    .post('/api/v1/request')
    .send({ mediaType: 'movie', mediaId: movie.id });
  assert.equal(again.status, 201, again.text);
  assert.notEqual(again.body.id, response.body.id);
  assert.notEqual(again.body.requestedBy.id, response.body.requestedBy.id);
  assert.equal(
    await getRepository(MediaRequest).count({
      where: { media: { id: media.id } },
    }),
    2
  );
});

test('mounted watch history and cleanup routes enforce profile and administrator boundaries', async () => {
  const users = await getRepository(User).find();
  for (const user of users) {
    await getRepository(WatchHistory).save(
      Object.assign(new WatchHistory(), {
        user,
        mediaType: 'movie',
        tmdbId: 900000 + user.id,
        title: `Only profile ${user.id}`,
        status: WatchHistoryStatus.COMPLETED,
        watchCount: 1,
        seasonProgress: {},
        episodeOverrides: {},
        viewingProgress: {},
      })
    );
  }
  assert.equal((await request(app).get('/api/v1/watch-history')).status, 403);
  const agent = await login('demo@seerr.dev');
  const me = await agent.get('/api/v1/auth/me');
  const history = await agent.get('/api/v1/watch-history?profile=1');
  assert.equal(history.status, 200, history.text);
  assert.deepEqual(
    history.body.results.map((entry: { title: string }) => entry.title),
    [`Only profile ${me.body.id}`]
  );
  assert.equal((await agent.get('/api/v1/cleanup-reviews')).status, 403);
});
