#!/usr/bin/env node
/* Fake `ssh` for the cycle.cjs tests. The remote command (last argv) really runs under `sh -c` here, in a sandbox: /opt/desk is mapped to
   $FAKE_REMOTE_ROOT, `chown` is a no-op and `docker` is a shim that records its argv (FAKE_DOCKER_LOG) and prints FAKE_DOCKER_OUT
   (exit FAKE_DOCKER_RC). `docker compose ... exec ... desk-backup once` creates a dump of today; `pg_restore --list` lists 3 entries. */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const argv = process.argv.slice(2);
const cmd = argv[argv.length - 1];
const root = process.env.FAKE_REMOTE_ROOT.replace(/\\/g, '/');
if (process.env.FAKE_SSH_LOG)
  fs.appendFileSync(process.env.FAKE_SSH_LOG, JSON.stringify({ argv }) + '\n');
const shim = path.join(root, '.shim');
fs.mkdirSync(shim, { recursive: true });
fs.writeFileSync(path.join(shim, 'chown'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
fs.writeFileSync(
  path.join(shim, 'docker'),
  `#!/usr/bin/env node
const fs = require('fs');
const a = process.argv.slice(2);
if (process.env.FAKE_DOCKER_LOG) fs.appendFileSync(process.env.FAKE_DOCKER_LOG, JSON.stringify(a) + '\\n');
if (a.includes('desk-backup')) {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  fs.mkdirSync('backups', { recursive: true });
  fs.writeFileSync('backups/desk-' + a[a.indexOf('once') + 1] + '-' + d + 'T010101Z.dump', Buffer.alloc(20000));
  console.log('backup: ok');
} else if (a.includes('pg_restore')) console.log('; header\\n1; 1 TABLE a\\n2; 2 TABLE b\\n3; 3 TABLE c');
else console.log(process.env.FAKE_DOCKER_OUT || 'done: org 1 (dry run, rolled back)');
process.exit(Number(process.env.FAKE_DOCKER_RC || 0));
`,
  { mode: 0o755 },
);
const sh = spawn('sh', ['-c', cmd.split('/opt/desk').join(root)], {
  stdio: ['pipe', 'inherit', 'inherit'],
  env: { ...process.env, PATH: shim + path.delimiter + process.env.PATH },
});
sh.stdin.on('error', () => {});
process.stdin.pipe(sh.stdin);
sh.on('close', (c) => process.exit(c === null ? 255 : c));
