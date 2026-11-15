import cookieParser from 'cookie-parser';
import express from 'express';
import * as OpenApiValidator from 'express-openapi-validator';
import yaml from 'js-yaml';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import request from 'supertest';

const specification = path.resolve('seerr-api.yml');

it('declares every maintained authentication route in the production API schema', () => {
  const spec = yaml.load(readFileSync(specification, 'utf8')) as {
    paths: Record<string, Record<string, unknown>>;
  };
  const source = readFileSync(path.resolve('server/routes/auth.ts'), 'utf8');
  for (const match of source.matchAll(
    /authRoutes\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/g
  )) {
    const route = '/auth' + match[2].replace(/:([A-Za-z0-9_]+)/g, '{$1}');
    assert.ok(
      spec.paths[route]?.[match[1]],
      `Undocumented auth route: ${match[1]} ${route}`
    );
  }
});

it('lets an authenticated native-session request pass the real request validator', async () => {
  const app = express();
  app.use(cookieParser());
  app.use(
    OpenApiValidator.middleware({
      apiSpec: specification,
      validateRequests: true,
    })
  );
  app.get('/api/v1/auth/jellyfin-native-session', (_req, res) => {
    res.status(200).json({
      userId: 'fixture',
      deviceId: 'fixture-device',
      serverId: 'fixture-server',
      accessToken: 'fixture-user-token',
    });
  });
  const allowed = await request(app)
    .get('/api/v1/auth/jellyfin-native-session')
    .set('Cookie', 'connect.sid=fixture');
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body.deviceId, 'fixture-device');
  const anonymous = await request(app).get(
    '/api/v1/auth/jellyfin-native-session'
  );
  assert.equal(anonymous.status, 401);
  const unknown = await request(app)
    .get('/api/v1/auth/unknown-playback-endpoint')
    .set('Cookie', 'connect.sid=fixture');
  assert.equal(unknown.status, 404);
});
