import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { check } from './check.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('repo passes', () => assert.deepEqual(check(root).problems, []));

test('a service missing from the matrix, and a missing healthcheck, are caught', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-'));
  fs.cpSync(path.join(root, 'deploy'), path.join(tmp, 'deploy'), { recursive: true });
  fs.cpSync(path.join(root, 'docs/runbooks'), path.join(tmp, 'docs/runbooks'), { recursive: true });
  fs.cpSync(path.join(root, 'docs/performance/event-loop'), path.join(tmp, 'docs/performance/event-loop'), { recursive: true });
  for (const f of ['packages/observability/src/db-saturation.ts', 'apps/api/src/infra/db/database.service.ts']) {
    fs.mkdirSync(path.dirname(path.join(tmp, f)), { recursive: true });
    fs.copyFileSync(path.join(root, f), path.join(tmp, f));
  }
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(tmp, 'node_modules'));
  fs.mkdirSync(path.join(tmp, 'docs/performance/health'), { recursive: true });
  const m = JSON.parse(fs.readFileSync(path.join(root, 'docs/performance/health/coverage-matrix.json'), 'utf8'));
  delete m.services.redis;
  m.services.worker = { ...m.services.worker, exempt: undefined };
  fs.writeFileSync(path.join(tmp, 'docs/performance/health/coverage-matrix.json'), JSON.stringify(m));
  const f = path.join(tmp, 'deploy/hostinger/docker-compose.yml');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('interval: 30s\n      timeout: 5s', 'interval: 30s\n      timeout: 40s'));
  const p = check(tmp).problems.join('\n');
  assert.match(p, /redis .*not in coverage-matrix/);
  assert.match(p, /worker: healthcheck timeout 40s/);
  fs.rmSync(tmp, { recursive: true, force: true });
});
