import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanupReturnPath } from './cleanupReturnPath';

test('login returns to cleanup review without allowing external redirects', () => {
  const url =
    '/admin-tools?review=12345678-1234-1234-1234-123456789abc&intent=keep';
  assert.equal(cleanupReturnPath(url), url);
  assert.equal(cleanupReturnPath('https://evil.example/' + url), '/');
  assert.equal(cleanupReturnPath('//evil.example/admin-tools'), '/');
});
