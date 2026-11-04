import { readFrontendBuildId } from '@server/utils/appVersion';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

test('frontend identity comes from the deployed Next build and fails safely when unavailable', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'frontend-build-'));
  const file = path.join(directory, 'BUILD_ID');
  try {
    assert.equal(readFrontendBuildId(file, true), undefined);
    for (const value of ['', '../bad', 'development']) {
      await writeFile(file, value);
      assert.equal(readFrontendBuildId(file, true), undefined);
    }
    await writeFile(file, 'deployed-build_1\n');
    assert.equal(readFrontendBuildId(file, true), 'deployed-build_1');
    assert.equal(readFrontendBuildId(file, false), undefined);
  } finally {
    await rm(directory, { recursive: true });
  }
});
