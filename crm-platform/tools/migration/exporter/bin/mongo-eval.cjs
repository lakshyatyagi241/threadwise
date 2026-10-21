#!/usr/bin/env node
'use strict';
// Read-only: runs ONE of the fixed queries in ../lib/queries.cjs on the jump host and prints its result.
//   node mongo-eval.cjs --query core|expenses|wa --workspace <waboo database name>
// Same setup as mongo-export.cjs (MONGO_EXPORT_ENV or <kit>/.env, SSH_BIN). The connection string goes to the jump host on stdin only
// and is scrubbed from everything printed. Exit: 0 ok, 1 failure, 2 refused, 4 host key not trusted.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { QUERIES } = require('../lib/queries.cjs');

const KIT = path.resolve(__dirname, '..');
const a = process.argv.slice(2);
const flag = (n) => (a.includes(`--${n}`) ? a[a.indexOf(`--${n}`) + 1] : undefined);
const fail = (code, msg) => {
  console.error(msg);
  process.exit(code);
};
const query = flag('query');
const ws = flag('workspace');
if (!Object.prototype.hasOwnProperty.call(QUERIES, query || ''))
  fail(2, `usage: mongo-eval.cjs --query ${Object.keys(QUERIES).join('|')} --workspace <db>`);
if (!ws || !/^[A-Za-z0-9_+.-]{1,128}$/.test(ws)) fail(2, 'not a valid --workspace');

const envFile = process.env.MONGO_EXPORT_ENV || path.join(KIT, '.env');
if (!fs.existsSync(envFile)) fail(2, `the environment file ${envFile} does not exist`);
const env = {};
for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2');
}
for (const k of ['JUMP_HOST', 'JUMP_USER', 'PEM_PATH', 'MONGO_URI'])
  if (!env[k]) fail(2, `${envFile} is missing ${k}`);

const secrets = [env.MONGO_URI];
try {
  const u = new URL(env.MONGO_URI);
  for (const v of [u.password, decodeURIComponent(u.password), u.username, u.host])
    if (v && v.length >= 3) secrets.push(v);
} catch {
  /* redacted whole */
}
secrets.sort((x, y) => y.length - x.length);
const scrub = (t) => {
  let s = String(t);
  for (const x of secrets) s = s.split(x).join('***');
  return s.replace(/mongodb(\+srv)?:\/\/[^\s'"]+/g, '***');
};

const { db, expr } = QUERIES[query](ws);
const q = JSON.stringify;
const script = `const conn = connect(${q(env.MONGO_URI)}); const db = conn.getSiblingDB(${q(db)}); print(${expr.replace(/\n/g, ' ')});\n`;
const r = spawnSync(
  process.env.SSH_BIN || 'ssh',
  [
    '-i',
    path.resolve(path.dirname(envFile), env.PEM_PATH),
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-o',
    'BatchMode=yes',
    `${env.JUMP_USER}@${env.JUMP_HOST}`,
    'mongosh --nodb --quiet',
  ],
  { input: script, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 120000 },
);
const err = scrub(r.stderr || '');
if (/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/.test(err))
  fail(
    4,
    'Host key verification failed. Do NOT bypass this: confirm the jump host fingerprint with its owner first.',
  );
// the data is not run through the secret scrub (it would blank a business name that contains the Mongo user name): only a connection string is removed
process.stdout.write(String(r.stdout || '').replace(/mongodb(\+srv)?:\/\/[^\s'"]+/g, '***'));
if (r.status !== 0) fail(1, err.trim().slice(0, 500));
