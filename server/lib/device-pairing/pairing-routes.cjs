'use strict';
const { pairingService, normalizeCode, PairError } = require('./pairing-service.cjs');
function pairingRoutes({ express, query, secret, getUser, origin = 'https://stream.noah-work.com', qr }) {
  const router = express.Router();
  const service = pairingService({ query, secret });
  const limits = new Map();
  function rate(key, count, period = 60000) {
    const now = Date.now();
    if (limits.size >= 4096) for (const [id, value] of limits) if (value.until <= now) limits.delete(id);
    if (limits.size >= 4096 && !limits.has(key)) throw new PairError(429, 'Pairing is busy. Try again shortly.');
    let value = limits.get(key);
    if (!value || value.until <= now) { value = { count: 0, until: now + period }; limits.set(key, value); }
    if (++value.count > count) throw new PairError(429, 'Too many attempts. Please wait a minute.');
  }
  function signedIn(req) {
    if (!req.user || req.session?.userId !== req.user.id || req.get('X-API-Key')) throw new PairError(401, 'Sign in to Seerr to pair a device.');
    return req.user.id;
  }
  const route = handler => async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      if (req.method !== 'GET') {
        if (req.get('Sec-Fetch-Site') === 'cross-site' || (req.get('Origin') && req.get('Origin') !== origin)) throw new PairError(403, 'Open pairing in Seerr.');
        if (!req.is('application/json')) throw new PairError(415, 'JSON required.');
        if (JSON.stringify(req.body ?? {}).length > 2048) throw new PairError(413, 'Pairing request too large.');
      }
      await handler(req, res);
    } catch (error) {
      res.status(error instanceof PairError ? error.status : 503).json({ message: error instanceof PairError ? error.message : 'Pairing is temporarily unavailable. Please try again.' });
    }
  };
  router.post('/start', route(async (req, res) => {
    rate(`start:${req.ip}`, 10); rate('starts', 150);
    const pair = await service.start(req.body?.deviceName);
    res.status(201).json({ ...pair, approvalUrl: `${origin}/pair-device?code=${pair.code}` });
  }));
  router.get('/qr', route(async (req, res) => {
    rate(`qr:${req.ip}`, 30);
    const code = normalizeCode(req.query.code);
    const image = qr(0, 'M'); image.addData(`${origin}/pair-device?code=${code.slice(0, 4)}-${code.slice(4)}`); image.make();
    res.type('image/svg+xml').send(image.createSvgTag({ cellSize: 5, margin: 20, scalable: true }));
  }));
  router.post('/inspect', route(async (req, res) => {
    const id = signedIn(req); rate(`lookup:${req.ip}`, 15); rate(`lookup-user:${id}`, 15);
    res.json(await service.inspect(req.body?.code));
  }));
  router.post('/approve', route(async (req, res) => {
    const id = signedIn(req); rate(`approve:${req.ip}`, 12); rate(`approve-user:${id}`, 12);
    if (req.get('Origin') !== origin) throw new PairError(403, 'Approve using your signed-in Seerr browser.');
    if (!(await getUser(id))) throw new PairError(401, 'Sign in again.');
    await service.approve(req.body?.code, id); res.json({ status: 'approved' });
  }));
  router.post('/poll', route(async (req, res) => {
    rate(`poll:${req.ip}`, 180);
    const secret = req.body?.deviceSecret;
    const claim = await service.claim(secret, req.session?.userId ? req.sessionID : undefined);
    if (claim.status !== 'claim') return res.json({ status: claim.status });
    let created = false;
    try {
      if (!(await getUser(claim.userId))) { await service.cancel(secret); throw new PairError(410, 'This account is no longer available.'); }
      await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
      created = true;
      req.session.userId = claim.userId;
      req.session.noahPairedDevice = { name: 'Paired device', at: Date.now() };
      await new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
      await service.complete(secret, req.sessionID);
      res.json({ status: 'authenticated' });
    } catch (error) {
      if (created) await new Promise(resolve => req.session.destroy(() => resolve()));
      await service.release(secret); throw error;
    }
  }));
  router.post('/cancel', route(async (req, res) => {
    rate(`cancel:${req.ip}`, 30); await service.cancel(req.body?.deviceSecret); res.status(204).end();
  }));
  return router;
}
module.exports = { pairingRoutes };
