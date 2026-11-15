import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it, mock } from 'node:test';

import JellyfinAPI from '@server/api/jellyfin';
import PlexTvAPI from '@server/api/plextv';
import { ApiErrorCode } from '@server/constants/error';
import { MediaServerType } from '@server/constants/server';
import { UserType } from '@server/constants/user';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import * as schedule from '@server/job/schedule';
import PreparedEmail from '@server/lib/email';
import ImageProxy from '@server/lib/imageproxy';
import { getSettings } from '@server/lib/settings';
import { checkUser } from '@server/middleware/auth';
import { setupTestDb } from '@server/test/db';
import {
  allowlistedSettings,
  assertNoCredentials,
  seedUserSettings,
} from '@server/test/userSettings';
import { ApiError } from '@server/types/error';
import type { AxiosRequestConfig } from 'axios';
import axios from 'axios';
import type { Express } from 'express';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import authRoutes from './auth';

const emailMock = mock.method(PreparedEmail.prototype, 'send', async () => {
  return undefined;
}).mock;

// Jellyfin Quick Connect mocks
const defaultInitiateResponse = {
  Secret: 'abc123def456abc123def456',
  Code: '123456',
  DateAdded: new Date().toISOString(),
};

const defaultCheckResponse = {
  Authenticated: false,
  Secret: 'abc123def456abc123def456',
  Code: '123456',
  DeviceId: 'device-1',
  DeviceName: 'Test',
  AppName: 'Seerr',
  AppVersion: '1.0',
  DateAdded: new Date().toISOString(),
};

const defaultAuthenticateResponse = {
  User: {
    Id: 'jf-qc-user-001',
    Name: 'quickconnectuser',
    ServerId: 'server-1',
    Policy: { IsAdministrator: false },
  },
  AccessToken: 'fake-qc-access-token',
};

const initiateQCMock = mock.method(
  JellyfinAPI.prototype,
  'initiateQuickConnect',
  async () => ({ ...defaultInitiateResponse })
);

const checkQCMock = mock.method(
  JellyfinAPI.prototype,
  'checkQuickConnect',
  async () => ({ ...defaultCheckResponse })
);

const authenticateQCMock = mock.method(
  JellyfinAPI.prototype,
  'authenticateQuickConnect',
  async () => ({ ...defaultAuthenticateResponse })
);
const fakeAvatarBuffer = Buffer.from('fake-quickconnect-avatar-bytes');

const axiosHeadMock = mock.method(axios, 'head', async () => ({
  status: 200,
  headers: { 'last-modified': 'Wed, 01 Jan 2025 00:00:00 GMT' },
}));

const clearCachedImageMock = mock.method(
  ImageProxy.prototype,
  'clearCachedImage',
  async () => undefined
);

const getImageMock = mock.method(
  ImageProxy.prototype,
  'getImage',
  async () => ({
    imageBuffer: fakeAvatarBuffer,
    meta: {
      revalidateAfter: 3600,
      curRevalidate: 3600,
      isStale: false,
      etag: 'mock-meta-etag',
      extension: 'jpg',
      cacheKey: 'mock-cache-key',
      cacheMiss: true,
    },
  })
);

let app: Express;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: false,
    })
  );
  app.use(checkUser);
  app.use('/auth', authRoutes);
  // Error handler matching how next({ status, message }) calls are handled
  app.use(
    (
      err: { status?: number; message?: string },
      _req: express.Request,
      res: express.Response,
      // We must provide a next function for the function signature here even though its not used
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: express.NextFunction
    ) => {
      res
        .status(err.status ?? 500)
        .json({ status: err.status ?? 500, message: err.message });
    }
  );
  return app;
}

before(async () => {
  app = createApp();
});

setupTestDb();

/** Create a supertest agent that is logged in as the given user. */
async function authenticatedAgent(email: string, password: string) {
  const agent = request.agent(app);
  const settings = getSettings();
  settings.main.localLogin = true;

  const res = await agent.post('/auth/local').send({ email, password });

  assert.strictEqual(res.status, 200);
  return agent;
}

/** Configure Jellyfin settings for testing QC */
function configureJellyfin() {
  const settings = getSettings();
  settings.main.mediaServerType = MediaServerType.JELLYFIN;
  settings.main.newPlexLogin = true;
  settings.jellyfin.ip = 'localhost';
  settings.jellyfin.port = 8096;
  settings.jellyfin.useSsl = false;
  settings.jellyfin.urlBase = '';
}

describe('Playback authentication and activity boundaries', () => {
  const account = {
    ...defaultAuthenticateResponse.User,
    Id: '0123456789abcdef0123456789abcdef',
    Name: 'seerr-2',
    Policy: {
      IsAdministrator: false,
      IsDisabled: false,
      EnableMediaPlayback: true,
    },
  };
  const restorers: (() => void)[] = [];
  afterEach(() => {
    for (const restore of restorers.splice(0)) restore();
  });

  async function linkedAgent() {
    configureJellyfin();
    const settings = getSettings();
    settings.jellyfin.apiKey = 'fixture-admin-key';
    settings.jellyfin.serverId = 'fixture-server';
    await getRepository(User).update(
      { email: 'demo@seerr.dev' },
      {
        jellyfinUserId: account.Id,
        jellyfinUsername: account.Name,
      }
    );
    const transport = mock.method(
      axios,
      'request',
      async (config: AxiosRequestConfig) => {
        const url = String(config.url);
        if (
          url.endsWith('/QuickConnect/Enabled') ||
          url.endsWith('/QuickConnect/Authorize')
        )
          return { data: true };
        if (url.endsWith('/QuickConnect/Initiate'))
          return { data: { Secret: 'fixture-secret', Code: '123456' } };
        if (url.endsWith('/Users/AuthenticateWithQuickConnect'))
          return { data: { User: account, AccessToken: 'fixture-user-token' } };
        if (config.method === 'GET' && url.includes('/Users/'))
          return { data: account };
        throw new Error('Unexpected playback request');
      }
    );
    restorers.push(() => transport.mock.restore());
    return {
      agent: await authenticatedAgent('demo@seerr.dev', 'test1234'),
      transport,
    };
  }

  it('rejects anonymous access and non-Jellyfin installations', async () => {
    for (const path of ['/jellyfin-session', '/jellyfin-native-session']) {
      assert.equal((await request(app).get('/auth' + path)).status, 403);
    }
    const { agent } = await linkedAgent();
    getSettings().main.mediaServerType = MediaServerType.PLEX;
    for (const path of ['/jellyfin-session', '/jellyfin-native-session']) {
      const res = await agent.get('/auth' + path);
      assert.equal(res.status, 409);
      assert.equal(res.body.code, 'JELLYFIN_NOT_CONFIGURED');
    }
  });

  it('keeps browser and native tokens scoped and reuses each established session', async () => {
    const { agent, transport } = await linkedAgent();
    const devices = new Set();
    for (const path of ['/jellyfin-session', '/jellyfin-native-session']) {
      const res = await agent.get('/auth' + path);
      assert.equal(res.status, 200);
      assert.equal(res.headers['cache-control'], 'private, no-store');
      assert.equal(res.body.accessToken, 'fixture-user-token');
      assert.equal(res.body.userId, account.Id);
      devices.add(res.body.deviceId);
      const again = await agent.get('/auth' + path);
      assert.equal(again.body.deviceId, res.body.deviceId);
    }
    assert.equal(devices.size, 2);
    assert.equal(
      transport.mock.calls.filter((c) =>
        c.arguments[0].url?.endsWith('/QuickConnect/Initiate')
      ).length,
      2
    );
  });

  for (const reuse of [true, false]) {
    it(`links an unlinked Seerr profile by ${reuse ? 'reusing' : 'creating'} its managed account`, async () => {
      const { agent } = await linkedAgent();
      await getRepository(User).update(
        { email: 'demo@seerr.dev' },
        { jellyfinUserId: null }
      );
      const users = mock.method(
        JellyfinAPI.prototype,
        'getUsers',
        async () => ({ users: reuse ? [account] : [] })
      );
      const create = mock.method(
        JellyfinAPI.prototype,
        'createUser',
        async () => account
      );
      restorers.push(
        () => users.mock.restore(),
        () => create.mock.restore()
      );
      const res = await agent.get('/auth/jellyfin-session');
      assert.equal(res.status, 200);
      assert.equal(create.mock.calls.length, reuse ? 0 : 1);
      const saved = await getRepository(User).findOneByOrFail({
        email: 'demo@seerr.dev',
      });
      assert.equal(saved.jellyfinUserId, account.Id);
      if (!reuse)
        assert.ok((create.mock.calls[0].arguments[1]?.length ?? 0) >= 48);
    });
  }

  it('does not silently replace a different existing account mapping', async () => {
    const { agent } = await linkedAgent();
    await getRepository(User).update(
      { email: 'demo@seerr.dev' },
      { jellyfinUserId: null, jellyfinUsername: 'different-user' }
    );
    const res = await agent.get('/auth/jellyfin-session');
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'JELLYFIN_RELINK_REQUIRED');
  });

  it('revokes only the browser and native devices issued to this session on logout', async () => {
    const { agent } = await linkedAgent();
    const web = await agent.get('/auth/jellyfin-session');
    const native = await agent.get('/auth/jellyfin-native-session');
    const revoke = mock.method(
      axios,
      'delete',
      async (url: string, config?: AxiosRequestConfig) => {
        assert.ok(url.endsWith('/Devices'));
        assert.ok(config?.params?.Id);
        return { status: 204 };
      }
    );
    restorers.push(() => revoke.mock.restore());
    assert.equal((await agent.post('/auth/logout')).status, 200);
    assert.deepEqual(
      new Set(revoke.mock.calls.map((call) => call.arguments[1]?.params.Id)),
      new Set([web.body.deviceId, native.body.deviceId])
    );
    assert.ok(
      revoke.mock.calls.every(
        (call) =>
          call.arguments[1]?.timeout === 8000 &&
          call.arguments[1]?.maxRedirects === 0
      )
    );
    assert.equal(
      (await agent.get('/auth/jellyfin-native-session')).status,
      403
    );
  });

  it('restores Plex configuration when the existing owner signs into an unconfigured server', async () => {
    const settings = getSettings();
    settings.main.mediaServerType = MediaServerType.NOT_CONFIGURED;
    const account = mock.method(PlexTvAPI.prototype, 'getUser', async () => ({
      id: 1,
      email: 'admin@seerr.dev',
      username: 'admin',
      authToken: 'fixture-plex-token',
      thumb: '',
    }));
    const save = mock.method(settings, 'save', async () => undefined);
    const jobs = mock.method(schedule, 'startJobs', () => undefined);
    restorers.push(
      () => account.mock.restore(),
      () => save.mock.restore(),
      () => jobs.mock.restore()
    );
    const res = await request(app)
      .post('/auth/plex')
      .send({ authToken: 'fixture-plex-token' });
    assert.equal(res.status, 200);
    assert.equal(settings.main.mediaServerType, MediaServerType.PLEX);
    assert.equal(save.mock.calls.length, 1);
    assert.equal(jobs.mock.calls.length, 1);
  });

  it('returns bounded public errors instead of backend details or credentials', async () => {
    const { agent, transport } = await linkedAgent();
    for (const status of [403, 503]) {
      transport.mock.mockImplementation(async () => {
        throw { response: { status }, message: 'private backend details' };
      });
      for (const path of ['/jellyfin-session', '/jellyfin-native-session']) {
        const res = await agent.get('/auth' + path);
        assert.equal(res.status, status === 403 ? 403 : 502);
        assert.equal(res.body.code, 'JELLYFIN_SESSION_UNAVAILABLE');
        assert.ok(!JSON.stringify(res.body).includes('private backend'));
        assert.ok(!JSON.stringify(res.body).includes('fixture-admin-key'));
      }
    }
  });

  it('treats valid warmup as optional and rejects malformed item IDs', async () => {
    const { agent } = await linkedAgent();
    assert.equal(
      (await agent.post('/auth/jellyfin-warm').send({ itemId: 'bad-id' }))
        .status,
      400
    );
    const warm = mock.method(axios, 'post', async () => {
      throw new Error('Warm service unavailable');
    });
    restorers.push(() => warm.mock.restore());
    const res = await agent
      .post('/auth/jellyfin-warm')
      .send({ itemId: 'a'.repeat(32) });
    assert.equal(res.status, 204);
    assert.equal(warm.mock.calls.length, 1);
    assert.equal(
      warm.mock.calls[0].arguments[2]?.headers?.Authorization,
      'MediaBrowser Token="fixture-user-token"'
    );
  });

  it('records activity once within the debounce window and refreshes stale activity', async () => {
    const { agent } = await linkedAgent();
    const repo = getRepository(User);
    await repo.update({ email: 'demo@seerr.dev' }, { lastActiveAt: null });
    assert.equal((await agent.post('/auth/activity')).status, 204);
    const first = (await repo.findOneByOrFail({ email: 'demo@seerr.dev' }))
      .lastActiveAt;
    assert.ok(first);
    await agent.post('/auth/activity');
    assert.equal(
      (
        await repo.findOneByOrFail({ email: 'demo@seerr.dev' })
      ).lastActiveAt?.getTime(),
      first.getTime()
    );
    await repo.update(
      { email: 'demo@seerr.dev' },
      { lastActiveAt: new Date(0) }
    );
    await agent.post('/auth/activity');
    assert.ok(
      (
        await repo.findOneByOrFail({ email: 'demo@seerr.dev' })
      ).lastActiveAt!.getTime() > first.getTime()
    );
  });

  it('limits diagnostics to admins, validates payloads and expires rate limits', async () => {
    const { agent } = await linkedAgent();
    const payload = { phase: 'snapshot', media: [] };
    assert.equal(
      (await agent.post('/auth/cast-diagnostics').send(payload)).status,
      403
    );
    const admin = await authenticatedAgent('admin@seerr.dev', 'test1234');
    assert.equal(
      (await admin.post('/auth/cast-diagnostics').send({ phase: 'bad' }))
        .status,
      400
    );
    const now = Date.now();
    const clock = mock.method(Date, 'now', () => now + 120000);
    restorers.push(() => clock.mock.restore());
    for (let i = 0; i < 120; i++)
      assert.equal(
        (await admin.post('/auth/cast-diagnostics').send(payload)).status,
        204
      );
    assert.equal(
      (await admin.post('/auth/cast-diagnostics').send(payload)).status,
      429
    );
    clock.mock.mockImplementation(() => now + 240000);
    assert.equal(
      (await admin.post('/auth/cast-diagnostics').send(payload)).status,
      204
    );
  });
});

describe('POST /auth/jellyfin/quickconnect/initiate', () => {
  beforeEach(() => {
    initiateQCMock.mock.resetCalls();
    initiateQCMock.mock.mockImplementation(async () => ({
      ...defaultInitiateResponse,
    }));
    configureJellyfin();
  });

  it('returns code and secret on success', async () => {
    const res = await request(app).post('/auth/jellyfin/quickconnect/initiate');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.code, '123456');
    assert.strictEqual(res.body.secret, 'abc123def456abc123def456');
    assert.strictEqual(initiateQCMock.mock.callCount(), 1);
  });

  it('returns 403 when the media server is Emby', async () => {
    getSettings().main.mediaServerType = MediaServerType.EMBY;

    const res = await request(app).post('/auth/jellyfin/quickconnect/initiate');

    assert.strictEqual(res.status, 403);
    assert.strictEqual(initiateQCMock.mock.callCount(), 0);
  });

  it('returns 500 when Jellyfin API fails', async () => {
    initiateQCMock.mock.mockImplementation(async () => {
      throw new Error('Connection refused');
    });

    const res = await request(app).post('/auth/jellyfin/quickconnect/initiate');

    assert.strictEqual(res.status, 500);
    assert.match(res.body.message, /initiate quick connect/i);
  });

  it('returns 500 when initiateQuickConnect throws ApiError', async () => {
    initiateQCMock.mock.mockImplementation(async () => {
      throw new ApiError(500, ApiErrorCode.Unknown);
    });

    const res = await request(app).post('/auth/jellyfin/quickconnect/initiate');
    assert.strictEqual(res.status, 500);
  });
});

describe('GET /auth/jellyfin/quickconnect/check', () => {
  beforeEach(() => {
    checkQCMock.mock.resetCalls();
    checkQCMock.mock.mockImplementation(async () => ({
      ...defaultCheckResponse,
    }));
    configureJellyfin();
  });

  it('returns authenticated: false when not yet authorized', async () => {
    const res = await request(app)
      .get('/auth/jellyfin/quickconnect/check')
      .query({ secret: 'abc123def456abc123def456' });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.authenticated, false);
    assert.strictEqual(checkQCMock.mock.callCount(), 1);
  });

  it('returns authenticated: true when authorized', async () => {
    checkQCMock.mock.mockImplementation(async () => ({
      ...defaultCheckResponse,
      Authenticated: true,
    }));

    const res = await request(app)
      .get('/auth/jellyfin/quickconnect/check')
      .query({ secret: 'abc123def456abc123def456' });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.authenticated, true);
  });

  it('returns 400 when secret is missing', async () => {
    const res = await request(app).get('/auth/jellyfin/quickconnect/check');

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /invalid secret/i);
    assert.strictEqual(checkQCMock.mock.callCount(), 0);
  });

  it('returns 400 when secret is too short', async () => {
    const res = await request(app)
      .get('/auth/jellyfin/quickconnect/check')
      .query({ secret: 'ab12' });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /invalid secret/i);
    assert.strictEqual(checkQCMock.mock.callCount(), 0);
  });

  it('returns 400 when secret is too long', async () => {
    const res = await request(app)
      .get('/auth/jellyfin/quickconnect/check')
      .query({ secret: 'a'.repeat(129) });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /invalid secret/i);
    assert.strictEqual(checkQCMock.mock.callCount(), 0);
  });

  it('returns 400 when secret contains non-hex characters', async () => {
    const res = await request(app)
      .get('/auth/jellyfin/quickconnect/check')
      .query({ secret: 'zzzzzzzzzzzz' });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /invalid secret/i);
    assert.strictEqual(checkQCMock.mock.callCount(), 0);
  });

  it('returns 403 when the media server is Emby', async () => {
    getSettings().main.mediaServerType = MediaServerType.EMBY;

    const res = await request(app)
      .get('/auth/jellyfin/quickconnect/check')
      .query({ secret: 'abc123def456abc123def456' });

    assert.strictEqual(res.status, 403);
    assert.strictEqual(checkQCMock.mock.callCount(), 0);
  });

  it('returns error when Jellyfin API fails', async () => {
    checkQCMock.mock.mockImplementation(async () => {
      throw new ApiError(500, ApiErrorCode.Unknown);
    });

    const res = await request(app)
      .get('/auth/jellyfin/quickconnect/check')
      .query({ secret: 'abc123def456abc123def456' });

    assert.strictEqual(res.status, 500);
  });
});

describe('POST /auth/jellyfin/quickconnect/authenticate', () => {
  beforeEach(() => {
    authenticateQCMock.mock.resetCalls();
    authenticateQCMock.mock.mockImplementation(async () => ({
      ...defaultAuthenticateResponse,
    }));
    axiosHeadMock.mock.resetCalls();
    clearCachedImageMock.mock.resetCalls();
    getImageMock.mock.resetCalls();
    configureJellyfin();
  });

  it('returns 400 when secret is missing', async () => {
    const res = await request(app)
      .post('/auth/jellyfin/quickconnect/authenticate')
      .send({});

    assert.strictEqual(res.status, 400);
    assert.strictEqual(authenticateQCMock.mock.callCount(), 0);
  });

  it('returns 400 when secret is not a string', async () => {
    const res = await request(app)
      .post('/auth/jellyfin/quickconnect/authenticate')
      .send({ secret: 12345678 });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(authenticateQCMock.mock.callCount(), 0);
  });

  it('returns 400 when secret is too short', async () => {
    const res = await request(app)
      .post('/auth/jellyfin/quickconnect/authenticate')
      .send({ secret: 'ab12' });

    assert.strictEqual(res.status, 400);
  });

  it('returns 400 when secret contains non-hex characters', async () => {
    const res = await request(app)
      .post('/auth/jellyfin/quickconnect/authenticate')
      .send({ secret: 'zzzzzzzzzzzz' });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(authenticateQCMock.mock.callCount(), 0);
  });

  it('returns 403 when media server is not configured', async () => {
    const settings = getSettings();
    settings.main.mediaServerType = MediaServerType.NOT_CONFIGURED;

    const res = await request(app)
      .post('/auth/jellyfin/quickconnect/authenticate')
      .send({ secret: 'abc123def456abc123def456' });

    assert.strictEqual(res.status, 403);
    assert.match(res.body.message, /initial setup/i);
    assert.strictEqual(authenticateQCMock.mock.callCount(), 0);
  });

  it('returns 403 when no users exist in the database', async () => {
    // Clear all users to simulate initial setup
    const userRepo = getRepository(User);
    await userRepo.clear();

    const res = await request(app)
      .post('/auth/jellyfin/quickconnect/authenticate')
      .send({ secret: 'abc123def456abc123def456' });

    assert.strictEqual(res.status, 403);
    assert.match(res.body.message, /initial setup/i);
  });

  it('signs in an existing Jellyfin user and sets session', async () => {
    const userRepo = getRepository(User);
    const existingUser = new User({
      email: 'existing-qc@seerr.dev',
      jellyfinUsername: 'quickconnectuser',
      jellyfinUserId: 'jf-qc-user-001',
      jellyfinDeviceId: 'old-device-id',
      permissions: 0,
      avatar: '/avatarproxy/jf-qc-user-001?v=0',
      userType: UserType.JELLYFIN,
    });
    await userRepo.save(existingUser);

    const agent = request.agent(app);

    const res = await agent
      .post('/auth/jellyfin/quickconnect/authenticate')
      .send({ secret: 'abc123def456abc123def456' });

    assert.strictEqual(res.status, 200);
    assert.ok('id' in res.body);
    assert.ok(!('password' in res.body));

    const meRes = await agent.get('/auth/me');
    assert.strictEqual(meRes.status, 200);
    assert.strictEqual(meRes.body.jellyfinUsername, 'quickconnectuser');

    const updatedUser = await userRepo.findOneOrFail({
      where: { jellyfinUserId: 'jf-qc-user-001' },
      select: {
        id: true,
        jellyfinAuthToken: true,
        jellyfinDeviceId: true,
      },
    });
    assert.strictEqual(updatedUser.jellyfinAuthToken, 'fake-qc-access-token');
    assert.notStrictEqual(updatedUser.jellyfinDeviceId, 'old-device-id');
  });

  it('refreshes avatarVersion/avatarETag when the remote avatar has changed', async () => {
    const userRepo = getRepository(User);
    const existingUser = new User({
      email: 'qc-avatar-change@seerr.dev',
      jellyfinUsername: 'quickconnectuser',
      jellyfinUserId: 'jf-qc-user-001',
      jellyfinDeviceId: 'old-device-id',
      permissions: 0,
      avatar: '/avatarproxy/jf-qc-user-001?v=old',
      avatarVersion: 'old-version',
      avatarETag: 'old-etag',
      userType: UserType.JELLYFIN,
    });
    await userRepo.save(existingUser);

    const agent = request.agent(app);
    const res = await agent
      .post('/auth/jellyfin/quickconnect/authenticate')
      .send({ secret: 'abc123def456abc123def456' });

    assert.strictEqual(res.status, 200);

    const updatedUser = await userRepo.findOneOrFail({
      where: { jellyfinUserId: 'jf-qc-user-001' },
    });
    assert.notStrictEqual(updatedUser.avatarVersion, 'old-version');
    assert.notStrictEqual(updatedUser.avatarETag, 'old-etag');
    assert.notStrictEqual(
      updatedUser.avatar,
      '/avatarproxy/jf-qc-user-001?v=old'
    );
  });

  it('creates a new user when newPlexLogin is enabled and user does not exist', async () => {
    const settings = getSettings();
    settings.main.newPlexLogin = true;

    authenticateQCMock.mock.mockImplementation(async () => ({
      User: {
        Id: 'jf-brand-new-user',
        Name: 'brandnewuser',
        ServerId: 'server-1',
        Policy: { IsAdministrator: false },
      },
      AccessToken: 'new-user-token',
    }));

    const agent = request.agent(app);

    const res = await agent
      .post('/auth/jellyfin/quickconnect/authenticate')
      .send({ secret: 'abc123def456abc123def456' });

    assert.strictEqual(res.status, 200);
    assert.ok('id' in res.body);

    const userRepo = getRepository(User);
    const newUser = await userRepo.findOne({
      where: { jellyfinUserId: 'jf-brand-new-user' },
    });
    assert.ok(newUser);
    assert.strictEqual(newUser.jellyfinUsername, 'brandnewuser');
    assert.strictEqual(newUser.userType, UserType.JELLYFIN);

    const meRes = await agent.get('/auth/me');
    assert.strictEqual(meRes.status, 200);
  });

  it('returns 403 when the media server is Emby', async () => {
    getSettings().main.mediaServerType = MediaServerType.EMBY;

    const res = await request(app)
      .post('/auth/jellyfin/quickconnect/authenticate')
      .send({ secret: 'abc123def456abc123def456' });

    assert.strictEqual(res.status, 403);
    assert.strictEqual(authenticateQCMock.mock.callCount(), 0);
  });

  it('applies default permissions to newly created users', async () => {
    const settings = getSettings();
    settings.main.newPlexLogin = true;
    settings.main.defaultPermissions = 32;

    authenticateQCMock.mock.mockImplementation(async () => ({
      User: {
        Id: 'jf-perms-test-user',
        Name: 'permsuser',
        ServerId: 'server-1',
        Policy: { IsAdministrator: false },
      },
      AccessToken: 'perms-token',
    }));

    const res = await request(app)
      .post('/auth/jellyfin/quickconnect/authenticate')
      .send({ secret: 'abc123def456abc123def456' });

    assert.strictEqual(res.status, 200);

    const userRepo = getRepository(User);
    const user = await userRepo.findOneOrFail({
      where: { jellyfinUserId: 'jf-perms-test-user' },
    });
    assert.strictEqual(user.permissions, 32);
  });

  it('returns 403 when newPlexLogin is disabled and user does not exist', async () => {
    const settings = getSettings();
    settings.main.newPlexLogin = false;

    authenticateQCMock.mock.mockImplementation(async () => ({
      User: {
        Id: 'jf-unknown-user',
        Name: 'unknownuser',
        ServerId: 'server-1',
        Policy: { IsAdministrator: false },
      },
      AccessToken: 'unknown-token',
    }));

    const res = await request(app)
      .post('/auth/jellyfin/quickconnect/authenticate')
      .send({ secret: 'abc123def456abc123def456' });

    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.message, 'Access denied.');
  });

  it('returns error when Jellyfin authenticateQuickConnect fails', async () => {
    authenticateQCMock.mock.mockImplementation(async () => {
      throw new ApiError(401, ApiErrorCode.InvalidCredentials);
    });

    const res = await request(app)
      .post('/auth/jellyfin/quickconnect/authenticate')
      .send({ secret: 'abc123def456abc123def456' });

    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.message, ApiErrorCode.InvalidCredentials);
  });

  it('returns 500 when Jellyfin throws a generic error', async () => {
    authenticateQCMock.mock.mockImplementation(async () => {
      throw new Error('Network timeout');
    });

    const res = await request(app)
      .post('/auth/jellyfin/quickconnect/authenticate')
      .send({ secret: 'abc123def456abc123def456' });

    assert.strictEqual(res.status, 500);
  });
});

describe('GET /auth/me', () => {
  it('returns 403 when not authenticated', async () => {
    const res = await request(app).get('/auth/me');
    assert.strictEqual(res.status, 403);
  });

  it('returns the authenticated user', async () => {
    const agent = await authenticatedAgent('admin@seerr.dev', 'test1234');

    const res = await agent.get('/auth/me');

    assert.strictEqual(res.status, 200);
    assert.ok('id' in res.body);
    assert.strictEqual(res.body.displayName, 'admin');
  });

  it('includes userEmailRequired warning when email is required but invalid', async () => {
    const settings = getSettings();
    settings.notifications.agents.email.options.userEmailRequired = true;

    // Change the user's email to something invalid
    const userRepo = getRepository(User);
    const user = await userRepo.findOneOrFail({
      where: { email: 'admin@seerr.dev' },
    });
    user.email = 'not-an-email';
    await userRepo.save(user);

    // Log in with the changed email
    const agent = request.agent(app);
    settings.main.localLogin = true;
    const loginRes = await agent
      .post('/auth/local')
      .send({ email: 'not-an-email', password: 'test1234' });
    assert.strictEqual(loginRes.status, 200);

    const res = await agent.get('/auth/me');

    assert.strictEqual(res.status, 200);
    assert.ok(res.body.warnings.includes('userEmailRequired'));

    settings.notifications.agents.email.options.userEmailRequired = false;
  });

  it('returns only the allowlisted settings fields', async () => {
    await seedUserSettings('admin@seerr.dev');
    const agent = await authenticatedAgent('admin@seerr.dev', 'test1234');

    const res = await agent.get('/auth/me');

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(Object.keys(res.body.settings).sort(), [
      'discoverRegion',
      'locale',
      'notificationTypes',
      'originalLanguage',
      'showAnime',
      'streamingRegion',
      'watchlistSyncMovies',
      'watchlistSyncTv',
    ]);
    assert.strictEqual(res.body.settings.locale, allowlistedSettings.locale);
    assert.strictEqual(
      res.body.settings.discoverRegion,
      allowlistedSettings.discoverRegion
    );
    assertNoCredentials(res.body);
  });
});

describe('POST /auth/local', () => {
  beforeEach(() => {
    const settings = getSettings();
    settings.main.localLogin = true;
  });

  it('returns 200 and user data on valid credentials', async () => {
    const res = await request(app)
      .post('/auth/local')
      .send({ email: 'admin@seerr.dev', password: 'test1234' });

    assert.strictEqual(res.status, 200);
    assert.ok('id' in res.body);
    // filter() strips sensitive fields like password
    assert.ok(!('password' in res.body));
  });

  it('returns 403 on wrong password', async () => {
    const res = await request(app)
      .post('/auth/local')
      .send({ email: 'admin@seerr.dev', password: 'wrongpassword' });

    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.message, 'Access denied.');
  });

  it('returns 403 for nonexistent user', async () => {
    const res = await request(app)
      .post('/auth/local')
      .send({ email: 'nobody@seerr.dev', password: 'test1234' });

    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.message, 'Access denied.');
  });

  it('returns 500 when local login is disabled', async () => {
    const settings = getSettings();
    settings.main.localLogin = false;

    const res = await request(app)
      .post('/auth/local')
      .send({ email: 'admin@seerr.dev', password: 'test1234' });

    assert.strictEqual(res.status, 500);
    assert.strictEqual(res.body.error, 'Password sign-in is disabled.');
  });

  it('returns 500 when email is missing', async () => {
    const res = await request(app)
      .post('/auth/local')
      .send({ password: 'test1234' });

    assert.strictEqual(res.status, 500);
    assert.match(res.body.error, /email address and a password/);
  });

  it('returns 500 when password is missing', async () => {
    const res = await request(app)
      .post('/auth/local')
      .send({ email: 'admin@seerr.dev' });

    assert.strictEqual(res.status, 500);
    assert.match(res.body.error, /email address and a password/);
  });

  it('is case-insensitive for email', async () => {
    const res = await request(app)
      .post('/auth/local')
      .send({ email: 'Admin@Seerr.Dev', password: 'test1234' });

    assert.strictEqual(res.status, 200);
    assert.ok('id' in res.body);
  });

  it('allows the non-admin user to log in', async () => {
    const res = await request(app)
      .post('/auth/local')
      .send({ email: 'demo@seerr.dev', password: 'test1234' });

    assert.strictEqual(res.status, 200);
    assert.ok('id' in res.body);
  });

  it('sets a session on successful login', async () => {
    const agent = request.agent(app);

    await agent
      .post('/auth/local')
      .send({ email: 'admin@seerr.dev', password: 'test1234' });

    // Session should persist — /me should succeed
    const meRes = await agent.get('/auth/me');
    assert.strictEqual(meRes.status, 200);
  });
});

describe('POST /auth/logout', () => {
  it('returns 200 when not logged in', async () => {
    const res = await request(app).post('/auth/logout');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'ok');
  });

  it('destroys session and returns 200 when logged in', async () => {
    const agent = await authenticatedAgent('admin@seerr.dev', 'test1234');

    // Verify session is active
    const meBeforeRes = await agent.get('/auth/me');
    assert.strictEqual(meBeforeRes.status, 200);

    const logoutRes = await agent.post('/auth/logout');
    assert.strictEqual(logoutRes.status, 200);
    assert.strictEqual(logoutRes.body.status, 'ok');

    // Session should be invalidated — /me should fail
    const meAfterRes = await agent.get('/auth/me');
    assert.strictEqual(meAfterRes.status, 403);
  });
});

describe('POST /auth/reset-password', () => {
  beforeEach(() => {
    emailMock.resetCalls();
  });

  it('returns 200 for a valid email', async () => {
    const res = await request(app)
      .post('/auth/reset-password')
      .send({ email: 'admin@seerr.dev' });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'ok');
    assert.strictEqual(emailMock.callCount(), 1);
  });

  it('returns 200 for nonexistent email (does not reveal user existence)', async () => {
    const res = await request(app)
      .post('/auth/reset-password')
      .send({ email: 'nonexistent@seerr.dev' });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'ok');
    assert.strictEqual(emailMock.callCount(), 0);
  });

  it('returns 500 when email is missing', async () => {
    const res = await request(app).post('/auth/reset-password').send({});

    assert.strictEqual(res.status, 500);
    assert.strictEqual(res.body.message, 'Email address required.');
    assert.strictEqual(emailMock.callCount(), 0);
  });

  it('sets a resetPasswordGuid on the user', async () => {
    await request(app)
      .post('/auth/reset-password')
      .send({ email: 'admin@seerr.dev' });

    const userRepo = getRepository(User);
    const user = await userRepo
      .createQueryBuilder('user')
      .addSelect(['user.resetPasswordGuid', 'user.recoveryLinkExpirationDate'])
      .where('user.email = :email', { email: 'admin@seerr.dev' })
      .getOneOrFail();

    assert.notStrictEqual(user.resetPasswordGuid, undefined);
    assert.notStrictEqual(user.resetPasswordGuid, null);
    assert.notStrictEqual(user.recoveryLinkExpirationDate, undefined);
    assert.strictEqual(emailMock.callCount(), 1);
  });
});

describe('POST /auth/reset-password/:guid', () => {
  /** Trigger a password reset and return the guid. */
  async function getResetGuid(email: string): Promise<string> {
    await request(app).post('/auth/reset-password').send({ email });

    const userRepo = getRepository(User);
    const user = await userRepo
      .createQueryBuilder('user')
      .addSelect('user.resetPasswordGuid')
      .where('user.email = :email', { email })
      .getOneOrFail();

    return user.resetPasswordGuid!;
  }

  it('resets password with a valid guid and password', async () => {
    const guid = await getResetGuid('admin@seerr.dev');

    const res = await request(app)
      .post(`/auth/reset-password/${guid}`)
      .send({ password: 'newpassword123' });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'ok');

    // Old password no longer works
    const oldLogin = await request(app)
      .post('/auth/local')
      .send({ email: 'admin@seerr.dev', password: 'test1234' });
    assert.strictEqual(oldLogin.status, 403);

    // New password works
    const newLogin = await request(app)
      .post('/auth/local')
      .send({ email: 'admin@seerr.dev', password: 'newpassword123' });
    assert.strictEqual(newLogin.status, 200);
  });

  it('returns 500 for an invalid guid', async () => {
    const res = await request(app)
      .post('/auth/reset-password/invalid-guid-here')
      .send({ password: 'newpassword123' });

    assert.strictEqual(res.status, 500);
    assert.strictEqual(res.body.message, 'Invalid password reset link.');
  });

  it('returns 500 when password is too short', async () => {
    const guid = await getResetGuid('admin@seerr.dev');

    const res = await request(app)
      .post(`/auth/reset-password/${guid}`)
      .send({ password: 'short' });

    assert.strictEqual(res.status, 500);
    assert.strictEqual(
      res.body.message,
      'Password must be at least 8 characters long.'
    );
  });

  it('returns 500 when password is missing', async () => {
    const guid = await getResetGuid('admin@seerr.dev');

    const res = await request(app)
      .post(`/auth/reset-password/${guid}`)
      .send({});

    assert.strictEqual(res.status, 500);
    assert.strictEqual(
      res.body.message,
      'Password must be at least 8 characters long.'
    );
  });

  it('returns 500 for an expired recovery link', async () => {
    const guid = await getResetGuid('admin@seerr.dev');

    // Expire the link
    const userRepo = getRepository(User);
    const user = await userRepo.findOneOrFail({
      where: { email: 'admin@seerr.dev' },
    });
    user.recoveryLinkExpirationDate = new Date('2020-01-01');
    await userRepo.save(user);

    const res = await request(app)
      .post(`/auth/reset-password/${guid}`)
      .send({ password: 'newpassword123' });

    assert.strictEqual(res.status, 500);
    assert.strictEqual(res.body.message, 'Invalid password reset link.');
  });

  it('cannot reuse a guid after successful reset', async () => {
    const guid = await getResetGuid('admin@seerr.dev');

    // First reset succeeds
    const first = await request(app)
      .post(`/auth/reset-password/${guid}`)
      .send({ password: 'newpassword123' });
    assert.strictEqual(first.status, 200);

    // Second reset with same guid fails (recoveryLinkExpirationDate was cleared)
    const second = await request(app)
      .post(`/auth/reset-password/${guid}`)
      .send({ password: 'anotherpassword' });
    assert.strictEqual(second.status, 500);
  });
});
