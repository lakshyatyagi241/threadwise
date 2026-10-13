#!/usr/bin/env node
/* Fake `ssh` to the STAGING server for the --to-ssh tests. The last argv is the remote command; it is run with `sh -c` on this machine
   with /opt/desk/migration/dumps mapped to $FAKE_REMOTE_ROOT and `chown` as a no-op. FAKE_SINK_MODE: die-mid | corrupt. */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const argv = process.argv.slice(2);
const cmd = argv[argv.length - 1];
const root = process.env.FAKE_REMOTE_ROOT.replace(/\\/g, '/');
if (process.env.FAKE_SINK_LOG)
  fs.appendFileSync(process.env.FAKE_SINK_LOG, JSON.stringify({ argv }) + '\n');
const shim = path.join(root, '.shim');
fs.mkdirSync(shim, { recursive: true });
fs.writeFileSync(path.join(shim, 'chown'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
const mode = process.env.FAKE_SINK_MODE;
const streaming = /cat > '[^']*\.part'/.test(cmd) && !cmd.includes('sha256sum');
const sh = spawn('sh', ['-c', cmd.split('/opt/desk/migration/dumps').join(root)], {
  stdio: ['pipe', 'inherit', 'inherit'],
  env: { ...process.env, PATH: shim + path.delimiter + process.env.PATH },
});
sh.stdin.on('error', () => {});
let first = true;
process.stdin.on('data', (c) => {
  if (streaming && mode === 'die-mid' && !first) return;
  sh.stdin.write(c);
  if (streaming && mode === 'die-mid') {
    first = false;
    setTimeout(() => {
      sh.kill();
      process.exit(255);
    }, 150);
  }
});
process.stdin.on('end', () => {
  if (streaming && mode === 'corrupt') sh.stdin.write('x');
  sh.stdin.end();
});
sh.on('close', (c) => process.exit(c === null ? 255 : c));
