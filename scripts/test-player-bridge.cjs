'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PlayerBridge } = require('../src/utils/playerBridge.ts');

function fixture() {
  let listener;
  const sent = [];
  const frame = { postMessage: message => sent.push(message) };
  global.window = {
    location: { origin: 'https://stream.example' },
    addEventListener(_event, fn) { listener = fn; },
    removeEventListener() {},
  };
  const events = [];
  const bridge = new PlayerBridge(frame, 'fixture', (event, state) => events.push({ event, state }));
  const send = (data, other = {}) => listener({ source: frame, origin: window.location.origin, data: { channel: 'noah-player', version: 1, frameId: 'fixture', ...data }, ...other });
  return { bridge, sent, send, events };
}

test('Play waits for readiness and repeated calls share one request', async () => {
  const f = fixture();
  const first = f.bridge.play(90000000), second = f.bridge.play(90000000);
  assert.equal(first, second);
  assert.equal(f.sent.filter(x => x.kind === 'command').length, 0);
  f.send({ kind: 'event', event: 'ready' });
  const play = f.sent.find(x => x.action === 'play');
  assert.equal(play.payload.resumeTicks, 90000000);
  f.send({ kind: 'reply', id: play.id, ok: true, state: { position: 9, duration: 60 } });
  assert.equal((await first).position, 9);
  f.bridge.close();
});

test('wrong window/origin/version/frame and invalid progress are rejected', () => {
  const f = fixture();
  const data = { kind: 'event', event: 'firstFrame', state: { position: 1, duration: 60 } };
  f.send(data, { origin: 'https://other.example' });
  f.send(data, { source: {} });
  f.send({ ...data, version: 2 });
  f.send({ ...data, frameId: 'old-frame' });
  f.send({ ...data, state: { position: -1, duration: 60 } });
  assert.equal(f.events.length, 0);
  f.send(data);
  assert.equal(f.events.length, 1);
  f.bridge.close();
});

test('closing cancels waiting commands and late replies cannot revive playback', async () => {
  const f = fixture();
  const promise = f.bridge.play();
  const rejected = assert.rejects(promise, /PLAYER_STOPPED/);
  f.bridge.close();
  await rejected;
  assert.equal(f.sent.at(-1).action, 'stop');
  f.send({ kind: 'event', event: 'ready' });
  assert.equal(f.sent.filter(x => x.action === 'play').length, 0);
  f.bridge.close();
});

test('commands receive matching failure acknowledgments', async () => {
  const f = fixture();
  f.send({ kind: 'event', event: 'ready' });
  const pending = f.bridge.command('subtitle', { index: 2 });
  const command = f.sent.at(-1);
  f.send({ kind: 'reply', id: command.id, ok: false, code: 'INVALID_TRACK' });
  await assert.rejects(pending, /INVALID_TRACK/);
  f.bridge.close();
});

test('document replacement retires the endpoint without stopping the new document', async () => {
  const f = fixture();
  const pending = f.bridge.play();
  const rejected = assert.rejects(pending, /PLAYER_STOPPED/);
  f.bridge.close(false);
  await rejected;
  assert.equal(f.sent.filter(x => x.action === 'stop').length, 0);
  f.send({ kind: 'event', event: 'ready' });
  assert.equal(f.sent.filter(x => x.action === 'play').length, 0);
});

test('player labels and French playback messages contain no misdecoded UTF-8', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync('src/components/Common/PlayButton/index.tsx', 'utf8');
  const broken = /[\u00c2\u00c3\ufffd]|\u00e2\u20ac/;
  assert.doesNotMatch(source, broken);
  const french = JSON.parse(fs.readFileSync('src/i18n/locale/fr.json', 'utf8'));
  for (const [key, text] of Object.entries(french)) {
    if (key.startsWith('components.PlayButton.')) assert.doesNotMatch(text, broken, key);
  }
  assert.equal(french['components.PlayButton.starting'], 'D\u00e9marrage de la lecture\u2026');
});
