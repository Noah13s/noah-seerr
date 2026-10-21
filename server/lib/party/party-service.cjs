'use strict';
const crypto = require('node:crypto');
const ID = /^[a-f0-9]{32}$/;
const AVATAR = /^\/profile-avatars\/preset-(0[1-9]|1[0-6])\.svg$/;
class PartyError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new PartyError(status, message); };
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max && !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(value) ? value.trim() : fail(400, 'Please enter a valid name or message.');
const signedUser = req => req.user && req.session?.userId === req.user.id ? req.user : null;

function partyService({ query, secret, now = Date.now }) {
  const locks = new Map();
  // Routers are imported before Seerr initializes TypeORM. Delay schema setup
  // until the first request, after the application has completed startup.
  let initialization;
  const ready = () => initialization ||= query('CREATE TABLE IF NOT EXISTS noah_party (id TEXT PRIMARY KEY, owner_id INTEGER NOT NULL, expires_at INTEGER NOT NULL, data TEXT NOT NULL)').catch(error => { initialization = undefined; throw error; });
  const serial = async (key, action) => {
    const task = (locks.get(key) || Promise.resolve()).catch(() => {}).then(action);
    locks.set(key, task);
    try { return await task; } finally { if (locks.get(key) === task) locks.delete(key); }
  };
  async function load(id) {
    if (!ID.test(id || '')) fail(404, 'Party not found.');
    await ready();
    const rows = await query('SELECT data FROM noah_party WHERE id = ?', [id]);
    if (!rows.length) fail(404, 'Party not found.');
    const room = JSON.parse(rows[0].data);
    if (room.expiresAt <= now() || room.ended) fail(410, 'This party has ended.');
    return room;
  }
  async function save(room) {
    await query('INSERT INTO noah_party (id, owner_id, expires_at, data) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET expires_at=excluded.expires_at, data=excluded.data', [room.id, room.ownerId, room.expiresAt, JSON.stringify(room)]);
    return room;
  }
  const invite = room => crypto.createHmac('sha256', secret).update(`party:${room.id}:${room.inviteVersion}`).digest('base64url');
  function member(room, req) {
    const user = signedUser(req);
    const token = req.cookies?.[`noah_party_${room.id}`];
    const found = user ? room.members.find(m => m.userId === user.id) : room.members.find(m => !m.userId && typeof token === 'string' && equal(m.credential, hash(token)));
    if (!found || found.kicked) fail(403, 'Join this party with its invitation link.');
    return found;
  }
  function admin(room, req) {
    const user = signedUser(req);
    if (!user || user.id !== room.ownerId) fail(403, 'Only the party creator can do that.');
    return member(room, req);
  }
  const snapshot = (room, me) => ({
    id: room.id, title: room.title, itemId: room.itemId, mediaTitle: room.mediaTitle,
    expiresAt: room.expiresAt, serverTime: now(), me: me.id, isAdmin: me.userId === room.ownerId,
    inviteToken: me.userId === room.ownerId ? invite(room) : undefined,
    playback: room.playback, watchContext: room.watchContext,
    members: room.members.filter(m => !m.kicked).map(m => ({ id: m.id, name: m.name, avatar: m.avatar, isAdmin: m.userId === room.ownerId, online: now() - m.seenAt < 45_000 })),
    messages: room.messages.slice(-200),
  });
  async function update(id, action) {
    return serial(id, async () => { const room = await load(id); const result = await action(room); await save(room); return result; });
  }
  return {
    get ready() { return ready(); }, load, member, admin, invite, snapshot, update,
    async create(req, input, media) {
      const user = signedUser(req);
      if (!user) fail(401, 'Sign in to create a party.');
      if (!ID.test(media.itemId)) fail(400, 'Choose an available movie or episode.');
      return serial('create', async () => {
        await ready();
        await query('DELETE FROM noah_party WHERE expires_at < ?', [now()]);
        const rows = await query('SELECT data FROM noah_party WHERE owner_id = ? AND expires_at > ?', [user.id, now()]);
        if (rows.filter(row => !JSON.parse(row.data).ended).length >= 3) fail(429, 'End an existing party before creating another.');
        const id = crypto.randomBytes(16).toString('hex');
        const room = { id, ownerId: user.id, ownerSessionId: req.sessionID, ownerJellyfinId: media.userId,
          itemId: media.itemId, mediaTitle: text(media.title, 300), watchContext: media.watchContext, title: text(input.title || `${media.title} · Watch party`, 350),
          createdAt: now(), expiresAt: now() + 48 * 60 * 60 * 1000, inviteVersion: 1,
          playback: { paused: true, position: 0, updatedAt: now(), revision: 0, duration: media.duration || 0 },
          members: [{ id: crypto.randomBytes(16).toString('hex'), userId: user.id, name: text(user.displayName || user.username || 'Host', 80), avatar: AVATAR.test(user.avatar) ? user.avatar : '/profile-avatars/preset-01.svg', seenAt: now() }], messages: [] };
        await save(room);
        return snapshot(room, room.members[0]);
      });
    },
    async list(req) {
      const user = signedUser(req); if (!user) fail(401, 'Sign in to see your parties.');
      await ready();
      const rows = await query('SELECT data FROM noah_party WHERE expires_at > ?', [now()]);
      return rows.map(row => JSON.parse(row.data)).filter(room => !room.ended && room.members.some(m => m.userId === user.id && !m.kicked)).map(room => ({ id: room.id, title: room.title, mediaTitle: room.mediaTitle, isAdmin: room.ownerId === user.id, expiresAt: room.expiresAt }));
    },
    async join(req, id, input) {
      let credential;
      const state = await update(id, room => {
        let existing; try { existing = member(room, req); } catch {}
        if (existing) { existing.seenAt = now(); return snapshot(room, existing); }
        const previousToken = req.cookies?.[`noah_party_${room.id}`];
        if (typeof previousToken === 'string' && room.members.some(m => m.kicked && equal(m.credential, hash(previousToken)))) fail(403, 'You were removed from this party.');
        if (!equal(input.inviteToken, invite(room))) fail(403, 'This invitation is invalid or has been replaced.');
        const user = signedUser(req);
        if (user && room.members.some(m => m.userId === user.id && m.kicked)) fail(403, 'You were removed from this party.');
        if (room.members.filter(m => !m.kicked).length >= 24) fail(409, 'This party is full.');
        const name = text(input.name, 40);
        if (!AVATAR.test(input.avatar)) fail(400, 'Choose a profile picture.');
        credential = !user ? crypto.randomBytes(32).toString('base64url') : undefined;
        const me = { id: crypto.randomBytes(16).toString('hex'), userId: user?.id, credential: credential && hash(credential), name, avatar: input.avatar, seenAt: now() };
        room.members.push(me);
        return snapshot(room, me);
      });
      return { state, credential };
    },
    async state(req, id) {
      const room = await load(id); const me = member(room, req);
      if (now() - me.seenAt > 15_000) return update(id, fresh => { const current = member(fresh, req); current.seenAt = now(); return snapshot(fresh, current); });
      return snapshot(room, me);
    },
    chat(req, id, input) {
      return update(id, room => {
        const me = member(room, req);
        const message = text(input.message, 1000);
        if (room.messages.some(m => m.memberId === me.id && now() - m.createdAt < 1000)) fail(429, 'Please wait a moment before sending another message.');
        room.messages.push({ id: crypto.randomUUID(), memberId: me.id, name: me.name, avatar: me.avatar, text: message, createdAt: now() });
        room.messages = room.messages.slice(-500); me.seenAt = now();
        return snapshot(room, me);
      });
    },
    playback(req, id, input) {
      return update(id, room => {
        const me = admin(room, req);
        if (input.revision !== room.playback.revision) fail(409, 'Playback changed. Synchronizing…');
        if (typeof input.paused !== 'boolean' || !Number.isFinite(input.position) || input.position < 0 || input.position > (room.playback.duration || 86_400)) fail(400, 'Invalid playback position.');
        room.playback = { ...room.playback, paused: input.paused, position: input.position, updatedAt: now(), revision: room.playback.revision + 1 };
        me.seenAt = now(); return snapshot(room, me);
      });
    },
    manage(req, id, input) {
      return update(id, room => {
        const me = admin(room, req);
        if (input.action === 'end') { room.ended = true; room.expiresAt = now(); }
        else if (input.action === 'rotate') room.inviteVersion++;
        else if (input.action === 'kick') {
          const target = room.members.find(m => m.id === input.memberId);
          if (!target || target.userId === room.ownerId) fail(400, 'Choose another participant.');
          target.kicked = true;
        } else fail(400, 'Unknown action.');
        return snapshot(room, me);
      });
    },
    leave(req, id) { return update(id, room => { const me = member(room, req); me.seenAt = 0; return { ok: true }; }); },
  };
}
module.exports = { partyService, PartyError, signedUser, hash, equal, ID };
