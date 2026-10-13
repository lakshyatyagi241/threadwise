import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { FAQ_VARIATION_SOURCES } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import type { ErrorKey } from './lib/errors';
import type { DraftField, FieldProblem } from './lib/model';

/**
 * The domain's strings live in messages/en/faq-knowledge.json under `faq`. next-intl prints the key path when a key is missing, so
 * these checks make sure no component asks for a key that is not there, no string is dead, and everything built at run time exists.
 */
const WEB = resolve(__dirname, '../../..');
const ROOT = 'faq';

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
  JSON.parse(readFileSync(join(WEB, 'messages', 'en', 'faq-knowledge.json'), 'utf8')) as Tree,
);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    // `platform/` is the operator console's slice, with its own namespace and file.
    if (e.isDirectory()) return e.name === 'platform' ? [] : sourceFiles(p);
    return /\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
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

/** Keys the code builds from a value (a template string), so the literal scan cannot see them. */
const DYNAMIC = [
  `${ROOT}.list.paused`,
  `${ROOT}.list.activated`,
  `${ROOT}.editor.created`,
  `${ROOT}.editor.saved`,
  `${ROOT}.log.expand`,
  `${ROOT}.log.collapse`,
  `${ROOT}.log.testRun`,
  `${ROOT}.log.flowRun`,
  `${ROOT}.verify.chip.`,
  `${ROOT}.verify.body.`,
  `${ROOT}.errors.`,
  `${ROOT}.nav.tab.`,
  `${ROOT}.list.bulk.done.`,
  `${ROOT}.list.status.`,
  `${ROOT}.editor.problem.`,
  `${ROOT}.variations.source.`,
  `${ROOT}.decision.verdict.`,
  `${ROOT}.decision.tier.`,
  `${ROOT}.log.view.`,
  `${ROOT}.log.why.`,
  `${ROOT}.flowPicker.state.`,
  `${ROOT}.settings.sens.preset.`,
  `${ROOT}.settings.facts.`,
];

const files = [
  ...sourceFiles(join(WEB, 'src', 'features', 'faq-knowledge')),
  ...sourceFiles(join(WEB, 'src', 'app', '(app)', '(faq-knowledge)')),
];

describe('faq-knowledge messages', () => {
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
    expect(checked).toBeGreaterThan(150);
    expect(missing).toEqual([]);
  });

  it('every key built at run time exists', () => {
    const errorKeys: ErrorKey[] = [
      'network',
      'forbidden',
      'notFound',
      'conflict',
      'duplicateQuestion',
      'duplicateVariation',
      'limitReached',
      'flowNotFound',
      'flowNodeNotFound',
      'embeddingUnavailable',
      'engineDisabled',
      'modelNotAllowed',
      'validation',
      'rateLimited',
      'unexpected',
    ];
    const fields: DraftField[] = [
      'question',
      'answerText',
      'flowId',
      'flowNodeId',
      'category',
      'thresholdOverride',
    ];
    const problems: FieldProblem[] = ['required', 'tooLong', 'invalid'];
    const verdicts = [
      'answer',
      'below',
      'ambiguous',
      'noFaqs',
      'providerError',
      'notSent',
      'vetoed',
    ];
    const dynamic = [
      ...errorKeys.map((k) => `errors.${k}`),
      ...['faqs', 'test', 'unanswered', 'insights', 'settings'].map((k) => `nav.tab.${k}`),
      ...['pause', 'activate', 'delete'].map((k) => `list.bulk.done.${k}`),
      ...['active', 'paused'].map((k) => `list.status.${k}`),
      ...fields.flatMap((f) => problems.map((p) => `editor.problem.${f}.${p}`)),
      ...FAQ_VARIATION_SOURCES.map((s) => `variations.source.${s}`),
      ...verdicts.flatMap((v) => [`decision.verdict.${v}.title`, `decision.verdict.${v}.body`]),
      ...['exact', 'semantic', 'trigram'].flatMap((t) => [
        `decision.tier.${t}.name`,
        `decision.tier.${t}.body`,
      ]),
      ...['all', 'answered', 'unanswered', 'errors'].map((v) => `log.view.${v}`),
      ...[
        'answered',
        'flowStarted',
        'belowThreshold',
        'lowMargin',
        'noFaqs',
        'providerError',
        'notSent',
        'vetoed',
        'vetoedNoBar',
        'belowThresholdNoBar',
      ].map((k) => `log.why.${k}`),
      ...['testRun', 'flowRun'].map((k) => `log.${k}`),
      ...['confirmed', 'vetoed', 'failed', 'skipped'].flatMap((k) => [
        `verify.chip.${k}`,
        `verify.body.${k}`,
      ]),
      ...['live', 'off', 'draft'].map((s) => `flowPicker.state.${s}`),
      ...['strict', 'balanced', 'forgiving'].map((p) => `settings.sens.preset.${p}`),
      ...['faqs', 'variations'].map((k) => `settings.facts.${k}`),
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
