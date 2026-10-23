'use strict';
const crypto = require('node:crypto');

class PlaybackSessionError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

const normalizedId = value => String(value || '').replaceAll('-', '').toLowerCase();
// Browser and native routes share the same Express store. Serialize their short
// reload/save checkpoints, not the network requests, to preserve both records.
const sessionWrites = new Map();
async function sessionCheckpoint(key, action) {
  const work = (sessionWrites.get(key) || Promise.resolve()).catch(() => {}).then(action);
  sessionWrites.set(key, work);
  try { return await work; } finally { if (sessionWrites.get(key) === work) sessionWrites.delete(key); }
}

// A Seerr login already grants playback as its linked Jellyfin user. Quick
// Connect issues a user-scoped native token, never an administrator API key.
// Identity comes exclusively from Seerr's authenticated database mapping.
function nativePlaybackSessions({ request, randomUUID = crypto.randomUUID, channel = 'native' }) {
  if (!['native', 'web'].includes(channel)) throw new Error('Invalid playback channel');
  const property = channel === 'web' ? 'noahWebPlayback' : 'noahNativePlayback';
  const pending = new Map();
  return async function prepare({ session, user, settings, hostname }) {
    const userId = normalizedId(user.jellyfinUserId);
    if (!/^[a-f0-9]{32}$/.test(userId)) {
      throw new PlaybackSessionError(409, 'JELLYFIN_RELINK_REQUIRED');
    }
    if (!session) throw new PlaybackSessionError(401, 'SEERR_LOGIN_REQUIRED');
    const identity = `${settings.jellyfin.serverId}:${user.id}:${userId}`;
    let stored = session[property];
    // Express loads a separate Session object per request. A stable session key
    // coalesces parallel Play, preload and progress requests even on a fresh login.
    const digest = session.id && crypto.createHmac('sha256', settings.sessionSecret || settings.jellyfin.apiKey)
      .update(`${identity}:${channel}:${session.id}`).digest('hex').slice(0, 32);
    const uuid = digest ? `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20)}` : randomUUID();
    const selectDevice = () => stored?.identity === identity && new RegExp(`^noah-${channel}-[a-f0-9-]{36}$`).test(stored.deviceId)
      ? stored.deviceId : `noah-${channel}-${uuid}`;
    let deviceId = selectDevice();
    const key = `${identity}:${session.id || deviceId}`;
    const writeKey = session.id || key;
    const reload = async () => {
      if (typeof session.reload !== 'function') return;
      const req = session.req;
      await new Promise((resolve, reject) => session.reload(error => error ? reject(new PlaybackSessionError(401, 'SEERR_LOGIN_REQUIRED')) : resolve()));
      session = req?.session || session;
      if (session.userId !== user.id) throw new PlaybackSessionError(401, 'SEERR_LOGIN_REQUIRED');
    };
    const checkpoint = value => sessionCheckpoint(writeKey, async () => {
      await reload();
      if (value) session[property] = value;
      // Explicit save also records express-session's savedHash, preventing an
      // automatic end-of-response save from writing an older channel snapshot.
      await new Promise((resolve, reject) => session.save(error => error ? reject(error) : resolve()));
    });
    if (pending.has(key)) {
      const result = await pending.get(key);
      await checkpoint();
      return result;
    }
    const headers = token => ({
      Authorization: `MediaBrowser Client="Noah Stream", Device="${channel === 'web' ? 'Browser Player' : 'Native App'}", DeviceId="${deviceId}", Version="0.1.0"${token ? `, Token="${token}"` : ''}`,
      Accept: 'application/json', 'Content-Type': 'application/json',
    });
    const call = async (method, path, token, data, params) => {
      const config = { method, url: `${hostname}${path}`, headers: headers(token), data, params, timeout: 8000, maxRedirects: 0 };
      try { return await request(config); } catch (error) {
        // Retry one idempotent read after a brief server/database interruption.
        // Never repeat token issuance, permission denials or invalid credentials.
        if (method !== 'GET' || !([500, 502, 503, 504].includes(error.response?.status) || ['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED'].includes(error.code))) throw error;
        await new Promise(resolve => setTimeout(resolve, 150));
        return request(config);
      }
    };
    const accountMatches = account => normalizedId(account?.Id) === userId &&
      account.Policy?.IsDisabled !== true && account.Policy?.EnableMediaPlayback !== false;
    const load = async () => {
      // A request may have loaded its Session before the previous renewal
      // finished. Reload after joining/reserving the queue before trusting it.
      await sessionCheckpoint(writeKey, reload);
      stored = session[property];
      deviceId = selectDevice();
      if (stored?.identity === identity && stored.token && stored.deviceId === deviceId) {
        try {
          const { data: account } = await call('GET', '/Users/Me', stored.token);
          if (!accountMatches(account)) throw new PlaybackSessionError(403, 'JELLYFIN_ACCESS_DENIED');
          await checkpoint();
          return { accessToken: stored.token, userId, deviceId, serverId: settings.jellyfin.serverId };
        } catch (error) {
          // A connection failure or permission denial is not an expired login.
          if (error.response?.status !== 401) throw error;
        }
      }
      let account;
      try {
        ({ data: account } = await call('GET', `/Users/${userId}`, settings.jellyfin.apiKey));
      } catch (error) {
        if (error.response?.status === 404) throw new PlaybackSessionError(409, 'JELLYFIN_RELINK_REQUIRED');
        throw error;
      }
      // The immutable ID is authoritative. Renaming a linked user must not
      // break playback or cause a second account to be created.
      if (!accountMatches(account)) {
        throw new PlaybackSessionError(403, 'JELLYFIN_ACCESS_DENIED');
      }
      const { data: enabled } = await call('GET', '/QuickConnect/Enabled');
      if (enabled !== true) throw new PlaybackSessionError(503, 'JELLYFIN_QUICK_CONNECT_DISABLED');
      const { data: challenge } = await call('POST', '/QuickConnect/Initiate', undefined, {});
      if (!challenge.Secret || !challenge.Code) throw new PlaybackSessionError(502, 'JELLYFIN_SESSION_UNAVAILABLE');
      const { data: authorized } = await call('POST', '/QuickConnect/Authorize', settings.jellyfin.apiKey, undefined, { code: challenge.Code, userId });
      if (authorized !== true) throw new PlaybackSessionError(403, 'JELLYFIN_ACCESS_DENIED');
      const { data: authenticated } = await call('POST', '/Users/AuthenticateWithQuickConnect', undefined, { Secret: challenge.Secret });
      if (!accountMatches(authenticated.User) || !authenticated.AccessToken || authenticated.AccessToken === settings.jellyfin.apiKey) {
        throw new PlaybackSessionError(403, 'JELLYFIN_ACCESS_DENIED');
      }
      try {
        await checkpoint({ identity, deviceId, token: authenticated.AccessToken, userId: user.id });
      } catch (error) {
        await call('DELETE', '/Devices', settings.jellyfin.apiKey, undefined, { Id: deviceId }).catch(() => {});
        throw error;
      }
      return { accessToken: authenticated.AccessToken, userId, deviceId, serverId: settings.jellyfin.serverId };
    };
    // Reserve the device identity before awaiting network I/O so concurrent
    // Play/prepare requests use one login rather than revoking each other.
    if (stored?.identity !== identity) session[property] = { identity, deviceId, userId: user.id };
    const work = load().finally(() => pending.delete(key));
    pending.set(key, work);
    return work;
  };
}

function playbackDeviceIds(session, user) {
  if (!user) return [];
  return ['noahWebPlayback', 'noahNativePlayback'].map(property => session?.[property])
    .filter(value => value?.userId === user.id && value.identity?.endsWith(`:${user.id}:${normalizedId(user.jellyfinUserId)}`) && /^noah-(web|native)-[a-f0-9-]{36}$/.test(value.deviceId))
    .map(value => value.deviceId).filter((id, index, ids) => ids.indexOf(id) === index);
}
module.exports = { nativePlaybackSessions, PlaybackSessionError, playbackDeviceIds };
