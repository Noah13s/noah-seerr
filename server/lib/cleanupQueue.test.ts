import type { CleanupQueueRecord } from '@server/lib/cleanupQueue';
import { cleanupQueueBlocks } from '@server/lib/cleanupQueue';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const retained: CleanupQueueRecord = {
  seriesId: 14,
  episodeId: 609,
  downloadId: 'old-pack',
  status: 'completed',
  sizeleft: 0,
  trackedDownloadState: 'importBlocked',
};
const episodes = [{ id: 609, episodeFileId: 302 }];
const blocks = (records: CleanupQueueRecord[], files = episodes) =>
  cleanupQueueBlocks(
    { totalRecords: records.length, records },
    'sonarr',
    14,
    files
  );

test('a rejected, completed pack with all expected episodes already imported does not block cleanup', () => {
  assert.equal(
    blocks(
      [retained, { ...retained, episodeId: 610 }],
      [...episodes, { id: 610, episodeFileId: 303 }]
    ),
    false
  );
});

test('fresh missing-file evidence overrides an old completed queue entry', () => {
  assert.equal(blocks([retained], [{ id: 609, episodeFileId: 0 }]), true);
  assert.equal(blocks([retained], []), true);
});

test('one missing or unidentified episode keeps the whole pack protected', () => {
  assert.equal(blocks([retained, { ...retained, episodeId: 610 }]), true);
  assert.equal(blocks([{ ...retained, episodeId: undefined }]), true);
  assert.equal(blocks([{ ...retained, downloadId: undefined }]), true);
});

test('active downloads, imports and upgrades still block deletion', () => {
  for (const change of [
    { status: 'downloading' },
    { sizeleft: 1 },
    { trackedDownloadState: 'importPending' },
    { trackedDownloadState: 'importing' },
    { trackedDownloadState: undefined },
  ]) {
    assert.equal(blocks([{ ...retained, ...change }]), true);
  }
});

test('a new active upgrade is not hidden behind a retained blocked replacement', () => {
  assert.equal(
    blocks([
      retained,
      { ...retained, downloadId: 'new-pack', status: 'downloading' },
    ]),
    true
  );
});

test('a shared pack containing a different series remains protected', () => {
  assert.equal(blocks([retained, { ...retained, seriesId: 15 }]), true);
});

test('unrelated series downloads do not block this series', () => {
  assert.equal(blocks([{ seriesId: 15, status: 'downloading' }]), false);
});

test('truncated or malformed queue evidence fails closed', () => {
  for (const totalRecords of [2, -1, 0.5, Number.NaN]) {
    assert.equal(
      cleanupQueueBlocks(
        { totalRecords, records: [retained] },
        'sonarr',
        14,
        episodes
      ),
      true
    );
  }
  assert.equal(
    cleanupQueueBlocks(
      { totalRecords: 0, records: null! },
      'sonarr',
      14,
      episodes
    ),
    true
  );
});

test('movie downloads retain their existing deletion protection', () => {
  assert.equal(
    cleanupQueueBlocks(
      { totalRecords: 1, records: [{ movieId: 10 }] },
      'radarr',
      10
    ),
    true
  );
  assert.equal(
    cleanupQueueBlocks({ totalRecords: 0, records: [] }, 'radarr', 10),
    false
  );
});

test('work for a known different season cannot block deletion of this season', () => {
  const files = [
    { id: 609, episodeFileId: 0, seasonNumber: 2 },
    { id: 700, episodeFileId: 400, seasonNumber: 3 },
  ];
  for (const record of [retained, { ...retained, status: 'downloading' }]) {
    assert.equal(
      cleanupQueueBlocks(
        { totalRecords: 1, records: [record] },
        'sonarr',
        14,
        files,
        [700]
      ),
      false
    );
  }
  // A new episode in the target season is relevant even outside reviewed files.
  files.push({ id: 701, episodeFileId: 0, seasonNumber: 3 });
  assert.equal(
    cleanupQueueBlocks(
      { totalRecords: 1, records: [{ ...retained, episodeId: 701 }] },
      'sonarr',
      14,
      files,
      [700]
    ),
    true
  );
});

test('unknown identities, target scope and multi-season packs stay protected', () => {
  const files = [
    { id: 609, episodeFileId: 0, seasonNumber: 2 },
    { id: 700, episodeFileId: 400, seasonNumber: 3 },
  ];
  for (const records of [
    [retained, { ...retained, episodeId: 700 }],
    [retained, { ...retained, episodeId: 999 }],
    [{ ...retained, episodeId: undefined }],
  ]) {
    assert.equal(
      cleanupQueueBlocks(
        { totalRecords: records.length, records },
        'sonarr',
        14,
        files,
        [700]
      ),
      true
    );
  }
  assert.equal(
    cleanupQueueBlocks(
      { totalRecords: 1, records: [retained] },
      'sonarr',
      14,
      files,
      [999]
    ),
    true
  );
});
