import AdminActivity from '@app/components/AdminActivity';
import AdminToolsPage from '@app/pages/admin-tools';
import { RouterContext } from 'next/dist/shared/lib/router-context.shared-runtime';
import type { NextRouter } from 'next/router';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { IntlProvider } from 'react-intl';
import { SWRConfig } from 'swr';
const endpoint = '/api/v1/admin-tools/activity?take=50';
const users = [{ id: 1, name: 'Fixture user' }];
function render(
  component: ReactElement,
  fallback: Record<string, unknown>,
  locale = 'en'
) {
  return renderToStaticMarkup(
    createElement(
      SWRConfig,
      { value: { provider: () => new Map(), fallback } },
      createElement(
        RouterContext.Provider,
        { value: { pathname: '/admin-tools', query: {} } as NextRouter },
        createElement(IntlProvider, { locale, messages: {} }, component)
      )
    )
  );
}
const observation = { available: true, lastSuccessAt: '2026-11-05T08:00:00Z' };
const base = {
  userId: 1,
  userName: 'Fixture user',
  category: 'playback',
  title: '<img src=x onerror=alert(1)>',
  device: 'Fixture TV',
  createdAt: '2026-11-05T08:00:00Z',
};
test('admin history displays devices, tracks, timeline positions and failed actions safely', () => {
  const events = [
    {
      action: 'playback.started',
      details: {
        audio: 'jpn',
        subtitle: 'eng',
        method: 'DirectPlay',
        position: 42,
      },
    },
    {
      action: 'playback.audio',
      details: { from: 'jpn', to: 'fra', position: 100 },
    },
    { action: 'playback.seeked', details: { from: 50, to: 100 } },
    {
      action: 'request.created',
      category: 'request',
      details: { resource: 82 },
    },
    {
      action: 'watchlist.removed.failed',
      category: 'watchlist',
      details: { resource: 12 },
    },
  ].map((event, i) => ({ ...base, id: i + 1, ...event }));
  const html = render(createElement(AdminActivity, { users }), {
    [endpoint]: { events, next: 1, observation },
  });
  for (const text of [
    'Fixture TV',
    'DirectPlay',
    'jpn',
    'fra',
    '0:50',
    '1:40',
    'failed',
    '&lt;img',
  ])
    assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /90 days/);
  const french = render(
    createElement(AdminActivity, { users }),
    { [endpoint]: { events, next: null, observation } },
    'fr'
  );
  assert.match(french, /Piste audio modifiée/);
  assert.match(french, /échec/);
  assert.doesNotMatch(french, /Ã|Â|�/);
});
test('empty and unavailable histories have clear states without invented events', () => {
  const html = render(
    createElement(AdminActivity, { users }),
    {
      [endpoint]: { events: [], next: null, observation: { available: false } },
    },
    'fr'
  );
  assert.match(html, /Aucune activité/);
  assert.match(html, /temporairement indisponible/);
  const loading = render(createElement(AdminActivity, { users }), {});
  assert.match(loading, /Loading/);
});
test('admin overview uses full width, separates panels and does not load hidden service frames', () => {
  const insights = {
    totals: { users: 1, requests: 3, watched: 2, watching: 1 },
    users: [{ ...users[0], completed: 2, watching: 1, requests: 3 }],
    disk: {
      volumes: [
        { mount: '/media', total: 1e12, free: 2e11 },
        { mount: '/app/config', total: 1e9, free: 1e8 },
      ],
      libraries: [{ name: 'films', bytes: 1e9 }],
    },
  };
  const html = render(
    createElement(AdminToolsPage),
    {
      '/api/v1/auth/me': { id: 1, permissions: 2 },
      '/api/v1/admin-tools/insights': insights,
    },
    'fr'
  );
  assert.match(html, /max-w-\[1600px\]/);
  assert.match(html, /Historique d’activité/);
  assert.match(html, /Disque des médias/);
  assert.doesNotMatch(html, /<iframe/);
  assert.equal(
    render(createElement(AdminToolsPage), {
      '/api/v1/auth/me': { id: 2, permissions: 0 },
    }),
    ''
  );
});
