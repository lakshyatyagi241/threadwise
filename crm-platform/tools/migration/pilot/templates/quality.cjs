#!/usr/bin/env node
'use strict';
/**
 * Template quality for a migrated workspace. Waboo never stored a template's quality (Meta rates it live), so the migration asks Meta
 * once per WABA: GET /{waba-id}/message_templates. Read-only: nothing is sent and no number is connected. The WABA id and access token
 * are read from Waboo into memory here; they are never printed or written. The output holds template names, languages and ratings only.
 *
 *   node pilot/templates/quality.cjs --client <c> --db <waboo database>      (run from tools/migration)
 *
 * Prints ONE JSON line: {"client","wabas","failedWabas","skipped","rows":[{"name","language","quality"}]}.
 * A WABA Meta refuses is counted in failedWabas and does not stop the run: its templates keep Unknown until a Refresh.
 */
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const GRAPH = process.env.META_API_VERSION || 'v25.0';
const LEVELS = new Set(['GREEN', 'YELLOW', 'RED', 'UNKNOWN']);
/** The older names of the same three levels, read as their colour (Meta now says GREEN, YELLOW, RED). */
const LEGACY = { HIGH: 'GREEN', MEDIUM: 'YELLOW', LOW: 'RED' };

/** The rating as Desk stores it: Meta's word, uppercase (GREEN, YELLOW, RED, UNKNOWN). Anything else (missing, unknown word) is UNKNOWN. */
function normalizeQuality(q) {
  const s = typeof q === 'string' ? q : q && typeof q === 'object' ? q.score : null;
  const u = typeof s === 'string' ? s.trim().toUpperCase() : '';
  const word = LEGACY[u] || u;
  return LEVELS.has(word) ? word : 'UNKNOWN';
}

/**
 * The distinct (WABA id, access token) pairs of the workspace's live WhatsApp configs (`docs` as the `waba` query returns them). A config
 * that is deleted or inactive, or has no token or no WABA id, is left out. The import tool refuses such a config too.
 */
function wabaCredentials(docs) {
  const byWaba = new Map();
  const skipped = { inactive: 0, incomplete: 0 };
  for (const doc of docs) {
    if (doc.deleted_time != null || doc.is_active === false) {
      skipped.inactive++;
      continue;
    }
    let v = doc.config_value;
    if (typeof v === 'string' && doc.is_json === true) {
      try {
        v = JSON.parse(v);
      } catch {
        v = null;
      }
    }
    const obj = v !== null && typeof v === 'object' && !Array.isArray(v) ? v : null;
    const token = obj && typeof obj.access_token === 'string' ? obj.access_token : '';
    const waba = obj && obj.waba_id != null ? String(obj.waba_id) : '';
    if (!token || !/^\d{5,32}$/.test(waba)) {
      skipped.incomplete++;
      continue;
    }
    if (!byWaba.has(waba)) byWaba.set(waba, token);
  }
  const creds = [...byWaba].map(([wabaId, accessToken]) => ({ wabaId, accessToken }));
  return { creds, skipped };
}

/**
 * Every template of one WABA, with its rating. Follows Meta's `paging.next`. The token goes in the Authorization header only, never in a
 * URL or a message. `fetchImpl` is injectable for the tests.
 */
async function fetchQualities({ wabaId, accessToken }, fetchImpl = fetch) {
  const out = [];
  let url =
    `https://graph.facebook.com/${GRAPH}/${encodeURIComponent(wabaId)}/message_templates` +
    '?fields=name,language,quality_score&limit=100';
  for (let page = 0; url && page < 200; page++) {
    const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error(`Meta answered ${res.status} for one WABA (its token or id is refused)`);
    const body = await res.json();
    for (const t of Array.isArray(body.data) ? body.data : [])
      out.push({
        name: String(t.name || ''),
        language: String(t.language || ''),
        quality: normalizeQuality(t.quality_score),
      });
    url = body.paging && typeof body.paging.next === 'string' ? body.paging.next : null;
  }
  return out;
}

/** Reads the WhatsApp config documents from Waboo through the exporter's fixed `waba` query (stdout only, nothing on disk). */
function readWabaDocs(db) {
  const kit = path.resolve(__dirname, '..', '..', 'exporter', 'bin', 'mongo-eval.cjs');
  const r = spawnSync(process.execPath, [kit, '--query', 'waba', '--workspace', db], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`the Waboo read failed (exit ${r.status}); nothing was printed`);
  const m = /^@@WABA@@(.*)$/m.exec(r.stdout || '');
  if (!m) throw new Error('the Waboo read gave no WhatsApp document list');
  return JSON.parse(m[1]).docs;
}

async function main(argv) {
  const arg = (k) => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const client = arg('client');
  const db = arg('db');
  if (!client || !db) throw new Error('usage: quality.cjs --client <c> --db <waboo database>');
  const { creds, skipped } = wabaCredentials(readWabaDocs(db));
  const rows = new Map();
  let failedWabas = 0;
  for (const c of creds) {
    try {
      for (const r of await fetchQualities(c)) {
        const key = `${r.name}\u0000${r.language}`;
        if (!rows.has(key)) rows.set(key, r);
      }
    } catch (e) {
      failedWabas++;
      console.error(e.message);
    }
  }
  console.log(
    JSON.stringify({
      client,
      wabas: creds.length,
      failedWabas,
      skipped,
      rows: [...rows.values()],
    }),
  );
}

module.exports = { normalizeQuality, wabaCredentials, fetchQualities };

if (require.main === module)
  main(process.argv.slice(2)).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
