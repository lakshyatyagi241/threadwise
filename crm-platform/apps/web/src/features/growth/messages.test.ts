import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { GROWTH_ACTION_TYPES, GROWTH_AUDIENCES, GROWTH_FEATURES } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { FEATURE_GROUPS } from './components/controls-tab';
import { visibleTabs } from './components/growth-screen';
import { ERROR_KEYS } from './lib/errors';

/**
 * The Growth screen's strings live in messages/en/growth.json under `growth`. next-intl prints the key path when a key is missing, so
 * these checks make sure no component asks for a key that is not there and everything built at run time exists.
 */
const WEB = resolve(__dirname, '../../..');
const ROOT = 'growth';

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
  JSON.parse(readFileSync(join(WEB, 'messages', 'en', 'growth.json'), 'utf8')) as Tree,
);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
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

/** Key prefixes the code builds from a value (a template string), so the literal scan cannot see them. */
const DYNAMIC = [
  `${ROOT}.errors.`,
  `${ROOT}.page.tabs.`,
  `${ROOT}.digest.highlights.`,
  `${ROOT}.inbox.types.`,
  `${ROOT}.inbox.titles.`,
  `${ROOT}.inbox.accept.`,
  `${ROOT}.inbox.facts.issue.`,
  `${ROOT}.audiences.kinds.`,
  `${ROOT}.audiences.errors.`,
  `${ROOT}.insights.propensity.features.`,
  `${ROOT}.insights.quality.suggestions.`,
  `${ROOT}.insights.quality.actionTypes.`,
  `${ROOT}.controls.groups.`,
  `${ROOT}.controls.features.`,
  `${ROOT}.controls.problem.`,
  // Chosen with a conditional, so the literal scan cannot see them.
  `${ROOT}.inbox.doneAccept`,
  `${ROOT}.inbox.doneDismiss`,
  `${ROOT}.inbox.facts.route`,
  `${ROOT}.autoStage.undoRefused`,
  `${ROOT}.autoStage.undoFailed`,
];

const files = [
  ...sourceFiles(join(WEB, 'src', 'features', 'growth')),
  ...sourceFiles(join(WEB, 'src', 'app', '(app)', '(growth)')),
];

describe('growth messages', () => {
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
    expect(checked).toBeGreaterThan(100);
    expect(missing).toEqual([]);
  });

  it('every key built at run time exists', () => {
    const features = [...GROWTH_FEATURES].flatMap((f) => [
      `controls.features.${f}.label`,
      `controls.features.${f}.hint`,
    ]);
    const dynamic = [
      ...ERROR_KEYS.map((k) => `errors.${k}`),
      ...['inbox', 'audiences', 'campaigns', 'insights', 'autoStage', 'assistant', 'controls'].map(
        (k) => `page.tabs.${k}`,
      ),
      ...[
        'hotLeads',
        'unanswered',
        'optOuts',
        'suggestionsPending',
        'campaignReplies',
        'lapsed',
      ].map((k) => `digest.highlights.${k}`),
      ...GROWTH_ACTION_TYPES.flatMap((k) => [
        `inbox.types.${k}`,
        `inbox.titles.${k}`,
        `inbox.accept.${k}`,
        `insights.quality.actionTypes.${k}`,
      ]),
      ...['missing_confirmation', 'payment_problem', 'wrong_info'].map(
        (k) => `inbox.facts.issue.${k}`,
      ),
      ...GROWTH_AUDIENCES.flatMap((k) => [
        `audiences.kinds.${k}.label`,
        `audiences.kinds.${k}.description`,
      ]),
      ...['forbidden', 'failed'].map((k) => `audiences.errors.${k}`),
      ...[
        'campaigns_opened_30d',
        'campaigns_received_30d',
        'messages_from_contact_30d',
        'links_clicked_30d',
        'groups',
        'has_email',
        'chat_messages_total',
        'age_days',
      ].map((k) => `insights.propensity.features.${k}`),
      ...['chat', 'engagement'].map((k) => `insights.quality.suggestions.${k}`),
      ...FEATURE_GROUPS.flatMap((g) => [
        `controls.groups.${g.id}.title`,
        `controls.groups.${g.id}.hint`,
      ]),
      ...[
        'inbox.doneAccept',
        'inbox.doneDismiss',
        'inbox.facts.routeOwner',
        'inbox.facts.routeLeastBusy',
        'autoStage.undoRefused',
        'autoStage.undoFailed',
      ],
      ...['numbers', 'serviceRules', 'customPhrases'].map((k) => `controls.problem.${k}`),
      ...features,
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

describe('the Controls tab', () => {
  it('places every switch of the contract in exactly one group', () => {
    const placed = FEATURE_GROUPS.flatMap((g) => g.features);
    expect([...placed].sort()).toEqual([...GROWTH_FEATURES].sort());
    expect(new Set(placed).size).toBe(placed.length);
  });

  it('shows a tab only for a part that is on, and always shows Controls', () => {
    const off = Object.fromEntries(GROWTH_FEATURES.map((f) => [f, false])) as Record<
      (typeof GROWTH_FEATURES)[number],
      boolean
    >;
    expect(visibleTabs({ features: off })).toEqual(['inbox', 'controls']);
    expect(
      visibleTabs({ features: { ...off, campaign_response: true, auto_stage: true } }),
    ).toEqual(['inbox', 'campaigns', 'autoStage', 'controls']);
    expect(
      visibleTabs({
        features: { ...off, service_rules: true, quality: true, broadcast_assistant: true },
      }),
    ).toEqual(['inbox', 'audiences', 'insights', 'assistant', 'controls']);
  });
});
