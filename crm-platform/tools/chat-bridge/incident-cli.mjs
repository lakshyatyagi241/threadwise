#!/usr/bin/env node
// Team incident CLI: node incident-cli.mjs list [status] | show <id> | claim <id> | release-claim <id> | pr <id> <url> "<summary>" | note <id> "<text>"
// Config from env INCIDENT_API_URL, INCIDENT_API_USER, INCIDENT_API_PASSWORD, INCIDENT_API_TOKEN or ~/.config/threadwise/incidents.env (KEY=VALUE, mode 600).
// Identity: INCIDENT_WHO or `git config user.name`. Secrets are never printed. Exit 0 ok, 1 refused/failed, 2 usage/config.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export async function run(argv, env = process.env, out = console.log) {
  const file = path.join(env.HOME ?? os.homedir(), '.config/threadwise/incidents.env'), cfg = { ...env };
  try {
    if (fs.statSync(file).mode & 0o077) { out(`refusing to read ${file}: chmod 600 it`); return 2; }
    for (const l of fs.readFileSync(file, 'utf8').split('\n')) { const m = /^\s*([A-Z_]+)=(.*)$/.exec(l); if (m && cfg[m[1]] == null) cfg[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, '$2'); }
  } catch { /* file optional when env is set */ }
  const [cmd, id, a, b] = argv;
  const who = cfg.INCIDENT_WHO || (() => { try { return execFileSync('git', ['config', 'user.name'], { encoding: 'utf8' }).trim(); } catch { return ''; } })();
  if (!cfg.INCIDENT_API_URL || !cfg.INCIDENT_API_TOKEN) { out(`missing INCIDENT_API_URL / INCIDENT_API_TOKEN (set them or fill ${file})`); return 2; }
  const route = { list: ['GET', '/incidents' + (id ? `?status=${encodeURIComponent(id)}` : '')], show: ['GET', `/incidents/${id}`], claim: ['POST', `/incidents/${id}/claim`, {}], 'release-claim': ['POST', `/incidents/${id}/release-claim`, {}], pr: ['POST', `/incidents/${id}/pr`, { url: a, summary: b }], note: ['POST', `/incidents/${id}/note`, { text: a }] }[cmd];
  if (!route || (cmd !== 'list' && !/^[A-Za-z0-9-]{1,64}$/.test(id ?? '')) || (cmd === 'pr' && !(a && b)) || (cmd === 'note' && !a)) { out('usage: incident-cli list [status] | show <id> | claim <id> | release-claim <id> | pr <id> <url> "<summary>" | note <id> "<text>"'); return 2; }
  if (route[2] && !who) { out('no identity: set INCIDENT_WHO or git config user.name'); return 2; }
  const headers = { 'x-incident-token': cfg.INCIDENT_API_TOKEN, 'content-type': 'application/json' };
  if (cfg.INCIDENT_API_USER) headers.authorization = 'Basic ' + Buffer.from(`${cfg.INCIDENT_API_USER}:${cfg.INCIDENT_API_PASSWORD ?? ''}`).toString('base64');
  let r;
  try { r = await fetch(cfg.INCIDENT_API_URL.replace(/\/+$/, '') + route[1], { method: route[0], headers, body: route[2] ? JSON.stringify({ ...route[2], who }) : undefined }); } catch (e) { out(`cannot reach the incident API: ${e?.cause?.code ?? e?.code ?? 'error'}`); return 1; }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { out(`refused (${r.status}): ${j.error ?? 'error'}${j.owner ? ` (owner: ${j.owner})` : ''}`); return 1; }
  if (cmd === 'list') for (const i of j.incidents) out(`${i.id}  ${i.status.padEnd(9)}  ${i.playbook}  owner=${i.owner ?? '-'}  ${i.prUrl ?? ''}`);
  else out(JSON.stringify(j, null, 2));
  return 0;
}
if (import.meta.url === `file://${process.argv[1]}`) process.exit(await run(process.argv.slice(2)));
