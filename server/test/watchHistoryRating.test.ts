import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import { WatchHistory, WatchHistoryStatus } from '@server/entity/WatchHistory';
import watchHistoryRoutes from '@server/routes/watchHistory';
import { setupTestDb } from '@server/test/db';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import * as OpenApiValidator from 'express-openapi-validator';
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import request from 'supertest';

setupTestDb();
const app = express();
app.use(express.json(), (req, _res, next) => {
  req.user = new User({ id: 1 });
  next();
});
app.use(
  OpenApiValidator.middleware({
    apiSpec: path.join(__dirname, '../../seerr-api.yml'),
    validateRequests: true,
    validateSecurity: false,
  })
);
app.use('/api/v1/watch-history', watchHistoryRoutes);
app.get('/api/v1/search', (req, res) => res.json({ query: req.query.query }));
app.use(
  (
    error: { status?: number; message: string },
    _req: Request,
    res: Response,
    next: NextFunction
  ) => {
    if (res.headersSent) return next(error);
    return res.status(error.status ?? 500).json({ message: error.message });
  }
);

async function entry(userId = 1) {
  return getRepository(WatchHistory).save(
    new WatchHistory({
      user: new User({ id: userId }),
      mediaType: 'movie',
      tmdbId: 947,
      title: 'Movie fixture',
      status: WatchHistoryStatus.COMPLETED,
      watchCount: 3,
      rating: 2,
      notes: 'Keep my notes',
      seasonProgress: {},
      episodeOverrides: {},
      viewingProgress: {
        movie: {
          position: 420,
          duration: 6000,
          completed: false,
          updatedAt: '2026-11-11T12:00:00Z',
          sessionIds: ['fixture'],
          retiredSessionIds: [],
          rewatching: true,
          watchCount: 3,
        },
      },
    })
  );
}

test('rating and clearing rating preserve playback, status, notes and watch count', async () => {
  const saved = await entry();
  for (const rating of [5, null, 1]) {
    const response = await request(app)
      .patch(`/api/v1/watch-history/${saved.id}/rating`)
      .send({ rating, notes: 'Do not apply', watchCount: 0 });
    assert.equal(response.status, 200);
    const current = await getRepository(WatchHistory).findOneByOrFail({
      id: saved.id,
    });
    assert.equal(current.rating, rating);
    assert.equal(current.notes, saved.notes);
    assert.equal(current.watchCount, 3);
    assert.equal(current.status, WatchHistoryStatus.COMPLETED);
    assert.deepEqual(current.viewingProgress, saved.viewingProgress);
  }
});

test('rating cannot modify another account and rejects malformed input', async () => {
  const other = await entry(2);
  assert.equal(
    (
      await request(app)
        .patch(`/api/v1/watch-history/${other.id}/rating`)
        .send({ rating: 5 })
    ).status,
    404
  );
  const own = await entry();
  for (const rating of [0, 6, 1.5, '5', {}, undefined]) {
    assert.equal(
      (
        await request(app)
          .patch(`/api/v1/watch-history/${own.id}/rating`)
          .send({ rating })
      ).status,
      400
    );
  }
  assert.equal(
    (await getRepository(WatchHistory).findOneByOrFail({ id: own.id })).rating,
    2
  );
});

test('search query contract accepts percent-encoded titles and documents rejected form spaces', async () => {
  const query = "Howl's Moving Castle (2004)!";
  const encoded = encodeURIComponent(query).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
  const response = await request(app).get(
    `/api/v1/search?page=1&query=${encoded}`
  );
  assert.equal(response.status, 200);
  assert.equal(response.body.query, query);
  assert.equal(
    (await request(app).get('/api/v1/search?page=1&query=demon+slayer')).status,
    400
  );
});
