import { User } from '@server/entity/User';
import { Permission } from '@server/lib/permissions';
import express from 'express';
import assert from 'node:assert/strict';
import fs, { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import request from 'supertest';
import adminRoutes, { diskSnapshot } from './adminInsights';

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

test('storage insights include a second disk only on a distinct filesystem and sum both libraries', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'storage-insights-'));
  t.after(() => rm(directory, { recursive: true }));
  const fixture = (name: string) => path.join(directory, name);
  await mkdir(fixture('/app/config'), { recursive: true });
  await mkdir(fixture('/media/films'), { recursive: true });
  await writeFile(fixture('/media/films/first.mkv'), 'abc');

  const { readdir, statfs, stat } = fs;
  const secondCapacity = {
    ...(await statfs(directory, { bigint: true })),
    bsize: 4096n,
    blocks: 100n,
    bavail: 90n,
  };
  let secondaryIsDistinct = false;
  t.mock.method(fs, 'stat', async (name: string) => {
    const stats = await stat(fixture(name));
    if (name === '/media2' && secondaryIsDistinct) stats.dev += 1;
    return stats;
  });
  t.mock.method(fs, 'statfs', async (name: string) =>
    name === '/media2'
      ? secondCapacity
      : statfs(fixture(name), { bigint: true })
  );
  t.mock.method(fs, 'readdir', (name: string) =>
    readdir(fixture(name), { withFileTypes: true })
  );

  const read = async () => {
    const { volumes, libraries } = await diskSnapshot();
    return {
      mounts: volumes.map((volume) => volume.mount),
      libraries,
      volumes,
    };
  };
  const baseMounts = ['/app/config', '/media'];
  assert.deepEqual((await read()).mounts, baseMounts);

  await mkdir(fixture('/media2/films'), { recursive: true });
  await writeFile(fixture('/media2/films/second.mkv'), '12345');
  const unmounted = await read();
  assert.deepEqual(unmounted.mounts, baseMounts);
  assert.deepEqual(
    unmounted.libraries.find(({ name }) => name === 'films'),
    {
      name: 'films',
      bytes: 3,
    }
  );

  secondaryIsDistinct = true;
  const mounted = await read();
  assert.deepEqual(mounted.mounts, [...baseMounts, '/media2']);
  assert.deepEqual(mounted.volumes[2], {
    mount: '/media2',
    total: 409600,
    free: 368640,
  });
  assert.deepEqual(
    mounted.libraries.find(({ name }) => name === 'films'),
    {
      name: 'films',
      bytes: 8,
    }
  );
});
