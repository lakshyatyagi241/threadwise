#!/usr/bin/env node
/**
 * migration-complete.cjs: builds ONE readable document, migration-complete.md (+ migration-complete.json), that shows feature by
 * feature what moved from Mongo to Postgres, with a percentage and an honest verifier verdict. Plain Node, no dependencies,
 * read-only on every input. Not part of the bundle; run it on your laptop after fetching the reconcile output from the server.
 *
 * RUN
 *   node pilot/report/migration-complete.cjs [--runs <dir>] [--out <dir>] [--clients iskm,rhythm]
 *   defaults: --runs D:\wadesk-vedant\_work\migration\runs   --out D:\wadesk-vedant\_work\migration   (run from tools/migration)
 *   Writes <out>/migration-complete.{md,json} (combined, newest run per client) and
 *          <runs>/<client>/<timestamp>/migration-complete.{md,json} (that client's run only).
 *   Exit 1 if an input is unreadable or an email/phone-like string would be written.
 *
 * INPUT LAYOUT (fetch with scp from the server's /opt/desk/migration/out/<client>/ and dumps/<client>/manifest.json)
 *   <runs>/<client>/<timestamp>/reconcile.json   REQUIRED  what `reconcile` writes (Report in reconcile/index.ts)
 *   <runs>/<client>/<timestamp>/reconcile.md     optional  only scanned for "NOT RUN" lines
 *   <runs>/<client>/<timestamp>/manifest.json    optional  what `manifest` writes (docs + sha256 per collection)
 *   <runs>/<client>/<timestamp>/run-info.json    optional  free-form: { target, orgSlug, startedAt, finishedAt, loaded, note }
 *   <runs>/<client>/<timestamp>/BUILD-INFO.json  optional  dist/BUILD-INFO.json of the bundle (else <runs>/BUILD-INFO.json)
 *   <timestamp> is any sortable folder name (for example 2026-10-12T10-30-00Z); the newest (sorted last) wins.
 *   A client with no run folder is reported as NOT RUN. Client keys: iskm, rhythm (Karma is dropped).
 * Other inputs read from this repo: registry/index.ts (parsed as text), README.md (open questions),
 *   D:\wadesk-vedant\_work\migration\{team-points.md, missing-in-wadesk-log.md}. A missing one prints "not available in this run".
 *
 * Rules: every number comes from an input; nothing is invented. Percent = migrated / (read - excluded by decision), also shown as
 * migrated / read; denominator 0 prints n/a.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const NA = 'not available in this run';
const TOOL = path.resolve(__dirname, '..', '..');
const WORK = 'D:\\wadesk-vedant\\_work\\migration';

// ---------- small helpers ----------------------------------------------------------------------------------------------------------
const rj = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
  } catch (e) {
    if (fs.existsSync(p)) throw new Error(`cannot read ${p}: ${e.message}`);
    return null;
  }
};
const rt = (p) => {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
};
const n0 = (n) => (typeof n === 'number' ? n.toLocaleString('en-US') : NA);
const pct = (n, d) => (d > 0 ? `${((100 * n) / d).toFixed(1)}%` : 'n/a');
const sum = (xs, f) => xs.reduce((a, x) => a + (f(x) || 0), 0);
const cell = (s) =>
  String(s ?? '')
    .replace(/\|/g, '/')
    .replace(/\r?\n/g, ' ');
const table = (head, rows) =>
  [
    `| ${head.join(' | ')} |`,
    `|${head.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
  ].join('\n');
const codeOf = (s) => (/^([A-Z][A-Z0-9_]+):/.exec(s) || [])[1] || 'OTHER';
const top = (obj, k = 3) =>
  Object.entries(obj)
    .sort((a, b) => b[1] - a[1])
    .slice(0, k);
const topText = (obj, k = 3) => {
  const t = top(obj, k);
  return t.length ? t.map(([c, n]) => `${c} ${n0(n)}`).join(', ') : 'none';
};

// ---------- registry (text parse of registry/index.ts: disposition, reason, targets, handler per collection) ------------------------
function parseRegistry(file) {
  const src = rt(file);
  if (!src) return null;
  const start = src.indexOf('export const REGISTRY');
  const body = src.slice(start);
  const consts = {};
  for (const m of src.matchAll(/const (\w+) =\s*\n?\s*'((?:[^'\\]|\\.)*)';/g)) consts[m[1]] = m[2];
  const kind = { m: 'MIGRATE', later: 'MIGRATE_LATER', ex: 'EXCLUDE', gap: 'GAP', open: 'OPEN' };
  const out = {};
  const re = /(?:^|\n)\s*(m|later|ex|gap|open)\(/g;
  let mm;
  while ((mm = re.exec(body))) {
    let i = mm.index + mm[0].length,
      depth = 1;
    const args = [];
    let cur = '',
      isStr = false;
    while (i < body.length && depth > 0) {
      const c = body[i];
      if (c === "'" || c === '"' || c === '`') {
        let j = i + 1,
          s = '';
        while (j < body.length && body[j] !== c) {
          if (body[j] === '\\') j++;
          s += body[j];
          j++;
        }
        cur = s;
        isStr = true;
        i = j + 1;
        continue;
      }
      if (c === '[') {
        let j = body.indexOf(']', i);
        args.push({
          list: body
            .slice(i + 1, j)
            .split(',')
            .map((x) => x.trim().replace(/^['"]|['"]$/g, ''))
            .filter(Boolean),
        });
        i = j + 1;
        cur = '';
        isStr = false;
        continue;
      }
      if (c === '(') depth++;
      if (c === ')') depth--;
      if (c === ',' || depth === 0) {
        if (isStr) args.push(cur);
        else if (cur.trim()) args.push(consts[cur.trim()] ?? cur.trim());
        cur = '';
        isStr = false;
        i++;
        continue;
      }
      if (!isStr && /[\w]/.test(c)) cur += c;
      i++;
    }
    const k = mm[1];
    const strs = args.filter((a) => typeof a === 'string');
    const lists = args.filter((a) => typeof a === 'object');
    const collection = strs[0];
    if (!collection) continue;
    out[collection] = {
      collection,
      disposition: kind[k],
      targets: lists[0]?.list ?? [],
      reason: k === 'm' || k === 'later' ? (strs[1] ?? '') : (strs[1] ?? ''),
      handler: k === 'm' ? strs[2] : undefined,
    };
  }
  return out;
}

// ---------- the fixed feature map ---------------------------------------------------------------------------------------------------
const L = (...a) => a;
const FEATURES = [
  {
    id: 'contacts',
    name: 'Contacts and fields',
    colls: L(
      'contact_list',
      'contact_properties_fields',
      'contact_properties_field_options',
      'contact_properties_field_dependancy_mapping',
      'contact_properties_field_options_dependancy_mapping',
      'contact_lifecycle_stages',
      'contact_tag',
      'contact_notes',
    ),
    notes: [/^contacts->/, /^certain no/],
    ui: '/contacts, /contact-properties, /contact-stages',
    fam: [/^DISPLAY_ID/, /^CONTACT/],
  },
  {
    id: 'groups',
    name: 'Marketing lists to groups',
    colls: L('marketing_list'),
    notes: [/^marketing list/],
    ui: '/contact-groups',
    fam: [],
  },
  {
    id: 'users',
    name: 'Users',
    colls: L('user'),
    notes: [/^User/],
    ui: '/team-members',
    fam: [/^USER_/, /^OWNER/, /NO-?ADMIN/],
  },
  {
    id: 'roles',
    name: 'Roles',
    colls: L('roles'),
    notes: [/^roles banana/, /^permissiions/],
    ui: '/settings/roles',
    fam: [/^ROLE_/, /^PLAN_ORACLE/],
  },
  {
    id: 'inbox',
    name: 'Inbox (chat history)',
    colls: L('chathistory'),
    notes: [/^chathistory=/],
    ui: '/inbox, /inbox/channels',
    fam: [/^INBOX/, /^PARTITION/, /^CHANNEL/],
  },
  {
    id: 'campaigns',
    name: 'Campaigns (broadcasting)',
    colls: L('broadcasting'),
    notes: [/^whstaap broadcasting/],
    ui: '/campaigns',
    fam: [/^BROADCAST/, /^SENDABLE_CAMP/],
  },
  {
    id: 'recipients',
    name: 'Campaign recipients and broadcast logs',
    colls: L('whatsapp_broadcasting_data'),
    notes: [/^broadcast logs/],
    ui: '/campaigns/[id] (recipient log)',
    fam: [],
  },
  {
    id: 'credits',
    name: 'Credit logs',
    colls: L('credit_logs'),
    notes: [/^credit-logs/],
    ui: '/billing/wallet/statement, /ai-usage',
    fam: [/^CREDITS?_/, /^WALLET_/, /^LEDGER_/, /^TOKEN_PARITY/],
  },
  {
    id: 'flows',
    name: 'Flows and chatbot',
    colls: L(
      'chatbots',
      'flows',
      'bot_flow_version',
      'bot_flow_version_data',
      'bot_workspace',
      'faq_variations',
    ),
    notes: [/^chatbot$/, /^flows\(/, /^No version history/, /^Journey table/],
    ui: '/flows, /flows/simple',
    fam: [/^FLOW/, /^SENDABLE_(WIDGET|ASSISTANT)/],
  },
  {
    id: 'widgets',
    name: 'Chatbot widgets',
    colls: L('chatbot_configuration', 'chatbot_theme'),
    notes: [],
    ui: '/chatbot-widgets',
    fam: [/^WIDGET/, /^SENDABLE_WIDGET/],
  },
  {
    id: 'pricing',
    name: 'Pricing (credits_mapping_new, by pricing-seed)',
    colls: L('credits_mapping_new'),
    notes: [/^credit-mapping new/],
    ui: '/admin/wallet/pricing',
    special: 'pricing',
    fam: [],
  },
  {
    id: 'files',
    name: 'File manager',
    colls: L('file_manager'),
    notes: [/^file-manager/],
    ui: 'no page (no target table)',
    fam: [],
  },
  {
    id: 'channel',
    name: 'Channel config (WhatsApp credentials)',
    colls: L('chatbot_misc_config'),
    notes: [/^chatbot mise/, /^p1 :/, /^Authtables/],
    ui: '/channels/whatsapp',
    fam: [],
  },
  {
    id: 'automations',
    name: 'Automations (advanced flows)',
    colls: L('automation_journey', 'automation_metadata'),
    notes: [/^\(advance/],
    ui: '/flows/builder',
    fam: [],
  },
  {
    id: 'rag',
    name: 'RAG (AI knowledge base)',
    colls: L('document_col'),
    notes: [/^RAG/],
    ui: '/ai-training',
    onHold: true,
    fam: [],
  },
  {
    id: 'decision',
    name: 'Not migrated by decision',
    colls: [],
    notes: [],
    ui: 'none',
    special: 'decision',
    fam: [],
  },
];
const FEATURE_OF = {};
for (const f of FEATURES) for (const c of f.colls) FEATURE_OF[c] = f.id;

// ---------- load inputs -------------------------------------------------------------------------------------------------------------
function newestRun(runsDir, client) {
  const d = path.join(runsDir, client);
  if (!fs.existsSync(d)) return null;
  const ts = fs
    .readdirSync(d, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  if (!ts.length) return null;
  const dir = path.join(d, ts[ts.length - 1]);
  return {
    client,
    timestamp: ts[ts.length - 1],
    dir,
    report: rj(path.join(dir, 'reconcile.json')),
    md: rt(path.join(dir, 'reconcile.md')),
    manifest: rj(path.join(dir, 'manifest.json')),
    info: rj(path.join(dir, 'run-info.json')),
    build: rj(path.join(dir, 'BUILD-INFO.json')) || rj(path.join(runsDir, 'BUILD-INFO.json')),
  };
}

function loadNotes(workDir) {
  const t = rt(path.join(workDir, 'team-points.md'));
  if (!t) return null;
  const a = t.split(/^## Part A.*$/m)[1];
  if (!a) return null;
  return a
    .split(/^## Part B/m)[0]
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((text, i) => ({ n: i + 1, text }));
}
function loadLog(workDir) {
  const t = rt(path.join(workDir, 'missing-in-wadesk-log.md'));
  if (!t) return null;
  const rows = (sec) =>
    (sec || '')
      .split(/\r?\n/)
      .filter((l) => /^\|/.test(l) && !/^\|\s*(ID|---)/.test(l))
      .map((l) =>
        l
          .split('|')
          .slice(1, -1)
          .map((x) => x.trim()),
      )
      .filter((r) => r[0]);
  const A = t.split(/^## A\..*$/m)[1]?.split(/^## B\./m)[0];
  const B = t.split(/^## B\..*$/m)[1];
  return { A: rows(A), B: rows(B) };
}
function loadOpenQuestions(toolDir) {
  const t = rt(path.join(toolDir, 'README.md'));
  if (!t) return null;
  const sec = t.split(/^## Open questions \(current\)$/m)[1]?.split(/^---$/m)[0];
  return sec
    ? sec
        .split(/\r?\n/)
        .filter((l) => /^- \[ \]/.test(l))
        .map((l) => l.replace(/^- \[ \]\s*/, ''))
    : null;
}
const OQ_FEATURES = [
  [/re-?authori[sz]ation/i, ['channel', 'inbox']],
  [/RAG/, ['rag']],
  [/status \/ stage/i, ['contacts']],
  [/Plan and permission/i, ['roles', 'users']],
  [/number fields/i, ['contacts']],
  [/openchat_logs/, ['decision']],
  [/file_manager/, ['files']],
  [/leadrepo/, ['decision']],
  [/Owner sign-in/i, ['users']],
  [/Automations in scope/i, ['automations']],
  [/Chat history/i, ['inbox']],
];

// ---------- per client feature computation --------------------------------------------------------------------------------------------
function attributeAlarm(a, reg) {
  for (const f of FEATURES) if (f.colls.some((c) => a.includes(c))) return f.id;
  for (const f of FEATURES)
    if (
      reg &&
      f.colls
        .flatMap((c) => reg[c]?.targets ?? [])
        .some((t) => t.length > 3 && new RegExp(`\\b${t}\\b`).test(a))
    )
      return f.id;
  for (const f of FEATURES) if (f.fam.some((r) => r.test(a))) return f.id;
  return null; // run-wide
}

function computeClient(run, reg, notes) {
  const out = {
    client: run.client,
    timestamp: run.timestamp,
    run: run.dir ? run : null,
    features: [],
    runWide: [],
  };
  const rep = run.report;
  const man = Object.fromEntries((run.manifest?.collections ?? []).map((c) => [c.collection, c]));
  const rows = Object.fromEntries(
    (rep?.collections ?? []).filter((c) => c.kind === 'collection').map((c) => [c.collection, c]),
  );
  const fp = rep?.fingerprints ?? {};
  const alarms = rep?.alarms ?? [];
  const attributed = {};
  for (const a of alarms) {
    const id = attributeAlarm(a, reg);
    if (id) (attributed[id] ||= []).push(a);
    else out.runWide.push(a);
  }
  // collections not mapped explicitly fall into the decision group
  const decisionColls = new Set();
  for (const c of new Set([...Object.keys(rows), ...Object.keys(man), ...Object.keys(reg || {})]))
    if (!FEATURE_OF[c]) decisionColls.add(c);
  const claimedNote = new Set();
  for (const f of FEATURES) {
    const colls = f.special === 'decision' ? [...decisionColls].sort() : f.colls;
    const regOf = (c) => (reg ? reg[c] : null);
    const disp = (c) => rows[c]?.disposition ?? regOf(c)?.disposition ?? null;
    const readOf = (c) => rows[c]?.read ?? man[c]?.docs ?? null;
    const present = colls.filter((c) => rows[c] || man[c]);
    const mig = colls.filter((c) => disp(c) === 'MIGRATE');
    const migRows = mig.map((c) => rows[c]).filter(Boolean);
    const o = {
      id: f.id,
      name: f.name,
      ui: f.ui,
      collections: colls,
      noteLines: [],
      dispositions: Object.fromEntries(colls.map((c) => [c, disp(c)])),
      read: null,
      migrated: null,
      quarantined: null,
      excluded: null,
      unaccounted: null,
      pgRows: null,
      notPresent: [],
      alarms: attributed[f.id] ?? [],
      quarantineReasons: {},
      excludedReasons: {},
      quarantineMeaning: {},
      fieldRows: [],
      fingerprints: [],
      perColl: [],
    };
    if (notes)
      for (const nl of notes)
        if (f.notes.some((r) => r.test(nl.text))) {
          o.noteLines.push(nl);
          claimedNote.add(nl.n);
        }
    const readAll = present.map(readOf).filter((x) => x != null);
    o.readAll = readAll.length ? sum(readAll, (x) => x) : null;
    // verifier numbers come from MIGRATE collections that the report has
    if (migRows.length) {
      o.read = sum(migRows, (r) => r.read);
      o.migrated = sum(migRows, (r) => r.migrated);
      o.quarantined = sum(migRows, (r) => r.quarantined);
      o.excluded = sum(migRows, (r) => r.excluded);
      o.unaccounted = sum(migRows, (r) => r.unaccounted);
    }
    for (const c of colls) {
      const r = rows[c];
      o.perColl.push({
        collection: c,
        disposition: disp(c),
        reason: regOf(c)?.reason ?? null,
        targets: regOf(c)?.targets ?? [],
        manifestDocs: man[c]?.docs ?? null,
        sha: man[c]?.sha256 ?? null,
        read: r?.read ?? null,
        migrated: r?.migrated ?? null,
        quarantined: r?.quarantined ?? null,
        excluded: r?.excluded ?? null,
        gap: r?.gap ?? null,
        unaccounted: r?.unaccounted ?? null,
      });
      if (disp(c) === 'EXCLUDE' || disp(c) === 'MIGRATE')
        for (const [k, n] of Object.entries(rep?.excludedByCode ?? {}))
          if (k.startsWith(c + ':') || k.startsWith(c + '.') || k.startsWith(c + ' '))
            o.excludedReasons[k] = n;
      for (const l of rep?.nonMigrated ?? [])
        if (l.collection === c) {
          if (l.status === 'quarantined') {
            o.quarantineReasons[l.code] = (o.quarantineReasons[l.code] || 0) + 1;
            o.quarantineMeaning[l.code] ||= l.reason;
          }
        }
    }
    // handlers -> field rows; fingerprints by registry target tables
    const handlers = new Set(mig.map((c) => regOf(c)?.handler).filter(Boolean));
    o.fieldRows = (rep?.fields ?? []).filter((x) => handlers.has(x.step));
    const targets = new Set(mig.flatMap((c) => regOf(c)?.targets ?? []));
    for (const [t, v] of Object.entries(fp))
      if (targets.has(t))
        o.fingerprints.push({ table: t, rows: v.rows, match: v.source === v.target });
    if (o.fingerprints.length) o.pgRows = sum(o.fingerprints, (x) => x.rows);
    o.notPresent = (rep?.notPresent?.droppedFields ?? []).filter((s) =>
      colls.some((c) => s.startsWith(c + '.')),
    );
    o.fingerprintFail = o.fingerprints.filter((x) => !x.match);
    // status + verifier
    const ds = new Set(colls.map(disp).filter(Boolean));
    if (f.special === 'decision') o.status = 'NOT MIGRATED BY DECISION';
    else if (f.special === 'pricing') o.status = 'DONE BY pricing-seed (separate command)';
    else if (f.onHold) o.status = 'ON HOLD';
    else if (mig.length) o.status = null;
    else if (ds.has('MIGRATE_LATER') || ds.has('GAP') || ds.has('OPEN') || !ds.size)
      o.status = 'NOT BUILT';
    else o.status = 'NOT MIGRATED BY DECISION';
    if (!rep) o.verifier = 'NOT RUN';
    else if (f.special === 'decision') o.verifier = 'n/a (nothing loaded)';
    else if (f.special === 'pricing') o.verifier = 'NOT RUN (pricing-seed has no reconcile)';
    else if (f.onHold) o.verifier = 'ON HOLD';
    else if (!mig.length) o.verifier = 'NOT BUILT';
    else if (!migRows.length) o.verifier = 'NOT RUN';
    else {
      const bad = [...o.alarms.map(codeOf)];
      if (o.unaccounted > 0) bad.push('UNACCOUNTED');
      if (o.fingerprintFail.length) bad.push('FINGERPRINT');
      o.verifier = bad.length ? `FAIL (${[...new Set(bad)].join(', ')})` : 'PASS';
    }
    if (o.status === null) {
      if (!rep) o.status = 'NOT RUN';
      else if (!migRows.length) o.status = 'NOT RUN';
      else if (o.verifier.startsWith('FAIL')) o.status = 'HAS ALARMS';
      else
        o.status =
          o.quarantined > 0 || mig.length < colls.filter((c) => disp(c) !== 'EXCLUDE').length
            ? 'PARTIAL'
            : 'COMPLETE';
    }
    out.features.push(o);
  }
  // note lines not claimed by a feature go to the decision group
  const dec = out.features.find((x) => x.id === 'decision');
  if (notes) dec.noteLines = notes.filter((nl) => !claimedNote.has(nl.n));
  // verdict
  const builtFails = out.features.filter((x) => /^FAIL/.test(x.verifier));
  out.notRun = out.features.filter((x) => x.status === 'NOT RUN').length;
  out.verdict = !rep
    ? 'NOT RUN'
    : builtFails.length ||
        out.runWide.length ||
        (rep.integrity ?? []).length ||
        rep.unaccounted > 0 ||
        rep.ok === false
      ? 'HAS ALARMS'
      : 'COMPLETE FOR BUILT FEATURES';
  return out;
}

// ---------- rendering ---------------------------------------------------------------------------------------------------------------
const checkFamilies = [
  [
    'count equation (read = migrated + quarantined + excluded, unaccounted 0)',
    /^(EQUATION|UNCLAIMED|NOT_LOADED|UNACCOUNTED)/,
  ],
  ['independent oracle comparison', /^(ORACLE_MISMATCH|PLAN_ORACLE_MISMATCH)/],
  ['extra-row and baseline anti-joins', /^(EXTRA_ROWS|BASELINE_CHANGED|LEAKED_ROWS|WALLET_EXTRA)/],
  ['id_map exactness and target rows exist', /^(IDMAP_MISSING|TARGET_MISSING|ORPHANS)/],
  [
    'quarantine digest and re-derivation',
    /^(QUARANTINE_DIGEST|FALSE_QUARANTINE|QUARANTINE_ORPHAN)/,
  ],
  [
    'safety (no side effects, nothing sendable, flows inactive, no secrets)',
    /^(SIDE_EFFECT|SENDABLE_|FLOW_SECRET|SECRET_LEAK|WIDGET_TOKEN|NO-?ADMIN)/,
  ],
  ['display ids and counters', /^(DISPLAY_ID|COUNTER_MISMATCH)/],
  ['field coverage (every source field mapped or listed as dropped)', /^(FIELD|NO_FIELDS_ROW)/],
  ['dump integrity (hashes, parse errors)', /^(PARSE_ERRORS|DUMP|HASH|MANIFEST)/],
];
const LIMITS = [
  'It cannot prove how WhatsApp behaves with a migrated number: nothing is sent, channels are created without credentials and need a fresh connection.',
  'It cannot prove plan limits: rows are inserted directly and bypass the plan checks.',
  'Owner sign-in is not proven by the verifier: migrated users have no password; the owner password helper sets one and the sign-in itself must be tried by hand.',
  'Source fields that appear in under 1 percent of documents may not be in the field profiles the mapping was written from. The coverage table lists every field the dump actually contained; a new one raises an alarm.',
  'The independent oracle shares the app phone canonicaliser, so a wrong phone rule would be wrong on both sides.',
  'Dependency mappings (field and option dependencies) have no oracle other than the recomputation from the same source.',
  'Fingerprints and the column compare prove that the target equals what the loader intended, not that the loader intended the right business meaning (stage versus status, thread open or closed).',
  'The Mongo counts come from the export count check against the live collection, and from manifest.json (documents per file, sha256); the verifier re-hashes the dump files and refuses a changed dump. Large collections above 250,000 documents are compared on a seeded sample, the rest in full.',
  'Real WhatsApp behaviour, webhooks, delivery of old campaigns and any live traffic are outside the verifier.',
];

function featureRow(f) {
  const denom = f.read != null ? f.read - f.excluded : null;
  const isBuilt = f.migrated != null;
  return [
    f.name,
    f.noteLines.length ? f.noteLines.map((x) => `#${x.n}`).join(', ') : 'none',
    f.id === 'decision'
      ? n0(f.readAll)
      : isBuilt
        ? n0(f.read)
        : f.readAll != null
          ? n0(f.readAll)
          : NA,
    f.pgRows != null ? n0(f.pgRows) : isBuilt ? NA : 'n/a (nothing loaded)',
    isBuilt
      ? `${pct(f.migrated, denom)} (${n0(f.migrated)}/${n0(denom)}); of read ${pct(f.migrated, f.read)}`
      : 'n/a',
    isBuilt ? n0(f.quarantined) : 'n/a',
    isBuilt
      ? `${n0(f.excluded)} (${topText(f.excludedReasons, 2)})`
      : f.id === 'decision'
        ? `${n0(f.readAll)} (see section 4)`
        : 'n/a',
    f.notPresent.length ? `${f.notPresent.length} field(s)` : isBuilt ? 'none listed' : 'n/a',
    f.verifier,
    f.status,
    f.ui,
  ];
}
const ROWHEAD = [
  'feature',
  'team note lines',
  'Mongo documents read',
  'Postgres rows now',
  'migrated % (migrated / (read - excluded))',
  'quarantined',
  'excluded (top reasons)',
  'not present in WaDesk',
  'verifier',
  'status',
  'where in the WaDesk UI',
];

function happened(f) {
  if (f.migrated == null)
    return f.id === 'decision'
      ? `${n0(f.readAll)} documents sit in collections that are not migrated by decision. Nothing was loaded for them.`
      : `Nothing was loaded for this feature in this run (${f.status}).`;
  const denom = f.read - f.excluded;
  let s = `${n0(f.migrated)} of ${n0(denom)} loadable documents were migrated (${pct(f.migrated, denom)}); ${n0(f.read)} were read from the dump.`;
  s += ` ${n0(f.quarantined)} quarantined${f.quarantined ? ` (${topText(f.quarantineReasons, 3)})` : ''}, ${n0(f.excluded)} excluded${f.excluded ? ` (${topText(f.excludedReasons, 3)})` : ''}, ${n0(f.unaccounted)} unaccounted.`;
  if (f.alarms.length) s += ` ${f.alarms.length} alarm(s) point at this feature.`;
  return s;
}

function renderClient(c, opts) {
  const T = [];
  const rep = c.run?.report;
  const S = (x) => T.push(x);
  S(`### ${c.client.toUpperCase()} (run ${c.timestamp})`);
  S('');
  for (const f of c.features.filter((x) => x.id !== 'decision' || true)) {
    S(`#### ${f.name}`);
    S('');
    S(
      `Mongo collections: ${
        f.collections.length
          ? f.collections
              .map((k) => {
                const p = f.perColl.find((x) => x.collection === k);
                const d = p.read ?? p.manifestDocs;
                return `${k} (${d != null ? n0(d) + ' docs' : 'documents ' + NA}, ${p.disposition || 'not in registry'})`;
              })
              .join(', ')
          : 'none'
      }`,
    );
    const tg = [
      ...new Set(f.perColl.flatMap((p) => (p.disposition === 'MIGRATE' ? p.targets : []))),
    ];
    S(
      `Postgres tables: ${
        tg.length
          ? tg
              .map((t) => {
                const x = f.fingerprints.find((y) => y.table === t);
                return `${t} (${x ? n0(x.rows) + ' rows' : 'row count ' + NA})`;
              })
              .join(', ')
          : 'none (not loaded)'
      }`,
    );
    if (f.migrated != null)
      S(
        `Equation: read ${n0(f.read)} = migrated ${n0(f.migrated)} + quarantined ${n0(f.quarantined)} + excluded ${n0(f.excluded)}; unaccounted ${n0(f.unaccounted)} (must be 0). ${f.read === f.migrated + f.quarantined + f.excluded + f.unaccounted ? 'It holds.' : 'IT DOES NOT HOLD.'}`,
      );
    else S(`Equation: not applicable (${f.status}).`);
    S('');
    S(`What actually happened: ${happened(f)}`);
    S('');
    if (f.fieldRows.length) {
      S(
        table(
          ['Mongo field', 'documents', 'goes to (Postgres column, jsonb or dropped)', 'verdict'],
          f.fieldRows.map((x) => [x.field, n0(x.seen), x.where, x.verdict]),
        ),
      );
      S('');
    } else if (f.migrated != null) {
      S(`Field table: ${NA}.`);
      S('');
    }
    if (f.notPresent.length) {
      S('NOT PRESENT in WaDesk (no column, counted in this run):');
      f.notPresent.forEach((x) => S(`- ${x}`));
      S('');
    }
    if (Object.keys(f.quarantineReasons).length) {
      S(
        table(
          ['quarantine reason', 'rows listed', 'what it means (from the report)'],
          top(f.quarantineReasons, 10).map(([k, n]) => [k, n0(n), f.quarantineMeaning[k] || NA]),
        ),
      );
      if (sum(Object.values(f.quarantineReasons), (x) => x) !== f.quarantined)
        S(
          `Note: the report lists ${n0(sum(Object.values(f.quarantineReasons), (x) => x))} quarantined keys of ${n0(f.quarantined)}; the full list is in reconcile.json.`,
        );
      S('');
    } else if (f.quarantined > 0) {
      S(
        `Quarantine reasons: ${NA} (${n0(f.quarantined)} rows quarantined, reasons not listed in reconcile.json).`,
      );
      S('');
    }
  }
  return T.join('\n');
}

function renderChecks(c) {
  const rep = c.run?.report;
  const T = [`### ${c.client.toUpperCase()}`, ''];
  if (!rep) return T.concat(`Verifier: NOT RUN (${NA}).`, '').join('\n');
  T.push(
    `Verifier result: ${rep.ok ? 'PASS' : 'FAIL'}; unaccounted ${n0(rep.unaccounted)}; alarms ${n0((rep.alarms ?? []).length)}; integrity failures ${n0((rep.integrity ?? []).length)}; report generated ${rep.generatedAt ?? NA}.`,
    '',
  );
  const all = [...(rep.alarms ?? []), ...(rep.integrity ?? [])];
  T.push(
    table(
      ['check family', 'result in this run'],
      checkFamilies.map(([n, re]) => {
        const hits = all.filter((a) => re.test(a));
        return [
          n,
          hits.length
            ? `ALARM x${hits.length}: ${[...new Set(hits.map(codeOf))].join(', ')}`
            : 'no alarm of this family raised',
        ];
      }),
    ),
  );
  T.push(
    '',
    'A row reading "no alarm raised" means the verifier ran the check and did not fire; it does not list individual passes. Per-column compare result:',
    '',
  );
  const fps = Object.entries(rep.fingerprints ?? {});
  T.push(
    fps.length
      ? table(
          ['table', 'rows compared', 'source fingerprint', 'target fingerprint', 'match'],
          fps.map(([t, v]) => [
            t,
            n0(v.rows),
            v.source.slice(0, 16),
            v.target.slice(0, 16),
            v.source === v.target ? 'yes' : 'NO',
          ]),
        )
      : `Fingerprints: ${NA}.`,
  );
  T.push(
    '',
    `Rows compared column by column: ${n0(rep.sample?.compared)}; mismatches: ${n0((rep.sample?.mismatches ?? []).length)}.`,
    '',
  );
  T.push('Alarms, verbatim:');
  T.push(...((rep.alarms ?? []).length ? rep.alarms.map((a) => `- ${a}`) : ['- none']));
  if ((rep.integrity ?? []).length) {
    T.push('', 'Integrity failures, verbatim:', ...rep.integrity.map((a) => `- ${a}`));
  }
  T.push('', 'Warnings, verbatim:');
  T.push(...((rep.warnings ?? []).length ? rep.warnings.map((a) => `- ${a}`) : ['- none']));
  const notRun = (c.run.md ?? '').split(/\r?\n/).filter((l) => /NOT RUN/.test(l));
  T.push('', 'Steps marked NOT RUN in the report:');
  T.push(
    ...(notRun.length
      ? notRun.map((l) => (l.trim().startsWith('-') ? l.trim() : `- ${l.trim()}`))
      : ['- none marked (' + (c.run.md ? 'reconcile.md scanned' : 'reconcile.md ' + NA) + ')']),
  );
  const man = c.run.manifest;
  T.push(
    '',
    man
      ? `Dump manifest: generated ${man.generatedAt}, ${n0(man.collections.length)} collections, ${n0(sum(man.collections, (x) => x.docs))} documents, ${n0(sum(man.collections, (x) => x.badLines))} unparseable lines. Per-collection sha256 are in manifest.json.`
      : `Dump manifest: ${NA}.`,
  );
  if (man && rep) {
    const diff = rep.collections
      .filter((r) => r.kind === 'collection')
      .map((r) => [r, man.collections.find((m) => m.collection === r.collection)])
      .filter(([r, m]) => m && m.docs !== r.read);
    T.push(
      diff.length
        ? `Manifest and report disagree on read counts for: ${diff.map(([r, m]) => `${r.collection} (manifest ${m.docs}, report ${r.read})`).join('; ')}.`
        : 'Manifest document counts equal the read counts in the report for every collection both list.',
    );
  }
  return T.concat('').join('\n');
}

function render(clients, ctx) {
  const T = [];
  const S = (x = '') => T.push(x);
  const clientsRun = clients.filter((c) => c.run);
  S('# Migration complete: Waboo to WaDesk staging');
  S('');
  S('## 0. Header');
  S('');
  S(
    table(
      ['client', 'run (timestamp)', 'target', 'org slug', 'report generated', 'VERDICT'],
      clients.map((c) => [
        c.client.toUpperCase(),
        c.timestamp ?? 'no run folder',
        c.run?.info?.target ?? (c.run ? 'staging (assumed, run-info.json has no target)' : NA),
        c.run?.info?.orgSlug ?? NA,
        c.run?.report?.generatedAt ?? NA,
        c.verdict +
          (c.notRun && c.run?.report
            ? `; ${c.notRun} built feature(s) NOT RUN in this report`
            : ''),
      ]),
    ),
  );
  S('');
  const b = clientsRun.map((c) => c.run.build).find(Boolean);
  S(
    b
      ? `Tool build: git sha ${b.gitSha ?? NA}${b.gitDirty ? ' (dirty tree)' : ''}, tool version ${b.tool ?? NA}, built ${b.builtAt ?? NA}, bundle sha256 ${(b.files && b.files['waboo-migrate.cjs']?.sha256) || NA}.`
      : `Tool build: ${NA} (BUILD-INFO.json not supplied).`,
  );
  S('');
  S(
    'Verdict words: COMPLETE FOR BUILT FEATURES = the verifier passed for every feature the tool builds (features not built are listed in section 4 and are not part of this verdict); HAS ALARMS = at least one alarm, integrity failure or unaccounted document; NOT RUN = no reconcile output for this client.',
  );
  S('');
  S('## 1. Features at a glance');
  S('');
  S(
    'Legend: migrated % = migrated / (read minus excluded by decision); the migrated / read ratio is shown next to it. Denominator 0 prints n/a. "Postgres rows now" is the row count of the target tables in the verifier fingerprints; "not available in this run" when the report has none. Status words: COMPLETE, PARTIAL (some rows quarantined or some collections of the feature not built), HAS ALARMS, NOT BUILT, ON HOLD, NOT MIGRATED BY DECISION, NOT RUN.',
  );
  S('');
  for (const c of clients) {
    S(`### ${c.client.toUpperCase()}`);
    S('');
    S(c.run ? table(ROWHEAD, c.features.map(featureRow)) : `NOT RUN: ${NA}.`);
    S('');
  }
  S('## 2. Mongo to Postgres comparison');
  S('');
  for (const c of clients) {
    if (c.run) {
      S(renderClient(c));
      S('');
    }
  }
  S('## 3. Is this correct? How much to trust the verifier');
  S('');
  S(
    'The verifier (`reconcile`) is a separate command that recomputes counts from the dump and from the migration tables; it does not trust the loader counters.',
  );
  S('');
  for (const c of clients) {
    S(renderChecks(c));
  }
  S('### Known limits: what the verifier cannot prove');
  S('');
  LIMITS.forEach((l) => S(`- ${l}`));
  S('');
  S('## 4. Not migrated and why');
  S('');
  S('### 4a. Not migrated by decision (the team notes, in their words)');
  S('');
  const decRef = clientsRun[0]?.features.find((f) => f.id === 'decision');
  if (ctx.notes)
    S(
      table(
        ['note #', 'team note'],
        (decRef?.noteLines ?? []).map((x) => [x.n, x.text]),
      ),
    );
  else S(`Team notes: ${NA}.`);
  S('');
  S(
    table(
      [
        'collection',
        'decision',
        'reason (registry)',
        ...clientsRun.map((c) => `${c.client.toUpperCase()} documents`),
      ],
      (() => {
        const names = [
          ...new Set(
            clientsRun.flatMap((c) =>
              c.features.find((f) => f.id === 'decision').perColl.map((p) => p.collection),
            ),
          ),
        ].sort();
        return names.map((n) => {
          const p =
            clientsRun[0].features
              .find((f) => f.id === 'decision')
              .perColl.find((x) => x.collection === n) ?? {};
          const d = clientsRun.map((c) => {
            const q = c.features
              .find((f) => f.id === 'decision')
              .perColl.find((x) => x.collection === n);
            return q ? n0(q.read ?? q.manifestDocs) : NA;
          });
          return [n, p.disposition || 'not in registry', (p.reason ?? NA).slice(0, 220), ...d];
        });
      })(),
    ),
  );
  S('');
  S('### 4b. Not built yet');
  S('');
  S(
    table(
      [
        'feature / collection',
        'registry decision',
        'reason (registry)',
        ...clientsRun.map((c) => `${c.client.toUpperCase()} documents`),
      ],
      clientsRun.length
        ? (() => {
            const rows = [];
            for (const f of clientsRun[0].features.filter((x) =>
              ['NOT BUILT', 'ON HOLD', 'DONE BY pricing-seed (separate command)'].includes(
                x.status,
              ),
            ))
              for (const p of f.perColl)
                rows.push([
                  `${f.name}: ${p.collection}`,
                  p.disposition || 'not in registry',
                  (p.reason ?? NA).slice(0, 220),
                  ...clientsRun.map((c) => {
                    const q = c.features
                      .find((x) => x.id === f.id)
                      .perColl.find((x) => x.collection === p.collection);
                    return n0(q.read ?? q.manifestDocs);
                  }),
                ]);
            return rows;
          })()
        : [],
    ),
  );
  S('');
  S('### 4c. Missing in WaDesk (from missing-in-wadesk-log.md)');
  S('');
  if (ctx.log) {
    S('Section A (expected from design):');
    S('');
    S(
      table(
        [
          'ID',
          'Found',
          'Client',
          'Waboo collection and field',
          'What is needed in WaDesk',
          'Count',
          'What the migration does',
          'Decision needed',
        ],
        ctx.log.A,
      ),
    );
    S('');
    S('Section B (found on real data):');
    S('');
    S(
      ctx.log.B.length
        ? table(
            [
              'ID',
              'Found',
              'Client',
              'Waboo collection and field',
              'What is needed in WaDesk',
              'Count',
              'What the migration did',
              'Decision needed',
            ],
            ctx.log.B,
          )
        : 'No rows in section B of the log yet.',
    );
  } else S(`Log: ${NA}.`);
  S('');
  S('Counts of this run (NOT PRESENT section of the reports):');
  S('');
  for (const c of clientsRun) {
    const np = c.run.report?.notPresent;
    S(`${c.client.toUpperCase()}:`);
    if (!np) {
      S(`- ${NA}`);
      continue;
    }
    for (const [k, v] of [
      ['collections with no target table (GAP)', np.collectionsGap],
      ['not in the registry (UNKNOWN)', np.collectionsUnknown],
      ['undecided (OPEN)', np.collectionsOpen],
      ['deferred to phase 2', np.collectionsDeferred],
      ['source fields with no target column', np.droppedFields],
    ]) {
      S(`- ${k}: ${v.length}`);
      v.slice(0, 60).forEach((x) => S(`  - ${x}`));
      if (v.length > 60) S(`  - ... ${v.length - 60} more in reconcile.json`);
    }
    const fi = c.run.report.fieldIssues ?? {};
    if (Object.keys(fi).length) {
      S('- field-level issues (document migrated, value quarantined):');
      Object.entries(fi).forEach(([k, n]) => S(`  - ${k}: ${n0(n)}`));
    }
  }
  S('');
  S('## 5. How to check it yourself');
  S('');
  const slug = (c) => c.run?.info?.orgSlug ?? '<org-slug>';
  S(
    'On the staging server, in /opt/desk (as the staging runbook shows). Replace the slug with the one in the header table.',
  );
  S('');
  S('```bash');
  S('cd /opt/desk && set -a && . ./.env && set +a');
  S(
    'PSQL="docker compose --env-file .env exec -T postgres psql -U $POSTGRES_USER -d $POSTGRES_DB -v slug=<org-slug>"',
  );
  S('$PSQL -c "select id, slug, name from organizations where slug = :\'slug\'"');
  S('```');
  S('');
  const tbls = [
    ...new Set(
      clientsRun.flatMap((c) =>
        c.features.flatMap((f) =>
          f.perColl.filter((p) => p.disposition === 'MIGRATE').flatMap((p) => p.targets),
        ),
      ),
    ),
  ]
    .filter((t) => /^[a-z_]+$/.test(t))
    .sort();
  S('Rows per table for one organization (read only):');
  S('');
  S('```sql');
  S(
    tbls.length
      ? tbls
          .map(
            (t) =>
              `select '${t}' as tbl, count(*) from ${t} where org_id = (select id from organizations where slug = :'slug')`,
          )
          .join('\nunion all\n') + ';'
      : `-- ${NA} (no registry)`,
  );
  S('```');
  S('');
  S('Quarantine by reason and the id map size (tool tables, no contact data):');
  S('');
  S('```sql');
  S(
    "select source_collection, reason_code, count(*) from migration.quarantine where source_client = '<client key>' group by 1,2 order by 3 desc;",
  );
  S(
    "select source_collection, count(*) from migration.id_map where source_client = '<client key>' group by 1 order by 1;",
  );
  S('```');
  S('');
  S(
    'Compare the first query with the "Postgres rows now" column; compare the second with the quarantine reasons in section 2. If psql as the database owner shows zero rows because of row level security, use the UI paths below instead.',
  );
  S('');
  S(
    'UI paths after signing in as the owner: ' +
      [
        ...new Set(
          FEATURES.filter((f) => f.ui && !/^no page|^none/.test(f.ui)).map(
            (f) => `${f.name}: ${f.ui}`,
          ),
        ),
      ].join('; ') +
      '.',
  );
  S('');
  S(
    'Sign in: migrated users have no password and staging sends no mail, so set the owner password on the server, then sign in at https://desk.wabo.ai/login with the organization slug, the owner email and that password.',
  );
  S('');
  S('```bash');
  S("read -rs -p 'new owner password: ' PW; echo");
  S('docker compose --env-file .env run --rm --no-deps -T --user 10001:10001 \\');
  S(
    '  -v $MIG/bundle/set-owner-password.cjs:/app/set-owner-password.cjs:ro -e OWNER_NEW_PASSWORD="$PW" worker \\',
  );
  S(
    '  sh -c \'TARGET_DATABASE_URL="$DATABASE_URL" exec node /app/set-owner-password.cjs --org-slug <org-slug> --email <owner email> --confirm-db-name crm --allow-docker-host postgres\'',
  );
  S('unset PW');
  S('```');
  S('');
  S(
    'The helper prints `ok <user uuid>` and nothing else. Full steps: pilot/staging/STAGING-RUNBOOK.md, steps 7 to 9.',
  );
  S('');
  S('## 6. Open questions for the manager');
  S('');
  if (ctx.oq) {
    const present = new Set(
      clientsRun.flatMap((c) => c.features.filter((f) => f.read || f.readAll).map((f) => f.id)),
    );
    const qs = ctx.oq.filter((q) => {
      const hit = OQ_FEATURES.find(([re]) => re.test(q));
      return hit && hit[1].some((id) => present.has(id));
    });
    S(
      qs.length
        ? qs.map((q) => `- ${q}`).join('\n')
        : `- none apply to the features present in this run (${NA} if no run exists).`,
    );
  } else S(`README open questions: ${NA}.`);
  S('');
  return T.join('\n');
}

// ---------- PII guard ---------------------------------------------------------------------------------------------------------------
function piiHits(text) {
  // a full UUID is an identifier, not personal data (its last group can be 12 digits by chance and then reads like a phone number)
  const t = text.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '').replace(/\b[0-9a-f]{16,}\b/gi, '').replace(/\d{4}-\d{2}-\d{2}T[\d:.\-]+Z?/g, '');
  // a decimal number (a node's x/y on the canvas, an amount) is not a phone number: its fractional digits must not read as one
  const t2 = t.replace(/-?\d+\.\d{3,}/g, '');
  const hits = [];
  for (const m of t2.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/g))
    if (!/^(you|user|x|name)@/i.test(m[0]) && !m[0].includes('<')) hits.push(m[0]);
  for (const m of t2.matchAll(/\+\d[\d ()-]{7,}\d|\b\d{10,15}\b/g)) hits.push(m[0]);
  return hits;
}

function jsonOf(clients) {
  return {
    generatedAt: new Date().toISOString(),
    clients: clients.map((c) => ({
      client: c.client,
      timestamp: c.timestamp ?? null,
      verdict: c.verdict,
      notRunFeatures: c.notRun ?? null,
      features: c.features.map((f) => ({
        id: f.id,
        name: f.name,
        noteLines: f.noteLines.map((x) => x.n),
        collections: f.collections,
        read: f.read,
        readAll: f.readAll,
        migrated: f.migrated,
        quarantined: f.quarantined,
        excluded: f.excluded,
        unaccounted: f.unaccounted,
        postgresRows: f.pgRows,
        migratedPercent:
          f.migrated != null && f.read - f.excluded > 0
            ? Math.round((1000 * f.migrated) / (f.read - f.excluded)) / 10
            : null,
        migratedOfReadPercent:
          f.migrated != null && f.read > 0 ? Math.round((1000 * f.migrated) / f.read) / 10 : null,
        quarantineReasons: f.quarantineReasons,
        excludedReasons: f.excludedReasons,
        notPresent: f.notPresent,
        alarms: f.alarms,
        verifier: f.verifier,
        status: f.status,
        ui: f.ui,
      })),
    })),
  };
}

// ---------- main --------------------------------------------------------------------------------------------------------------------
function build({
  runsDir,
  outDir,
  clients = ['iskm', 'rhythm'],
  workDir = WORK,
  toolDir = TOOL,
  write = true,
}) {
  const reg = parseRegistry(path.join(toolDir, 'registry', 'index.ts'));
  const notes = loadNotes(workDir);
  const ctx = { notes, log: loadLog(workDir), oq: loadOpenQuestions(toolDir) };
  const computed = clients.map((k) => {
    const run = newestRun(runsDir, k);
    if (!run || !run.report)
      return computeClient(
        { client: k, timestamp: run?.timestamp, report: null, ...(run || {}) },
        reg,
        notes,
      );
    return computeClient(run, reg, notes);
  });
  const results = [];
  const emit = (dir, list) => {
    const md = render(list, ctx);
    const json = JSON.stringify(jsonOf(list), null, 2);
    const hits = piiHits(md + json);
    if (hits.length)
      throw new Error(
        `PII-like strings found in the output (${hits.length}), nothing written. First: ${hits
          .slice(0, 3)
          .map((h) => h.slice(0, 2) + '***')
          .join(', ')}`,
      );
    if (write) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'migration-complete.md'), md);
      fs.writeFileSync(path.join(dir, 'migration-complete.json'), json + '\n');
    }
    results.push({ dir, md, json: JSON.parse(json) });
  };
  emit(outDir, computed);
  for (const c of computed) if (c.run) emit(c.run.dir, [c]);
  return results;
}

module.exports = { build, piiHits, pct, parseRegistry };

if (require.main === module) {
  const arg = (k, d) => {
    const i = process.argv.indexOf(k);
    return i > 0 ? process.argv[i + 1] : d;
  };
  try {
    const r = build({
      runsDir: arg('--runs', path.join(WORK, 'runs')),
      outDir: arg('--out', WORK),
      clients: arg('--clients', 'iskm,rhythm').split(','),
    });
    for (const x of r) console.log(`wrote ${path.join(x.dir, 'migration-complete.md')}`);
  } catch (e) {
    console.error(`migration-complete: ${e.message}`);
    process.exit(1);
  }
}
