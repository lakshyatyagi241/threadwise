import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AIAG_RESPONDER_MODES } from '@crm/contracts';
import { STEP_KEYS } from './lib/builder-model';

/**
 * The domain's strings live in messages/<locale>/ai-agents-training.json under `aiTraining`. These checks make sure no component
 * asks for a key that is missing (next-intl would print the key path instead of text) and that Arabic has every key English has.
 */
const WEB = resolve(__dirname, '../../..');
const ROOT = 'aiTraining';

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
      readFileSync(join(WEB, 'messages', locale, 'ai-agents-training.json'), 'utf8'),
    ) as Tree,
  );
const en = load('en');
const ar = load('ar');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
  });
}

/** Literal `t('key')` calls, paired with the namespace of the nearest preceding `useTranslations`. */
function usedKeys(source: string): string[] {
  const decls = [...source.matchAll(/const\s+(\w+)\s*=\s*useTranslations\(\s*'([^']+)'\s*\)/g)].map(
    (m) => ({ name: m[1]!, ns: m[2]!, index: m.index ?? 0 }),
  );
  const out: string[] = [];
  for (const name of new Set(decls.map((d) => d.name))) {
    const call = new RegExp(`\\b${name}(?:\\.rich)?\\(\\s*'([^']+)'`, 'g');
    for (const c of source.matchAll(call)) {
      const at = c.index ?? 0;
      const owner = [...decls].reverse().find((d) => d.name === name && d.index < at);
      if (owner) out.push(`${owner.ns}.${c[1]}`);
    }
  }
  return out;
}

describe('ai-agents-training messages', () => {
  it('keeps every key under the root and every message non-empty', () => {
    for (const [key, text] of Object.entries(en)) {
      expect(key.startsWith(`${ROOT}.`), key).toBe(true);
      expect(text.trim(), key).not.toBe('');
    }
  });

  it('exist for every literal key the code asks for', () => {
    const files = [
      ...sourceFiles(join(WEB, 'src', 'features', 'ai-agents-training')),
      ...sourceFiles(join(WEB, 'src', 'app', '(app)', '(ai-agents-training)')),
    ];
    const missing: string[] = [];
    let checked = 0;
    for (const file of files) {
      for (const key of usedKeys(readFileSync(file, 'utf8'))) {
        checked++;
        if (!(key in en)) missing.push(`${file.replace(WEB, '')}: ${key}`);
      }
    }
    expect(checked).toBeGreaterThan(80);
    expect(missing).toEqual([]);
  });

  it('exist for the keys built at run time', () => {
    const dynamic = [
      ...STEP_KEYS.map((k) => `${ROOT}.builder.steps.${k}`),
      ...AIAG_RESPONDER_MODES.flatMap((m) => [
        `${ROOT}.responder.mode.${m}.label`,
        `${ROOT}.responder.mode.${m}.desc`,
      ]),
      ...['all', 'active', 'paused'].flatMap((s) => [
        `${ROOT}.list.view.${s}`,
        `${ROOT}.list.status.${s}`,
      ]),
      ...['healthy', 'empty', 'attention'].map((h) => `${ROOT}.list.health.${h}`),
      ...['helpful', 'friendly', 'formal', 'playful'].map(
        (t) => `${ROOT}.builder.identity.tones.${t}`,
      ),
      ...['name', 'greeting', 'model', 'tokens', 'temperature'].map(
        (p) => `${ROOT}.builder.problem.${p}`,
      ),
      ...['url', 'text', 'qa', 'file'].flatMap((k) => [
        `${ROOT}.knowledge.add.${k}.title`,
        `${ROOT}.knowledge.add.${k}.body`,
        `${ROOT}.knowledge.panel.${k}`,
        `${ROOT}.knowledge.placeholder.label.${k}`,
        `${ROOT}.knowledge.submit.${k}`,
        `${ROOT}.knowledge.kind.${k}`,
      ]),
      ...['ready', 'processing', 'failed'].map((s) => `${ROOT}.knowledge.state.${s}`),
      ...[
        'label',
        'url',
        'content',
        'question',
        'answer',
        'file',
        'file_type',
        'file_legacyDoc',
        'file_size',
        'file_empty',
        'tooLarge',
      ].map((p) => `${ROOT}.knowledge.problem.${p}`),
    ];
    expect(dynamic.filter((k) => !(k in en))).toEqual([]);
  });

  it('Arabic has every key English has, with the same placeholders', () => {
    expect(Object.keys(en).filter((k) => !(k in ar))).toEqual([]);
    expect(Object.keys(ar).filter((k) => !(k in en))).toEqual([]);
    const vars = (s: string) => [...s.matchAll(/\{(\w+)[,}]/g)].map((m) => m[1]).sort();
    for (const k of Object.keys(en)) expect(vars(ar[k]!), k).toEqual(vars(en[k]!));
  });
});
