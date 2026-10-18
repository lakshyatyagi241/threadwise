import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DPDP_CATALOG,
  DPDP_CHECK_RESULTS,
  DPDP_CHECK_SOURCES,
  DPDP_GROUPS,
  DPDP_ITEM_STATUSES,
  DPDP_OWNERS,
  DPDP_PENALTY_TIERS,
} from '@crm/contracts';
import {
  ALL_CHECK_KEYS,
  CHECK_DETAILS,
  ERROR_KINDS,
  GENERIC_DETAILS,
  STATUS_FILTERS,
  checkMessageKey,
} from './platform/logic';

/**
 * The register's strings live in messages/en/dpdp-register-admin.json under `dpdp-register-admin`. next-intl prints the key path when
 * a key is missing, so these checks make sure no component asks for a key that is not there, that every obligation, check and
 * detail the API can return has its text, and that no text says what the register must never say.
 */
const WEB = resolve(__dirname, '../../..');
const ROOT = 'dpdp-register-admin';

type Tree = { [key: string]: string | Tree };
function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}
const tree = JSON.parse(readFileSync(join(WEB, 'messages', 'en', `${ROOT}.json`), 'utf8')) as Tree;
const en = flatten(tree);
const has = (key: string) => `${ROOT}.${key}` in en;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
  });
}

/** `t('key')` calls, paired with the namespace of the nearest earlier `useTranslations(...)` or `getTranslations(...)` that bound that name. */
function usedKeys(source: string): string[] {
  const decls = [
    ...source.matchAll(
      /const\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*(?:'([^']+)'|(NS))\s*\)/g,
    ),
  ].map((m) => ({ name: m[1]!, ns: m[2] ?? '$NS', index: m.index ?? 0 }));
  const nsConst = /const NS = '([^']+)'/.exec(source)?.[1];
  const out: string[] = [];
  for (const name of new Set(decls.map((d) => d.name))) {
    const call = new RegExp(`\\b${name}(?:\\.rich|\\.has)?\\(\\s*'([^']+)'`, 'g');
    for (const c of source.matchAll(call)) {
      const owner = [...decls].reverse().find((d) => d.name === name && d.index < (c.index ?? 0));
      if (!owner) continue;
      const ns = owner.ns === '$NS' ? nsConst : owner.ns;
      if (ns) out.push(`${ns}.${c[1]}`);
    }
  }
  return out.filter((k) => k.startsWith(`${ROOT}.`));
}

describe('dpdp-register-admin messages', () => {
  it('keeps every key under the domain root, every message non-empty, and no dot inside a key', () => {
    for (const [key, text] of Object.entries(en)) {
      expect(key.startsWith(`${ROOT}.`), key).toBe(true);
      expect(text.trim(), key).not.toBe('');
    }
    const dotted: string[] = [];
    const walk = (t: Tree, path: string) => {
      for (const [k, v] of Object.entries(t)) {
        if (k.includes('.')) dotted.push(`${path}${k}`);
        if (typeof v !== 'string') walk(v, `${path}${k}/`);
      }
    };
    walk(tree, '');
    expect(dotted).toEqual([]);
  });

  it('every key the code asks for exists', () => {
    const files = [
      ...sourceFiles(join(WEB, 'src', 'features', 'dpdp-register')),
      ...sourceFiles(join(WEB, 'src', 'app', '(admin)', '(dpdp-register)')),
    ];
    const missing: string[] = [];
    let checked = 0;
    for (const file of files) {
      for (const key of usedKeys(readFileSync(file, 'utf8'))) {
        checked++;
        if (!(key in en)) missing.push(`${file.replace(WEB, '')}: ${key}`);
      }
    }
    expect(checked).toBeGreaterThan(40);
    expect(missing).toEqual([]);
  });

  it('has a title for each of the 47 obligations, and for nothing else', () => {
    expect(DPDP_CATALOG).toHaveLength(47);
    const ids = DPDP_CATALOG.map((i) => i.id);
    expect(ids[0]).toBe('r01');
    expect(ids[46]).toBe('r47');
    expect(ids.filter((id) => !has(`items.${id}.title`))).toEqual([]);
    const titled = Object.keys(en)
      .map((k) => /^dpdp-register-admin\.items\.(r\d\d)\.title$/.exec(k)?.[1])
      .filter(Boolean);
    expect(titled.sort()).toEqual([...ids].sort());
    expect(Object.keys(en).filter((k) => k.includes('.items.') && !k.endsWith('.title'))).toEqual(
      [],
    );
  });

  it('keeps each obligation title under 12 words', () => {
    const long = DPDP_CATALOG.map(
      (i) => [i.id, en[`${ROOT}.items.${i.id}.title`]!] as const,
    ).filter(([, title]) => title.trim().split(/\s+/).length >= 12);
    expect(long).toEqual([]);
  });

  it('has a heading for each group, A to I, that starts with the plan heading', () => {
    expect(DPDP_GROUPS.filter((g) => !has(`groups.${g}`))).toEqual([]);
    expect(en[`${ROOT}.groups.A`]).toBe('Grounds, notice, consent (ss4 to 7, rule 3)');
    expect(en[`${ROOT}.groups.D`]).toBe('Security (s8(4), (5), rule 6)');
    expect(en[`${ROOT}.groups.I`]).toBe('Governance and enforcement (ss27 to 33, rule 19)');
  });

  it('has a text for every status, check result, source, owner and penalty tier the contract lists', () => {
    const keys = [
      ...DPDP_ITEM_STATUSES.map((s) => `status.${s}`),
      ...DPDP_CHECK_RESULTS.map((r) => `result.${r}`),
      ...DPDP_CHECK_SOURCES.map((s) => `source.${s}`),
      ...DPDP_OWNERS.map((o) => `owners.${o}`),
      ...DPDP_PENALTY_TIERS.map((t) => `tiers.${t}`),
      ...['consent_managers', 'main_duties'].map((m) => `summary.milestones.names.${m}`),
    ];
    expect(keys.filter((k) => !has(k))).toEqual([]);
  });

  it('has the texts for the keys the code builds from a value', () => {
    const keys = [
      ...ERROR_KINDS.map((k) => `errors.${k}`),
      ...['noteShort', 'noteLong', 'link', 'range'].map((p) => `attest.problems.${p}`),
      ...['pass', 'fail'].map((r) => `attest.result.${r}`),
      ...STATUS_FILTERS.filter((f) => f !== 'all').map((f) => `status.${f}`),
    ];
    expect(keys.filter((k) => !has(k))).toEqual([]);
  });

  it('has a title for every check key and a text for every detail that check can return', () => {
    const missing: string[] = [];
    for (const key of ALL_CHECK_KEYS) {
      const flat = checkMessageKey(key);
      if (!has(`checks.${flat}.title`)) missing.push(`checks.${flat}.title`);
      for (const detail of CHECK_DETAILS[key]) {
        if (!has(`checks.${flat}.details.${detail}`))
          missing.push(`checks.${flat}.details.${detail}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('has the shared texts for the details every check can return, and the fallback', () => {
    expect([...GENERIC_DETAILS, 'unrecognised'].filter((d) => !has(`details.${d}`))).toEqual([]);
  });

  it('has no text for a check or detail that does not exist', () => {
    const checks = Object.keys(en)
      .map((k) => /^dpdp-register-admin\.checks\.(\w+)\./.exec(k)?.[1])
      .filter((k): k is string => Boolean(k));
    const known = new Set(ALL_CHECK_KEYS.map(checkMessageKey));
    expect([...new Set(checks)].filter((k) => !known.has(k))).toEqual([]);
    const stray = Object.keys(en).filter((k) => {
      const m = /^dpdp-register-admin\.checks\.(\w+)\.details\.(\w+)$/.exec(k);
      if (!m) return false;
      const key = ALL_CHECK_KEYS.find((c) => checkMessageKey(c) === m[1]);
      return !key || !CHECK_DETAILS[key].includes(m[2]!);
    });
    expect(stray).toEqual([]);
  });

  // The API sends each detail as a key from a closed set. This reads the two files that set them, so a detail added there without a
  // text here fails this test instead of showing a code to an operator.
  const API = resolve(WEB, '..', 'api', 'src', 'modules', 'dpdp-register');
  const sources = ['probes.ts', 'rules.ts'].map((f) => join(API, f));
  it.skipIf(!sources.every((f) => existsSync(f)))('covers every detail the API can return', () => {
    const emitted = new Set<string>();
    for (const file of sources) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/detail:\s*'([a-z_]+)'/g)) emitted.add(m[1]!);
      for (const m of text.matchAll(/'(attested_(?:pass|fail))'/g)) emitted.add(m[1]!);
    }
    expect(emitted.size).toBeGreaterThan(20);
    const known = new Set<string>([...GENERIC_DETAILS, ...Object.values(CHECK_DETAILS).flat()]);
    expect([...emitted].filter((d) => !known.has(d))).toEqual([]);
    // the other way round: a text for a detail nothing sends is dead, except the three the page picks from the params
    const picked = new Set([
      'region_unrecognised_host',
      'default_opt_in_counts',
      'default_opt_out_counts',
    ]);
    expect([...known].filter((d) => !emitted.has(d) && !picked.has(d))).toEqual([]);
  });

  it('says the disclaimer exactly, and never says compliant or certified anywhere', () => {
    expect(en[`${ROOT}.page.disclaimer`]).toBe(
      'Tracks what the platform does today against the DPDP Act and Rules. It is not a compliance certificate.',
    );
    const offending = Object.entries(en).filter(([, text]) =>
      /\b(compliant|certified|certifies|certify)\b/i.test(text),
    );
    expect(offending).toEqual([]);
  });
});
