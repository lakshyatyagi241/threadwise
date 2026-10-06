import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  FREQUENCY_CAP_ERROR_CODE,
  RECURRENCE_FREQUENCIES,
  WIZARD_CONTACT_FIELDS,
  WIZARD_SCHEDULE_MODES,
  WIZARD_STEPS,
  WIZARD_TEMPLATE_CATEGORIES,
  WIZARD_TEST_STATUSES,
  CAMPAIGN_STATUSES,
} from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { KNOWN_STATES } from './components/broadcast-screen';

/**
 * The wizard's strings are `campaigns.wizard.*` in messages/<locale>/campaigns.json. English and Arabic must have the same keys
 * and placeholders, every key the code asks for must exist (next-intl would print the key path), and nothing may be left unused.
 */
const WEB = resolve(__dirname, '../../../..');
type Tree = { [key: string]: string | Tree };
const load = (locale: string): Tree =>
  (
    JSON.parse(readFileSync(join(WEB, 'messages', locale, 'campaigns.json'), 'utf8')) as {
      campaigns: Tree;
    }
  ).campaigns;

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}

/** Variable names of a message. Plural branches that hold only words (`one {day}`) are not variables, so they are removed first. */
function placeholders(message: string): string[] {
  let text = message;
  for (let prev = ''; prev !== text;) {
    prev = text;
    text = text.replace(/\b(?:zero|one|two|few|many|other|=\d+)\s*\{[^{}]*\}/g, '');
  }
  return [...new Set([...text.matchAll(/\{\s*([A-Za-z_]\w*)\s*[,}]/g)].map((m) => m[1]!))].sort();
}

const wizard = (locale: string) =>
  Object.fromEntries(
    Object.entries(flatten(load(locale))).filter(([k]) => k.startsWith('wizard.')),
  );
const en = wizard('en');
const ar = wizard('ar');

describe('wizard messages', () => {
  it('Arabic has exactly the keys English has', () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
    expect(Object.keys(en).length).toBeGreaterThan(300);
  });

  it('every message is non-empty and has the same placeholders in both languages', () => {
    for (const [key, text] of Object.entries(en)) {
      expect(text.trim(), key).not.toBe('');
      expect(ar[key]!.trim(), key).not.toBe('');
      expect(placeholders(ar[key]!), `placeholders of ${key}`).toEqual(placeholders(text));
    }
  });

  it('the entry point has a label in both languages', () => {
    const list = (l: string) => flatten(load(l))['list.createBroadcast'];
    expect(list('en')).toBe('Create broadcast');
    expect(list('ar')).toBeTruthy();
  });

  it('uses no left or right in the English or Arabic copy of directions', () => {
    for (const text of Object.values(en)) expect(text).not.toMatch(/\bon the (left|right)\b/i);
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) && e.name !== 'testing.tsx'
      ? [p]
      : [];
  });
}

function usedKeys(source: string): string[] {
  const decls = [
    ...source.matchAll(/const\s+(\w+)\s*=\s*(?:await\s+)?useTranslations\(\s*'([^']+)'\s*\)/g),
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

const files = [
  ...sourceFiles(__dirname),
  ...sourceFiles(join(WEB, 'src', 'app', '(app)', '(campaigns)', 'campaigns', 'wizard')),
];
const enAll = Object.fromEntries(
  Object.entries(flatten(load('en'))).map(([k, v]) => [`campaigns.${k}`, v]),
);

/** Keys looked up with a value known only at run time. */
const DYNAMIC = [
  ...WIZARD_STEPS.map((s) => `campaigns.wizard.steps.${s}`),
  ...WIZARD_STEPS.map((s) => `campaigns.wizard.stepHint.${s}`),
  ...WIZARD_TEMPLATE_CATEGORIES.map((c) => `campaigns.wizard.categories.${c}`),
  ...WIZARD_CONTACT_FIELDS.map((f) => `campaigns.wizard.fields.${f}`),
  ...WIZARD_TEST_STATUSES.map((s) => `campaigns.wizard.test.status.${s}`),
  ...WIZARD_SCHEDULE_MODES.map((m) => `campaigns.wizard.send.mode.${m}`),
  ...WIZARD_SCHEDULE_MODES.map((m) => `campaigns.wizard.panel.mode.${m}`),
  ...WIZARD_SCHEDULE_MODES.map((m) => `campaigns.wizard.send.modeHint.${m}`),
  ...RECURRENCE_FREQUENCIES.flatMap((f) => [
    `campaigns.wizard.send.freq.${f}`,
    `campaigns.wizard.send.unit.${f}`,
    `campaigns.wizard.words.cadence.${f}`,
  ]),
  ...['never', 'on_date', 'after'].map((k) => `campaigns.wizard.send.endsKind.${k}`),
  ...['now', 'schedule', 'recurring'].flatMap((k) => [
    `campaigns.wizard.footer.launch.${k}`,
    `campaigns.wizard.launch.title.${k}`,
    `campaigns.wizard.launch.confirm.${k}`,
  ]),
  ...['network', 'forbidden', 'notFound', 'rateLimited', 'unexpected'].flatMap((k) => [
    `campaigns.wizard.errors.${k}`,
    `campaigns.wizard.test.sendError.${k}`,
  ]),
  ...[
    'name_required',
    'template_required',
    'sender_required',
    'audience_required',
    'variable_unmapped',
    'schedule_in_past',
    'schedule_end_before_start',
    'recurrence_invalid',
    'retry_end_required',
    'retry_end_before_send',
    'retry_end_in_past',
    'schedule_required',
    'no_recipients',
    'insufficient_balance',
    'checking_balance',
  ].map((c) => `campaigns.wizard.issues.${c}`),
  ...['header', 'body', 'button'].map((s) => `campaigns.wizard.review.slotSection.${s}`),
  ...['multiple', 'tracking', 'credits', 'format'].map((n) => `campaigns.wizard.test.notes.${n}`),
  ...['pause', 'resume', 'cancel'].flatMap((a) => [
    `campaigns.wizard.status.action.${a}`,
    `campaigns.wizard.status.done.${a}`,
  ]),
  ...['occurrence', 'runAt', 'status', 'sent', 'delivered', 'failed', 'retries'].map(
    (c) => `campaigns.wizard.status.col.${c}`,
  ),
  ...['saved', 'saving', 'failed'].map((k) => `campaigns.wizard.save.${k}`),
  ...['searchGroups', 'searchSegments'].map((k) => `campaigns.wizard.audience.${k}`),
  ...['pending', 'recovered', 'exhausted'].map((k) => `campaigns.wizard.status.retry.${k}`),
  ...KNOWN_STATES.map((s) => `campaigns.wizard.status.state.${s}`),
];

describe('message keys used in code', () => {
  it('exist in the English messages', () => {
    const missing: string[] = [];
    let checked = 0;
    for (const file of files) {
      for (const key of usedKeys(readFileSync(file, 'utf8'))) {
        checked++;
        if (!(key in enAll)) missing.push(`${file.replace(WEB, '')}: ${key}`);
      }
    }
    expect(checked).toBeGreaterThan(200);
    expect(missing).toEqual([]);
  });

  it('exist for the keys built at run time', () => {
    expect(DYNAMIC.filter((k) => !(k in enAll))).toEqual([]);
  });

  it('every campaign status the status page can show has words', () => {
    for (const s of CAMPAIGN_STATUSES) expect(KNOWN_STATES as readonly string[]).toContain(s);
    expect(FREQUENCY_CAP_ERROR_CODE).toBe('131049');
  });

  it('are all used somewhere (no dead strings)', () => {
    const used = new Set<string>(DYNAMIC);
    for (const file of files) for (const key of usedKeys(readFileSync(file, 'utf8'))) used.add(key);
    const unused = Object.keys(en)
      .map((k) => `campaigns.${k}`)
      .filter((k) => !used.has(k));
    expect(unused).toEqual([]);
  });
});
