#!/usr/bin/env node
// Stops and deletes leftover throwaway Postgres clusters / Redis servers made by the Docker-free test layer
// (test/support/no-docker). Everything it owns is named tc_nodocker_* under /tmp in the WSL distro; the shared dev cluster
// (16/main, port 55710) is never touched.
//   node scripts/test-no-docker-clean.mjs          remove leftovers older than 3 h (the layer also does this on every start)
//   node scripts/test-no-docker-clean.mjs --all    remove ALL of them (use when no test run is in progress)
//   node scripts/test-no-docker-clean.mjs --list   show what exists
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const script = readFileSync(resolve(here, '../test/support/no-docker/wsl-ctl.sh'), 'utf8').replace(
  /\r/g,
  '',
);
const distro = process.env.TEST_NO_DOCKER_DISTRO ?? 'Ubuntu-24.04';
const flag = process.argv[2];
const args = flag === '--list' ? ['list'] : flag === '--all' ? ['clean', '--all'] : ['clean'];
const r = spawnSync(
  'wsl.exe',
  ['-d', distro, '-u', 'root', '--exec', 'bash', '-s', '--', ...args],
  {
    input: script,
    encoding: 'utf8',
    env: { ...process.env, WSL_UTF8: '1' },
  },
);
process.stdout.write((r.stdout ?? '').replace(/\0/g, ''));
process.stderr.write((r.stderr ?? '').replace(/\0/g, ''));
process.exit(r.status ?? 1);
