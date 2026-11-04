import RequestPipelineStatus from '@app/components/RequestPipelineStatus';
import french from '@app/i18n/locale/fr.json';
import { MediaType } from '@server/constants/media';
import type { DownloadingItem } from '@server/lib/downloadtracker';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { IntlProvider } from 'react-intl';

const item: DownloadingItem = {
  mediaType: MediaType.TV,
  externalId: 14,
  downloadId: 'search:1',
  title: 'Fixture',
  status: 'searching',
  stage: 'searching',
  size: 0,
  sizeLeft: 0,
  timeLeft: '',
  estimatedCompletionTime: new Date(NaN),
  startedAt: '2026-11-03T19:00:00Z',
  updatedAt: '2026-11-03T19:16:00Z',
  searchProgress: { episodeNumber: 4, totalEpisodes: 11 },
};
const render = (overrides: Partial<DownloadingItem>) =>
  renderToStaticMarkup(
    createElement(
      IntlProvider,
      { locale: 'fr', messages: french },
      createElement(RequestPipelineStatus, {
        item: { ...item, ...overrides },
        details: true,
      })
    )
  );

test('French request progress renders real search steps and elapsed time without fake percentages', () => {
  const html = render({ reason: 'search-delayed' });
  assert.match(html, /Recherche/);
  assert.match(html, /4.*11/);
  assert.match(html, /16 minutes/);
  assert.doesNotMatch(html, /%|Ã|Â|�/);
});

test('completed transfer is presented as importing rather than available or a second download', () => {
  const html = render({
    stage: 'importing',
    searchProgress: undefined,
    reason: 'import-delayed',
    size: 100,
    sizeLeft: 0,
  });
  assert.match(html, /Import/);
  assert.doesNotMatch(html, /%|Disponible|NaN|Ã|Â|�/);
});
