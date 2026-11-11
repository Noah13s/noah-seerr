import type PWAInstallPromptComponent from '@app/components/PWAInstallPrompt';
import type * as InstallModule from '@app/context/PWAInstallContext';
import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { IntlProvider } from 'react-intl';

require.extensions['.svg'] = (module: NodeModule) => {
  module.exports = () => createElement('svg');
};
let installModule: typeof InstallModule;
let Banner: typeof PWAInstallPromptComponent;
before(async () => {
  installModule = await import('@app/context/PWAInstallContext');
  Banner = (await import('@app/components/PWAInstallPrompt')).default;
});

async function fixture(
  options: { ua?: string; standalone?: boolean; storageError?: boolean } = {}
) {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="root"></div></body></html>',
    { url: 'https://fixture.test' }
  );
  const mode = Object.assign(new dom.window.EventTarget(), {
    matches: options.standalone ?? false,
  });
  Object.defineProperty(dom.window, 'matchMedia', { value: () => mode });
  if (options.ua)
    Object.defineProperty(dom.window.navigator, 'userAgent', {
      value: options.ua,
    });
  const storage = options.storageError
    ? {
        getItem() {
          throw new Error('Storage blocked');
        },
        setItem() {
          throw new Error('Storage blocked');
        },
      }
    : dom.window.localStorage;
  const values: Record<string, unknown> = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    Node: dom.window.Node,
    localStorage: storage,
    getComputedStyle: dom.window.getComputedStyle,
    requestAnimationFrame: (cb: FrameRequestCallback) =>
      setTimeout(() => cb(0), 0),
    cancelAnimationFrame: clearTimeout,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(
    Object.keys(values).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ])
  );
  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  let state!: ReturnType<typeof InstallModule.usePWAInstall>;
  function Controls() {
    state = installModule.usePWAInstall();
    return createElement(Banner);
  }
  const root = createRoot(dom.window.document.getElementById('root')!);
  await act(async () =>
    root.render(
      createElement(
        IntlProvider,
        { locale: 'en', messages: {} },
        createElement(installModule.PWAInstallProvider, {
          children: createElement(Controls),
        })
      )
    )
  );
  return {
    dom,
    mode,
    get state() {
      return state;
    },
    async capture(prompt: () => Promise<void>, outcome = 'accepted') {
      const event = Object.assign(
        new dom.window.Event('beforeinstallprompt', { cancelable: true }),
        { prompt, userChoice: Promise.resolve({ outcome }) }
      );
      await act(async () => {
        dom.window.dispatchEvent(event);
      });
      assert.equal(event.defaultPrevented, true);
    },
    async close() {
      await act(async () => root.unmount());
      dom.window.close();
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}

test('native install prompt is captured, consumed once and protected against concurrent clicks', async () => {
  const f = await fixture();
  try {
    let calls = 0,
      finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    await f.capture(async () => {
      calls++;
      await pending;
    });
    assert.equal(f.state.canPrompt, true);
    assert.match(
      f.dom.window.document.body.textContent!,
      /Install Noah Stream/
    );
    let install!: Promise<void>;
    await act(async () => {
      install = f.state.install();
      await f.state.install();
    });
    assert.equal(calls, 1);
    assert.equal(f.state.installing, true);
    assert.equal(f.state.canPrompt, false);
    await act(async () => {
      finish();
      await install;
    });
    assert.equal(f.state.installing, false);
    await act(async () => {
      f.dom.window.dispatchEvent(new f.dom.window.Event('appinstalled'));
    });
    assert.equal(f.state.installed, true);
    await act(async () => f.state.install());
    assert.equal(calls, 1);
    assert.equal(f.dom.window.document.querySelector('button'), null);
  } finally {
    await f.close();
  }
});

test('banner dismissal does not consume the profile-menu install action, even with blocked storage', async () => {
  const f = await fixture({ storageError: true });
  try {
    let calls = 0;
    await f.capture(async () => {
      calls++;
    }, 'dismissed');
    const dismiss = f.dom.window.document.querySelector(
      'button[aria-label="Not now"]'
    ) as HTMLElement;
    assert.ok(dismiss);
    await act(async () => dismiss.click());
    assert.equal(f.dom.window.document.querySelector('button'), null);
    assert.equal(f.state.canPrompt, true);
    await act(async () => f.state.install());
    assert.equal(calls, 1);
    assert.equal(f.state.installing, false);
  } finally {
    await f.close();
  }
});

test('browser dismissal is remembered and a later display-mode change hides install UI', async () => {
  const f = await fixture();
  try {
    await f.capture(async () => {}, 'dismissed');
    await act(async () => f.state.install());
    assert.ok(
      Number(f.dom.window.localStorage.getItem('pwa-install-dismissed-at')) > 0
    );
    await act(async () => {
      f.mode.matches = true;
      f.mode.dispatchEvent(new f.dom.window.Event('change'));
    });
    assert.equal(f.state.installed, true);
  } finally {
    await f.close();
  }
});

for (const [ua, text] of [
  ['iPhone Safari', 'Add to Home Screen'],
  ['Android Chrome', 'Install app'],
  ['Macintosh Safari', 'Add to Dock'],
  ['Windows Chrome', 'address bar'],
]) {
  test(`manual installation instructions work for ${ua}`, async () => {
    const f = await fixture({ ua });
    try {
      await act(async () => f.state.install());
      assert.match(f.dom.window.document.body.textContent!, new RegExp(text));
      const close = Array.from(
        f.dom.window.document.querySelectorAll('button')
      ).find((button) => button.textContent === 'Close');
      assert.ok(close);
      await act(async () => close.click());
    } finally {
      await f.close();
    }
  });
}

test('expired prompt falls back to instructions and standalone launch never prompts', async () => {
  const f = await fixture({ ua: 'Android Chrome' });
  try {
    await f.capture(async () => {
      throw new Error('Expired');
    });
    await act(async () => f.state.install());
    assert.equal(f.state.installing, false);
    assert.equal(f.state.canPrompt, false);
    assert.match(f.dom.window.document.body.textContent!, /browser menu/);
    await act(async () => {
      f.dom.window.dispatchEvent(new f.dom.window.Event('appinstalled'));
    });
    assert.doesNotMatch(
      f.dom.window.document.body.textContent!,
      /browser menu/
    );
  } finally {
    await f.close();
  }
  const standalone = await fixture({ standalone: true });
  try {
    assert.equal(standalone.state.installed, true);
    await act(async () => standalone.state.install());
    assert.equal(standalone.dom.window.document.querySelector('button'), null);
  } finally {
    await standalone.close();
  }
});
