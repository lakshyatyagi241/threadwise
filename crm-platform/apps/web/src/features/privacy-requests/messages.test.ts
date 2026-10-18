import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  LEGAL_HOLD_REASON_CATEGORIES,
  LEGAL_HOLD_SCOPES,
  LEGAL_HOLD_STATUSES,
  PRIVACY_DISPOSITIONS,
  PRIVACY_REQUEST_STATUSES,
  PRIVACY_REQUEST_TYPES,
  PRIVACY_REQUESTER_CHANNELS,
  PRIVACY_VERIFICATION_METHODS,
} from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { ERROR_KEYS } from './lib/errors';

/**
 * The strings of this feature live in messages/<locale>/privacy-requests.json under `privacy-requests`. next-intl prints the key path
 * when a key is missing, so these checks make sure every key the components ask for exists, everything built at run time exists, and
 * every locale carries exactly the English keys.
 */
const WEB = resolve(__dirname, '../../..');
const ROOT = 'privacy-requests';

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
      readFileSync(join(WEB, 'messages', locale, 'privacy-requests.json'), 'utf8'),
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

/**
 * `const t = useTranslations('privacy-requests.card')` then `t('x.y')` gives `privacy-requests.card.x.y`. A name is re-declared per
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

describe('privacy-requests messages', () => {
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
      ...PRIVACY_REQUEST_TYPES.flatMap((k) => [`${ROOT}.type.${k}`, `${ROOT}.typeHint.${k}`]),
      ...PRIVACY_REQUEST_STATUSES.map((k) => `${ROOT}.status.${k}`),
      ...PRIVACY_REQUESTER_CHANNELS.map((k) => `${ROOT}.channel.${k}`),
      ...PRIVACY_VERIFICATION_METHODS.map((k) => `${ROOT}.method.${k}`),
      ...PRIVACY_DISPOSITIONS.map((k) => `${ROOT}.disposition.${k}`),
      ...['delete', 'anonymise'].map((k) => `${ROOT}.detail.history.${k}`),
      ...['queued', 'running', 'ready', 'failed', 'expired'].map(
        (k) => `${ROOT}.detail.export.status.${k}`,
      ),
      ...[
        'created',
        'verification_started',
        'verified',
        'verification_failed',
        'hold_set',
        'hold_released',
        'rejected',
        'export_requested',
        'export_downloaded',
        'erase_previewed',
        'erased',
        'completed',
        'restricted',
        'erasure_queued',
        'restriction_lifted',
        'resume_skipped',
        'resume_failed',
        'other',
      ].map((k) => `${ROOT}.detail.timeline.event.${k}`),
      ...LEGAL_HOLD_REASON_CATEGORIES.map((k) => `${ROOT}.legalHold.category.${k}`),
      ...LEGAL_HOLD_SCOPES.map((k) => `${ROOT}.legalHold.scope.${k}`),
      ...LEGAL_HOLD_STATUSES.map((k) => `${ROOT}.legalHold.status.${k}`),
      ...['insert', 'update', 'delete', 'other'].map((k) => `${ROOT}.legalHold.detail.action.${k}`),
      ...['reviewBy', 'reviewOverdue'].map((k) => `${ROOT}.legalHold.banner.${k}`),
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
    },
  );
});
