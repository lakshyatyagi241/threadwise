import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  CONSENT_CHANNELS,
  CONSENT_EVIDENCE_KEYS,
  CONSENT_GATE_REASONS,
  CONSENT_SOURCES,
  MINOR_RULES,
  PRIVACY_FLAG_KINDS,
  PRIVACY_FLAG_SOURCES,
} from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { ERROR_KEYS } from './lib/errors';

/**
 * The strings of this feature live in messages/<locale>/contact-consent.json under `contact-consent`. next-intl prints the key path
 * when a key is missing, so these checks make sure every key the components ask for exists, everything built at run time exists, and
 * every locale carries exactly the English keys.
 */
const WEB = resolve(__dirname, '../../..');
const ROOT = 'contact-consent';

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
    JSON.parse(readFileSync(join(WEB, 'messages', locale, 'contact-consent.json'), 'utf8')) as Tree,
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

/**
 * `const t = useTranslations('contact-consent.card')` then `t('x.y')` gives `contact-consent.card.x.y`. A name is re-declared per
 * component, so each declaration owns the text up to the next declaration of the same name. Dynamic keys are checked below.
 */
function usedKeys(source: string): string[] {
  const out: string[] = [];
  const decls = [...source.matchAll(/const (\w+) = useTranslations\('([^']+)'\)/g)];
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

describe('contact-consent messages', () => {
  it('every key a component asks for exists in English', () => {
    const missing: string[] = [];
    for (const f of sourceFiles(join(__dirname))) {
      for (const k of usedKeys(readFileSync(f, 'utf8'))) if (!(k in en)) missing.push(`${f}: ${k}`);
    }
    expect(missing).toEqual([]);
  });

  it('keys built at run time exist', () => {
    const need = [
      ...ERROR_KEYS.map((k) => `${ROOT}.errors.${k}`),
      ...CONSENT_CHANNELS.map((c) => `${ROOT}.card.channel.${c}`),
      ...CONSENT_SOURCES.map((s) => `${ROOT}.card.source.${s}`),
      ...CONSENT_EVIDENCE_KEYS.map((k) => `${ROOT}.card.evidence.${k}`),
      // Privacy flags (BL-180): the history lines, the minor rule texts, the sources and every reason the gate can answer.
      ...PRIVACY_FLAG_KINDS.flatMap((k) => [
        `${ROOT}.card.privacy.event.${k}.on`,
        `${ROOT}.card.privacy.event.${k}.off`,
      ]),
      ...MINOR_RULES.map((r) => `${ROOT}.card.privacy.rule.${r}`),
      ...PRIVACY_FLAG_SOURCES.map((s) => `${ROOT}.card.source.${s}`),
      ...CONSENT_GATE_REASONS.map((r) => `${ROOT}.gate.reasons.${r}`),
      ...['optedOut', 'subscribed', 'none'].map((s) => `${ROOT}.card.status.${s}`),
      ...['granted', 'withdrawn'].flatMap((s) => [
        `${ROOT}.card.state.${s}`,
        `${ROOT}.card.action.${s}`,
      ]),
      ...['opts_out', 'opts_in', 'no_match', 'detection_off'].map(
        (o) => `${ROOT}.test.outcome.${o}`,
      ),
      ...['noOptOutWord', 'badLang'].map((p) => `${ROOT}.settings.problems.${p}`),
    ];
    expect(need.filter((k) => !(k in en))).toEqual([]);
  });

  const locales = readdirSync(join(WEB, 'messages')).filter((l) => l !== 'en');
  it('has all 21 locales', () => {
    expect(locales).toHaveLength(20);
  });
  it.each(locales)(
    '%s has exactly the English keys, translated, with the same placeholders',
    (locale) => {
      const l = load(locale);
      expect(Object.keys(l).sort()).toEqual(Object.keys(en).sort());
      const args = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      for (const [k, v] of Object.entries(en)) {
        expect(args(l[k]!), `${locale} ${k}`).toEqual(args(v));
        expect(l[k]!.trim(), `${locale} ${k}`).not.toBe('');
      }
      // Words that must stay a literal placeholder.
      expect(l[`${ROOT}.lang.replyHint`]).toContain('{{name}}');
    },
  );
});
