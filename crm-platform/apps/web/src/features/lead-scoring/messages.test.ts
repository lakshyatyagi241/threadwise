import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { LSC_INTENTS, LSC_RUN_STATUSES, LSC_RUN_TRIGGERS } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { ERROR_KEYS } from './lib/errors';
import { RUN_REASONS } from './lib/runs-model';

/**
 * The workspace side's strings live in messages/en/lead-scoring.json under `lead-scoring`. next-intl prints the key path when a key
 * is missing, so these checks make sure no component asks for a key that is not there and everything built at run time exists.
 */
const WEB = resolve(__dirname, '../../..');
const ROOT = 'lead-scoring';

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
const en = flatten(
  JSON.parse(readFileSync(join(WEB, 'messages', 'en', 'lead-scoring.json'), 'utf8')) as Tree,
);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    // `platform/` is the operator console's slice, with its own namespace and file.
    if (e.isDirectory()) return e.name === 'platform' ? [] : sourceFiles(p);
    return /\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) && e.name !== 'testing.tsx'
      ? [p]
      : [];
  });
}

function usedKeys(source: string): string[] {
  const decls = [
    ...source.matchAll(
      /const\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*'([^']+)'\s*\)/g,
    ),
  ].map((m) => ({ name: m[1]!, ns: m[2]!, index: m.index ?? 0 }));
  const out: string[] = [];
  for (const name of new Set(decls.map((d) => d.name))) {
    const call = new RegExp(`\\b${name}(?:\\.rich|\\.has)?\\(\\s*'([^']+)'`, 'g');
    for (const c of source.matchAll(call)) {
      const owner = [...decls].reverse().find((d) => d.name === name && d.index < (c.index ?? 0));
      if (owner) out.push(`${owner.ns}.${c[1]}`);
    }
  }
  return out;
}

/** Key prefixes the code builds from a value (a template string), so the literal scan cannot see them. */
const DYNAMIC = [
  `${ROOT}.badge.band.`,
  `${ROOT}.card.band.`,
  `${ROOT}.errors.`,
  `${ROOT}.scoreErrors.`,
  `${ROOT}.runs.status.`,
  `${ROOT}.runs.reason.`,
  `${ROOT}.runs.trigger.`,
  `${ROOT}.runs.costSource.`,
  `${ROOT}.runs.billed.`,
  `${ROOT}.log.status.`,
  `${ROOT}.settings.sent.`,
  `${ROOT}.settings.notSent.`,
  `${ROOT}.settings.chat.masked.`,
  `${ROOT}.settings.chat.rules.`,
  `${ROOT}.insight.intent.`,
  `${ROOT}.insight.signal.`,
  `${ROOT}.settings.cost.payerBy.`,
  `${ROOT}.settings.banner.key`,
  `${ROOT}.settings.backfill.noRight`,
  `${ROOT}.settings.backfill.notReady`,
];

const files = [
  ...sourceFiles(join(WEB, 'src', 'features', 'lead-scoring')),
  ...sourceFiles(join(WEB, 'src', 'app', '(app)', '(lead-scoring)')),
];

describe('lead-scoring messages', () => {
  it('every message is non-empty and sits under the domain root', () => {
    for (const [key, text] of Object.entries(en)) {
      expect(text.trim(), key).not.toBe('');
      expect(key.startsWith(`${ROOT}.`), key).toBe(true);
    }
  });

  it('every key the code asks for exists', () => {
    const missing: string[] = [];
    let checked = 0;
    for (const file of files)
      for (const key of usedKeys(readFileSync(file, 'utf8'))) {
        checked++;
        if (!(key in en)) missing.push(`${file.replace(WEB, '')}: ${key}`);
      }
    expect(checked).toBeGreaterThan(80);
    expect(missing).toEqual([]);
  });

  it('every key built at run time exists', () => {
    const dynamic = [
      ...['cold', 'warm', 'hot'].flatMap((b) => [`badge.band.${b}`, `card.band.${b}`]),
      ...ERROR_KEYS.flatMap((k) => [`errors.${k}`, `scoreErrors.${k}`]),
      ...LSC_RUN_STATUSES.flatMap((s) => [`runs.status.${s}`, `log.status.${s}`]),
      ...[...RUN_REASONS, 'other'].map((r) => `runs.reason.${r}`),
      ...LSC_RUN_TRIGGERS.map((t) => `runs.trigger.${t}`),
      ...['vendor', 'estimate'].map((c) => `runs.costSource.${c}`),
      ...['admin', 'workspace'].map((b) => `runs.billed.${b}`),
      ...['stage', 'source', 'tags', 'deals', 'activity', 'company'].map(
        (k) => `settings.sent.${k}`,
      ),
      ...['name', 'email', 'phone', 'messages', 'messagesChat'].map((k) => `settings.notSent.${k}`),
      ...['phone', 'email', 'card', 'name'].map((k) => `settings.chat.masked.${k}`),
      ...['quiet', 'enough', 'person', 'closing'].map((k) => `settings.chat.rules.${k}`),
      ...LSC_INTENTS.map((k) => `insight.intent.${k}`),
      ...['askedPrice', 'readyToBuy', 'objection', 'urgent'].map((k) => `insight.signal.${k}`),
      ...['workspace', 'admin', 'none'].map((k) => `settings.cost.payerBy.${k}`),
      ...['keyWorkspace', 'keyAdmin'].map((k) => `settings.banner.${k}`),
      ...['noRight', 'notReady'].map((k) => `settings.backfill.${k}`),
    ];
    expect(dynamic.filter((k) => !(`${ROOT}.${k}` in en))).toEqual([]);
  });

  it('has no dead strings', () => {
    const used = new Set<string>();
    for (const file of files) for (const key of usedKeys(readFileSync(file, 'utf8'))) used.add(key);
    const unused = Object.keys(en).filter(
      (k) => !used.has(k) && !DYNAMIC.some((p) => k.startsWith(p)),
    );
    expect(unused).toEqual([]);
  });
});
