import { MediaType } from '@server/constants/media';
import type { DownloadingItem } from '@server/lib/downloadtracker';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getRequestDownloadStatus } from './refreshIntervalHelper';
import {
  elapsedMinutes,
  pipelineSummary,
  requestPercent,
  requestStage,
} from './requestPipeline';

const item = (values: Partial<DownloadingItem> = {}): DownloadingItem => ({
  mediaType: MediaType.TV,
  externalId: 14,
  downloadId: 'fixture',
  status: 'downloading',
  size: 100,
  sizeLeft: 75,
  timeLeft: '',
  title: 'Fixture',
  estimatedCompletionTime: new Date(),
  ...values,
});

test('searching, metadata and import stages never present a fake transfer percentage', () => {
  for (const stage of [
    'searching',
    'metadata',
    'importing',
    'indexing',
  ] as const) {
    assert.equal(requestPercent(item({ stage })), undefined);
  }
  assert.equal(requestStage(item({ sizeLeft: 0 })), 'importing');
  assert.equal(requestPercent(item({ sizeLeft: 0 })), undefined);
  assert.equal(requestStage(item({ status: 'paused' })), 'paused');
  assert.equal(requestStage(item({ status: 'error' })), 'blocked');
});

test('transfer percentages clamp to valid bounds and reject invalid size data', () => {
  assert.equal(requestPercent(item()), 25);
  assert.equal(requestPercent(item({ sizeLeft: 200 })), 0);
  assert.equal(
    requestPercent(item({ stage: 'downloading', sizeLeft: -1 })),
    100
  );
  assert.equal(requestPercent(item({ size: 0 })), undefined);
  assert.equal(requestPercent(item({ sizeLeft: NaN })), undefined);
});

test('synthetic searches are filtered by the requested season without inventing episode zero', () => {
  const searching = item({ stage: 'searching', seasonNumber: 4, size: 0 });
  assert.deepEqual(getRequestDownloadStatus([searching], [4]), [searching]);
  assert.deepEqual(getRequestDownloadStatus([searching], [2]), []);
  assert.equal(searching.episode, undefined);
});

test('elapsed time is stable across server rendering and client hydration', () => {
  const start = Date.UTC(2026, 10, 3, 18, 49, 3);
  assert.equal(
    elapsedMinutes(
      item({
        startedAt: new Date(start).toISOString(),
        updatedAt: new Date(start + 991000).toISOString(),
      })
    ),
    16
  );
  assert.equal(elapsedMinutes(item({ startedAt: 'invalid' })), undefined);
});

test('mixed season requests show active transfer while retaining blocked details', () => {
  const blocked = item({ stage: 'blocked' }),
    active = item({ stage: 'downloading' });
  assert.equal(pipelineSummary([blocked, active]), active);
  assert.equal(pipelineSummary([]), undefined);
});
