import { User } from '@server/entity/User';
import { Permission } from '@server/lib/permissions';
import express from 'express';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import request from 'supertest';
import adminRoutes from './adminInsights';

function app(permissions?: number) {
  const app = express();
  app.use((req, _res, next) => {
    if (permissions !== undefined) {
      req.user = new User();
      req.user.permissions = permissions;
    }
    next();
  });
  app.use('/admin-tools', adminRoutes);
  return app;
}

test('request pipeline is denied to anonymous and ordinary users', async () => {
  for (const permissions of [undefined, 0]) {
    const response = await request(app(permissions)).get(
      '/admin-tools/pipeline'
    );
    assert.equal(response.status, 403);
  }
});

test('administrator monitor responses are private and sanitized with a safe missing-file fallback', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'pipeline-route-'));
  const before = process.env.REQUEST_PIPELINE_FILE;
  process.env.REQUEST_PIPELINE_FILE = path.join(directory, 'snapshot.json');
  try {
    const endpoint = app(Permission.ADMIN);
    const missing = await request(endpoint).get('/admin-tools/pipeline');
    assert.equal(missing.status, 200);
    assert.equal(missing.body.fresh, false);
    await writeFile(
      process.env.REQUEST_PIPELINE_FILE,
      JSON.stringify({
        version: 1,
        generatedAt: new Date().toISOString(),
        apiKey: 'private-fixture',
        records: [],
        jobs: [],
      })
    );
    const response = await request(endpoint).get('/admin-tools/pipeline');
    assert.equal(response.status, 200);
    assert.equal(response.headers['cache-control'], 'private, no-store');
    assert.equal(response.body.fresh, true);
    assert.doesNotMatch(response.text, /private-fixture|apiKey/);
  } finally {
    if (before === undefined) delete process.env.REQUEST_PIPELINE_FILE;
    else process.env.REQUEST_PIPELINE_FILE = before;
    await rm(directory, { recursive: true });
  }
});
