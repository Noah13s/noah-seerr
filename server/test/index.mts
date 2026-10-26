// Runs unit tests using the `node:test` runner.

import { Command, Option } from 'commander';
import { createWriteStream, existsSync, lstatSync, mkdirSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { run } from 'node:test';
import * as reporters from 'node:test/reporters';
import { fileURLToPath } from 'node:url';

const resolveImport = (specifier: string) =>
  fileURLToPath(import.meta.resolve(specifier));
const BASE_DIR = join(import.meta.dirname, '../..');

const program = new Command();
program
  .name('test')
  .argument('[file...]', 'Test file(s) to run (default: all)')
  .option(
    '-m, --test-name-pattern <pattern>',
    'Run tests matching the given pattern',
    (v, acc: string[]) => [...acc, v],
    [] as string[]
  )
  .option(
    '--test-reporter <reporter>',
    'Test reporter to use (repeatable)',
    (v, acc: string[]) => [...acc, v],
    [] as string[]
  )
  .option(
    '--test-reporter-destination <dest>',
    'Test reporter destination: stdout, stderr, or a file path (repeatable)',
    (v, acc: string[]) => [...acc, v],
    [] as string[]
  )
  .option(
    '--coverage, --experimental-test-coverage',
    'Enable code coverage collection'
  )
  // ignore additional options passed by vscode test runner
  .addOption(new Option('--test').hideHelp())
  .parse();

const positionals: string[] = program.args;
const opts = program.opts<{
  testNamePattern: string[];
  testReporter: string[];
  testReporterDestination: string[];
  experimentalTestCoverage: boolean;
}>();

let files: string[];

if (positionals.length > 0) {
  files = positionals.map((f) => resolve(f));
} else {
  files = [];
  for await (const entry of glob(join(BASE_DIR, 'server/**/*.test.ts'))) {
    files.push(resolve(entry));
  }
  for await (const entry of glob(join(BASE_DIR, 'src/**/*.test.ts'))) {
    files.push(resolve(entry));
  }
  files.sort((a, b) => a.localeCompare(b, 'en'));
}

Object.assign(process.env, { NODE_ENV: 'test' });
// configure ts
process.env.TS_NODE_PROJECT = resolveImport('./tsconfig.json');
process.env.TS_NODE_FILES = 'true';

// Validate/open destinations before run() starts its root test harness, so a
// rejected path fails fast with a visible error rather than an unreported event.
const reportDestinations = opts.testReporterDestination.map((destination) =>
  destination === 'stdout'
    ? process.stdout
    : destination === 'stderr'
      ? process.stderr
      : reportFile(destination)
);
const ciReport = process.env.CI
  ? reportFile(join(BASE_DIR, 'report.xml'))
  : null;

const stream = run({
  files,
  // Bound simultaneous TypeScript compiler/SQLite workers on hosted runners.
  concurrency: 2,
  execArgv: [
    '--experimental-test-module-mocks',
    '-r',
    'ts-node/register',
    '-r',
    'tsconfig-paths/register',
    '-r',
    resolveImport('./setup.ts'),
  ],
  coverage: opts.experimentalTestCoverage,
  coverageIncludeGlobs: [join(BASE_DIR, 'server/**'), join(BASE_DIR, 'src/**')],
  coverageExcludeGlobs: [
    '**/*.test.*',
    join(BASE_DIR, 'server/test/**'),
    join(BASE_DIR, 'server/migration/**'),
  ],
  testNamePatterns: opts.testNamePattern,
});

function reportFile(path: string) {
  const target = resolve(path);
  const roots = [join(BASE_DIR, 'coverage'), tmpdir()].map((root) =>
    resolve(root)
  );
  const root = roots.find((candidate) => {
    const child = relative(candidate, target);
    return (
      child !== '' &&
      !child.startsWith(`..${sep}`) &&
      child !== '..' &&
      !isAbsolute(child)
    );
  });
  if (
    (target !== resolve(BASE_DIR, 'report.xml') && !root) ||
    !['.xml', '.info', '.lcov', '.json', '.txt', '.tap', '.log'].includes(
      extname(target)
    )
  ) {
    throw new Error(
      'Test reports must use report.xml, coverage/ or the temporary directory'
    );
  }
  // A local report must never follow an output/parent symlink into source files.
  for (let entry = target; entry !== dirname(entry); entry = dirname(entry)) {
    if (existsSync(entry) && lstatSync(entry).isSymbolicLink()) {
      throw new Error('Test report paths cannot contain symbolic links');
    }
    if (entry === (root ?? BASE_DIR)) break;
  }
  if (existsSync(target) && lstatSync(target).nlink > 1) {
    throw new Error('Test report output cannot be a hard link');
  }
  mkdirSync(dirname(target), { recursive: true });
  const output = createWriteStream(target);
  output.on('error', (error) => {
    process.stderr.write(`Unable to write test report: ${error.message}\n`);
    process.exitCode = 1;
  });
  return output;
}

// run() reports child failures as events; piping a reporter alone exits zero.
// Keep the process alive to drain every reporter, but fail the CI step.
stream.on('test:fail', () => {
  process.exitCode = 1;
});
stream.on('error', (error) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`
  );
  process.exitCode = 1;
});

// In CI, write a JUnit report to a file for use by GitHub
if (ciReport) {
  stream.compose(reporters.junit).pipe(ciReport);
}

if (opts.testReporter.length > 0) {
  for (let i = 0; i < opts.testReporter.length; i++) {
    const reporterName = opts.testReporter[i];
    // check built-in reporters, otherwise import
    const reporter =
      reporterName in reporters
        ? reporters[reporterName as keyof typeof reporters]
        : await import(reporterName).then((m) => m.default);

    if (reporter == null) {
      process.stderr.write(`Invalid test reporter: ${reporterName}\n`);
      process.exit(1);
    }

    const dest = reportDestinations[i] ?? process.stdout;

    stream.compose(reporter).pipe(dest);
  }
} else {
  stream.compose(reporters.spec).pipe(process.stdout);
}
