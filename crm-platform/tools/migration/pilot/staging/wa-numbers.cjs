#!/usr/bin/env node
/**
 * The REAL WhatsApp number of a Waboo workspace, for the channel map of a NEW client (read-only, no tokens).
 *
 *   node wa-numbers.cjs --workspace <waboo db name> --name "Org name" [--out <file>]
 *
 * Reads two things from the tenant database through the read-only access kit (mongo-eval.cjs), projecting only non-secret fields:
 *   - the live META_WHATSAPP_CONFIG documents of chatbot_misc_config: chatbot_id, phoneID, display_number / whatsapp_no, display_name
 *   - the distinct botid values of chathistory (the key the channel map must use: a chat whose botid is not in the map is quarantined NO_CHANNEL)
 * and pairs them (buildMap). The access token is never selected, so it cannot be printed. Exit 0 and a map file when every botid got a real
 * number; exit 3 when some did not (the caller falls back to the placeholder for those, loudly); exit 1 on a read failure.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PHONE_ID = /^\d{5,32}$/;
const DEFAULT_KIT = path.resolve(__dirname, '..', '..', 'exporter');

const asStr = (v) =>
  v === undefined || v === null ? '' : String(v?.$numberLong ?? v?.$numberInt ?? v).trim();

/** "+65 6250 2280" / "6562502280" -> "+6562502280"; null when it does not look like a number */
function address(v) {
  const d = asStr(v).replace(/\D/g, '');
  return d.length >= 5 && d.length <= 20 ? `+${d}` : null;
}

/**
 * Pure: { botids: string[], docs: [{chatbot_id, is_active, deleted_time, config_value:{phoneID, display_number, whatsapp_no, display_name}}] }
 * -> { map, unresolved: string[], notes: string[] }. map is the channel-map object (non-secret keys only). A botid is resolved when a live
 * document names it (chatbot_id), or, when the workspace has ONE number and ONE botid, by that pairing. Two live documents with different
 * numbers for the same botid are not guessed: that botid stays unresolved.
 */
function buildMap({ botids, docs }, orgName) {
  const notes = [];
  const live = [];
  for (const d of docs || []) {
    if (d.deleted_time != null || d.is_active === false) continue;
    const v = d.config_value || {};
    const ext = asStr(v.phoneID);
    if (!PHONE_ID.test(ext)) continue;
    live.push({
      botid: asStr(d.chatbot_id),
      externalId: ext,
      displayAddress: address(v.display_number) || address(v.whatsapp_no),
      name: asStr(v.display_name).slice(0, 120) || `${orgName} WhatsApp`.slice(0, 120),
    });
  }
  const numbers = new Map(live.map((x) => [x.externalId, x]));
  const ids = [...new Set((botids || []).map(asStr).filter(Boolean))];
  const map = {};
  const unresolved = [];
  const entry = (n) => {
    const e = { kind: 'whatsapp_cloud', externalId: n.externalId, name: n.name };
    if (n.displayAddress) e.displayAddress = n.displayAddress;
    return e;
  };
  for (const b of ids) {
    const exts = new Set(live.filter((x) => x.botid === b).map((x) => x.externalId));
    if (exts.size === 1) map[b] = entry(numbers.get([...exts][0]));
    else if (exts.size === 0 && ids.length === 1 && numbers.size === 1) {
      map[b] = entry([...numbers.values()][0]);
      notes.push(
        'the only botid was paired with the only live number (the configuration document names a different chatbot_id)',
      );
    } else {
      unresolved.push(b);
      notes.push(
        exts.size > 1
          ? `botid ${b}: several live numbers, not guessed`
          : `botid ${b}: no live WhatsApp number found`,
      );
    }
  }
  if (!ids.length) notes.push('the workspace has no chat history: no botid to key the map with');
  return { map, unresolved: ids.length ? unresolved : ['(none)'], notes };
}

function readWorkspace(ws) {
  const kit = process.env.GETA_MONGO_KIT || DEFAULT_KIT;
  const r = spawnSync(
    process.execPath,
    [path.join(kit, 'bin', 'mongo-eval.cjs'), '--query', 'wa', '--workspace', ws],
    {
      encoding: 'utf8',
      timeout: 120000,
      env: { ...process.env, MSYS_NO_PATHCONV: '1' },
    },
  );
  const m = /@@WA@@(\{.*\})/.exec(r.stdout || '');
  if (!m) throw new Error(`no answer from the read replica (exit ${r.status}; host key / VPN?)`);
  return JSON.parse(m[1]);
}

module.exports = { buildMap, address, readWorkspace };

if (require.main === module) {
  const a = process.argv.slice(2);
  const flag = (n) => (a.includes(`--${n}`) ? a[a.indexOf(`--${n}`) + 1] : undefined);
  const ws = flag('workspace');
  if (!ws || !/^[\w.+-]+$/.test(ws)) {
    console.error(
      'usage: wa-numbers.cjs --workspace <waboo db name> --name "Org name" [--out <file>]',
    );
    process.exit(2);
  }
  let res;
  try {
    res = buildMap(readWorkspace(ws), flag('name') || ws);
  } catch (e) {
    console.error(`wa-numbers: ${e.message}`);
    process.exit(1);
  }
  const ok = Object.keys(res.map).length;
  console.log(`wa-numbers: ${ok} botid(s) with a real number, ${res.unresolved.length} without`);
  for (const n of res.notes) console.log(`wa-numbers: ${n}`);
  if (flag('out') && ok) fs.writeFileSync(flag('out'), JSON.stringify(res.map, null, 2) + '\n');
  process.exit(res.unresolved.length ? 3 : 0);
}
