import { Formik } from 'formik';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { IntlProvider } from 'react-intl';
import {
  ArrConnectionFields,
  ArrSelectField,
  ArrServiceOptions,
  ArrTagsField,
  arrProfileOptions,
} from './ArrFormFields';

const messages = Object.fromEntries(
  [
    'apiKey',
    'apiKeyHelp',
    'baseUrl',
    'baseUrlHelp',
    'default4kserver',
    'defaultserver',
    'enableSearch',
    'enableSearchHelp',
    'externalUrl',
    'externalUrlHelp',
    'hostname',
    'port',
    'server4k',
    'server4kHelp',
    'servername',
    'ssl',
    'syncEnabled',
    'syncEnabledHelp',
    'tagRequests',
    'tagRequestsInfo',
  ].map((key) => [key, { id: key, defaultMessage: key }])
) as ComponentProps<typeof ArrConnectionFields>['messages'];

test('shared Arr connection fields retain saved values, errors and password protection', () => {
  const html = renderToStaticMarkup(
    createElement(
      IntlProvider,
      { locale: 'en' },
      createElement(
        Formik,
        {
          initialValues: {
            name: 'Fixture',
            hostname: 'localhost',
            port: 8989,
            ssl: true,
            apiKey: 'fixture',
            baseUrl: '/sonarr',
            externalUrl: '',
            is4k: true,
            isDefault: true,
            enableSearch: true,
            syncEnabled: true,
            tagRequests: false,
          },
          initialErrors: { hostname: 'Invalid hostname' },
          initialTouched: { hostname: true },
          onSubmit: () => {},
        },
        createElement(
          'div',
          null,
          createElement(ArrConnectionFields, {
            messages,
            onConnectionEdit: () => {},
          }),
          createElement(ArrServiceOptions, { messages })
        )
      )
    )
  );
  for (const name of [
    'name',
    'hostname',
    'port',
    'ssl',
    'apiKey',
    'baseUrl',
    'isDefault',
    'is4k',
    'externalUrl',
    'enableSearch',
    'syncEnabled',
    'tagRequests',
  ]) {
    assert.match(html, new RegExp('id="' + name + '"'));
    assert.match(html, new RegExp('for="' + name + '"'));
  }
  assert.match(html, /type="password"/);
  assert.match(html, /value="8989"/);
  assert.match(html, /https:\/\//);
  assert.match(html, /Invalid hostname/);
  assert.match(html, />default4kserver</);
});

test('Arr profile sorting is numeric, case insensitive and does not mutate the response', () => {
  const profiles = Object.freeze([
    { id: 10, name: 'profile 10' },
    { id: 2, name: 'Profile 2' },
  ]);
  assert.deepEqual(
    arrProfileOptions(profiles, 'en').map((p) => p.value),
    [2, 10]
  );
  assert.deepEqual(
    profiles.map((p) => p.id),
    [10, 2]
  );
});

test('shared anime selectors preserve string paths, optional fields and disabled state', () => {
  const html = renderToStaticMarkup(
    createElement(
      Formik,
      {
        initialValues: { activeAnimeRootFolder: '/media/anime' },
        onSubmit: () => {},
      },
      createElement(ArrSelectField, {
        name: 'activeAnimeRootFolder',
        label: 'Anime root',
        placeholder: 'Test first',
        disabled: true,
        options: [{ value: '/media/anime', label: '/media/anime' }],
      })
    )
  );
  assert.match(html, /disabled=""/);
  assert.match(html, /value="\/media\/anime" selected=""/);
  assert.doesNotMatch(html, /label-required/);
});

test('standard and anime tags retain separate accessible inputs and selections', () => {
  const tags = [
    { id: 1, label: 'Standard group' },
    { id: 2, label: 'Anime group' },
  ];
  const html = renderToStaticMarkup(
    createElement(
      IntlProvider,
      { locale: 'en' },
      createElement(
        Formik,
        {
          initialValues: { tags: [1], animeTags: [2] },
          onSubmit: () => {},
        },
        createElement(
          'div',
          null,
          ...['tags', 'animeTags'].map((name) =>
            createElement(ArrTagsField, {
              key: name,
              name,
              label: name,
              tags,
              disabled: false,
              loading: false,
              placeholder: 'Select',
              noOptionsLabel: 'No tags',
            })
          )
        )
      )
    )
  );
  assert.match(html, /for="tags"/);
  assert.match(html, /id="tags"/);
  assert.match(html, /for="animeTags"/);
  assert.match(html, /id="animeTags"/);
  assert.match(html, /name="tags"[^>]*value="1"/);
  assert.match(html, /name="animeTags"[^>]*value="2"/);
});
