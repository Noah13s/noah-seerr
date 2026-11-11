import type TitleCardComponent from '@app/components/TitleCard';
import type { MediaType } from '@server/models/Search';
import { RouterContext } from 'next/dist/shared/lib/router-context.shared-runtime';
import type { NextRouter } from 'next/router';
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { IntlProvider } from 'react-intl';
import { SWRConfig } from 'swr';

// Node does not have Next's SVG loader. This test exercises the real card's
// rendered links; the updating spinner's artwork is irrelevant to navigation.
require.extensions['.svg'] = (module: NodeModule) => {
  module.exports = () => createElement('svg');
};
let TitleCard: typeof TitleCardComponent;
before(async () => {
  TitleCard = (await import('@app/components/TitleCard')).default;
});

function render(
  mediaType: MediaType,
  image = '/fixture.jpg',
  action?: React.ReactNode
) {
  return renderToStaticMarkup(
    createElement(
      SWRConfig,
      {
        value: {
          provider: () => new Map(),
          fallback: { '/api/v1/auth/me': { id: 1, permissions: 2 } },
        },
      },
      createElement(
        RouterContext.Provider,
        { value: { pathname: '/search', query: {} } as NextRouter },
        createElement(
          IntlProvider,
          { locale: 'en', messages: {} },
          createElement(TitleCard, {
            id: 1647,
            mediaType,
            image,
            title: 'Fixture title',
            action,
          })
        )
      )
    )
  );
}

for (const [kind, href] of [
  ['movie', '/movie/1647'],
  ['tv', '/tv/1647'],
  ['collection', '/collection/1647'],
] as const) {
  test(`${kind} poster is a real named link before any hover or tap`, () => {
    const html = render(kind);
    const anchor = html.match(
      /<a\b[^>]*data-testid="title-card-link"[^>]*>/
    )?.[0];
    assert.ok(anchor);
    assert.ok(anchor.includes(`href="${href}"`));
    assert.ok(anchor.includes('aria-label="Fixture title"'));
    assert.doesNotMatch(anchor, /tabindex="-1"/i);
  });
}

test('fallback posters retain navigation and card actions are not nested in a link', () => {
  assert.match(render('movie', ''), /href="\/movie\/1647"/);
  const html = render(
    'tv',
    '/fixture.jpg',
    createElement('button', null, 'Resume')
  );
  assert.doesNotMatch(html, /<a\b[^>]*>(?:(?!<\/a>)[\s\S])*<button\b/);
  assert.match(html, />Resume<\/button>/);
});
