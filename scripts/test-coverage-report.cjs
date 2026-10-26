const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const c8 = path.join(root, 'node_modules/c8/bin/c8.js');

function collect(reportDir, testFile) {
  const env = { ...process.env, CI: '', NODE_ENV: 'test' };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(
    process.execPath,
    [
      c8,
      '--config',
      '.c8rc.json',
      '--reports-dir',
      reportDir,
      '--temp-directory',
      path.join(reportDir, 'raw'),
      process.execPath,
      'server/test/index.mts',
      testFile,
    ],
    { cwd: root, env, encoding: 'utf8', timeout: 90000 }
  );
}

test('CI coverage maps a transpiled function back to its original TypeScript line', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'seerr-mapped-coverage-'));
  try {
    const result = collect(
      dir,
      'src/components/RequestButton/requestActions.test.ts'
    );
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const lcov = readFileSync(path.join(dir, 'lcov.info'), 'utf8');
    const source = readFileSync(
      path.join(root, 'src/components/RequestButton/requestActions.ts'),
      'utf8'
    );
    const sourceLine =
      source
        .split('\n')
        .findIndex((line) =>
          line.startsWith('export async function updateRequestBatch')
        ) + 1;
    // ts-node emits this at a different line. The old native LCOV reported FN:1.
    assert.match(lcov, new RegExp(`FN:${sourceLine},updateRequestBatch`));
    assert.doesNotMatch(lcov, /SF:.*(?:\.test\.|server[/\\]test[/\\])/);
    assert.doesNotMatch(lcov, /FN:undefined/);
    let current;
    for (const row of lcov.split('\n')) {
      if (row.startsWith('SF:')) current = row.slice(3);
      if (!row.startsWith('DA:')) continue;
      const lines = readFileSync(path.resolve(root, current), 'utf8').split(
        '\n'
      ).length;
      assert.ok(
        Number(row.slice(3).split(',')[0]) <= lines,
        `${current}: ${row}`
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('coverage collection preserves the underlying test failure', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'seerr-failed-coverage-'));
  try {
    const fixture = path.join(dir, 'failure.test.ts');
    writeFileSync(
      fixture,
      "const {test}=require('node:test'); test('expected failure',()=>{ throw new Error('coverage-exit-check'); });\n"
    );
    const result = collect(path.join(dir, 'report'), fixture);
    assert.ifError(result.error);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout + result.stderr, /coverage-exit-check/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
