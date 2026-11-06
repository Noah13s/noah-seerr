import AdminRequestPipeline from '@app/components/AdminRequestPipeline';
import french from '@app/i18n/locale/fr.json';
import type { PipelineSnapshot } from '@server/lib/requestPipeline';
import { RouterContext } from 'next/dist/shared/lib/router-context.shared-runtime';
import type { NextRouter } from 'next/router';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { IntlProvider } from 'react-intl';
import { SWRConfig } from 'swr';

const snapshot: PipelineSnapshot = {
  fresh: true,
  clientAvailable: true,
  generatedAt: '2026-11-03T19:00:00Z',
  records: [
    {
      mediaType: 'tv',
      serverId: 0,
      externalId: 14,
      title: 'Fixture series',
      downloadId: 'search:fixture',
      stage: 'searching',
      reason: 'search-delayed',
      seasonNumber: 4,
      size: 0,
      sizeLeft: 0,
    },
  ],
  jobs: ['superseded', 'reused', 'held', 'blocked'].map((stage, index) => ({
    downloadId: String(index).repeat(40),
    stage,
    title: 'Old pack ' + index,
    seasonNumber: 2,
    retained: true,
    reason: 'selection-held',
  })),
};
function render(data: PipelineSnapshot, locale = 'en', permissions = 2) {
  return renderToStaticMarkup(
    createElement(
      SWRConfig,
      {
        value: {
          provider: () => new Map(),
          fallback: {
            '/api/v1/auth/me': { id: 1, permissions },
            '/api/v1/admin-tools/pipeline': data,
          },
        },
      },
      createElement(
        RouterContext.Provider,
        { value: { pathname: '/admin-tools' } as NextRouter },
        createElement(
          IntlProvider,
          { locale, messages: locale === 'fr' ? french : {} },
          createElement(AdminRequestPipeline)
        )
      )
    )
  );
}

test('ordinary profiles never render administrative request monitoring', () => {
  assert.equal(render(snapshot, 'en', 0), '');
});

test('tracker credit and account restrictions render for administrators in both languages', () => {
  const data: PipelineSnapshot = {
    ...snapshot,
    trackerHealth: [
      {
        id: 'c411',
        name: 'C411',
        budgeted: true,
        fresh: false,
        reason: 'tracker-quota-exhausted',
        availableBytes: -132000000,
        reservedBytes: 5 * 1024 ** 3,
        reservations: 1,
        checkedAt: '2026-11-03T19:00:00Z',
        adapterError: 'profile-unavailable',
        retryAt: '2026-11-03T19:30:00Z',
      },
    ],
  };
  const english = render(data);
  assert.match(english, /Download allowance exhausted/);
  assert.match(english, /Account allowance/);
  assert.match(english, /Reserved credit/);
  assert.match(english, /5 GiB/);
  assert.match(english, /Zen is never spent automatically/);
  const frenchHtml = render(data, 'fr');
  assert.match(frenchHtml, /Crédit de téléchargement épuisé/);
  assert.match(frenchHtml, /Crédit réservé/);
  assert.match(frenchHtml, /données anciennes/);
  assert.doesNotMatch(frenchHtml, /Ã|Â|�|NaN|undefined/);
  assert.equal(render(data, 'fr', 0), '');
});

test('administrator overview keeps slow searches and retained attempts distinct', () => {
  const html = render(snapshot);
  assert.match(html, /Fixture series/);
  assert.match(html, /Searching/);
  assert.match(html, /Superseded attempt/);
  assert.match(html, /Reused by a current request/);
  assert.match(html, /Held.*record retained/);
  assert.match(html, /request\(s\) waiting or needing attention/);
  assert.doesNotMatch(html, /NaN|undefined|apiKey/);
});

test('monitor-only accounts show source, obligations and unavailable access without claiming availability', () => {
  const data: PipelineSnapshot = {
    ...snapshot,
    trackerHealth: [
      {
        id: 'tr4ker',
        name: 'TR4KER',
        budgeted: false,
        fresh: true,
        monitored: true,
        healthFresh: true,
        reservedBytes: 0,
        reservations: 0,
        health: {
          source: 'api',
          ratio: 0.57,
          bufferBytes: 17_000_000_000,
          warnings: ['ratio-low'],
        },
      },
      {
        id: 'draupnirr',
        name: 'Draupnirr',
        budgeted: false,
        fresh: false,
        monitored: true,
        healthFresh: true,
        reservedBytes: 0,
        reservations: 0,
        health: {
          source: 'api',
          ratio: null,
          freeleech: true,
          hnrCount: 2,
          warnings: ['hit-and-run'],
        },
      },
      {
        id: 'crazyspirits',
        name: 'CrazySpirits',
        budgeted: false,
        fresh: false,
        monitored: true,
        healthFresh: false,
        reservedBytes: 0,
        reservations: 0,
        adapterError: 'website-challenge-required',
      },
      {
        id: 'astratorrent',
        name: 'AstraTorrent',
        budgeted: false,
        fresh: false,
        monitored: true,
        healthFresh: true,
        reservedBytes: 0,
        reservations: 0,
        health: { source: 'website', slotsUnlimited: true, activeContracts: 0 },
      },
    ],
  };
  const english = render(data);
  assert.match(english, /TR4KER/);
  assert.match(english, /Ratio approaching/);
  assert.match(english, /Outstanding seeding obligations/);
  assert.match(english, /Cloudflare verification required/);
  assert.match(english, /approximate counters/);
  assert.match(english, /∞/);
  assert.doesNotMatch(english, />Available</);
  const fr = render(data, 'fr');
  assert.match(fr, /Validation Cloudflare requise/);
  assert.match(fr, /surveillé/);
  assert.doesNotMatch(fr, /Ã|Â|�|NaN|undefined/);
  assert.equal(render(data, 'fr', 0), '');
});

test('French administrators see stale-monitor warnings and an empty retained list', () => {
  const html = render(
    { fresh: false, generatedAt: snapshot.generatedAt, records: [], jobs: [] },
    'fr'
  );
  assert.match(html, /temporairement indisponible/);
  assert.match(html, /Aucune ancienne tentative/);
  assert.doesNotMatch(html, /Ã|Â|�/);
});

test('a client outage is visible while manual holds are excluded from the attention count', () => {
  const data = {
    ...snapshot,
    clientAvailable: false,
    records: snapshot.records.map((row) => ({
      ...row,
      reason: 'manual-or-held-pause',
      title: undefined,
    })),
  };
  const html = render(data);
  assert.match(html, /temporarily unavailable/);
  assert.match(html, /tv #14/);
  assert.doesNotMatch(html, /request\(s\) waiting/);
  const frenchHtml = render(snapshot, 'fr');
  assert.match(frenchHtml, /Ancienne tentative/);
  assert.match(frenchHtml, /Réutilisée/);
  assert.match(frenchHtml, /Suspendue/);
});
