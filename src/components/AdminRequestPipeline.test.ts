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
