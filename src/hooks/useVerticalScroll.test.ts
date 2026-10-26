import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import useVerticalScroll from './useVerticalScroll';

test('scroll listeners keep current props and cancel queued work on unmount', async (t) => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  t.after(() => {
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  Object.defineProperty(dom.window.document.documentElement, 'offsetHeight', {
    value: 2000,
  });
  Object.defineProperty(dom.window, 'innerHeight', { value: 600 });
  Object.defineProperty(dom.window, 'pageYOffset', {
    value: 0,
    writable: true,
  });
  const add = t.mock.method(dom.window, 'addEventListener');
  const remove = t.mock.method(dom.window, 'removeEventListener');
  const root = createRoot(dom.window.document.getElementById('root')!);
  const calls: string[] = [];
  let scrolling = false;
  function Probe({ name, enabled }: { name: string; enabled: boolean }) {
    scrolling = useVerticalScroll(() => {
      calls.push(name);
    }, enabled);
    return null;
  }
  await act(async () => {
    root.render(createElement(Probe, { name: 'old', enabled: true }));
  });
  await act(async () => {
    dom.window.dispatchEvent(new dom.window.Event('scroll'));
  });
  assert.equal(scrolling, true);
  await act(async () => {
    root.render(createElement(Probe, { name: 'current', enabled: true }));
  });
  Reflect.set(dom.window, 'pageYOffset', 1500);
  await act(async () => {
    t.mock.timers.tick(60);
  });
  assert.deepEqual(calls, ['current']);
  assert.equal(
    add.mock.calls.filter(({ arguments: args }) => args[0] === 'scroll').length,
    1
  );
  await act(async () => {
    root.render(createElement(Probe, { name: 'disabled', enabled: false }));
  });
  await act(async () => {
    dom.window.dispatchEvent(new dom.window.Event('resize'));
    t.mock.timers.tick(250);
  });
  assert.equal(scrolling, false);
  assert.deepEqual(calls, ['current']);
  Reflect.set(dom.window, 'pageYOffset', 0);
  await act(async () => {
    root.render(createElement(Probe, { name: 'unmounted', enabled: true }));
  });
  await act(async () => {
    dom.window.dispatchEvent(new dom.window.Event('scroll'));
  });
  Reflect.set(dom.window, 'pageYOffset', 1500);
  await act(async () => {
    root.unmount();
    t.mock.timers.tick(300);
  });
  assert.deepEqual(calls, ['current']);
  const addedScroll = add.mock.calls.find(
    ({ arguments: args }) => args[0] === 'scroll'
  )!.arguments[1];
  assert.ok(
    remove.mock.calls.some(
      ({ arguments: args }) => args[0] === 'scroll' && args[1] === addedScroll
    )
  );
});
