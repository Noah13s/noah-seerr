import AdminToolsPage from '@app/pages/admin-tools';
import { JSDOM } from 'jsdom';
import { RouterContext } from 'next/dist/shared/lib/router-context.shared-runtime';
import type { NextRouter } from 'next/router';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { IntlProvider } from 'react-intl';
import { SWRConfig } from 'swr';

test('client navigation opens the cleanup section without executing a decision', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: 'http://localhost/admin-tools',
  });
  const values: Record<string, unknown> = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    Node: dom.window.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const originals = new Map(
    Object.keys(values).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ])
  );
  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, {
      value,
      writable: true,
      configurable: true,
    });
  const root = createRoot(dom.window.document.getElementById('root')!);
  const cache = new Map();
  const swr = {
    provider: () => cache,
    fallback: {
      '/api/v1/auth/me': { id: 1, permissions: 2 },
      '/api/v1/admin-tools/cleanup': { reviews: [], manualCandidates: [] },
    },
  };
  const view = (query: Record<string, string | string[]>) =>
    createElement(
      SWRConfig,
      { value: swr },
      createElement(
        RouterContext.Provider,
        {
          value: {
            pathname: '/admin-tools',
            query,
            isReady: true,
          } as NextRouter,
        },
        createElement(
          IntlProvider,
          { locale: 'en', messages: {} },
          createElement(AdminToolsPage)
        )
      )
    );
  try {
    await act(async () => {
      root.render(view({ review: ['invalid'] }));
    });
    assert.equal(
      dom.window.document.querySelector('[aria-current="page"]')?.textContent,
      'Overview'
    );
    await act(async () => {
      root.render(view({ review: 'fixture-review' }));
    });
    assert.equal(
      dom.window.document.querySelector('[aria-current="page"]')?.textContent,
      'Cleanup approvals'
    );
    assert.ok(dom.window.document.body.textContent?.includes('Source cleanup'));
    assert.equal(dom.window.document.querySelector('[role="dialog"]'), null);
    await act(async () => {
      root.render(view({}));
    });
    const overview = Array.from(
      dom.window.document.querySelectorAll('nav button')
    ).find((x) => x.textContent === 'Overview')!;
    await act(async () => {
      (overview as HTMLElement).click();
    });
    assert.equal(
      dom.window.document.querySelector('[aria-current="page"]')?.textContent,
      'Overview'
    );
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
