'use strict';
// Loopback-only API double shared by Next SSR and the real browser. It cannot
// connect to Seerr/Jellyfin/Arr and uses no production credentials or DB.
const http = require('node:http');
process.env.NODE_ENV = 'production';
process.env.HOST = '127.0.0.1';
process.env.PORT = '5055';
const next = require('next')({ dev: false, hostname: '127.0.0.1', port: 5055 });
const handleNext = next.getRequestHandler();
const settings = {
  initialized: true,
  applicationTitle: 'Fixture Stream',
  applicationUrl: '',
  localLogin: true,
  mediaServerLogin: false,
  mediaServerType: 2,
  hideAvailable: false,
  hideRequested: false,
  hideBlocklisted: false,
  issuesEnabled: false,
  blocklistEnabled: false,
  movie4kEnabled: false,
  series4kEnabled: false,
  partialRequestsEnabled: true,
  enableSpecialEpisodes: false,
  cacheImages: false,
  enablePushRegistration: false,
  locale: 'en',
  discoverRegion: '',
  streamingRegion: '',
  originalLanguage: '',
  emailEnabled: false,
  newPlexLogin: false,
  versionCheck: false,
  vapidPublic: '',
  plexClientIdentifier: '',
};
const profile = (id) => ({
  id,
  email: `fixture${id}@example.invalid`,
  username: `Profile ${id}`,
  displayName: `Profile ${id}`,
  avatar: '/favicon.ico',
  userType: 2,
  permissions: 32,
  settings: { locale: 'en', showAnime: id === 2, notificationTypes: {} },
});
const page = (results) => ({
  page: 1,
  totalPages: 1,
  totalResults: results.length,
  results,
});
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:5055');
  if (!url.pathname.startsWith('/api/')) {
    await handleNext(req, res);
    return;
  }
  const id = Number(
    /fixture-profile=(\d)/.exec(req.headers.cookie || '')?.[1] || 0
  );
  const send = (value, status = 200) => {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(value));
  };
  const path = url.pathname.replace('/api/v1', '');
  if (path === '/settings/public') return send(settings);
  if (path === '/status')
    return send({
      version: 'fixture',
      commitTag: require('node:fs').existsSync('committag.json') ? require('../committag.json').commitTag : 'local',
      updateAvailable: false,
    });
  if (path === '/auth/local' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    if (input.password !== 'fixture-only')
      return send({ message: 'Invalid credentials' }, 401);
    const selected = input.email === 'fixture2@example.invalid' ? 2 : 1;
    res.setHeader(
      'Set-Cookie',
      `fixture-profile=${selected}; HttpOnly; SameSite=Lax; Path=/`
    );
    return send(profile(selected));
  }
  if (path === '/auth/me')
    return id ? send(profile(id)) : send({ message: 'Sign in' }, 403);
  if (!id) return send({ message: 'Sign in' }, 403);
  if (path === '/watch-history')
    return send({
      pageInfo: { pages: 1, pageSize: 1000, results: 1, page: 1 },
      results: [
        {
          id,
          mediaType: 'movie',
          tmdbId: 900000 + id,
          title: `Private history ${id}`,
          releaseYear: 2020,
          status: 'completed',
          watchCount: 1,
          watchedAt: '2026-01-01',
          seasonProgress: {},
          episodeOverrides: {},
          viewingProgress: {},
          rating: 8,
        },
      ],
    });
  if (path === '/discover/watchlist')
    return send(
      page([
        {
          id,
          ratingKey: String(id),
          tmdbId: 910000 + id,
          mediaType: 'movie',
          title: `Future film ${id}`,
          createdAt: '2026-01-01',
        },
      ])
    );
  if (path === '/watch-history/public-ratings')
    return send({
      [`movie:${900000 + id}`]: {
        average: 7.5,
        isAnime: false,
        releaseDate: '2020-01-01',
      },
    });
  if (path === '/watch-history/planned-metadata')
    return send({
      [`movie:${910000 + id}`]: {
        average: 7.5,
        isAnime: false,
        releaseDate: '2027-01-01',
        upcoming: true,
      },
    });
  if (path === '/watch-history/summary') return send({});
  if (path === '/request/count')
    return send({
      pending: 0,
      approved: 0,
      processing: 0,
      available: 0,
      total: 0,
    });
  if (path.includes('notification'))
    return send({ results: [], unreadCount: 0, upcoming: [] });
  if (path === '/settings/main') return send(settings);
  return send(page([]));
});
next.prepare().then(() => server.listen(5055, '127.0.0.1')).catch(error => {
  console.error(error);
  process.exitCode = 1;
  server.close();
});
const stop = () => {
  next.close();
  server.close();
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
