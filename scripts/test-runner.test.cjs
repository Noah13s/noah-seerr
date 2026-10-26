const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

// Exercise the real entrypoint, including its TS preload and reporters. The
// deliberately failing fixture must never be discovered by the main suite.
for (const fails of [false, true]) {
  test(`test runner propagates ${fails ? 'failure' : 'success'} to its exit status`, () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'seerr-runner-'));
    try {
      const fixture = path.join(dir, 'fixture.test.ts');
      writeFileSync(
        fixture,
        `const { test } = require('node:test');\ntest('runner fixture', () => { ${fails ? "throw Error('intentional-runner-fixture');" : ''} });\n`
      );
      const env = { ...process.env, CI: '', NODE_ENV: 'test' };
      // A standalone runner must not inherit node:test's child-process marker.
      delete env.NODE_TEST_CONTEXT;
      const result = spawnSync(
        process.execPath,
        ['server/test/index.mts', fixture],
        {
          cwd: path.resolve(__dirname, '..'),
          env,
          encoding: 'utf8',
          timeout: 45000,
        }
      );
      assert.ifError(result.error);
      assert.equal(result.signal, null, result.stderr);
      assert.match(result.stdout, /runner fixture/);
      assert.equal(result.status, fails ? 1 : 0, result.stdout + result.stderr);
      if (fails) assert.match(result.stdout, /intentional-runner-fixture/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

for (const flag of ['--coverage', '--experimental-test-coverage']) {
  test(`runner ${flag} creates nested LCOV output and excludes test code`, () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'seerr-coverage-'));
    try {
      const fixture = path.join(dir, 'fixture.test.ts');
      writeFileSync(
        fixture,
        "const {test}=require('node:test'); test('coverage fixture',()=>{});\n"
      );
      const report = path.join(dir, 'nested', 'lcov.info');
      const env = { ...process.env, CI: '', NODE_ENV: 'test' };
      delete env.NODE_TEST_CONTEXT;
      const result = spawnSync(
        process.execPath,
        [
          'server/test/index.mts',
          fixture,
          flag,
          '--test-reporter',
          'spec',
          '--test-reporter',
          'lcov',
          '--test-reporter-destination',
          'stdout',
          '--test-reporter-destination',
          report,
        ],
        {
          cwd: path.resolve(__dirname, '..'),
          env,
          encoding: 'utf8',
          timeout: 45000,
        }
      );
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /start of coverage report/);
      assert.ok(existsSync(report));
      assert.doesNotMatch(readFileSync(report, 'utf8'), /SF:.*\.test\.ts/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
