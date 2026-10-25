// Run inside the newly built image with --network none and disposable config.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

async function main() {
  assert.notEqual(
    process.getuid(),
    0,
    'Runtime must use the unprivileged node user'
  );
  for (const path of [
    '/app/src',
    '/app/server',
    '/app/.git',
    '/app/.env',
    '/app/cypress',
  ]) {
    assert.equal(
      fs.existsSync(path),
      false,
      `Unexpected source or secret path: ${path}`
    );
  }
  await import('/app/dist/lib/native-playback-session.cjs');
  const deadline = Date.now() + 60_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      await new Promise((resolve, reject) => {
        const request = http.get(
          'http://127.0.0.1:5055/api/v1/settings/public',
          (response) => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', (chunk) => {
              body += chunk;
            });
            response.on('end', () => {
              try {
                assert.equal(response.statusCode, 200);
                assert.equal(typeof JSON.parse(body).initialized, 'boolean');
                resolve();
              } catch (error) {
                reject(error);
              }
            });
            response.on('error', reject);
          }
        );
        request.setTimeout(2000, () =>
          request.destroy(new Error('Public settings deadline'))
        );
        request.on('error', reject);
      });
      process.stdout.write(
        'PASS: non-root production image starts with isolated configuration and contains no source tree\n'
      );
      return;
    } catch (error) {
      lastError = error;
      await delay(500);
    }
  }
  throw lastError || new Error('Production startup deadline exceeded');
}
main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
