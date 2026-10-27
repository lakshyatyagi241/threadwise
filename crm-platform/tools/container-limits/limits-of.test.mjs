import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const limits = (service) =>
  JSON.parse(
    execFileSync(process.execPath, [
      new URL('./limits-of.mjs', import.meta.url).pathname,
      new URL('../../deploy/hostinger/docker-compose.yml', import.meta.url).pathname,
      service,
    ]),
  );

test('every service the container test starts has a memory, CPU and PID limit in the compose file that ships', () => {
  for (const s of ['api-blue', 'api-green', 'worker', 'web-blue', 'web-green']) {
    const l = limits(s);
    assert.ok(l.memoryBytes > 0 && l.cpus > 0 && l.pids > 0, `${s}: ${JSON.stringify(l)}`);
  }
});
test('no CPU cap is above the 4 cores of the host (Docker refuses to start such a container)', () => {
  for (const s of [
    'api-blue',
    'worker',
    'web-blue',
    'postgres',
    'redis',
    'backup',
    'offsite',
    'api-hooks',
  ])
    assert.ok(limits(s).cpus <= 4, s);
});
