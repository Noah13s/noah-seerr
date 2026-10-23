const { test } = require('node:test');
const assert = require('node:assert/strict');
const { nativePlaybackSessions, playbackDeviceIds } = require('../server/lib/native-playback-session.cjs');
const user = { id: 1, jellyfinUserId: '0123456789abcdef0123456789abcdef', jellyfinUsername: 'noah' };
const settings = { jellyfin: { apiKey: 'admin-secret', serverId: 'server-a' } };
const account = { Id: user.jellyfinUserId, Name: 'noah', Policy: { IsDisabled: false, EnableMediaPlayback: true } };
function fixture(modify = () => {}, options = {}) {
  const calls = [];
  const session = { save: done => done() };
  let invalid = false;
  const prepare = nativePlaybackSessions({
    ...options,
    randomUUID: () => '11111111-2222-3333-4444-555555555555',
    request: async config => {
      calls.push(config);
      const path = new URL(config.url).pathname;
      const custom = modify(config, path); if (custom) return custom;
      if (path.endsWith('/Users/Me')) {
        if (invalid) throw { response: { status: 401 } };
        return { data: account };
      }
      if (path.includes('/Users/') && config.method === 'GET') return { data: account };
      if (path.endsWith('/QuickConnect/Enabled')) return { data: true };
      if (path.endsWith('/QuickConnect/Initiate')) return { data: { Code: '123456', Secret: 'quick-secret' } };
      if (path.endsWith('/QuickConnect/Authorize')) return { data: true };
      if (path.endsWith('/Users/AuthenticateWithQuickConnect')) return { data: { User: account, AccessToken: 'native-secret' } };
      throw Error('Unexpected request');
    },
  });
  return { session, calls, setInvalid: () => { invalid = true; }, run: (as = user, state = session) => prepare({ session: state, user: as, settings, hostname: 'http://localhost:8096/player' }) };
}
test('native login is scoped to the authenticated mapping, saved, reused and renewed once', async () => {
  const f = fixture();
  const [a, b] = await Promise.all([f.run(), f.run()]);
  assert.deepEqual(a, b);
  assert.equal(a.accessToken, 'native-secret');
  assert.notEqual(a.accessToken, settings.jellyfin.apiKey);
  assert.equal(f.calls.filter(c => c.url.endsWith('/QuickConnect/Initiate')).length, 1);
  const authorization = f.calls.find(c => c.url.endsWith('/QuickConnect/Authorize'));
  assert.deepEqual(authorization.params, { code: '123456', userId: user.jellyfinUserId });
  assert.ok(f.calls.every(c => c.timeout === 8000 && c.maxRedirects === 0));
  await f.run();
  assert.equal(f.calls.filter(c => c.url.endsWith('/QuickConnect/Initiate')).length, 1);
  f.setInvalid(); await f.run();
  assert.equal(f.calls.filter(c => c.url.endsWith('/QuickConnect/Initiate')).length, 2);
});
test('a disabled account or identity mismatch cannot receive a session', async () => {
  for (const value of [{ ...account, Policy: { IsDisabled: true } }, { ...account, Id: 'a'.repeat(32) }]) {
    const f = fixture((c, path) => path.includes('/Users/') && c.method === 'GET' ? { data: value } : undefined);
    await assert.rejects(f.run(), error => error.status === 403);
    assert.equal(f.calls.some(c => c.url.endsWith('/QuickConnect/Initiate')), false);
  }
});
test('outages and forbidden tokens are never treated as expired or renewed', async () => {
  for (const status of [403, 503]) {
    const f = fixture((c, path) => { if (path.endsWith('/Users/Me')) throw { response: { status } }; });
    await f.run();
    await assert.rejects(f.run(), error => error.response.status === status);
    assert.equal(f.calls.filter(c => c.url.endsWith('/QuickConnect/Initiate')).length, 1);
  }
});
test('switching Seerr profiles cannot reuse the previous user token', async () => {
  const f = fixture(); await f.run();
  await assert.rejects(f.run({ ...user, id: 2, jellyfinUserId: 'a'.repeat(32) }), error => error.status === 403);
});

test('parallel browser requests loaded as separate Express sessions mint one token', async () => {
  const f = fixture(() => {}, { channel: 'web' });
  const sessions = Array.from({ length: 8 }, () => ({ id: 'one-browser-cookie', save: done => done() }));
  const results = await Promise.all(sessions.map(session => f.run(user, session)));
  assert.ok(results.every(result => result.accessToken === results[0].accessToken));
  assert.equal(f.calls.filter(call => call.url.endsWith('/QuickConnect/Initiate')).length, 1);
  assert.ok(results[0].deviceId.startsWith('noah-web-'));
  const other = await f.run(user, { id: 'another-browser-cookie', save: done => done() });
  assert.notEqual(other.deviceId, results[0].deviceId);
});

test('browser and native token state are isolated and logout never targets the shared device', async () => {
  const browser = fixture(() => {}, { channel: 'web' });
  const native = fixture();
  const state = { id: 'cookie', save: done => done() };
  const web = await browser.run(user, state);
  const app = await native.run(user, state);
  assert.notEqual(web.deviceId, app.deviceId);
  assert.equal(state.noahWebPlayback.token, web.accessToken);
  assert.equal(state.noahNativePlayback.token, app.accessToken);
  assert.deepEqual(playbackDeviceIds(state, { ...user, jellyfinDeviceId: 'shared-device' }), [web.deviceId, app.deviceId]);
  assert.deepEqual(playbackDeviceIds({}, { ...user, jellyfinDeviceId: 'shared-device' }), []);
  assert.deepEqual(playbackDeviceIds(state, { ...user, id: 2 }), []);
});

test('session.reload replacement preserves concurrent state when saving a renewed token', async () => {
  const f = fixture(() => {}, { channel: 'web' });
  const active = { userId: user.id, noahNativePlayback: { token: 'existing-native' }, save: done => done() };
  const original = { id: 'cookie', req: { session: null }, reload(done) { this.req.session = active; done(); }, save() { throw Error('Must not save stale Express session'); } };
  await f.run(user, original);
  assert.equal(active.noahNativePlayback.token, 'existing-native');
  assert.equal(active.noahWebPlayback.token, 'native-secret');
});

test('logout or profile change during renewal cannot resurrect the session', async () => {
  for (const changedUser of [undefined, 2]) {
    const f = fixture(() => {}, { channel: 'web' });
    let saved = false;
    let reloads = 0;
    const session = { id: 'cookie', userId: user.id, reload(done) {
      if (++reloads === 1) return done();
      this.userId = changedUser;
      if (changedUser === undefined) done(Error('Session deleted')); else done();
    }, save: done => { saved = true; done(); } };
    await assert.rejects(f.run(user, session), error => error.status === 401);
    assert.equal(saved, false);
    assert.equal(f.calls.some(call => call.method === 'DELETE' && call.url.endsWith('/Devices')), true);
  }
});

test('a late request loaded before renewal reloads the saved token instead of replacing it', async () => {
  const f = fixture(() => {}, { channel: 'web' });
  f.session.id = 'stale-cookie';
  const original = await f.run();
  const active = { ...f.session, userId: user.id };
  const stale = { id: 'stale-cookie', req: { session: null }, reload(done) { this.req.session = active; done(); }, save() { throw Error('Stale save'); } };
  const next = await f.run(user, stale);
  assert.equal(next.accessToken, original.accessToken);
  assert.equal(f.calls.filter(call => call.url.endsWith('/QuickConnect/Initiate')).length, 1);
});

test('simultaneous native/browser writes merge the persisted records', async () => {
  const web = fixture(() => {}, { channel: 'web' });
  const native = fixture();
  let persisted = { userId: user.id };
  function state(req) {
    return { id: 'concurrent-cookie', ...JSON.parse(JSON.stringify(persisted)), req,
      reload(done) { req.session = state(req); done(); },
      save(done) { setTimeout(() => { const { req: ignored, ...data } = this; persisted = JSON.parse(JSON.stringify(data)); done(); }, 2); },
    };
  }
  const a = {}, b = {};
  await Promise.all([web.run(user, state(a)), native.run(user, state(b))]);
  assert.ok(persisted.noahWebPlayback.token);
  assert.ok(persisted.noahNativePlayback.token);
});

test('renamed linked accounts retain access by immutable ID', async () => {
  const f = fixture((config, path) => path.includes('/Users/') && config.method === 'GET' ? { data: { ...account, Name: 'new-name' } } : undefined);
  const result = await f.run();
  assert.equal(result.userId, account.Id);
});

test('deleted mappings require relinking; disabled Quick Connect does not', async () => {
  const deleted = fixture((config, path) => { if (path === '/player/Users/' + user.jellyfinUserId) throw { response: { status: 404 } }; });
  await assert.rejects(deleted.run(), error => error.status === 409 && error.code === 'JELLYFIN_RELINK_REQUIRED');
  const disabled = fixture((config, path) => path.endsWith('/QuickConnect/Enabled') ? { data: false } : undefined);
  await assert.rejects(disabled.run(), error => error.status === 503 && error.code === 'JELLYFIN_QUICK_CONNECT_DISABLED');
  assert.equal(disabled.calls.some(call => call.url.endsWith('/QuickConnect/Initiate')), false);
});

test('a brief database/network failure on validation recovers without issuing a new token', async () => {
  let failed = false;
  const f = fixture((config, path) => {
    if (path.endsWith('/Users/Me') && !failed) { failed = true; throw { response: { status: 500 } }; }
  });
  const first = await f.run();
  const next = await f.run();
  assert.equal(first.accessToken, next.accessToken);
  assert.equal(f.calls.filter(call => call.url.endsWith('/Users/Me')).length, 2);
  assert.equal(f.calls.filter(call => call.url.endsWith('/QuickConnect/Initiate')).length, 1);
});
