// node --test script-testing/_lib/master.test.mjs
import test from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
test('master --self-test passes', () => {
  const r = spawnSync('node', [fileURLToPath(new URL('./master.mjs', import.meta.url)), '--self-test'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});
