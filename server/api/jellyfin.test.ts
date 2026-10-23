import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import JellyfinAPI from './jellyfin';

test('managed Jellyfin creation sets its initial password in the same authenticated request', async () => {
  const calls: { path: string; body: Record<string, string>; auth?: string }[] =
    [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    calls.push({
      path: req.url ?? '',
      body: JSON.parse(body),
      auth: req.headers.authorization,
    });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ Id: 'a'.repeat(32), Name: 'seerr-fixture' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = (server.address() as AddressInfo).port;
    const api = new JellyfinAPI(
      `http://127.0.0.1:${port}`,
      'fixture-admin',
      'fixture-device'
    );
    const user = await api.createUser('seerr-fixture', 'fixture-only-password');
    assert.equal(user.Id, 'a'.repeat(32));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, '/Users/New');
    assert.deepEqual(calls[0].body, {
      Name: 'seerr-fixture',
      Password: 'fixture-only-password',
    });
    assert.match(calls[0].auth ?? '', /fixture-admin/);
    await assert.rejects(
      api.createUser('seerr-fixture', ''),
      /requires a name and password/
    );
    assert.equal(calls.length, 1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
