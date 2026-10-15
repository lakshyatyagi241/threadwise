import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  CHECKLIST_DETAIL_KEYS,
  COMPLIANCE_REGIMES,
  DND_REGISTRIES,
  INDIAN_NOTICE_LOCALES,
  SUBPROCESSOR_STATUSES,
} from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { ERROR_KEYS } from './lib/errors';

/**
 * The strings of this feature live in messages/<locale>/compliance-center.json under `compliance-center`. next-intl prints the key path
 * when a key is missing, so these checks make sure every key the components ask for exists, every key built at run time exists, and
 * every locale carries exactly the English keys.
 */
const WEB = resolve(__dirname, '../../..');
const ROOT = 'compliance-center';

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
const load = (locale: string) =>
  flatten(
    JSON.parse(
      readFileSync(join(WEB, 'messages', locale, 'compliance-center.json'), 'utf8'),
    ) as Tree,
  );
const en = load('en');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) && e.name !== 'testing.tsx'
      ? [p]
      : [];
  });
}

/** `const t = useTranslations('compliance-center.x')` then `t('a.b')` gives `compliance-center.x.a.b`. */
function usedKeys(source: string): string[] {
  const out: string[] = [];
  const decls = [
    ...source.matchAll(/const (\w+) = (?:useTranslations|await getTranslations)\('([^']+)'\)/g),
  ];
  decls.forEach((d, i) => {
    const name = d[1]!;
    const start = d.index! + d[0].length;
    const next = decls.slice(i + 1).find((x) => x[1] === name);
    const body = source.slice(start, next ? next.index : source.length);
    for (const m of body.matchAll(new RegExp(`\\b${name}\\('([^'$]+)'`, 'g'))) {
      out.push(`${d[2]!}.${m[1]}`);
    }
  });
  return out;
}

describe('compliance-center messages', () => {
  const locales = readdirSync(join(WEB, 'messages')).filter((l) =>
    readdirSync(join(WEB, 'messages', l)).includes('compliance-center.json'),
  );

  it('every one of the 21 locales has the file', () => {
    const all = readdirSync(join(WEB, 'messages'));
    expect(all).toHaveLength(21);
    expect(locales.sort()).toEqual(all.sort());
  });

  it('has no empty English text', () => {
    for (const [k, v] of Object.entries(en)) expect(v.trim(), k).not.toBe('');
  });

  it('every key a component asks for exists', () => {
    const missing: string[] = [];
    for (const file of [
      ...sourceFiles(join(WEB, 'src/features/compliance-center')),
      join(WEB, 'src/app/trust/[org]/page.tsx'),
    ]) {
      for (const key of usedKeys(readFileSync(file, 'utf8'))) {
        if (!(key in en)) missing.push(`${key} (${file.split(/[\\/]/).slice(-2).join('/')})`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('every key built at run time exists', () => {
    const need: string[] = [];
    for (const k of ERROR_KEYS) need.push(`${ROOT}.errors.${k}`);
    for (const r of COMPLIANCE_REGIMES) {
      for (const f of ['name', 'summary', 'extras']) need.push(`${ROOT}.profiles.items.${r}.${f}`);
    }
    for (const r of DND_REGISTRIES) {
      need.push(`${ROOT}.profiles.effective.registry.${r}`, `${ROOT}.windows.dnd.registry.${r}`);
    }
    for (const s of SUBPROCESSOR_STATUSES) need.push(`${ROOT}.subprocessors.status.${s}`);
    for (const d of [1, 2, 3, 4, 5, 6, 7]) need.push(`${ROOT}.windows.day.${d}`);
    for (const p of ['unset', 'no_minors', 'may_include_minors']) {
      need.push(`${ROOT}.contacts.children.policies.${p}`);
    }
    for (const p of [
      'httpsOnly',
      'email',
      'quietEmpty',
      'windowOrder',
      'daysEmpty',
      'englishFirst',
    ]) {
      need.push(`${ROOT}.problems.${p}`);
    }
    for (const s of ['built', 'partial', 'open']) need.push(`${ROOT}.checklist.status.${s}`);
    for (const [id, details] of Object.entries(CHECKLIST_DETAIL_KEYS)) {
      need.push(`${ROOT}.checklist.items.${id}.title`);
      for (const d of details) need.push(`${ROOT}.checklist.items.${id}.detail.${d}`);
    }
    expect(need.filter((k) => !(k in en))).toEqual([]);
  });

  it('offers the languages the DPDP profile asks for', () => {
    expect(INDIAN_NOTICE_LOCALES).toContain('hi');
    expect(INDIAN_NOTICE_LOCALES).not.toContain('en');
  });

  it('never says a workspace is compliant', () => {
    for (const [k, v] of Object.entries(en)) {
      expect(v, k).not.toMatch(
        /\byou are compliant\b|\bis compliant\b|\bfully compliant\b|\bguarantee/i,
      );
    }
  });

  it('every locale carries exactly the English keys', () => {
    for (const locale of locales) {
      const keys = Object.keys(load(locale)).sort();
      expect(keys, locale).toEqual(Object.keys(en).sort());
    }
  });
});
