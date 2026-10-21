'use strict';
const crypto = require('node:crypto');
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
class PairError extends Error { constructor(status, message) { super(message); this.status = status; } }
const normalizeCode = value => {
  const code = typeof value === 'string' ? value.toUpperCase().replace(/[\s-]/g, '') : '';
  if (!/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/.test(code)) throw new PairError(400, 'Enter the eight-character code shown on your device.');
  return code;
};
function pairingService({ query, secret, now = Date.now }) {
  let ready, lastCleanup = 0;
  const hash = (kind, value) => crypto.createHmac('sha256', secret).update(`${kind}:${value}`).digest('hex');
  const deviceHash = value => {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{43}$/.test(value)) throw new PairError(400, 'Invalid pairing request.');
    return hash('device', value);
  };
  async function ensure() {
    await (ready ??= query(`CREATE TABLE IF NOT EXISTS noah_device_pairing (
      device_hash TEXT PRIMARY KEY, code_hash TEXT NOT NULL UNIQUE, device_name TEXT NOT NULL,
      expires_at BIGINT NOT NULL, status TEXT NOT NULL, user_id INTEGER,
      claim_until BIGINT, session_hash TEXT
    )`).catch(error => { ready = null; throw error; }));
    if (now() - lastCleanup > 60000) {
      lastCleanup = now(); await query('DELETE FROM noah_device_pairing WHERE expires_at <= ?', [now()]);
    }
  }
  const valid = row => {
    if (!row || Number(row.expires_at) <= now() || row.status === 'cancelled') throw new PairError(410, 'This pairing code expired or was cancelled. Generate a new code.');
    return row;
  };
  async function rowFor(secret) {
    await ensure();
    return valid((await query('SELECT * FROM noah_device_pairing WHERE device_hash = ?', [deviceHash(secret)]))[0]);
  }
  return {
    async start(name) {
      await ensure();
      const count = await query('SELECT COUNT(*) AS count FROM noah_device_pairing WHERE expires_at > ?', [now()]);
      if (Number(count[0].count) >= 1000) throw new PairError(429, 'Pairing is busy. Try again shortly.');
      const deviceName = typeof name === 'string' ? name.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 80) : '';
      for (let attempt = 0; attempt < 4; attempt++) {
        const code = [...crypto.randomBytes(8)].map(b => ALPHABET[b % 32]).join('');
        const deviceSecret = crypto.randomBytes(32).toString('base64url');
        const expiresAt = now() + 5 * 60000;
        try {
          await query('INSERT INTO noah_device_pairing (device_hash, code_hash, device_name, expires_at, status) VALUES (?, ?, ?, ?, ?)',
            [deviceHash(deviceSecret), hash('code', code), deviceName || 'Web browser', expiresAt, 'pending']);
          return { code: `${code.slice(0, 4)}-${code.slice(4)}`, deviceSecret, expiresAt, interval: 4 };
        } catch (error) { if (!/UNIQUE|constraint/i.test(error.message) || attempt === 3) throw error; }
      }
    },
    async inspect(value) {
      await ensure();
      const row = valid((await query('SELECT * FROM noah_device_pairing WHERE code_hash = ?', [hash('code', normalizeCode(value))]))[0]);
      if (row.status !== 'pending') throw new PairError(409, 'This code has already been used.');
      return { deviceName: row.device_name, expiresAt: Number(row.expires_at) };
    },
    async approve(value, userId) {
      await ensure();
      // TypeORM's SQLite driver uses run() for bare UPDATE and drops RETURNING rows.
      // A leading comment selects its all() path while retaining one atomic statement.
      const rows = await query(`/* pairing returning */ UPDATE noah_device_pairing SET status = 'approved', user_id = ?
        WHERE code_hash = ? AND status = 'pending' AND expires_at > ? RETURNING device_hash`,
        [userId, hash('code', normalizeCode(value)), now()]);
      if (!rows.length) throw new PairError(409, 'This code expired or has already been approved.');
    },
    async claim(value, sessionId) {
      let row = await rowFor(value);
      if (row.status === 'consumed') {
        if (sessionId && row.session_hash === hash('session', sessionId)) return { status: 'authenticated', userId: Number(row.user_id) };
        throw new PairError(410, 'This pairing has already been used.');
      }
      if (row.status === 'claiming' && Number(row.claim_until) <= now()) {
        await query("UPDATE noah_device_pairing SET status = 'approved' WHERE device_hash = ? AND status = 'claiming' AND claim_until <= ?", [row.device_hash, now()]);
      }
      const claimed = await query(`/* pairing returning */ UPDATE noah_device_pairing SET status = 'claiming', claim_until = ?
        WHERE device_hash = ? AND status = 'approved' AND expires_at > ? RETURNING user_id`, [now() + 30000, row.device_hash, now()]);
      return claimed.length ? { status: 'claim', userId: Number(claimed[0].user_id) } : { status: 'pending' };
    },
    async complete(value, sessionId) {
      const rows = await query("/* pairing returning */ UPDATE noah_device_pairing SET status = 'consumed', session_hash = ?, claim_until = NULL WHERE device_hash = ? AND status = 'claiming' AND expires_at > ? RETURNING device_hash", [hash('session', sessionId), deviceHash(value), now()]);
      if (!rows.length) throw new PairError(410, 'This pairing expired or was cancelled.');
    },
    async release(value) {
      await query("UPDATE noah_device_pairing SET status = 'approved', claim_until = NULL WHERE device_hash = ? AND status = 'claiming'", [deviceHash(value)]);
    },
    async cancel(value) {
      await ensure(); await query("UPDATE noah_device_pairing SET status = 'cancelled' WHERE device_hash = ? AND status IN ('pending', 'approved', 'claiming')", [deviceHash(value)]);
    },
  };
}
module.exports = { pairingService, normalizeCode, PairError };
