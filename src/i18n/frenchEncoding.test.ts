import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

test('French translations retain their UTF-8 accents', () => {
  const messages: Record<string, string> = JSON.parse(
    readFileSync(join(__dirname, 'locale/fr.json'), 'utf8')
  );
  assert.ok(
    Object.values(messages).some((value) => value.includes('Découvrir'))
  );
  for (const [key, value] of Object.entries(messages)) {
    assert.doesNotMatch(
      value,
      /(?:Ã[\u0080-\u00bf\u0152\u0153\u20ac]|â[\u0080-\u00bf\u20ac])/,
      key
    );
  }
});
