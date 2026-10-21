'use strict';
const crypto = require('node:crypto');
const { partyService, PartyError, signedUser, equal, ID } = require('./party-service.cjs');

// A dedicated party grant proxies only server-signed resources for this item.
// No Jellyfin key, host playback token, library browse, or admin API reaches guests.
function partyRoutes({ express, query, getSettings, getHostname, request, logger }) {
  const router = express.Router();
  const secret = getSettings().sessionSecret;
  const service = partyService({ query, secret });
  const preparations = new Map();
  const sessions = new Map();
  const limits = new Map();
  const cookieName = id => `noah_party_${id}`;
  function rate(key, count, period) {
    const now = Date.now();
    if (limits.size > 10_000) for (const [id, entry] of limits) if (entry.until <= now) limits.delete(id);
    let entry = limits.get(key);
    if (!entry || entry.until <= now) { entry = { count: 0, until: now + period }; limits.set(key, entry); }
    if (++entry.count > count) throw new PartyError(429, 'Too many attempts. Please try again shortly.');
  }
  const route = handler => async (req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    try {
      if (!['GET', 'HEAD'].includes(req.method)) {
        const origin = req.headers.origin;
        // CSRF protection also applies when the main Seerr CSRF option is off.
        if (req.headers['sec-fetch-site'] === 'cross-site' || (origin && new URL(origin).host !== req.get('host'))) throw new PartyError(403, 'Open this party in Seerr.');
        if (!req.is('application/json')) throw new PartyError(415, 'JSON required.');
      }
      await handler(req, res);
    } catch (error) {
      if (res.headersSent) return next(error);
      const status = error instanceof PartyError ? error.status : 502;
      if (status === 502) logger?.warn('Party request unavailable', { label: 'Party', status: error.response?.status || 502, reason: error instanceof PartyError ? error.message : error.code || error.name });
      res.status(status).json({ message: status === 502 ? 'The party player is temporarily unavailable. Please try again.' : error.message });
    }
  };
  async function ownerSession(req, room) {
    const saved = await new Promise((resolve, reject) => req.sessionStore.get(room.ownerSessionId, (error, session) => error ? reject(error) : resolve(session)));
    const playback = saved?.noahWebPlayback;
    if (saved?.userId !== room.ownerId || playback?.userId !== room.ownerId || !playback.token || !playback.identity?.endsWith(`:${room.ownerId}:${room.ownerJellyfinId}`)) throw new PartyError(409, 'The host must sign in and prepare playback again.');
    const users = await query('SELECT id, jellyfinUserId FROM "user" WHERE id = ?', [room.ownerId]);
    if (!users.length || String(users[0].jellyfinUserId).replaceAll('-', '').toLowerCase() !== room.ownerJellyfinId) throw new PartyError(410, 'The host account is no longer available.');
    return { token: playback.token, userId: room.ownerJellyfinId };
  }
  const authHeaders = (token, deviceId) => ({ Authorization: `MediaBrowser Client="Noah Stream Party", Device="Watch party", DeviceId="${deviceId}", Version="1", Token="${token}"` });
  const call = (method, resource, auth, deviceId, data, params) => request({ method, url: `${getHostname()}${resource}`, headers: authHeaders(auth.token, deviceId), data, params, timeout: 20_000, maxRedirects: 0 });
  const device = (room, member) => `noah-party-${room.id}-${member.id}`;
  async function stop(session) {
    for (const response of session?.outputs || []) response.destroy();
    if (!session?.playSessionId) return;
    await call('DELETE', '/Videos/ActiveEncodings', session.auth, session.deviceId, undefined, { DeviceId: session.deviceId, PlaySessionId: session.playSessionId }).catch(() => {});
  }
  const sign = (room, member, grant, value) => crypto.createHmac('sha256', secret).update(`${room.id}:${member.id}:${grant}:${value}`).digest('base64url');
  function target(room, uri, base = `${getHostname()}/`) {
    const root = new URL(`${getHostname()}/`);
    const url = new URL(uri, base);
    // PlaybackInfo can return a root-relative URL without urlBase and with a
    // dashed Guid, while item metadata uses compact IDs. Normalize both forms
    // before enforcing the item scope; never accept a different item or origin.
    let path = url.pathname;
    if (root.pathname !== '/' && path.toLowerCase().startsWith(root.pathname.toLowerCase())) path = '/' + path.slice(root.pathname.length);
    const match = path.match(/^\/videos\/([a-f0-9-]+)\/(.+)$/i);
    if (url.origin !== root.origin || !match || match[1].replaceAll('-', '').toLowerCase() !== room.itemId || url.username || url.password) throw new PartyError(502, 'Invalid player resource.');
    url.pathname = `${root.pathname}Videos/${room.itemId}/${match[2]}`;
    for (const name of [...url.searchParams.keys()]) if (/^(api_key|access_?token|token|x-emby-token)$/i.test(name)) url.searchParams.delete(name);
    return url.pathname + url.search;
  }
  function proxyUrl(room, member, grant, uri, base) {
    const value = Buffer.from(target(room, uri, base)).toString('base64url');
    return `/api/v1/parties/${room.id}/stream?grant=${grant}&resource=${value}&signature=${sign(room, member, grant, value)}`;
  }
  router.get('/', route(async (req, res) => res.json({ results: await service.list(req) })));
  router.post('/', route(async (req, res) => {
    const user = signedUser(req);
    if (!user) throw new PartyError(401, 'Sign in to create a party.');
    rate(`create:${user.id}`, 6, 3_600_000);
    const itemId = req.body?.itemId;
    if (!ID.test(itemId || '')) throw new PartyError(400, 'Choose an available movie or episode.');
    const playback = req.session.noahWebPlayback;
    const userId = String(user.jellyfinUserId || '').replaceAll('-', '').toLowerCase();
    if (!playback?.token || playback.userId !== user.id || !playback.identity?.endsWith(`:${user.id}:${userId}`)) throw new PartyError(409, 'Prepare playback before creating a party.');
    const { data: item } = await call('GET', `/Users/${userId}/Items/${itemId}`, { token: playback.token }, playback.deviceId);
    if (!['Movie', 'Episode'].includes(item.Type) || item.IsFolder || !item.MediaSources?.length) throw new PartyError(400, 'Choose an available movie or episode.');
    const title = item.Type === 'Episode' ? `${item.SeriesName || item.Name} · S${item.ParentIndexNumber} E${item.IndexNumber} · ${item.Name}` : item.Name;
    const series = item.Type === 'Episode' && ID.test(item.SeriesId || '') ? (await call('GET', `/Users/${userId}/Items/${item.SeriesId}`, { token: playback.token }, playback.deviceId)).data : null;
    const tmdbId = Number((series || item).ProviderIds?.Tmdb);
    const watchContext = Number.isInteger(tmdbId) && tmdbId > 0 ? { tmdbId, mediaType: item.Type === 'Movie' ? 'movie' : 'tv', title: series?.Name || item.Name, releaseYear: (series || item).ProductionYear, ...(item.Type === 'Episode' ? { seasonNumber: item.ParentIndexNumber, episodeNumber: item.IndexNumber } : {}) } : undefined;
    const state = await service.create(req, req.body, { itemId, userId, title, watchContext, duration: (item.RunTimeTicks || 0) / 10_000_000 });
    res.status(201).json(state);
  }));
  router.get('/:id', route(async (req, res) => {
    const state = await service.state(req, req.params.id);
    const active = sessions.get(`${state.id}:${state.me}`);
    if (active) active.seenAt = Date.now();
    res.json(state);
  }));
  router.post('/:id/join', route(async (req, res) => {
    rate(`join:${req.ip}`, 20, 60_000);
    const { state, credential } = await service.join(req, req.params.id, req.body || {});
    if (credential) res.cookie(cookieName(req.params.id), credential, { httpOnly: true, secure: req.secure, sameSite: 'lax', maxAge: 48 * 3_600_000, path: `/api/v1/parties/${req.params.id}` });
    res.json(state);
  }));
  router.post('/:id/chat', route(async (req, res) => res.json(await service.chat(req, req.params.id, req.body || {}))));
  router.post('/:id/state', route(async (req, res) => res.json(await service.playback(req, req.params.id, req.body || {}))));
  router.post('/:id/admin', route(async (req, res) => {
    const state = await service.manage(req, req.params.id, req.body || {});
    if (req.body.action === 'end' || req.body.action === 'kick') {
      for (const [key, active] of sessions) if (active.roomId === req.params.id && (req.body.action === 'end' || active.memberId === req.body.memberId)) { sessions.delete(key); await stop(active); }
    }
    res.json(state);
  }));
  router.post('/:id/leave', route(async (req, res) => res.json(await service.leave(req, req.params.id))));
  router.post('/:id/playback', route(async (req, res) => {
    const room = await service.load(req.params.id); const me = service.member(room, req);
    rate(`playback:${room.id}:${me.id}`, 12, 60_000);
    const auth = await ownerSession(req, room);
    const audio = req.body?.audio; const subtitle = req.body?.subtitle;
    for (const index of [audio, subtitle]) if (index !== undefined && (!Number.isInteger(index) || index < -1 || index > 200)) throw new PartyError(400, 'Invalid audio or subtitle track.');
    const key = `${room.id}:${me.id}`;
    const selection = `${audio ?? 'default'}:${subtitle ?? 'default'}`;
    const existing = sessions.get(key);
    if (!req.body?.force && existing?.selection === selection && Date.now() - existing.createdAt < 60 * 60_000) return res.json(existing.result);
    if (preparations.has(key)) {
      await preparations.get(key);
      const prepared = sessions.get(key);
      if (prepared?.selection === selection) return res.json(prepared.result);
    }
    const work = (async () => {
      const { data: item } = await call('GET', `/Users/${auth.userId}/Items/${room.itemId}`, auth, device(room, me));
      const profile = {
        Name: 'Noah Stream Party Browser', MaxStreamingBitrate: 8_000_000,
        DirectPlayProfiles: [{ Container: 'mp4,m4v', Type: 'Video', VideoCodec: 'h264', AudioCodec: 'aac,mp3' }],
        TranscodingProfiles: [{ Container: 'ts', Type: 'Video', VideoCodec: 'h264', AudioCodec: 'aac', Protocol: 'hls', Context: 'Streaming', MaxAudioChannels: '2', MinSegments: 1, BreakOnNonKeyFrames: false }],
        SubtitleProfiles: [{ Format: 'vtt', Method: 'External' }, { Format: 'srt', Method: 'External' }, ...['ass', 'ssa', 'pgssub', 'dvdsub'].map(Format => ({ Format, Method: 'Encode' }))],
        CodecProfiles: [{ Type: 'Video', Codec: 'h264', Conditions: [{ Condition: 'LessThanEqual', Property: 'Width', Value: '1920', IsRequired: true }, { Condition: 'LessThanEqual', Property: 'Height', Value: '1080', IsRequired: true }, { Condition: 'LessThanEqual', Property: 'VideoBitDepth', Value: '8', IsRequired: true }] }],
      };
      const { data: info } = await call('POST', `/Items/${room.itemId}/PlaybackInfo`, auth, device(room, me), {
        UserId: auth.userId, DeviceProfile: profile, EnableDirectPlay: audio === undefined, EnableDirectStream: true,
        EnableTranscoding: true, MaxStreamingBitrate: 8_000_000, StartTimeTicks: 0,
        ...(audio === undefined ? {} : { AudioStreamIndex: audio }), ...(subtitle === undefined ? {} : { SubtitleStreamIndex: subtitle }),
      }, { userId: auth.userId, isPlayback: true, autoOpenLiveStream: false });
      const source = info.MediaSources?.[0];
      if (!source) throw new PartyError(502, 'No playable source.');
      const tracks = (source.MediaStreams || item.MediaStreams || []).filter(t => ['Audio', 'Subtitle'].includes(t.Type)).map(t => ({ index: t.Index, type: t.Type, label: t.DisplayTitle || t.Language || t.Codec, codec: t.Codec }));
      const selectedSubtitle = subtitle ?? source.DefaultSubtitleStreamIndex ?? -1;
      const encodedSubtitle = tracks.some(t => t.type === 'Subtitle' && t.index === selectedSubtitle && ['ass', 'ssa', 'pgssub', 'dvdsub'].includes(t.codec));
      const direct = source.SupportsDirectPlay === true && !encodedSubtitle && audio === undefined;
      const uri = direct ? `${getHostname()}/Videos/${room.itemId}/stream.mp4?Static=true&MediaSourceId=${encodeURIComponent(source.Id)}&DeviceId=${device(room, me)}&PlaySessionId=${info.PlaySessionId}` : source.TranscodingUrl;
      if (!uri) throw new PartyError(502, 'No compatible stream.');
      const grant = crypto.randomBytes(24).toString('hex');
      const result = { url: proxyUrl(room, me, grant, uri), hls: !direct, tracks, audio: audio ?? source.DefaultAudioStreamIndex ?? -1, subtitle: selectedSubtitle, duration: (item.RunTimeTicks || 0) / 10_000_000,
        subtitleUrl: !encodedSubtitle && selectedSubtitle >= 0 ? proxyUrl(room, me, grant, `${getHostname()}/Videos/${room.itemId}/${source.Id}/Subtitles/${selectedSubtitle}/0/Stream.vtt`) : null };
      // Switch only this participant; preserve all other encoders and viewers.
      const previous = sessions.get(key);
      if (previous) await stop(previous);
      sessions.set(key, { roomId: room.id, memberId: me.id, grant, auth, deviceId: device(room, me), playSessionId: info.PlaySessionId, selection, result, createdAt: Date.now(), seenAt: Date.now(), outputs: new Set() });
      return result;
    })().finally(() => { if (preparations.get(key) === work) preparations.delete(key); });
    preparations.set(key, work);
    res.json(await work);
  }));
  router.post('/:id/playback/stop', route(async (req, res) => {
    const room = await service.load(req.params.id); const me = service.member(room, req);
    const key = `${room.id}:${me.id}`; const active = sessions.get(key); sessions.delete(key); await stop(active); res.sendStatus(204);
  }));
  router.get('/:id/stream', route(async (req, res) => {
    const room = await service.load(req.params.id); const me = service.member(room, req);
    const active = sessions.get(`${room.id}:${me.id}`);
    const { resource, signature, grant } = req.query;
    if (!active || grant !== active.grant || typeof resource !== 'string' || resource.length > 12_000 || !equal(signature, sign(room, me, grant, resource))) throw new PartyError(403, 'This stream grant has expired. Rejoin playback.');
    const relative = Buffer.from(resource, 'base64url').toString('utf8');
    const upstream = new URL(relative, getHostname());
    target(room, upstream.href);
    const auth = await ownerSession(req, room);
    active.seenAt = Date.now();
    const playlist = upstream.pathname.endsWith('.m3u8');
    const controller = new AbortController();
    res.once('close', () => controller.abort());
    const result = await request({ method: 'GET', url: upstream.href, headers: { ...authHeaders(auth.token, active.deviceId), ...(req.headers.range ? { Range: req.headers.range } : {}) }, responseType: playlist ? 'text' : 'stream', signal: controller.signal, timeout: 45_000, maxRedirects: 0, ...(playlist ? { maxContentLength: 8 * 1024 * 1024 } : {}) });
    res.status(result.status);
    for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges']) if (result.headers[key] && !(playlist && key === 'content-length')) res.setHeader(key, result.headers[key]);
    if (playlist) {
      const content = result.data.split('\n').map(line => line.startsWith('#') ? line.replace(/URI="([^"]+)"/g, (_, uri) => `URI="${proxyUrl(room, me, grant, uri, upstream.href)}"`) : line.trim() ? proxyUrl(room, me, grant, line.trim(), upstream.href) : line).join('\n');
      res.type('application/vnd.apple.mpegurl').send(content);
    } else {
      active.outputs.add(res);
      result.data.on('error', () => res.destroy());
      res.on('close', () => { active.outputs.delete(res); result.data.destroy(); }); result.data.pipe(res);
    }
  }));
  const timer = setInterval(async () => {
    try {
      for (const [key, active] of sessions) if (Date.now() - active.seenAt > 2 * 60_000) { sessions.delete(key); await stop(active); }
      await service.ready;
      await query('DELETE FROM noah_party WHERE expires_at < ?', [Date.now()]);
    } catch { logger?.warn('Party maintenance will retry', { label: 'Party' }); }
  }, 60_000);
  timer.unref();
  return router;
}
module.exports = { partyRoutes };
