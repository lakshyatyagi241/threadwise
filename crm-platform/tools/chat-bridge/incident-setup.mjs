// `incident-cli doctor` and `incident-cli init`: per-teammate setup of ~/.config/threadwise/incidents.env. Secrets are never printed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const DEFAULT_URL = 'https://prometheus-desk.wabo.ai';
const NAME_RE = /^[A-Za-z0-9 ._@-]{1,40}$/;
export const configPath = (env) => path.join(env.HOME ?? os.homedir(), '.config/threadwise/incidents.env');

// "Vedant (Claude)" -> "Vedant-Claude"; the bridge refuses parentheses.
export function sanitizeName(raw) {
  const base = String(raw ?? '').replace(/[^A-Za-z0-9 ._@-]+/g, ' ').trim().replace(/\s+/g, '-').replace(/^-+|-+$/g, '') || 'me';
  return (base.toLowerCase().endsWith('-claude') ? base : base.slice(0, 40 - 7) + '-Claude').slice(0, 40);
}
export const validName = (n) => NAME_RE.test(n ?? '');

// Host only: a trailing /incidents (or a slash) is removed because the CLI adds the path itself (a doubled path gave 404).
export function normalizeUrl(u) {
  const clean = String(u ?? '').trim().replace(/\/+$/, '').replace(/\/incidents$/i, '');
  return { url: clean, stripped: clean !== String(u ?? '').trim().replace(/\/+$/, '') };
}

export function parseEnvFile(text) {
  const o = {};
  for (const l of text.split('\n')) { const m = /^\s*([A-Z_]+)=(.*)$/.exec(l); if (m) o[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, '$2'); }
  return o;
}

export async function doctor(env, out, fetchImpl = fetch) {
  const file = configPath(env); let problems = 0, cfg = { ...env };
  const bad = (m) => { problems++; out(`FAIL  ${m}`); }, ok = (m) => out(`ok    ${m}`), warn = (m) => out(`WARN  ${m}`);
  try {
    const st = fs.statSync(file);
    if (st.mode & 0o077) warn(`${file} is readable by others (mode ${(st.mode & 0o777).toString(8)}): run chmod 600 ${file}`); else ok(`${file} exists, mode 600`);
    cfg = { ...parseEnvFile(fs.readFileSync(file, 'utf8')), ...Object.fromEntries(Object.entries(env).filter(([k]) => k.startsWith('INCIDENT_'))) };
  } catch { warn(`${file} not found (fine if INCIDENT_* are set in the environment); create it with: node tools/chat-bridge/incident-cli.mjs init`); }
  for (const k of ['INCIDENT_API_URL', 'INCIDENT_API_TOKEN']) if (!cfg[k]) bad(`${k} is missing`);
  const { url, stripped } = normalizeUrl(cfg.INCIDENT_API_URL);
  if (stripped) warn(`INCIDENT_API_URL must be the host only, without /incidents; using ${url}`);
  let who = cfg.INCIDENT_WHO; if (!who) try { who = execFileSync('git', ['config', 'user.name'], { encoding: 'utf8' }).trim(); } catch { who = ''; }
  if (validName(who)) ok(`name "${who}"`); else bad(`name "${who}" is not accepted (1-40 chars of letters, digits, space . _ @ -). Suggestion: INCIDENT_WHO=${sanitizeName(who)}`);
  if (!url || !cfg.INCIDENT_API_TOKEN) return 1;
  const headers = { 'x-incident-token': cfg.INCIDENT_API_TOKEN };
  if (cfg.INCIDENT_API_USER) headers.authorization = 'Basic ' + Buffer.from(`${cfg.INCIDENT_API_USER}:${cfg.INCIDENT_API_PASSWORD ?? ''}`).toString('base64');
  let r;
  try { r = await fetchImpl(url + '/incidents', { headers }); } catch (e) { bad(`cannot reach ${url} (${e?.cause?.code ?? e?.code ?? 'network error'}): check the URL, your internet or VPN; this is not a password problem`); return 1; }
  if (r.status === 401) bad('401: the login (INCIDENT_API_USER / INCIDENT_API_PASSWORD) was refused. Ask the owner to resend them.');
  else if (r.status === 403) bad('403: the login passed but INCIDENT_API_TOKEN was refused. Ask the owner to resend the token.');
  else if (r.status === 404) bad('404: wrong path. INCIDENT_API_URL must be the host only (no /incidents).');
  else if (!r.ok) bad(`the API answered ${r.status}`);
  else {
    const j = await r.json().catch(() => ({})), list = j.incidents ?? [], n = (s) => list.filter((i) => i.status === s).length;
    ok(`API reachable: ${n('open')} open, ${n('claimed')} claimed, ${n('pr_raised')} with a PR`);
    for (const i of list.filter((x) => x.owner && ['claimed', 'pr_raised'].includes(x.status))) out(`        ${i.id}  ${i.status}  owner=${i.owner}`);
  }
  out(problems ? `${problems} problem(s) to fix.` : 'All good.');
  return problems ? 1 : 0;
}

// ask(q) and askHidden(q) are injectable; hiddenFromStdin reads without echo using raw mode.
export function hiddenFromStdin(q, stdin = process.stdin, stdout = process.stdout) {
  return new Promise((resolve) => {
    stdout.write(q); let s = ''; stdin.setRawMode?.(true); stdin.resume(); stdin.setEncoding('utf8');
    const on = (c) => { for (const ch of c) { if (ch === '\r' || ch === '\n' || ch === '\u0004') { stdin.setRawMode?.(false); stdin.pause(); stdin.off('data', on); stdout.write('\n'); return resolve(s); } if (ch === '\u0003') process.exit(130); s = ch === '\u007f' ? s.slice(0, -1) : s + ch; } };
    stdin.on('data', on);
  });
}
export function plainFromStdin(q, stdin = process.stdin, stdout = process.stdout) {
  return new Promise((resolve) => { stdout.write(q); stdin.setEncoding('utf8'); stdin.resume(); stdin.once('data', (d) => { stdin.pause(); resolve(String(d).split('\n')[0].trim()); }); });
}

export async function init(env, out, ask = plainFromStdin, askHidden = hiddenFromStdin) {
  const file = configPath(env);
  const urlIn = (await ask(`API URL [${DEFAULT_URL}]: `)) || DEFAULT_URL, { url, stripped } = normalizeUrl(urlIn);
  if (stripped) out('removed the trailing /incidents (host only)');
  let gitName = ''; try { gitName = execFileSync('git', ['config', 'user.name'], { encoding: 'utf8' }).trim(); } catch { /* none */ }
  const def = sanitizeName(gitName);
  let who = (await ask(`Your name in the thread [${def}]: `)) || def;
  if (!validName(who)) { out(`"${who}" is not accepted; using ${sanitizeName(who)}`); who = sanitizeName(who); }
  const user = (await ask('Login user [incidents]: ')) || 'incidents', password = await askHidden('Login password (hidden): '), token = await askHidden('API token (hidden): ');
  if (!password || !token) { out('password and token are required; nothing written'); return 2; }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `INCIDENT_API_URL=${url}\nINCIDENT_API_USER=${user}\nINCIDENT_API_PASSWORD=${password}\nINCIDENT_API_TOKEN=${token}\nINCIDENT_WHO=${who}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  out(`wrote ${file} (mode 600). Next: node tools/chat-bridge/incident-cli.mjs doctor`);
  return 0;
}
