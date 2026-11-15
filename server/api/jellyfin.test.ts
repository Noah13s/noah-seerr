import type { AxiosInstance } from 'axios';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, it, mock, test } from 'node:test';
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

function buildJellyfin(): JellyfinAPI {
  return new JellyfinAPI('http://localhost:8096');
}

function getAxios(jellyfin: JellyfinAPI): AxiosInstance {
  return (jellyfin as unknown as { axios: AxiosInstance }).axios;
}

describe('JellyfinAPI getEpisodes', () => {
  afterEach(() => mock.restoreAll());

  it('filters special and virtual episodes', async () => {
    const jellyfin = buildJellyfin();
    mock.method(getAxios(jellyfin), 'get', async () => ({
      data: {
        Items: [
          {
            Id: 'ep1',
            SeasonId: 'season-1',
            LocationType: 'FileSystem',
          },
          {
            Id: 'ep-special',
            SeasonId: 'season-0',
            LocationType: 'FileSystem',
          },
          {
            Id: 'ep2',
            SeasonId: 'season-1',
            LocationType: 'FileSystem',
          },
          {
            Id: 'ep-virtual',
            SeasonId: 'season-1',
            LocationType: 'Virtual',
          },
        ],
      },
    }));

    const episodes = await jellyfin.getEpisodes('test-series', 'season-1');
    assert.deepStrictEqual(
      episodes.map((episode) => episode.Id),
      ['ep1', 'ep2']
    );
  });

  it('keeps episodes without a SeasonId', async () => {
    const jellyfin = buildJellyfin();
    mock.method(getAxios(jellyfin), 'get', async () => ({
      data: {
        Items: [{ Id: 'ep1', LocationType: 'FileSystem' }],
      },
    }));

    const episodes = await jellyfin.getEpisodes('test-series', 'season-1');
    assert.deepStrictEqual(
      episodes.map((episode) => episode.Id),
      ['ep1']
    );
  });
});
