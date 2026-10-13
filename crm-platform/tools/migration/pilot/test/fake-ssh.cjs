#!/usr/bin/env node
/* Fake `ssh` for the exporter tests. Reads the mongosh script from stdin. Invented data only. Modes via FAKE_MODE. */
'use strict';
const fs = require('fs');
const vm = require('vm');

const mode = process.env.FAKE_MODE || 'vm';
const log = process.env.FAKE_LOG;
const script = fs.readFileSync(0, 'utf8');
const i0 = script.indexOf('connect(') + 8;
const URI = JSON.parse(script.slice(i0, script.indexOf(');', i0)));
if (log)
  fs.appendFileSync(
    log,
    JSON.stringify({
      argv: process.argv.slice(2),
      stdin: script.split(JSON.stringify(URI)).join('<URI>'),
    }) + '\n',
  );

class Ext {
  constructor(x) {
    this.__ext = x;
  }
}
const oid = (i) => new Ext({ $oid: String(i).padStart(24, '0') });
const N = Number(process.env.FAKE_N || 5);

function dataset(name) {
  if (name === 'nothere') return null;
  const docs = [];
  for (let i = 1; i <= N; i++) {
    const d = {
      _id: oid(i),
      name: `Contact ${i} \u00e9\u00e8 \u2603 \ud83d\ude00`,
      createdAt: new Date(Date.UTC(2024, 0, i)),
      amount: new Ext({ $numberDecimal: `${i}.50` }),
      big: new Ext({ $numberLong: String(2 ** 40 + i) }),
      note: 'nul:\u0000:end',
      bad: 'lone:\ud800:end',
    };
    if (name === 'user')
      Object.assign(d, {
        email: `u${i}@example.invalid`,
        password: '$2b$10$HASHHASHHASH',
        passwordHash: 'x',
        profile: { reset_token: 'T0K', theme: 'dark', keys: [{ api_key: 'K', ok: 1 }] },
        password_changed_at: new Date(0),
      });
    docs.push(d);
  }
  if (process.env.FAKE_BIG === '1')
    docs.push({ _id: oid(9999), blob: 'x'.repeat(2 * 1024 * 1024) });
  return docs;
}
function ejson(v) {
  return JSON.stringify(v, function (k, val) {
    const raw = this[k];
    if (raw instanceof Date) return { $date: { $numberLong: String(raw.getTime()) } };
    if (raw instanceof Ext) return raw.__ext;
    return val;
  });
}

let out = '';
const print = (s) => {
  out += s + '\n';
};
function runVm() {
  const sandbox = {
    print,
    EJSON: {
      stringify: (d, o) => {
        if (!o || o.relaxed !== false) throw new Error('canonical EJSON required');
        return ejson(d);
      },
    },
    connect: (u) => {
      if (u !== URI) throw new Error('bad uri');
      return {
        getSiblingDB: () => ({
          getCollectionNames: () => [
            'contact_list',
            'user',
            'chatbot_misc_config',
            'auth_logs',
            'project',
            'unlisted_thing',
            'system.profile',
          ],
          getCollection: (n) => ({
            countDocuments: () =>
              process.env.FAKE_COUNT ? Number(process.env.FAKE_COUNT) : dataset(n).length,
            find: (_f, proj) => {
              let docs = dataset(n).map((d) => {
                const c = { ...d };
                for (const k of Object.keys(proj || {})) if (proj[k] === 0) delete c[k];
                return c;
              });
              const cur = {
                sort: () => cur,
                limit: (x) => ((docs = docs.slice(0, x)), cur),
                hasNext: () => docs.length > 0,
                next: () => docs.shift(),
              };
              return cur;
            },
          }),
        }),
      };
    },
  };
  // collection missing: the template checks getCollectionNames().includes(name); emulate by naming
  const names = [
    'contact_list',
    'user',
    'chatbot_misc_config',
    'auth_logs',
    'project',
    'unlisted_thing',
    'extra',
    'contact_notes',
  ];
  const orig = sandbox.connect;
  sandbox.connect = (u) => {
    const c = orig(u);
    const g = c.getSiblingDB;
    c.getSiblingDB = (d) => {
      const db = g(d);
      db.getCollectionNames = () => names;
      return db;
    };
    return c;
  };
  vm.runInNewContext(script, sandbox);
}

const emit = (
  str,
  { chunk = Number(process.env.FAKE_CHUNK || 0), noise = process.env.FAKE_NOISE === '1' } = {},
) => {
  if (noise)
    str =
      'Current Mongosh Log ID: abc123\r\n' + str.replace(/\n/, '\nUsing MongoDB: 7.0\n') + '... \n';
  const b = Buffer.from(str, 'utf8');
  if (!chunk) return process.stdout.write(b);
  for (let i = 0; i < b.length; i += chunk) process.stdout.write(b.subarray(i, i + chunk));
};

if (mode === 'hostkey') {
  process.stderr.write('Host key verification failed.\n');
  process.exit(255);
} else if (mode === 'leak') {
  process.stderr.write(`mongosh: cannot connect with ${URI}\n`);
  process.stdout.write(`@@COUNT 0\n@@END 0\n`);
  process.exit(1);
} else if (mode === 'error-mid') {
  emit(
    `@@COUNT 5\n@@D {"_id":{"$oid":"000000000000000000000001"}}\n@@D {"_id":{"$oid":"000000000000000000000002"}}\n`,
  );
  process.stderr.write('MongoServerError: cursor died\n');
  process.exit(1);
} else if (mode === 'truncated') {
  emit(
    `@@COUNT 2\n@@D {"_id":{"$oid":"000000000000000000000001"}}\n@@D {"_id":{"$oid":"00000000000`,
  );
  process.exit(0);
} else if (mode === 'nonzero') {
  emit(`@@COUNT 1\n@@D {"_id":{"$oid":"000000000000000000000001"}}\n@@STRIP 0\n@@END 1\n`);
  process.exit(3);
} else if (mode === 'short') {
  emit(`@@COUNT 10\n@@D {"a":1}\n@@D {"a":2}\n@@END 2\n`);
  process.exit(0);
} else if (mode === 'corrupt') {
  emit(`@@COUNT 1\n@@D {"a":\n@@END 1\n`);
  process.exit(0);
} else {
  runVm();
  emit(out);
  process.exit(0);
}
