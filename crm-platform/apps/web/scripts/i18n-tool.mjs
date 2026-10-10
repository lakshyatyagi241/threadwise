#!/usr/bin/env node
/**
 * Translation pipeline helper.
 *   plan  <chunkKeys>        writes $I18N_ROOT/in/<locale>/<NN>.json (default root /tmp/i18n): flat {"file.json::dotted.key": "English"} of the keys a
 *                            locale lacks, split in chunks of about <chunkKeys> keys (default 3000).
 *   apply <locale> <outFile> validates a translated flat file (same ICU argument names and rich tags as the English source,
 *                            non-empty, no leftover keys) and merges it into messages/<locale>/<file>.json.
 *   check [locale]           validates every message already on disk against English.
 */
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const msgRoot = join(root, 'messages');
const { LOCALES } = JSON.parse(readFileSync(join(root, 'scripts/.locales.json'), 'utf8'));
const files = readdirSync(join(msgRoot, 'en'))
  .filter((f) => f.endsWith('.json'))
  .sort();

const flat = (o, p = '', out = {}) => {
  for (const [k, v] of Object.entries(o)) {
    if (v && typeof v === 'object') flat(v, `${p}${k}.`, out);
    else out[`${p}${k}`] = v;
  }
  return out;
};
const load = (loc, f) => {
  const p = join(msgRoot, loc, f);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {};
};
const setDeep = (o, dotted, v) => {
  const parts = dotted.split('.');
  let cur = o;
  for (const part of parts.slice(0, -1)) {
    if (typeof cur[part] !== 'object' || cur[part] === null) cur[part] = {};
    cur = cur[part];
  }
  cur[parts.at(-1)] = v;
};

/** Argument names and rich-tag names of an ICU message (a small recursive parser; quoted text is skipped). */
function signature(msg) {
  const args = new Set();
  const tags = new Set();
  const s = String(msg);
  let ok = true;
  let i = 0;
  const parseText = (nested) => {
    while (i < s.length) {
      const c = s[i];
      if (c === "'") {
        if (s[i + 1] === "'") i += 2;
        else if (s[i + 1] === '{' || s[i + 1] === '}' || s[i + 1] === '<') {
          const end = s.indexOf("'", i + 2);
          i = end < 0 ? s.length : end + 1;
        } else i += 1;
      } else if (c === '{') {
        i++;
        parseArg();
      } else if (c === '}') {
        if (nested) return;
        ok = false;
        i++;
      } else if (c === '<') {
        const m = /^<\/?([A-Za-z][A-Za-z0-9]*)\s*\/?>/.exec(s.slice(i));
        if (m) {
          tags.add(m[1]);
          i += m[0].length;
        } else i++;
      } else i++;
    }
    if (nested) ok = false;
  };
  const parseArg = () => {
    const m = /^\s*([A-Za-z0-9_]+)\s*/.exec(s.slice(i));
    if (!m) {
      ok = false;
      return;
    }
    args.add(m[1]);
    i += m[0].length;
    if (s[i] === '}') {
      i++;
      return;
    }
    if (s[i] !== ',') {
      ok = false;
      return;
    }
    i++;
    const t = /^\s*([a-z]+)\s*/.exec(s.slice(i));
    if (!t) {
      ok = false;
      return;
    }
    i += t[0].length;
    if (['plural', 'select', 'selectordinal'].includes(t[1])) {
      if (s[i] !== ',') {
        ok = false;
        return;
      }
      i++;
      for (;;) {
        while (/\s/.test(s[i] ?? '')) i++;
        if (i >= s.length) {
          ok = false;
          return;
        }
        if (s[i] === '}') {
          i++;
          return;
        }
        const sel = /^[^\s{}]+/.exec(s.slice(i));
        if (!sel) {
          ok = false;
          return;
        }
        i += sel[0].length;
        while (/\s/.test(s[i] ?? '')) i++;
        if (s[i] !== '{') {
          if (sel[0].startsWith('offset:')) continue;
          ok = false;
          return;
        }
        i++;
        parseText(true);
        if (s[i] === '}') i++;
      }
    } else {
      while (i < s.length && s[i] !== '}') i++;
      i++;
    }
  };
  parseText(false);
  return { args, tags, balanced: ok };
}
const eq = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

function validate(en, tr) {
  if (en === '') return tr === '' ? null : 'English source is empty';
  const a = signature(en);
  const b = signature(tr);
  if (typeof tr !== 'string' || tr.trim() === '') return 'empty';
  if (!b.balanced) return 'unbalanced braces';
  // A translation may legitimately drop select/plural branch labels but must keep every named argument and tag.
  const missing = [...a.args].filter((x) => !b.args.has(x));
  const extra = [...b.args].filter((x) => !a.args.has(x));
  if (missing.length || extra.length) return `args differ (missing ${missing}, extra ${extra})`;
  if (!eq(a.tags, b.tags)) return `rich tags differ (${[...a.tags]} vs ${[...b.tags]})`;
  return null;
}

const [cmd, a1, a2] = process.argv.slice(2);

if (cmd === 'plan') {
  const size = Number(a1 ?? 3000);
  for (const loc of LOCALES.filter((l) => l !== 'en')) {
    const todo = {};
    for (const f of files) {
      const en = flat(load('en', f));
      const have = flat(load(loc, f));
      for (const [k, v] of Object.entries(en)) if (!(k in have)) todo[`${f}::${k}`] = v;
    }
    const entries = Object.entries(todo);
    const dir = `${process.env.I18N_ROOT ?? '/tmp/i18n'}/in/${loc}`;
    mkdirSync(dir, { recursive: true });
    const chunks = Math.max(1, Math.ceil(entries.length / size));
    const per = Math.ceil(entries.length / chunks);
    for (let c = 0; c < chunks; c++) {
      const slice = entries.slice(c * per, (c + 1) * per);
      if (!slice.length) continue;
      const nn = String(c + 1).padStart(2, '0');
      const base = c * per;
      writeFileSync(
        join(dir, `${nn}.json`),
        JSON.stringify(Object.fromEntries(slice.map(([, v], i) => [String(base + i + 1), v]))),
      );
      writeFileSync(
        join(dir, `${nn}.map.json`),
        JSON.stringify(Object.fromEntries(slice.map(([k], i) => [String(base + i + 1), k]))),
      );
    }
    console.log(loc, entries.length, 'keys,', chunks, 'chunks');
  }
} else if (cmd === 'apply') {
  const raw = JSON.parse(readFileSync(a2, 'utf8'));
  // Output files name their chunk by prefix (`03.json`, `03.a.json`): ids map back through in/<locale>/03.map.json.
  const nn = a2.split('/').pop().slice(0, 2);
  const mapFile = `${process.env.I18N_ROOT ?? '/tmp/i18n'}/in/${a1}/${nn}.map.json`;
  const idMap = existsSync(mapFile) ? JSON.parse(readFileSync(mapFile, 'utf8')) : null;
  const out = idMap
    ? Object.fromEntries(Object.entries(raw).map(([id, v]) => [idMap[id] ?? `?${id}::x`, v]))
    : raw;
  const bad = [];
  const byFile = {};
  for (const [id, tr] of Object.entries(out)) {
    const [f, key] = id.split('::');
    if (!files.includes(f)) {
      bad.push(`${id}: unknown file`);
      continue;
    }
    const en = flat(load('en', f))[key];
    if (en === undefined) {
      bad.push(`${id}: key not in English`);
      continue;
    }
    const why = validate(en, tr);
    if (why) {
      bad.push(`${id}: ${why}`);
      continue;
    }
    (byFile[f] ??= []).push([key, tr]);
  }
  // Parallel agents merge into the same locale files: take a per-file lock around read-modify-write.
  const lock = async (name, fn) => {
    const path = `/tmp/i18n/${name}.lock`;
    for (let n = 0; ; n++) {
      try {
        closeSync(openSync(path, 'wx'));
        break;
      } catch {
        if (n > 600) rmSync(path, { force: true });
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    try {
      fn();
    } finally {
      rmSync(path, { force: true });
    }
  };
  for (const [f, kv] of Object.entries(byFile)) {
    await lock(`${a1}-${f}`, () => {
      const dir = join(msgRoot, a1);
      mkdirSync(dir, { recursive: true });
      const cur = load(a1, f);
      for (const [k, v] of kv) setDeep(cur, k, v);
      writeFileSync(join(dir, f), JSON.stringify(cur, null, 2) + '\n');
    });
  }
  console.log(
    `${a1} ${a2.split('/').pop()}: applied ${Object.values(byFile).reduce((n, v) => n + v.length, 0)} of ${Object.keys(raw).length}; rejected ${bad.length}`,
  );
  if (bad.length) {
    writeFileSync(a2.replace(/\.json$/, '.rejected.txt'), bad.join('\n'));
    console.log(bad.slice(0, 5).join('\n'));
    process.exitCode = 1;
  }
} else if (cmd === 'check') {
  let bad = 0;
  for (const loc of a1 ? [a1] : LOCALES.filter((l) => l !== 'en')) {
    for (const f of files) {
      const en = flat(load('en', f));
      for (const [k, v] of Object.entries(flat(load(loc, f)))) {
        if (!(k in en)) continue;
        const why = validate(en[k], v);
        if (why) {
          bad++;
          if (bad <= 20) console.log(`${loc}/${f} ${k}: ${why}`);
        }
      }
    }
  }
  console.log(bad ? `${bad} problems` : 'all messages valid');
  process.exitCode = bad ? 1 : 0;
} else {
  console.error('usage: i18n-tool.mjs plan [n] | apply <locale> <out.json> | check [locale]');
  process.exit(2);
}
