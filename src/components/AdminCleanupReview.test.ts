import AdminCleanupReview from '@app/components/AdminCleanupReview';
import { JSDOM } from 'jsdom';
import { RouterContext } from 'next/dist/shared/lib/router-context.shared-runtime';
import type { NextRouter } from 'next/router';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { IntlProvider } from 'react-intl';
import { SWRConfig } from 'swr';

test('source cleanup distinguishes running, paused, stale and satisfied seeding without approving deletion', async () => {
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
  const now = Date.now();
  const definitions = [
    { title: 'Active source', remainingSeconds: 7200, seeding: true },
    { title: 'Paused source', remainingSeconds: 7200, seeding: false },
    {
      title: 'Stale source',
      remainingSeconds: 7200,
      seeding: true,
      stale: true,
    },
    { title: 'Satisfied source', remainingSeconds: 0, seeding: false },
  ];
  const reviews = definitions.map((row, id) => ({
    id: String(id),
    mediaType: 'movie',
    tmdbId: id + 1,
    title: row.title,
    status: 'deleted',
    eligibleAt: new Date(now).toISOString(),
    requesters: ['Fixture'],
    sourceCleanup: {
      state: 'waiting_seeding',
      remainingBytes: 1000,
      checkedAt: new Date(now - (row.stale ? 660000 : 0)).toISOString(),
      torrents: [
        {
          ...row,
          torrentState: row.seeding ? 'stalledUP' : 'missingFiles',
          reason: 'Fixture reason',
        },
      ],
    },
  }));
  const props = {
    candidates: [],
    onChanged: () => {
      throw new Error('Read-only tab must not perform an action');
    },
  };
  try {
    await act(async () => {
      root.render(
        createElement(
          SWRConfig,
          {
            value: {
              provider: () => new Map(),
              fallback: {
                '/api/v1/admin-tools/cleanup': {
                  reviews,
                  manualCandidates: [],
                },
              },
            },
          },
          createElement(
            RouterContext.Provider,
            { value: { pathname: '/admin-tools', query: {} } as NextRouter },
            createElement(
              IntlProvider,
              { locale: 'en', messages: {} },
              createElement(AdminCleanupReview, props)
            )
          )
        )
      );
    });
    const tab = Array.from(
      dom.window.document.querySelectorAll('[role="tab"]')
    ).find((button) => button.textContent?.includes('Source cleanup'))!;
    assert.ok(tab);
    await act(async () => {
      (tab as HTMLElement).click();
    });
    const text = dom.window.document.body.textContent!;
    for (const phrase of [
      'Active source',
      'Paused source',
      'Stale source',
      'Required seeding remaining',
      'Seeding is not advancing',
      'Status is stale',
      'Time requirement satisfied',
      'Fixture reason',
    ])
      assert.ok(text.includes(phrase), phrase);
    assert.doesNotMatch(text, /NaN|undefined/);
    assert.equal(dom.window.document.querySelector('[role="dialog"]'), null);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
